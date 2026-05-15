/**
 * API GATEWAY - Point d'entrée unique
 * Port: 3000
 * REST + GraphQL
 * Communique avec tous les microservices via gRPC
 */

'use strict';

const express = require('express');
const { ApolloServer, gql } = require('apollo-server-express');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { createLogger } = require('../shared/logger');

const logger = createLogger('api-gateway');

// ============== CONFIG ==============
const PORT = process.env.PORT || 3000;
const AUTH_URL = process.env.AUTH_SERVICE_URL || 'localhost:50051';
const BOOKING_URL = process.env.BOOKING_SERVICE_URL || 'localhost:50052';
const PAYMENT_URL = process.env.PAYMENT_SERVICE_URL || 'localhost:50053';
const NOTIFICATION_URL = process.env.NOTIFICATION_SERVICE_URL || 'localhost:50054';

// ============== gRPC CLIENT FACTORY ==============
const loadClient = (protoFile, packageName, serviceName, url) => {
  const protoPath = path.join(__dirname, '../shared/proto', protoFile);
  const def = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const pkg = grpc.loadPackageDefinition(def)[packageName];
  return new pkg[serviceName](url, grpc.credentials.createInsecure());
};

const authClient = loadClient('auth.proto', 'auth', 'AuthService', AUTH_URL);
const bookingClient = loadClient('booking.proto', 'booking', 'BookingService', BOOKING_URL);
const paymentClient = loadClient('payment.proto', 'payment', 'PaymentService', PAYMENT_URL);
const notificationClient = loadClient('notification.proto', 'notification', 'NotificationService', NOTIFICATION_URL);

/**
 * Promisify a gRPC unary call
 */
const grpcCall = (client, method, request) =>
  new Promise((resolve, reject) => {
    client[method](request, (err, response) => {
      if (err) {reject(err);}
      else {resolve(response);}
    });
  });

// ============== EXPRESS SETUP ==============
const app = express();
app.use(cors());
app.use(express.json());

// Request logger middleware
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// ============== AUTH MIDDLEWARE ==============
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or malformed' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const result = await grpcCall(authClient, 'validateToken', { token });
    if (!result.valid) {return res.status(401).json({ error: 'Invalid or expired token' });}
    req.userId = result.userId;
    req.userRole = result.role;
    next();
  } catch {
    res.status(401).json({ error: 'Token validation failed' });
  }
};

// ============== REST ROUTES ==============

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-gateway', timestamp: Date.now() });
});

// ---------- AUTH ----------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'email, password and name are required' });
    }
    const result = await grpcCall(authClient, 'registerUser', { email, password, name, role: role || 'client' });
    res.status(201).json({ success: result.success, userId: result.userId, message: result.message });
  } catch (err) {
    const status = err.code === grpc.status.ALREADY_EXISTS ? 409 : 400;
    res.status(status).json({ error: err.details || err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {return res.status(400).json({ error: 'email and password are required' });}
    const result = await grpcCall(authClient, 'authenticate', { email, password });
    res.json({ token: result.token, userId: result.userId, role: result.role });
  } catch {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.get('/api/users/:userId', authenticate, async (req, res) => {
  try {
    const result = await grpcCall(authClient, 'getUserProfile', { userId: req.params.userId });
    res.json(result);
  } catch {
    res.status(404).json({ error: 'User not found' });
  }
});

app.put('/api/users/:userId', authenticate, async (req, res) => {
  try {
    const { name, email } = req.body;
    const result = await grpcCall(authClient, 'updateProfile', { userId: req.params.userId, name, email });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.details || err.message });
  }
});

// ---------- SLOTS ----------
app.post('/api/slots', authenticate, async (req, res) => {
  try {
    const { serviceId, startTime, endTime, capacity, price } = req.body;
    const result = await grpcCall(bookingClient, 'createSlot', {
      serviceId, startTime, endTime, capacity: capacity || 1, price: price || 0,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.details || err.message });
  }
});

app.get('/api/slots', async (req, res) => {
  try {
    const { serviceId, date } = req.query;
    if (!serviceId) {return res.status(400).json({ error: 'serviceId is required' });}
    const result = await grpcCall(bookingClient, 'getAvailableSlots', {
      serviceId,
      date: parseInt(date) || Date.now(),
    });
    res.json({ slots: result.slots, totalAvailable: result.totalAvailable });
  } catch (err) {
    res.status(400).json({ error: err.details || err.message });
  }
});

// ---------- BOOKINGS ----------
app.post('/api/bookings', authenticate, async (req, res) => {
  try {
    const { slotId } = req.body;
    if (!slotId) {return res.status(400).json({ error: 'slotId is required' });}
    const result = await grpcCall(bookingClient, 'bookSlot', { userId: req.userId, slotId });
    res.status(201).json(result);
  } catch (err) {
    const status = err.code === grpc.status.UNAVAILABLE ? 409 : 400;
    res.status(status).json({ error: err.details || err.message });
  }
});

app.get('/api/bookings', authenticate, async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const result = await grpcCall(bookingClient, 'listBookings', {
      userId: req.userId,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
    });
    res.json({ bookings: result.bookings, total: result.total });
  } catch (err) {
    res.status(400).json({ error: err.details || err.message });
  }
});

app.get('/api/bookings/:bookingId', authenticate, async (req, res) => {
  try {
    const result = await grpcCall(bookingClient, 'getBooking', { bookingId: req.params.bookingId });
    res.json(result.booking);
  } catch {
    res.status(404).json({ error: 'Booking not found' });
  }
});

app.delete('/api/bookings/:bookingId', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await grpcCall(bookingClient, 'cancelBooking', {
      bookingId: req.params.bookingId,
      reason: reason || '',
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.details || err.message });
  }
});

// ---------- PAYMENTS ----------
app.post('/api/payments', authenticate, async (req, res) => {
  try {
    const { bookingId, amount, method, currency } = req.body;
    if (!bookingId || !amount) {return res.status(400).json({ error: 'bookingId and amount are required' });}
    const result = await grpcCall(paymentClient, 'processPayment', {
      bookingId, userId: req.userId, amount, method: method || 'card', currency: currency || 'TND',
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.details || err.message });
  }
});

app.get('/api/payments', authenticate, async (req, res) => {
  try {
    const { limit, offset, status } = req.query;
    const result = await grpcCall(paymentClient, 'listPayments', {
      userId: req.userId,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
      status: status || '',
    });
    res.json({ payments: result.payments, total: result.total });
  } catch (err) {
    res.status(400).json({ error: err.details || err.message });
  }
});

app.get('/api/payments/:paymentId', authenticate, async (req, res) => {
  try {
    const result = await grpcCall(paymentClient, 'getPaymentStatus', { paymentId: req.params.paymentId });
    res.json(result);
  } catch {
    res.status(404).json({ error: 'Payment not found' });
  }
});

app.post('/api/payments/:paymentId/refund', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await grpcCall(paymentClient, 'refundPayment', {
      paymentId: req.params.paymentId,
      reason: reason || '',
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.details || err.message });
  }
});

app.get('/api/invoices/:bookingId', authenticate, async (req, res) => {
  try {
    const result = await grpcCall(paymentClient, 'getInvoice', { bookingId: req.params.bookingId });
    res.json(result.invoice);
  } catch {
    res.status(404).json({ error: 'Invoice not found' });
  }
});

// ---------- NOTIFICATIONS ----------
app.get('/api/notifications', authenticate, async (req, res) => {
  try {
    const result = await grpcCall(notificationClient, 'getNotificationHistory', { userId: req.userId });
    res.json({ notifications: result.notifications, total: result.total });
  } catch (err) {
    res.status(400).json({ error: err.details || err.message });
  }
});

app.get('/api/notifications/preferences', authenticate, async (req, res) => {
  try {
    const result = await grpcCall(notificationClient, 'getNotificationPreferences', { userId: req.userId });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.details || err.message });
  }
});

app.put('/api/notifications/preferences', authenticate, async (req, res) => {
  try {
    const result = await grpcCall(notificationClient, 'updatePreferences', {
      userId: req.userId,
      ...req.body,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.details || err.message });
  }
});

// ============== GRAPHQL SANDBOX REDIRECT ==============
// Opens Apollo Sandbox pointing to this server
app.get('/sandbox', (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Platforma GraphQL</title></head>
    <body style="margin:0">
    <div style="width:100%;height:100vh" id="sandbox"></div>
    <script src="https://embeddable-sandbox.cdn.apollographql.com/_latest/embeddable-sandbox.umd.production.min.js"></script>
    <script>
      new window.EmbeddedSandbox({
        target: '#sandbox',
        initialEndpoint: 'http://localhost:3000/graphql',
      });
    </script>
    </body>
    </html>
  `);
});

// ============== GRAPHQL SCHEMA ==============
const typeDefs = gql`
  type Query {
    me: User
    user(id: ID!): User
    slots(serviceId: ID!, date: Float!): SlotList!
    booking(id: ID!): BookingDetail
    myBookings(limit: Int, offset: Int): BookingList!
    payment(id: ID!): PaymentStatus
    myPayments(limit: Int, offset: Int): PaymentList!
    invoice(bookingId: ID!): Invoice
    myNotifications: NotificationList!
    notificationPreferences: NotificationPreferences!
  }

  type Mutation {
    register(email: String!, password: String!, name: String!, role: String): AuthPayload!
    login(email: String!, password: String!): AuthPayload!
    updateProfile(name: String, email: String): UpdateProfileResult!
    createSlot(serviceId: ID!, startTime: Float!, endTime: Float!, capacity: Int, price: Float): SlotResult!
    bookSlot(slotId: ID!): BookingResult!
    cancelBooking(bookingId: ID!, reason: String): CancelResult!
    processPayment(bookingId: ID!, amount: Float!, method: String, currency: String): PaymentResult!
    refundPayment(paymentId: ID!, reason: String): RefundResult!
    updateNotificationPreferences(
      emailNotifications: Boolean
      smsNotifications: Boolean
      pushNotifications: Boolean
    ): NotificationPreferences!
  }

  type User {
    id: ID!
    email: String!
    name: String!
    role: String!
    createdAt: Float!
  }

  type AuthPayload {
    token: String!
    userId: ID!
    role: String!
  }

  type UpdateProfileResult {
    success: Boolean!
    profile: User
  }

  type Slot {
    id: ID!
    serviceId: ID!
    startTime: Float!
    endTime: Float!
    capacity: Int!
    booked: Int!
    price: Float!
    createdAt: Float!
  }

  type SlotList {
    slots: [Slot!]!
    totalAvailable: Int!
  }

  type SlotResult {
    success: Boolean!
    slotId: ID
    message: String
  }

  type BookingDetail {
    id: ID!
    userId: ID!
    slot: Slot
    status: String!
    totalPrice: Float!
    createdAt: Float!
    cancelledAt: Float
  }

  type BookingList {
    bookings: [BookingDetail!]!
    total: Int!
  }

  type BookingResult {
    success: Boolean!
    bookingId: ID
    message: String
  }

  type CancelResult {
    success: Boolean!
    message: String
  }

  type PaymentStatus {
    paymentId: ID!
    bookingId: ID!
    userId: ID!
    amount: Float!
    method: String!
    status: String!
    createdAt: Float!
    completedAt: Float
  }

  type PaymentList {
    payments: [PaymentStatus!]!
    total: Int!
  }

  type PaymentResult {
    success: Boolean!
    paymentId: ID
    status: String
    message: String
  }

  type RefundResult {
    success: Boolean!
    message: String
    refundedAmount: Float
  }

  type Invoice {
    id: ID!
    paymentId: ID!
    bookingId: ID!
    amount: Float!
    currency: String!
    issuedAt: Float!
    pdfUrl: String
    status: String!
  }

  type NotificationItem {
    id: ID!
    userId: ID!
    type: String!
    subject: String!
    body: String!
    status: String!
    createdAt: Float!
    sentAt: Float
  }

  type NotificationList {
    notifications: [NotificationItem!]!
    total: Int!
  }

  type NotificationPreferences {
    userId: ID!
    emailNotifications: Boolean!
    smsNotifications: Boolean!
    pushNotifications: Boolean!
    updatedAt: Float!
  }
`;

const resolvers = {
  Query: {
    me: async (_, __, { userId }) => {
      if (!userId) {throw new Error('Not authenticated');}
      return grpcCall(authClient, 'getUserProfile', { userId });
    },
    user: async (_, { id }) => grpcCall(authClient, 'getUserProfile', { userId: id }),
    slots: async (_, { serviceId, date }) => {
      const result = await grpcCall(bookingClient, 'getAvailableSlots', { serviceId, date });
      return { slots: result.slots || [], totalAvailable: result.totalAvailable || 0 };
    },
    booking: async (_, { id }, { userId }) => {
      if (!userId) {throw new Error('Not authenticated');}
      const result = await grpcCall(bookingClient, 'getBooking', { bookingId: id });
      return result.booking;
    },
    myBookings: async (_, { limit, offset }, { userId }) => {
      if (!userId) {throw new Error('Not authenticated');}
      const result = await grpcCall(bookingClient, 'listBookings', {
        userId, limit: limit || 50, offset: offset || 0,
      });
      return { bookings: result.bookings || [], total: result.total || 0 };
    },
    payment: async (_, { id }, { userId }) => {
      if (!userId) {throw new Error('Not authenticated');}
      return grpcCall(paymentClient, 'getPaymentStatus', { paymentId: id });
    },
    myPayments: async (_, { limit, offset }, { userId }) => {
      if (!userId) {throw new Error('Not authenticated');}
      const result = await grpcCall(paymentClient, 'listPayments', {
        userId, limit: limit || 50, offset: offset || 0,
      });
      return { payments: result.payments || [], total: result.total || 0 };
    },
    invoice: async (_, { bookingId }, { userId }) => {
      if (!userId) {throw new Error('Not authenticated');}
      const result = await grpcCall(paymentClient, 'getInvoice', { bookingId });
      return result.invoice;
    },
    myNotifications: async (_, __, { userId }) => {
      if (!userId) {throw new Error('Not authenticated');}
      const result = await grpcCall(notificationClient, 'getNotificationHistory', { userId });
      return { notifications: result.notifications || [], total: result.total || 0 };
    },
    notificationPreferences: async (_, __, { userId }) => {
      if (!userId) {throw new Error('Not authenticated');}
      return grpcCall(notificationClient, 'getNotificationPreferences', { userId });
    },
  },
  Mutation: {
    register: async (_, { email, password, name, role }) => {
      const result = await grpcCall(authClient, 'registerUser', { email, password, name, role: role || 'client' });
      return { token: '', userId: result.userId, role: role || 'client' };
    },
    login: async (_, { email, password }) => {
      const result = await grpcCall(authClient, 'authenticate', { email, password });
      return { token: result.token, userId: result.userId, role: result.role };
    },
    updateProfile: async (_, { name, email }, { userId }) => {
      if (!userId) {throw new Error('Not authenticated');}
      return grpcCall(authClient, 'updateProfile', { userId, name, email });
    },
    createSlot: async (_, { serviceId, startTime, endTime, capacity, price }) => {
      return grpcCall(bookingClient, 'createSlot', { serviceId, startTime, endTime, capacity: capacity || 1, price: price || 0 });
    },
    bookSlot: async (_, { slotId }, { userId }) => {
      if (!userId) {throw new Error('Not authenticated');}
      return grpcCall(bookingClient, 'bookSlot', { userId, slotId });
    },
    cancelBooking: async (_, { bookingId, reason }) => {
      return grpcCall(bookingClient, 'cancelBooking', { bookingId, reason: reason || '' });
    },
    processPayment: async (_, { bookingId, amount, method, currency }, { userId }) => {
      if (!userId) {throw new Error('Not authenticated');}
      return grpcCall(paymentClient, 'processPayment', {
        bookingId, userId, amount, method: method || 'card', currency: currency || 'TND',
      });
    },
    refundPayment: async (_, { paymentId, reason }) => {
      return grpcCall(paymentClient, 'refundPayment', { paymentId, reason: reason || '' });
    },
    updateNotificationPreferences: async (_, args, { userId }) => {
      if (!userId) {throw new Error('Not authenticated');}
      return grpcCall(notificationClient, 'updatePreferences', { userId, ...args });
    },
  },
};

// ============== GRAPHQL CONTEXT ==============
const getGraphQLContext = async ({ req }) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {return { userId: null };}
  const token = authHeader.split(' ')[1];
  try {
    const result = await grpcCall(authClient, 'validateToken', { token });
    return result.valid ? { userId: result.userId, role: result.role } : { userId: null };
  } catch {
    return { userId: null };
  }
};

// ============== START SERVER ==============
const startServer = async () => {
  const apolloServer = new ApolloServer({
    typeDefs,
    resolvers,
    context: getGraphQLContext,
    introspection: true,
    playground: true,
    formatError: (err) => {
      logger.error('GraphQL error: ' + err.message);
      return { message: err.message };
    },
  });

  await apolloServer.start();
  apolloServer.applyMiddleware({ app, path: '/graphql' });

  app.listen(PORT, () => {
    logger.info(`API Gateway running on http://localhost:${PORT}`);
    logger.info(`REST API: http://localhost:${PORT}/api`);
    logger.info(`GraphQL: http://localhost:${PORT}/graphql`);
    logger.info(`Health: http://localhost:${PORT}/health`);
  });
};

startServer().catch((err) => {
  logger.error('Startup failed: ' + err.message);
  process.exit(1);
});
