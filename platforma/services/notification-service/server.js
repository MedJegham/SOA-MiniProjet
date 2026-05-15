/**
 * NOTIFICATION SERVICE - Microservice de notifications
 * Port gRPC: 50054
 * Gère: Envoi notifications, Préférences, Historique
 * Consomme: tous les événements Kafka métier
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

const logger = createLogger('notification-service');

// ============== CONFIG ==============
const GRPC_PORT = process.env.NOTIFICATION_GRPC_PORT || process.env.GRPC_PORT || 50054;
const DB_PATH = process.env.NOTIFICATION_DB_PATH || process.env.DATABASE_PATH || './data/notification.db';
const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {fs.mkdirSync(dataDir, { recursive: true });}

// ============== PROTO LOADING ==============
const PROTO_PATH = path.join(__dirname, '../../shared/proto/notification.proto');
const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const notificationProto = grpc.loadPackageDefinition(packageDef).notification;

// ============== DATABASE SETUP ==============
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {logger.error('Database error: ' + err.message);}
  else {logger.info('Connected to notification database at ' + DB_PATH);}
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
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'email' CHECK(type IN ('email','sms','push')),
          subject TEXT NOT NULL,
          body TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
          failureReason TEXT,
          createdAt INTEGER NOT NULL,
          sentAt INTEGER
        )
      `);
      db.run(
        `
        CREATE TABLE IF NOT EXISTS preferences (
          userId TEXT PRIMARY KEY,
          emailNotifications INTEGER NOT NULL DEFAULT 1,
          smsNotifications INTEGER NOT NULL DEFAULT 0,
          pushNotifications INTEGER NOT NULL DEFAULT 0,
          bookingConfirmed INTEGER NOT NULL DEFAULT 1,
          bookingCancelled INTEGER NOT NULL DEFAULT 1,
          paymentReceived INTEGER NOT NULL DEFAULT 1,
          paymentFailed INTEGER NOT NULL DEFAULT 1,
          reminderBeforeSlot INTEGER NOT NULL DEFAULT 1,
          updatedAt INTEGER NOT NULL
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
  clientId: 'notification-service',
  brokers: [KAFKA_BROKER],
  retry: { retries: 5 },
});
const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'notification-service-group' });

const publishEvent = async (topic, payload) => {
  try {
    await producer.send({
      topic,
      messages: [{ key: payload.notificationId || uuidv4(), value: JSON.stringify(payload) }],
    });
    logger.info(`Event published → ${topic}`);
  } catch (err) {
    logger.error(`Failed to publish to ${topic}: ${err.message}`);
  }
};

// ============== NOTIFICATION SENDER ==============
/**
 * Simulates sending a notification (email/SMS/push)
 * In production: integrate Nodemailer, Twilio, Firebase, etc.
 */
const dispatchNotification = async (notificationId, type, subject, body, recipientEmail, recipientPhone) => {
  // Simulate async send
  await new Promise((r) => setTimeout(r, 50));

  if (type === 'email') {
    logger.info(`[EMAIL] To: ${recipientEmail || 'N/A'} | Subject: ${subject}`);
  } else if (type === 'sms') {
    logger.info(`[SMS] To: ${recipientPhone || 'N/A'} | Body: ${body.substring(0, 60)}`);
  } else {
    logger.info(`[PUSH] To userId | Subject: ${subject}`);
  }

  return true; // Simulated success
};

// ============== gRPC HANDLERS ==============

/**
 * Send a notification
 */
const SendNotification = async (call, callback) => {
  const { userId, type, subject, body, recipientEmail, recipientPhone } = call.request;

  if (!userId || !subject || !body) {
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'userId, subject and body are required' });
  }

  try {
    const notificationId = uuidv4();
    const now = Date.now();
    const notifType = type || 'email';

    await dbRun(
      "INSERT INTO notifications (id, userId, type, subject, body, status, createdAt) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      [notificationId, userId, notifType, subject, body, now]
    );

    const success = await dispatchNotification(notificationId, notifType, subject, body, recipientEmail, recipientPhone);
    const sentAt = Date.now();

    if (success) {
      await dbRun("UPDATE notifications SET status = 'sent', sentAt = ? WHERE id = ?", [sentAt, notificationId]);
      await publishEvent('notification.sent', { notificationId, userId, type: notifType, subject, sentAt });
    } else {
      await dbRun("UPDATE notifications SET status = 'failed', failureReason = ? WHERE id = ?", ['Dispatch failed', notificationId]);
    }

    logger.info(`Notification ${success ? 'sent' : 'failed'}: ${notificationId}`);
    callback(null, { success, notificationId, message: success ? 'Notification sent' : 'Notification failed' });
  } catch (err) {
    logger.error('SendNotification error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Failed to send notification' });
  }
};

/**
 * Get notification preferences for a user
 */
const GetNotificationPreferences = async (call, callback) => {
  const { userId } = call.request;

  try {
    let prefs = await dbGet('SELECT * FROM preferences WHERE userId = ?', [userId]);

    if (!prefs) {
      // Create default preferences
      const now = Date.now();
      await dbRun(
        'INSERT INTO preferences (userId, emailNotifications, smsNotifications, pushNotifications, bookingConfirmed, bookingCancelled, paymentReceived, paymentFailed, reminderBeforeSlot, updatedAt) VALUES (?, 1, 0, 0, 1, 1, 1, 1, 1, ?)',
        [userId, now]
      );
      prefs = await dbGet('SELECT * FROM preferences WHERE userId = ?', [userId]);
    }

    callback(null, {
      userId: prefs.userId,
      emailNotifications: !!prefs.emailNotifications,
      smsNotifications: !!prefs.smsNotifications,
      pushNotifications: !!prefs.pushNotifications,
      types: {
        bookingConfirmed: !!prefs.bookingConfirmed,
        bookingCancelled: !!prefs.bookingCancelled,
        paymentReceived: !!prefs.paymentReceived,
        paymentFailed: !!prefs.paymentFailed,
        reminderBeforeSlot: !!prefs.reminderBeforeSlot,
      },
      updatedAt: prefs.updatedAt,
    });
  } catch (err) {
    logger.error('GetNotificationPreferences error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Database error' });
  }
};

/**
 * Update notification preferences
 */
const UpdatePreferences = async (call, callback) => {
  const { userId, emailNotifications, smsNotifications, pushNotifications, types } = call.request;

  try {
    const now = Date.now();
    await dbRun(
      `INSERT INTO preferences (userId, emailNotifications, smsNotifications, pushNotifications,
        bookingConfirmed, bookingCancelled, paymentReceived, paymentFailed, reminderBeforeSlot, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(userId) DO UPDATE SET
         emailNotifications = excluded.emailNotifications,
         smsNotifications = excluded.smsNotifications,
         pushNotifications = excluded.pushNotifications,
         bookingConfirmed = excluded.bookingConfirmed,
         bookingCancelled = excluded.bookingCancelled,
         paymentReceived = excluded.paymentReceived,
         paymentFailed = excluded.paymentFailed,
         reminderBeforeSlot = excluded.reminderBeforeSlot,
         updatedAt = excluded.updatedAt`,
      [
        userId,
        emailNotifications ? 1 : 0,
        smsNotifications ? 1 : 0,
        pushNotifications ? 1 : 0,
        types?.bookingConfirmed ? 1 : 0,
        types?.bookingCancelled ? 1 : 0,
        types?.paymentReceived ? 1 : 0,
        types?.paymentFailed ? 1 : 0,
        types?.reminderBeforeSlot ? 1 : 0,
        now,
      ]
    );

    const prefs = await dbGet('SELECT * FROM preferences WHERE userId = ?', [userId]);
    callback(null, {
      userId: prefs.userId,
      emailNotifications: !!prefs.emailNotifications,
      smsNotifications: !!prefs.smsNotifications,
      pushNotifications: !!prefs.pushNotifications,
      types: {
        bookingConfirmed: !!prefs.bookingConfirmed,
        bookingCancelled: !!prefs.bookingCancelled,
        paymentReceived: !!prefs.paymentReceived,
        paymentFailed: !!prefs.paymentFailed,
        reminderBeforeSlot: !!prefs.reminderBeforeSlot,
      },
      updatedAt: prefs.updatedAt,
    });
  } catch (err) {
    logger.error('UpdatePreferences error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Database error' });
  }
};

/**
 * Get notification history for a user
 */
const GetNotificationHistory = async (call, callback) => {
  const { userId } = call.request;

  try {
    const rows = await dbAll(
      'SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 100',
      [userId]
    );

    const notifications = rows.map((n) => ({
      id: n.id,
      userId: n.userId,
      type: n.type,
      subject: n.subject,
      body: n.body,
      status: n.status,
      createdAt: n.createdAt,
      sentAt: n.sentAt || 0,
      failureReason: n.failureReason || '',
    }));

    callback(null, { notifications, total: notifications.length });
  } catch (err) {
    logger.error('GetNotificationHistory error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Database error' });
  }
};

// ============== KAFKA CONSUMER ==============

/**
 * Build notification content based on event type
 */
const buildNotification = (topic, event) => {
  const templates = {
    'user.registered': {
      subject: 'Bienvenue sur Platforma !',
      body: `Bonjour ${event.name || 'utilisateur'}, votre compte a été créé avec succès.`,
    },
    'booking.confirmed': {
      subject: 'Réservation confirmée',
      body: `Votre réservation #${event.bookingId} a été confirmée.`,
    },
    'booking.cancelled': {
      subject: 'Réservation annulée',
      body: `Votre réservation #${event.bookingId} a été annulée.`,
    },
    'payment.completed': {
      subject: 'Paiement reçu',
      body: `Votre paiement de ${event.amount} ${event.currency || 'TND'} a été traité avec succès.`,
    },
    'payment.failed': {
      subject: 'Échec du paiement',
      body: `Votre paiement pour la réservation #${event.bookingId} a échoué. Veuillez réessayer.`,
    },
    'invoice.generated': {
      subject: 'Facture disponible',
      body: `Votre facture #${event.invoiceId} est disponible. Montant: ${event.amount} ${event.currency || 'TND'}.`,
    },
  };

  return templates[topic] || { subject: `Événement: ${topic}`, body: JSON.stringify(event) };
};

const startConsumer = async () => {
  const topics = [
    'user.registered',
    'booking.confirmed',
    'booking.cancelled',
    'payment.completed',
    'payment.failed',
    'invoice.generated',
  ];

  await consumer.subscribe({ topics, fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        const event = JSON.parse(message.value.toString());
        logger.info(`Received event from ${topic}`);

        const userId = event.userId;
        if (!userId) {return;}

        const { subject, body } = buildNotification(topic, event);
        const notificationId = uuidv4();
        const now = Date.now();

        await dbRun(
          "INSERT INTO notifications (id, userId, type, subject, body, status, createdAt) VALUES (?, ?, 'email', ?, ?, 'pending', ?)",
          [notificationId, userId, subject, body, now]
        );

        // Simulate send
        await dispatchNotification(notificationId, 'email', subject, body, null, null);
        await dbRun("UPDATE notifications SET status = 'sent', sentAt = ? WHERE id = ?", [Date.now(), notificationId]);
        await publishEvent('notification.sent', { notificationId, userId, topic, sentAt: Date.now() });
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
  server.addService(notificationProto.NotificationService.service, {
    sendNotification: SendNotification,
    getNotificationPreferences: GetNotificationPreferences,
    updatePreferences: UpdatePreferences,
    getNotificationHistory: GetNotificationHistory,
  });

  server.bindAsync(
    `0.0.0.0:${GRPC_PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        logger.error('Failed to bind gRPC server: ' + err.message);
        process.exit(1);
      }
      logger.info(`Notification Service gRPC listening on port ${port}`);
    }
  );
};

startServer().catch((err) => {
  logger.error('Startup failed: ' + err.message);
  process.exit(1);
});

process.on('SIGINT', async () => {
  logger.info('Shutting down notification-service...');
  try { await producer.disconnect(); } catch (err) { logger.warn('Producer disconnect: ' + err.message); }
  try { await consumer.disconnect(); } catch (err) { logger.warn('Consumer disconnect: ' + err.message); }
  db.close();
  process.exit(0);
});
