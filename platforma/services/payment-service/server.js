/**
 * PAYMENT SERVICE - Microservice de gestion des paiements
 * Port gRPC: 50053
 * Gère: Paiements, Remboursements, Factures, Historique
 */

'use strict';

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const sqlite3 = require('sqlite3').verbose();
const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { createLogger } = require('../../shared/logger');

const logger = createLogger('payment-service');

// ============== CONFIG ==============
const GRPC_PORT = process.env.PAYMENT_GRPC_PORT || process.env.GRPC_PORT || 50053;
const DB_PATH = process.env.PAYMENT_DB_PATH || process.env.DATABASE_PATH || './data/payment.db';
const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {fs.mkdirSync(dataDir, { recursive: true });}

// ============== PROTO LOADING ==============
const PROTO_PATH = path.join(__dirname, '../../shared/proto/payment.proto');
const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const paymentProto = grpc.loadPackageDefinition(packageDef).payment;

// ============== DATABASE SETUP ==============
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {logger.error('Database error: ' + err.message);}
  else {logger.info('Connected to payment database at ' + DB_PATH);}
});

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      if (err) {reject(err);}
      else {resolve(this);}
    })
  );

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => {
      if (err) {reject(err);}
      else {resolve(row);}
    })
  );

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => {
      if (err) {reject(err);}
      else {resolve(rows);}
    })
  );

const initDb = () =>
  new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`PRAGMA journal_mode=WAL`);
      db.run(`
        CREATE TABLE IF NOT EXISTS payments (
          id TEXT PRIMARY KEY,
          bookingId TEXT NOT NULL,
          userId TEXT NOT NULL,
          amount REAL NOT NULL,
          method TEXT NOT NULL DEFAULT 'card',
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed','refunded')),
          currency TEXT NOT NULL DEFAULT 'TND',
          createdAt INTEGER NOT NULL,
          completedAt INTEGER
        )
      `);
      db.run(
        `
        CREATE TABLE IF NOT EXISTS invoices (
          id TEXT PRIMARY KEY,
          paymentId TEXT NOT NULL,
          bookingId TEXT NOT NULL,
          amount REAL NOT NULL,
          currency TEXT NOT NULL DEFAULT 'TND',
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','viewed')),
          issuedAt INTEGER NOT NULL,
          FOREIGN KEY(paymentId) REFERENCES payments(id)
        )
      `,
        (err) => {
          if (err) {reject(err);}
          else {resolve();}
        }
      );
    });
  });

// ============== KAFKA SETUP ==============
const kafka = new Kafka({
  clientId: 'payment-service',
  brokers: [KAFKA_BROKER],
  retry: { retries: 5 },
});
const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'payment-service-group' });

const publishEvent = async (topic, payload) => {
  try {
    await producer.send({
      topic,
      messages: [{ key: payload.paymentId || uuidv4(), value: JSON.stringify(payload) }],
    });
    logger.info(`Event published → ${topic}`);
  } catch (err) {
    logger.error(`Failed to publish to ${topic}: ${err.message}`);
  }
};

// ============== gRPC HANDLERS ==============

/**
 * Process a payment for a booking
 */
const ProcessPayment = async (call, callback) => {
  const { bookingId, userId, amount, method, currency } = call.request;

  if (!bookingId || !userId || !amount) {
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'bookingId, userId and amount are required' });
  }

  try {
    // Prevent duplicate payment for same booking
    const existing = await dbGet(
      "SELECT id FROM payments WHERE bookingId = ? AND status IN ('pending','completed')",
      [bookingId]
    );
    if (existing) {
      return callback({ code: grpc.status.ALREADY_EXISTS, message: 'Payment already exists for this booking' });
    }

    const paymentId = uuidv4();
    const now = Date.now();
    const curr = currency || 'TND';
    const meth = method || 'card';

    await dbRun(
      'INSERT INTO payments (id, bookingId, userId, amount, method, status, currency, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [paymentId, bookingId, userId, amount, meth, 'pending', curr, now]
    );

    await publishEvent('payment.initiated', { paymentId, bookingId, userId, amount, method: meth, currency: curr, createdAt: now });

    // Simulate payment processing (in production: integrate real payment gateway)
    const completedAt = Date.now();
    await dbRun("UPDATE payments SET status = 'completed', completedAt = ? WHERE id = ?", [completedAt, paymentId]);

    // Generate invoice
    const invoiceId = uuidv4();
    await dbRun(
      "INSERT INTO invoices (id, paymentId, bookingId, amount, currency, status, issuedAt) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      [invoiceId, paymentId, bookingId, amount, curr, completedAt]
    );

    await publishEvent('payment.completed', { paymentId, bookingId, userId, amount, currency: curr, completedAt });
    await publishEvent('invoice.generated', { invoiceId, paymentId, bookingId, userId, amount, currency: curr, issuedAt: completedAt });

    logger.info(`Payment completed: ${paymentId} for booking ${bookingId}`);
    callback(null, { success: true, paymentId, status: 'completed', message: 'Payment processed successfully' });
  } catch (err) {
    logger.error('ProcessPayment error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Payment processing failed' });
  }
};

/**
 * Refund a payment
 */
const RefundPayment = async (call, callback) => {
  const { paymentId, reason } = call.request;

  try {
    const payment = await dbGet('SELECT * FROM payments WHERE id = ?', [paymentId]);
    if (!payment) {
      return callback({ code: grpc.status.NOT_FOUND, message: 'Payment not found' });
    }
    if (payment.status !== 'completed') {
      return callback({ code: grpc.status.FAILED_PRECONDITION, message: 'Only completed payments can be refunded' });
    }

    await dbRun("UPDATE payments SET status = 'refunded' WHERE id = ?", [paymentId]);

    await publishEvent('payment.refunded', {
      paymentId,
      bookingId: payment.bookingId,
      userId: payment.userId,
      amount: payment.amount,
      reason: reason || '',
      refundedAt: Date.now(),
    });

    logger.info(`Payment refunded: ${paymentId}`);
    callback(null, { success: true, message: 'Refund processed successfully', refundedAmount: payment.amount });
  } catch (err) {
    logger.error('RefundPayment error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Refund failed' });
  }
};

/**
 * Get payment status by ID
 */
const GetPaymentStatus = async (call, callback) => {
  const { paymentId } = call.request;

  try {
    const p = await dbGet('SELECT * FROM payments WHERE id = ?', [paymentId]);
    if (!p) {
      return callback({ code: grpc.status.NOT_FOUND, message: 'Payment not found' });
    }
    callback(null, {
      paymentId: p.id,
      bookingId: p.bookingId,
      userId: p.userId,
      amount: p.amount,
      method: p.method,
      status: p.status,
      createdAt: p.createdAt,
      completedAt: p.completedAt || 0,
    });
  } catch (err) {
    logger.error('GetPaymentStatus error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Database error' });
  }
};

/**
 * Get invoice for a booking
 */
const GetInvoice = async (call, callback) => {
  const { bookingId } = call.request;

  try {
    const inv = await dbGet('SELECT * FROM invoices WHERE bookingId = ?', [bookingId]);
    if (!inv) {
      return callback({ code: grpc.status.NOT_FOUND, message: 'Invoice not found' });
    }
    callback(null, {
      invoice: {
        id: inv.id,
        paymentId: inv.paymentId,
        bookingId: inv.bookingId,
        amount: inv.amount,
        currency: inv.currency,
        issuedAt: inv.issuedAt,
        pdfUrl: `/invoices/${inv.id}.pdf`,
        status: inv.status,
      },
    });
  } catch (err) {
    logger.error('GetInvoice error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Database error' });
  }
};

/**
 * List payments for a user
 */
const ListPayments = async (call, callback) => {
  const { userId, limit, offset, status } = call.request;

  try {
    const lim = limit || 50;
    const off = offset || 0;

    let sql = 'SELECT * FROM payments WHERE userId = ?';
    const params = [userId];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
    params.push(lim, off);

    const rows = await dbAll(sql, params);
    const countRow = await dbGet('SELECT COUNT(*) as total FROM payments WHERE userId = ?', [userId]);

    const payments = rows.map((p) => ({
      id: p.id,
      bookingId: p.bookingId,
      userId: p.userId,
      amount: p.amount,
      method: p.method,
      status: p.status,
      currency: p.currency,
      createdAt: p.createdAt,
      completedAt: p.completedAt || 0,
    }));

    callback(null, { payments, total: countRow.total });
  } catch (err) {
    logger.error('ListPayments error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Database error' });
  }
};

// ============== KAFKA CONSUMER ==============
const startConsumer = async () => {
  await consumer.subscribe({ topics: ['booking.confirmed', 'booking.cancelled'], fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        const event = JSON.parse(message.value.toString());
        logger.info(`Received event from ${topic}: ${JSON.stringify(event)}`);

        if (topic === 'booking.cancelled' && event.bookingId) {
          // Auto-refund if payment exists
          const payment = await dbGet(
            "SELECT * FROM payments WHERE bookingId = ? AND status = 'completed'",
            [event.bookingId]
          );
          if (payment) {
            await dbRun("UPDATE payments SET status = 'refunded' WHERE id = ?", [payment.id]);
            await publishEvent('payment.refunded', {
              paymentId: payment.id,
              bookingId: event.bookingId,
              userId: payment.userId,
              amount: payment.amount,
              reason: 'Booking cancelled',
              refundedAt: Date.now(),
            });
            logger.info(`Auto-refund issued for cancelled booking ${event.bookingId}`);
          }
        }
      } catch (err) {
        logger.error(`Error processing ${topic} event: ${err.message}`);
      }
    },
  });
};

// ============== START SERVER ==============
const startServer = async () => {
  await initDb();
  logger.info('Database initialized');

  try {
    await producer.connect();
    await consumer.connect();
    await startConsumer();
    logger.info('Kafka connected');
  } catch (err) {
    logger.warn('Kafka unavailable, continuing without events: ' + err.message);
  }

  const server = new grpc.Server();
  server.addService(paymentProto.PaymentService.service, {
    processPayment: ProcessPayment,
    refundPayment: RefundPayment,
    getPaymentStatus: GetPaymentStatus,
    getInvoice: GetInvoice,
    listPayments: ListPayments,
  });

  server.bindAsync(
    `0.0.0.0:${GRPC_PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        logger.error('Failed to bind gRPC server: ' + err.message);
        process.exit(1);
      }
      logger.info(`Payment Service gRPC listening on port ${port}`);
    }
  );
};

startServer().catch((err) => {
  logger.error('Startup failed: ' + err.message);
  process.exit(1);
});

process.on('SIGINT', async () => {
  logger.info('Shutting down payment-service...');
  try { await producer.disconnect(); } catch (err) { logger.warn('Producer disconnect: ' + err.message); }
  try { await consumer.disconnect(); } catch (err) { logger.warn('Consumer disconnect: ' + err.message); }
  db.close();
  process.exit(0);
});
