/**
 * AUTH SERVICE - Microservice d'authentification
 * Port gRPC: 50051
 * Gère: Inscription, Login, Validation tokens, Profils utilisateurs
 */

'use strict';

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { createLogger } = require('../../shared/logger');

const logger = createLogger('auth-service');

// ============== CONFIG ==============
const GRPC_PORT = process.env.AUTH_GRPC_PORT || process.env.GRPC_PORT || 50051;
const JWT_SECRET = process.env.JWT_SECRET || 'platforma-secret-change-in-prod';
const JWT_EXPIRY = '7d';
const DB_PATH = process.env.AUTH_DB_PATH || process.env.DATABASE_PATH || './data/auth.db';
const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {fs.mkdirSync(dataDir, { recursive: true });}

// ============== PROTO LOADING ==============
const PROTO_PATH = path.join(__dirname, '../../shared/proto/auth.proto');
const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const authProto = grpc.loadPackageDefinition(packageDef).auth;

// ============== DATABASE SETUP ==============
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {logger.error('Database connection error: ' + err.message);}
  else {logger.info('Connected to SQLite database at ' + DB_PATH);}
});

// Promisify db helpers
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

const initDb = () =>
  new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`PRAGMA journal_mode=WAL`);
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          passwordHash TEXT NOT NULL,
          name TEXT NOT NULL,
          role TEXT DEFAULT 'client' CHECK(role IN ('client','provider','admin')),
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL
        )
      `);
      db.run(
        `
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          token TEXT NOT NULL,
          expiresAt INTEGER NOT NULL,
          FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
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
  clientId: 'auth-service',
  brokers: [KAFKA_BROKER],
  retry: { retries: 5 },
});
const producer = kafka.producer();

const publishEvent = async (topic, payload) => {
  try {
    await producer.send({
      topic,
      messages: [{ key: payload.userId || uuidv4(), value: JSON.stringify(payload) }],
    });
    logger.info(`Event published → ${topic}`);
  } catch (err) {
    logger.error(`Failed to publish to ${topic}: ${err.message}`);
  }
};

// ============== gRPC HANDLERS ==============

/**
 * Register a new user
 */
const RegisterUser = async (call, callback) => {
  const { email, password, name, role } = call.request;

  if (!email || !password || !name) {
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'email, password and name are required' });
  }

  try {
    const existing = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return callback({ code: grpc.status.ALREADY_EXISTS, message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = uuidv4();
    const now = Date.now();
    const userRole = ['client', 'provider', 'admin'].includes(role) ? role : 'client';

    await dbRun(
      'INSERT INTO users (id, email, passwordHash, name, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, email, passwordHash, name, userRole, now, now]
    );

    await publishEvent('user.registered', { userId, email, name, role: userRole, createdAt: now });

    logger.info(`User registered: ${email} (${userId})`);
    callback(null, { success: true, userId, message: 'User registered successfully' });
  } catch (err) {
    logger.error('RegisterUser error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Internal server error' });
  }
};

/**
 * Authenticate user and return JWT
 */
const Authenticate = async (call, callback) => {
  const { email, password } = call.request;

  if (!email || !password) {
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'email and password are required' });
  }

  try {
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      return callback({ code: grpc.status.UNAUTHENTICATED, message: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return callback({ code: grpc.status.UNAUTHENTICATED, message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    const sessionId = uuidv4();
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    await dbRun(
      'INSERT INTO sessions (id, userId, token, expiresAt) VALUES (?, ?, ?, ?)',
      [sessionId, user.id, token, expiresAt]
    );

    logger.info(`User authenticated: ${email}`);
    callback(null, { token, userId: user.id, role: user.role, expiresIn: expiresAt });
  } catch (err) {
    logger.error('Authenticate error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Internal server error' });
  }
};

/**
 * Validate a JWT token
 */
const ValidateToken = (call, callback) => {
  const { token } = call.request;
  if (!token) {
    return callback(null, { valid: false, userId: '', email: '', role: '' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    callback(null, { valid: true, userId: decoded.userId, email: decoded.email, role: decoded.role });
  } catch {
    callback(null, { valid: false, userId: '', email: '', role: '' });
  }
};

/**
 * Get user profile by ID
 */
const GetUserProfile = async (call, callback) => {
  const { userId } = call.request;

  try {
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return callback({ code: grpc.status.NOT_FOUND, message: 'User not found' });
    }
    callback(null, {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  } catch (err) {
    logger.error('GetUserProfile error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Internal server error' });
  }
};

/**
 * Update user profile
 */
const UpdateProfile = async (call, callback) => {
  const { userId, name, email } = call.request;

  try {
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return callback({ code: grpc.status.NOT_FOUND, message: 'User not found' });
    }

    const newName = name || user.name;
    const newEmail = email || user.email;
    const now = Date.now();

    await dbRun('UPDATE users SET name = ?, email = ?, updatedAt = ? WHERE id = ?', [
      newName, newEmail, now, userId,
    ]);

    await publishEvent('user.updated', { userId, name: newName, email: newEmail, updatedAt: now });

    const updated = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    callback(null, {
      success: true,
      profile: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err) {
    logger.error('UpdateProfile error: ' + err.message);
    callback({ code: grpc.status.INTERNAL, message: 'Internal server error' });
  }
};

// ============== START SERVER ==============
const startServer = async () => {
  await initDb();
  logger.info('Database initialized');

  try {
    await producer.connect();
    logger.info('Kafka producer connected');
  } catch (err) {
    logger.warn('Kafka unavailable, events will be skipped: ' + err.message);
  }

  const server = new grpc.Server();
  server.addService(authProto.AuthService.service, {
    authenticate: Authenticate,
    validateToken: ValidateToken,
    registerUser: RegisterUser,
    getUserProfile: GetUserProfile,
    updateProfile: UpdateProfile,
  });

  server.bindAsync(
    `0.0.0.0:${GRPC_PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        logger.error('Failed to bind gRPC server: ' + err.message);
        process.exit(1);
      }
      logger.info(`Auth Service gRPC listening on port ${port}`);
    }
  );
};

startServer().catch((err) => {
  logger.error('Startup failed: ' + err.message);
  process.exit(1);
});

process.on('SIGINT', async () => {
  logger.info('Shutting down auth-service...');
  try { await producer.disconnect(); } catch (err) { logger.warn('Producer disconnect: ' + err.message); }
  db.close();
  process.exit(0);
});
