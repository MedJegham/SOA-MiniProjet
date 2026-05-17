/**
 * NOTIFICATION SERVICE - Microservice de notifications
 * Port gRPC: 50054
 * Gère: Envoi notifications, Préférences, Historique
 * Consomme: tous les événements Kafka métier
 * Base de données: RxDB (NoSQL)
 */

'use strict';

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { createLogger } = require('../../shared/logger');
const { buildNotification } = require('./templates');

const logger = createLogger('notification-service');

// ============== CONFIG ==============
const GRPC_PORT = process.env.NOTIFICATION_GRPC_PORT || process.env.GRPC_PORT || 50054;
const DB_PATH = process.env.NOTIFICATION_DB_PATH || process.env.DATABASE_PATH || './data/notification-rxdb';
const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';

// Ensure data directory exists
const dataDir = path.resolve(DB_PATH);
if (!fs.existsSync(dataDir)) { fs.mkdirSync(dataDir, { recursive: true }); }

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

// ============== RxDB SETUP ==============
// RxDB with LokiJS adapter (pure Node.js, no browser APIs needed)
let db;
let notificationsCollection;
let preferencesCollection;

const initRxDB = async () => {
  const { createRxDatabase, addRxPlugin } = require('rxdb');
  const { getRxStorageLoki } = require('rxdb/plugins/storage-lokijs');
  const { RxDBQueryBuilderPlugin } = require('rxdb/plugins/query-builder');
  const { RxDBUpdatePlugin } = require('rxdb/plugins/update');

  addRxPlugin(RxDBQueryBuilderPlugin);
  addRxPlugin(RxDBUpdatePlugin);

  db = await createRxDatabase({
    name: path.join(dataDir, 'notificationdb'),
    storage: getRxStorageLoki({
      autosave: true,
      autosaveInterval: 500,
      persistenceAdapter: (() => {
        const LokiFsAdapter = require('lokijs/src/lokijs').LokiFsAdapter || require('lokijs').LokiFsAdapter;
        return new LokiFsAdapter();
      })(),
    }),
    ignoreDuplicate: true,
  });

  const notificationSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
      id:            { type: 'string', maxLength: 36 },
      userId:        { type: 'string' },
      type:          { type: 'string', enum: ['email', 'sms', 'push'], default: 'email' },
      subject:       { type: 'string' },
      body:          { type: 'string' },
      status:        { type: 'string', enum: ['pending', 'sent', 'failed'], default: 'pending' },
      failureReason: { type: 'string', default: '' },
      createdAt:     { type: 'number' },
      sentAt:        { type: 'number', default: 0 },
    },
    required: ['id', 'userId', 'type', 'subject', 'body', 'status', 'createdAt'],
  };

  const preferencesSchema = {
    version: 0,
    primaryKey: 'userId',
    type: 'object',
    properties: {
      userId:               { type: 'string', maxLength: 36 },
      emailNotifications:   { type: 'boolean', default: true },
      smsNotifications:     { type: 'boolean', default: false },
      pushNotifications:    { type: 'boolean', default: false },
      bookingConfirmed:     { type: 'boolean', default: true },
      bookingCancelled:     { type: 'boolean', default: true },
      paymentReceived:      { type: 'boolean', default: true },
      paymentFailed:        { type: 'boolean', default: true },
      reminderBeforeSlot:   { type: 'boolean', default: true },
      updatedAt:            { type: 'number' },
    },
    required: ['userId', 'updatedAt'],
  };

  const collections = await db.addCollections({
    notifications: { schema: notificationSchema },
    preferences:   { schema: preferencesSchema },
  });

  notificationsCollection = collections.notifications;
  preferencesCollection   = collections.preferences;

  logger.info('RxDB initialized at ' + dataDir);
};

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
  await new Promise((r) => setTimeout(r, 50));
  if (type === 'email') {
    logger.info(`[EMAIL] To: ${recipientEmail || 'N/A'} | Subject: ${subject}`);
  } else if (type === 'sms') {
    logger.info(`[SMS] To: ${recipientPhone || 'N/A'} | Body: ${body.substring(0, 60)}`);
  } else {
    logger.info(`[PUSH] Subject: ${subject}`);
  }
  return true;
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

    await notificationsCollection.insert({
      id: notificationId,
      userId,
      type: notifType,
      subject,
      body,
      status: 'pending',
      failureReason: '',
      createdAt: now,
      sentAt: 0,
    });

    const success = await dispatchNotification(notificationId, notifType, subject, body, recipientEmail, recipientPhone);
    const sentAt = Date.now();

    const doc = await notificationsCollection.findOne(notificationId).exec();
    if (doc) {
      await doc.patch({
        status: success ? 'sent' : 'failed',
        sentAt: success ? sentAt : 0,
        failureReason: success ? '' : 'Dispatch failed',
      });
    }

    if (success) {
      await publishEvent('notification.sent', { notificationId, userId, type: notifType, subject, sentAt });
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
    let prefs = await preferencesCollection.findOne(userId).exec();

    if (!prefs) {
      const now = Date.now();
      await preferencesCollection.insert({
        userId,
        emailNotifications: true,
        smsNotifications: false,
        pushNotifications: false,
        bookingConfirmed: true,
        bookingCancelled: true,
        paymentReceived: true,
        paymentFailed: true,
        reminderBeforeSlot: true,
        updatedAt: now,
      });
      prefs = await preferencesCollection.findOne(userId).exec();
    }

    const p = prefs.toJSON();
    callback(null, {
      userId: p.userId,
      emailNotifications: p.emailNotifications,
      smsNotifications: p.smsNotifications,
      pushNotifications: p.pushNotifications,
      types: {
        bookingConfirmed: p.bookingConfirmed,
        bookingCancelled: p.bookingCancelled,
        paymentReceived: p.paymentReceived,
        paymentFailed: p.paymentFailed,
        reminderBeforeSlot: p.reminderBeforeSlot,
      },
      updatedAt: p.updatedAt,
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
    const data = {
      userId,
      emailNotifications: !!emailNotifications,
      smsNotifications: !!smsNotifications,
      pushNotifications: !!pushNotifications,
      bookingConfirmed: !!(types && types.bookingConfirmed),
      bookingCancelled: !!(types && types.bookingCancelled),
      paymentReceived: !!(types && types.paymentReceived),
      paymentFailed: !!(types && types.paymentFailed),
      reminderBeforeSlot: !!(types && types.reminderBeforeSlot),
      updatedAt: now,
    };

    const existing = await preferencesCollection.findOne(userId).exec();
    if (existing) {
      await existing.patch(data);
    } else {
      await preferencesCollection.insert(data);
    }

    const prefs = await preferencesCollection.findOne(userId).exec();
    const p = prefs.toJSON();
    callback(null, {
      userId: p.userId,
      emailNotifications: p.emailNotifications,
      smsNotifications: p.smsNotifications,
      pushNotifications: p.pushNotifications,
      types: {
        bookingConfirmed: p.bookingConfirmed,
        bookingCancelled: p.bookingCancelled,
        paymentReceived: p.paymentReceived,
        paymentFailed: p.paymentFailed,
        reminderBeforeSlot: p.reminderBeforeSlot,
      },
      updatedAt: p.updatedAt,
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
    const docs = await notificationsCollection
      .find({ selector: { userId: { $eq: userId } } })
      .exec();

    const notifications = docs
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100)
      .map((n) => {
        const d = n.toJSON();
        return {
          id: d.id,
          userId: d.userId,
          type: d.type,
          subject: d.subject,
          body: d.body,
          status: d.status,
          createdAt: d.createdAt,
          sentAt: d.sentAt || 0,
          failureReason: d.failureReason || '',
        };
      });

    callback(null, { notifications, total: notifications.length });
  } catch (err) {
    logger.error('GetNotificationHistory error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Database error' });
  }
};

// ============== KAFKA CONSUMER ==============

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
        if (!userId) { return; }

        const { subject, body } = buildNotification(topic, event);
        const notificationId = uuidv4();
        const now = Date.now();

        await notificationsCollection.insert({
          id: notificationId,
          userId,
          type: 'email',
          subject,
          body,
          status: 'pending',
          failureReason: '',
          createdAt: now,
          sentAt: 0,
        });

        await dispatchNotification(notificationId, 'email', subject, body, null, null);

        const doc = await notificationsCollection.findOne(notificationId).exec();
        if (doc) {
          await doc.patch({ status: 'sent', sentAt: Date.now() });
        }

        await publishEvent('notification.sent', { notificationId, userId, topic, sentAt: Date.now() });
      } catch (err) {
        logger.error(`Error processing ${topic} event: ${err.message}`);
      }
    },
  });
};

// ============== START SERVER ==============
const startServer = async () => {
  await initRxDB();

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
  if (db) { await db.destroy(); }
  process.exit(0);
});
