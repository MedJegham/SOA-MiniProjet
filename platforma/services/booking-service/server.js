/**
 * BOOKING SERVICE - Microservice de gestion des réservations
 * Port gRPC: 50052
 * Gère: Créneaux, Réservations, Calendrier, Annulations
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

const logger = createLogger('booking-service');

// ============== CONFIG ==============
const GRPC_PORT = process.env.BOOKING_GRPC_PORT || process.env.GRPC_PORT || 50052;
const DB_PATH = process.env.BOOKING_DB_PATH || process.env.DATABASE_PATH || './data/booking.db';
const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {fs.mkdirSync(dataDir, { recursive: true });}

// ============== PROTO LOADING ==============
const PROTO_PATH = path.join(__dirname, '../../shared/proto/booking.proto');
const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const bookingProto = grpc.loadPackageDefinition(packageDef).booking;

// ============== DATABASE SETUP ==============
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {logger.error('Database error: ' + err.message);}
  else {logger.info('Connected to booking database at ' + DB_PATH);}
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
        CREATE TABLE IF NOT EXISTS slots (
          id TEXT PRIMARY KEY,
          serviceId TEXT NOT NULL,
          startTime INTEGER NOT NULL,
          endTime INTEGER NOT NULL,
          capacity INTEGER NOT NULL DEFAULT 1,
          booked INTEGER NOT NULL DEFAULT 0,
          price REAL NOT NULL DEFAULT 0,
          createdAt INTEGER NOT NULL
        )
      `);
      db.run(
        `
        CREATE TABLE IF NOT EXISTS bookings (
          id TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          slotId TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled','pending')),
          createdAt INTEGER NOT NULL,
          cancelledAt INTEGER,
          cancelReason TEXT,
          FOREIGN KEY(slotId) REFERENCES slots(id)
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
  clientId: 'booking-service',
  brokers: [KAFKA_BROKER],
  retry: { retries: 5 },
});
const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'booking-service-group' });

const publishEvent = async (topic, payload) => {
  try {
    await producer.send({
      topic,
      messages: [{ key: payload.bookingId || payload.slotId || uuidv4(), value: JSON.stringify(payload) }],
    });
    logger.info(`Event published → ${topic}`);
  } catch (err) {
    logger.error(`Failed to publish to ${topic}: ${err.message}`);
  }
};

// ============== gRPC HANDLERS ==============

/**
 * Create a new time slot for a service
 */
const CreateSlot = async (call, callback) => {
  const { serviceId, startTime, endTime, capacity, price } = call.request;

  if (!serviceId || !startTime || !endTime) {
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'serviceId, startTime and endTime are required' });
  }
  if (endTime <= startTime) {
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'endTime must be after startTime' });
  }

  try {
    const slotId = uuidv4();
    const createdAt = Date.now();

    await dbRun(
      'INSERT INTO slots (id, serviceId, startTime, endTime, capacity, booked, price, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
      [slotId, serviceId, startTime, endTime, capacity || 1, price || 0, createdAt]
    );

    await publishEvent('slot.created', { slotId, serviceId, startTime, endTime, capacity, price, createdAt });

    logger.info(`Slot created: ${slotId} for service ${serviceId}`);
    callback(null, { success: true, slotId, message: 'Slot created successfully' });
  } catch (err) {
    logger.error('CreateSlot error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Failed to create slot' });
  }
};

/**
 * Book a time slot for a user
 */
const BookSlot = async (call, callback) => {
  const { userId, slotId } = call.request;

  if (!userId || !slotId) {
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'userId and slotId are required' });
  }

  try {
    const slot = await dbGet('SELECT * FROM slots WHERE id = ?', [slotId]);
    if (!slot) {
      return callback({ code: grpc.status.NOT_FOUND, message: 'Slot not found' });
    }
    if (slot.booked >= slot.capacity) {
      return callback({ code: grpc.status.UNAVAILABLE, message: 'Slot is fully booked' });
    }

    // Prevent double booking
    const existing = await dbGet(
      "SELECT id FROM bookings WHERE userId = ? AND slotId = ? AND status = 'confirmed'",
      [userId, slotId]
    );
    if (existing) {
      return callback({ code: grpc.status.ALREADY_EXISTS, message: 'You already have a booking for this slot' });
    }

    const bookingId = uuidv4();
    const createdAt = Date.now();

    await dbRun(
      "INSERT INTO bookings (id, userId, slotId, status, createdAt) VALUES (?, ?, ?, 'confirmed', ?)",
      [bookingId, userId, slotId, createdAt]
    );
    await dbRun('UPDATE slots SET booked = booked + 1 WHERE id = ?', [slotId]);

    await publishEvent('booking.confirmed', {
      bookingId,
      userId,
      slotId,
      serviceId: slot.serviceId,
      amount: slot.price,
      createdAt,
    });

    logger.info(`Booking confirmed: ${bookingId} by user ${userId}`);
    callback(null, { success: true, bookingId, message: 'Booking confirmed' });
  } catch (err) {
    logger.error('BookSlot error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Failed to create booking' });
  }
};

/**
 * Get available slots for a service on a given date
 */
const GetAvailableSlots = async (call, callback) => {
  const { serviceId, date, startTime, endTime } = call.request;

  try {
    let sql, params;

    if (startTime && endTime) {
      sql = 'SELECT * FROM slots WHERE serviceId = ? AND startTime >= ? AND endTime <= ? ORDER BY startTime';
      params = [serviceId, startTime, endTime];
    } else {
      const dayStart = Math.floor(date / 86400000) * 86400000;
      const dayEnd = dayStart + 86400000;
      sql = 'SELECT * FROM slots WHERE serviceId = ? AND startTime >= ? AND startTime < ? ORDER BY startTime';
      params = [serviceId, dayStart, dayEnd];
    }

    const rows = await dbAll(sql, params);
    const slots = rows.map((s) => ({
      id: s.id,
      serviceId: s.serviceId,
      startTime: s.startTime,
      endTime: s.endTime,
      capacity: s.capacity,
      booked: s.booked,
      price: s.price,
      createdAt: s.createdAt,
    }));

    const totalAvailable = slots.reduce((acc, s) => acc + (s.capacity - s.booked), 0);
    callback(null, { slots, totalAvailable });
  } catch (err) {
    logger.error('GetAvailableSlots error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Database error' });
  }
};

/**
 * Cancel a booking
 */
const CancelBooking = async (call, callback) => {
  const { bookingId, reason } = call.request;

  try {
    const booking = await dbGet('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    if (!booking) {
      return callback({ code: grpc.status.NOT_FOUND, message: 'Booking not found' });
    }
    if (booking.status === 'cancelled') {
      return callback({ code: grpc.status.FAILED_PRECONDITION, message: 'Booking already cancelled' });
    }

    const now = Date.now();
    await dbRun(
      "UPDATE bookings SET status = 'cancelled', cancelledAt = ?, cancelReason = ? WHERE id = ?",
      [now, reason || '', bookingId]
    );
    await dbRun('UPDATE slots SET booked = MAX(0, booked - 1) WHERE id = ?', [booking.slotId]);

    await publishEvent('booking.cancelled', {
      bookingId,
      userId: booking.userId,
      slotId: booking.slotId,
      reason: reason || '',
      cancelledAt: now,
    });

    logger.info(`Booking cancelled: ${bookingId}`);
    callback(null, { success: true, message: 'Booking cancelled successfully' });
  } catch (err) {
    logger.error('CancelBooking error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Failed to cancel booking' });
  }
};

/**
 * List all bookings for a user
 */
const ListBookings = async (call, callback) => {
  const { userId, limit, offset } = call.request;

  try {
    const lim = limit || 50;
    const off = offset || 0;

    const rows = await dbAll(
      `SELECT b.*, s.serviceId, s.startTime, s.endTime, s.capacity, s.booked, s.price
       FROM bookings b
       JOIN slots s ON b.slotId = s.id
       WHERE b.userId = ?
       ORDER BY b.createdAt DESC
       LIMIT ? OFFSET ?`,
      [userId, lim, off]
    );

    const countRow = await dbGet('SELECT COUNT(*) as total FROM bookings WHERE userId = ?', [userId]);

    const bookings = rows.map((b) => ({
      id: b.id,
      userId: b.userId,
      slot: {
        id: b.slotId,
        serviceId: b.serviceId,
        startTime: b.startTime,
        endTime: b.endTime,
        capacity: b.capacity,
        booked: b.booked,
        price: b.price,
        createdAt: b.createdAt,
      },
      status: b.status,
      totalPrice: b.price,
      createdAt: b.createdAt,
      cancelledAt: b.cancelledAt || 0,
    }));

    callback(null, { bookings, total: countRow.total });
  } catch (err) {
    logger.error('ListBookings error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Database error' });
  }
};

/**
 * Get a single booking by ID
 */
const GetBooking = async (call, callback) => {
  const { bookingId } = call.request;

  try {
    const b = await dbGet(
      `SELECT b.*, s.serviceId, s.startTime, s.endTime, s.capacity, s.booked, s.price
       FROM bookings b
       JOIN slots s ON b.slotId = s.id
       WHERE b.id = ?`,
      [bookingId]
    );

    if (!b) {
      return callback({ code: grpc.status.NOT_FOUND, message: 'Booking not found' });
    }

    callback(null, {
      booking: {
        id: b.id,
        userId: b.userId,
        slot: {
          id: b.slotId,
          serviceId: b.serviceId,
          startTime: b.startTime,
          endTime: b.endTime,
          capacity: b.capacity,
          booked: b.booked,
          price: b.price,
          createdAt: b.createdAt,
        },
        status: b.status,
        totalPrice: b.price,
        createdAt: b.createdAt,
        cancelledAt: b.cancelledAt || 0,
      },
    });
  } catch (err) {
    logger.error('GetBooking error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Database error' });
  }
};

// ============== KAFKA CONSUMER ==============
const startConsumer = async () => {
  await consumer.subscribe({ topics: ['payment.failed', 'payment.completed'], fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        const event = JSON.parse(message.value.toString());
        logger.info(`Received event from ${topic}: ${JSON.stringify(event)}`);

        if (topic === 'payment.failed' && event.bookingId) {
          // Mark booking as cancelled if payment failed
          await dbRun(
            "UPDATE bookings SET status = 'cancelled', cancelledAt = ? WHERE id = ? AND status = 'confirmed'",
            [Date.now(), event.bookingId]
          );
          logger.info(`Booking ${event.bookingId} cancelled due to payment failure`);
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
  server.addService(bookingProto.BookingService.service, {
    createSlot: CreateSlot,
    bookSlot: BookSlot,
    getAvailableSlots: GetAvailableSlots,
    cancelBooking: CancelBooking,
    listBookings: ListBookings,
    getBooking: GetBooking,
  });

  server.bindAsync(
    `0.0.0.0:${GRPC_PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        logger.error('Failed to bind gRPC server: ' + err.message);
        process.exit(1);
      }
      logger.info(`Booking Service gRPC listening on port ${port}`);
    }
  );
};

startServer().catch((err) => {
  logger.error('Startup failed: ' + err.message);
  process.exit(1);
});

process.on('SIGINT', async () => {
  logger.info('Shutting down booking-service...');
  try { await producer.disconnect(); } catch (err) { logger.warn('Producer disconnect: ' + err.message); }
  try { await consumer.disconnect(); } catch (err) { logger.warn('Consumer disconnect: ' + err.message); }
  db.close();
  process.exit(0);
});
