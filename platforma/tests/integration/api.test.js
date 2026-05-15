/**
 * Integration tests - API Gateway REST endpoints
 * Mock Express app — no live gRPC services required
 * Run: npm run test:integration
 */
'use strict';

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

// ─── Constants ───────────────────────────────────────────────────────────────
const JWT_SECRET = 'test-secret';

// ─── In-memory stores ────────────────────────────────────────────────────────
const users        = new Map(); // email -> { userId, email, password, name }
const slots        = new Map(); // slotId -> { slotId, serviceId, date, capacity, booked }
const bookings     = new Map(); // bookingId -> { bookingId, userId, slotId, status }
const payments     = new Map(); // paymentId -> { paymentId, bookingId, userId, amount, status }
const invoices     = new Map(); // bookingId -> { invoiceId, bookingId, userId, amount }
const notifHistory = new Map(); // userId -> [{ notifId, message, read }]
const notifPrefs   = new Map(); // userId -> { email: bool, sms: bool, push: bool }

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

// ─── Middleware ───────────────────────────────────────────────────────────────
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── App factory ─────────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());

  // ── Health ──────────────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ── Auth ────────────────────────────────────────────────────────────────────
  app.post('/api/auth/register', (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'email, password and name are required' });
    }
    if (users.has(email)) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const userId = uuidv4();
    users.set(email, { userId, email, password, name });
    // seed default notification prefs
    notifPrefs.set(userId, { email: true, sms: false, push: true });
    notifHistory.set(userId, [
      { notifId: uuidv4(), message: 'Welcome to Platforma!', read: false },
    ]);
    const token = makeToken({ userId, email });
    return res.status(201).json({ userId, token });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const user = users.get(email);
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = makeToken({ userId: user.userId, email });
    return res.json({ userId: user.userId, token });
  });

  // ── Users ───────────────────────────────────────────────────────────────────
  app.get('/api/users/:userId', authenticate, (req, res) => {
    const { userId } = req.params;
    for (const u of users.values()) {
      if (u.userId === userId) {
        return res.json({ userId: u.userId, email: u.email, name: u.name });
      }
    }
    return res.status(404).json({ error: 'User not found' });
  });

  app.put('/api/users/:userId', authenticate, (req, res) => {
    const { userId } = req.params;
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    for (const [email, u] of users.entries()) {
      if (u.userId === userId) {
        u.name = name;
        users.set(email, u);
        return res.json({ userId: u.userId, email: u.email, name: u.name });
      }
    }
    return res.status(404).json({ error: 'User not found' });
  });

  // ── Slots ───────────────────────────────────────────────────────────────────
  app.post('/api/slots', authenticate, (req, res) => {
    const { serviceId, date, capacity } = req.body;
    if (!serviceId || !date) {
      return res.status(400).json({ error: 'serviceId and date are required' });
    }
    const slotId = uuidv4();
    const slot = { slotId, serviceId, date, capacity: capacity || 10, booked: 0 };
    slots.set(slotId, slot);
    return res.status(201).json(slot);
  });

  app.get('/api/slots', authenticate, (req, res) => {
    const { serviceId, date } = req.query;
    if (!serviceId) {
      return res.status(400).json({ error: 'serviceId query param is required' });
    }
    const result = [];
    for (const s of slots.values()) {
      if (s.serviceId === serviceId && (!date || s.date === date)) {
        result.push(s);
      }
    }
    return res.json({ slots: result });
  });

  // ── Bookings ─────────────────────────────────────────────────────────────────
  app.post('/api/bookings', authenticate, (req, res) => {
    const { slotId } = req.body;
    if (!slotId) {
      return res.status(400).json({ error: 'slotId is required' });
    }
    const slot = slots.get(slotId);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }
    if (slot.booked >= slot.capacity) {
      return res.status(409).json({ error: 'Slot is fully booked' });
    }
    slot.booked += 1;
    slots.set(slotId, slot);
    const bookingId = uuidv4();
    const booking = { bookingId, userId: req.userId, slotId, status: 'confirmed' };
    bookings.set(bookingId, booking);
    // create invoice automatically
    const invoiceId = uuidv4();
    invoices.set(bookingId, { invoiceId, bookingId, userId: req.userId, amount: 0 });
    return res.status(201).json(booking);
  });

  app.get('/api/bookings', authenticate, (req, res) => {
    const result = [];
    for (const b of bookings.values()) {
      if (b.userId === req.userId) {result.push(b);}
    }
    return res.json({ bookings: result });
  });

  app.get('/api/bookings/:bookingId', authenticate, (req, res) => {
    const booking = bookings.get(req.params.bookingId);
    if (!booking) {return res.status(404).json({ error: 'Booking not found' });}
    return res.json(booking);
  });

  app.delete('/api/bookings/:bookingId', authenticate, (req, res) => {
    const booking = bookings.get(req.params.bookingId);
    if (!booking) {return res.status(404).json({ error: 'Booking not found' });}
    if (booking.status === 'cancelled') {
      return res.status(409).json({ error: 'Booking already cancelled' });
    }
    booking.status = 'cancelled';
    bookings.set(booking.bookingId, booking);
    return res.json({ message: 'Booking cancelled', bookingId: booking.bookingId });
  });

  // ── Payments ─────────────────────────────────────────────────────────────────
  app.post('/api/payments', authenticate, (req, res) => {
    const { bookingId, amount } = req.body;
    if (!bookingId || amount === undefined) {
      return res.status(400).json({ error: 'bookingId and amount are required' });
    }
    if (!bookings.has(bookingId)) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    const paymentId = uuidv4();
    const payment = { paymentId, bookingId, userId: req.userId, amount, status: 'completed' };
    payments.set(paymentId, payment);
    // update invoice amount
    if (invoices.has(bookingId)) {
      const inv = invoices.get(bookingId);
      inv.amount = amount;
      invoices.set(bookingId, inv);
    }
    return res.status(201).json(payment);
  });

  app.get('/api/payments', authenticate, (req, res) => {
    const result = [];
    for (const p of payments.values()) {
      if (p.userId === req.userId) {result.push(p);}
    }
    return res.json({ payments: result });
  });

  app.get('/api/payments/:paymentId', authenticate, (req, res) => {
    const payment = payments.get(req.params.paymentId);
    if (!payment) {return res.status(404).json({ error: 'Payment not found' });}
    return res.json(payment);
  });

  app.post('/api/payments/:paymentId/refund', authenticate, (req, res) => {
    const payment = payments.get(req.params.paymentId);
    if (!payment) {return res.status(404).json({ error: 'Payment not found' });}
    if (payment.status !== 'completed') {
      return res.status(409).json({ error: 'Only completed payments can be refunded' });
    }
    payment.status = 'refunded';
    payments.set(payment.paymentId, payment);
    return res.json({ message: 'Refund processed', paymentId: payment.paymentId });
  });

  // ── Invoices ─────────────────────────────────────────────────────────────────
  app.get('/api/invoices/:bookingId', authenticate, (req, res) => {
    const invoice = invoices.get(req.params.bookingId);
    if (!invoice) {return res.status(404).json({ error: 'Invoice not found' });}
    return res.json(invoice);
  });

  // ── Notifications ─────────────────────────────────────────────────────────────
  app.get('/api/notifications', authenticate, (req, res) => {
    const history = notifHistory.get(req.userId) || [];
    return res.json({ notifications: history });
  });

  app.get('/api/notifications/preferences', authenticate, (req, res) => {
    const prefs = notifPrefs.get(req.userId) || { email: true, sms: false, push: false };
    return res.json(prefs);
  });

  app.put('/api/notifications/preferences', authenticate, (req, res) => {
    const { email, sms, push } = req.body;
    if (email === undefined && sms === undefined && push === undefined) {
      return res.status(400).json({ error: 'At least one preference field is required' });
    }
    const current = notifPrefs.get(req.userId) || { email: true, sms: false, push: false };
    const updated = {
      email: email !== undefined ? email : current.email,
      sms:   sms   !== undefined ? sms   : current.sms,
      push:  push  !== undefined ? push  : current.push,
    };
    notifPrefs.set(req.userId, updated);
    return res.json(updated);
  });

  return app;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

let app;

// Shared state populated during tests and reused across describe blocks
let token;
let userId;
let slotId;
let bookingId;
let paymentId;

// A second user for isolation tests
let token2;

beforeAll(() => {
  app = buildApp();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /health', () => {
  it('should return 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/register', () => {
  it('should register a new user and return 201 with token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'alice@example.com', password: 'pass1234', name: 'Alice' });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBeDefined();
    expect(res.body.token).toBeDefined();
    token  = res.body.token;
    userId = res.body.userId;
  });

  it('should register a second user for isolation tests', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'bob@example.com', password: 'pass5678', name: 'Bob' });
    expect(res.status).toBe(201);
    token2 = res.body.token;
  });

  it('should return 409 when email is already registered', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'alice@example.com', password: 'other', name: 'Alice2' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });

  it('should return 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ password: 'pass1234', name: 'NoEmail' });
    expect(res.status).toBe(400);
  });

  it('should return 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'nopass@example.com', name: 'NoPass' });
    expect(res.status).toBe(400);
  });

  it('should return 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'noname@example.com', password: 'pass1234' });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  it('should login with correct credentials and return a token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: 'pass1234' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.userId).toBe(userId);
    // refresh token for subsequent tests
    token = res.body.token;
  });

  it('should return 401 for wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: 'wrongpass' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it('should return 401 for unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: 'pass1234' });
    expect(res.status).toBe(401);
  });

  it('should return 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'pass1234' });
    expect(res.status).toBe(400);
  });

  it('should return 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@example.com' });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/users/:userId', () => {
  it('should return user profile for a valid userId', async () => {
    const res = await request(app)
      .get(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(userId);
    expect(res.body.email).toBe('alice@example.com');
    expect(res.body.name).toBe('Alice');
  });

  it('should return 401 without auth header', async () => {
    const res = await request(app).get(`/api/users/${userId}`);
    expect(res.status).toBe(401);
  });

  it('should return 401 with an invalid token', async () => {
    const res = await request(app)
      .get(`/api/users/${userId}`)
      .set('Authorization', 'Bearer not.a.real.token');
    expect(res.status).toBe(401);
  });

  it('should return 404 for a non-existent userId', async () => {
    const res = await request(app)
      .get('/api/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /api/users/:userId', () => {
  it('should update user name and return updated profile', async () => {
    const res = await request(app)
      .put(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Alice Updated' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Alice Updated');
  });

  it('should return 400 when name is missing', async () => {
    const res = await request(app)
      .put(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('should return 401 without auth header', async () => {
    const res = await request(app)
      .put(`/api/users/${userId}`)
      .send({ name: 'Hacker' });
    expect(res.status).toBe(401);
  });

  it('should return 404 for a non-existent userId', async () => {
    const res = await request(app)
      .put('/api/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ghost' });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/slots', () => {
  it('should create a slot and return 201', async () => {
    const res = await request(app)
      .post('/api/slots')
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceId: 'svc-001', date: '2025-08-01', capacity: 5 });
    expect(res.status).toBe(201);
    expect(res.body.slotId).toBeDefined();
    expect(res.body.serviceId).toBe('svc-001');
    slotId = res.body.slotId;
  });

  it('should return 400 when serviceId is missing', async () => {
    const res = await request(app)
      .post('/api/slots')
      .set('Authorization', `Bearer ${token}`)
      .send({ date: '2025-08-01' });
    expect(res.status).toBe(400);
  });

  it('should return 400 when date is missing', async () => {
    const res = await request(app)
      .post('/api/slots')
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceId: 'svc-001' });
    expect(res.status).toBe(400);
  });

  it('should return 401 without auth header', async () => {
    const res = await request(app)
      .post('/api/slots')
      .send({ serviceId: 'svc-001', date: '2025-08-01' });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/slots', () => {
  it('should return slots for a given serviceId', async () => {
    const res = await request(app)
      .get('/api/slots?serviceId=svc-001')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.slots)).toBe(true);
    expect(res.body.slots.length).toBeGreaterThan(0);
    expect(res.body.slots[0].serviceId).toBe('svc-001');
  });

  it('should filter slots by serviceId and date', async () => {
    const res = await request(app)
      .get('/api/slots?serviceId=svc-001&date=2025-08-01')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.slots.every((s) => s.date === '2025-08-01')).toBe(true);
  });

  it('should return empty array for unknown serviceId', async () => {
    const res = await request(app)
      .get('/api/slots?serviceId=svc-unknown')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.slots).toHaveLength(0);
  });

  it('should return 400 when serviceId query param is missing', async () => {
    const res = await request(app)
      .get('/api/slots')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('should return 401 without auth header', async () => {
    const res = await request(app).get('/api/slots?serviceId=svc-001');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/bookings', () => {
  it('should create a booking for an existing slot and return 201', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ slotId });
    expect(res.status).toBe(201);
    expect(res.body.bookingId).toBeDefined();
    expect(res.body.slotId).toBe(slotId);
    expect(res.body.status).toBe('confirmed');
    bookingId = res.body.bookingId;
  });

  it('should return 400 when slotId is missing', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('should return 404 when slotId does not exist', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ slotId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
  });

  it('should return 401 without auth header', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({ slotId });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/bookings', () => {
  it('should return bookings for the authenticated user', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.bookings)).toBe(true);
    expect(res.body.bookings.length).toBeGreaterThan(0);
    expect(res.body.bookings[0].userId).toBe(userId);
  });

  it('should return empty list for a user with no bookings', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${token2}`);
    expect(res.status).toBe(200);
    expect(res.body.bookings).toHaveLength(0);
  });

  it('should return 401 without auth header', async () => {
    const res = await request(app).get('/api/bookings');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/bookings/:bookingId', () => {
  it('should return a booking by id', async () => {
    const res = await request(app)
      .get(`/api/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.bookingId).toBe(bookingId);
  });

  it('should return 404 for a non-existent bookingId', async () => {
    const res = await request(app)
      .get('/api/bookings/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('should return 401 without auth header', async () => {
    const res = await request(app).get(`/api/bookings/${bookingId}`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/payments', () => {
  it('should create a payment for an existing booking and return 201', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ bookingId, amount: 49.99 });
    expect(res.status).toBe(201);
    expect(res.body.paymentId).toBeDefined();
    expect(res.body.status).toBe('completed');
    expect(res.body.amount).toBe(49.99);
    paymentId = res.body.paymentId;
  });

  it('should return 400 when bookingId is missing', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 10 });
    expect(res.status).toBe(400);
  });

  it('should return 400 when amount is missing', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ bookingId });
    expect(res.status).toBe(400);
  });

  it('should return 404 when bookingId does not exist', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ bookingId: '00000000-0000-0000-0000-000000000000', amount: 10 });
    expect(res.status).toBe(404);
  });

  it('should return 401 without auth header', async () => {
    const res = await request(app)
      .post('/api/payments')
      .send({ bookingId, amount: 10 });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/payments', () => {
  it('should return payments for the authenticated user', async () => {
    const res = await request(app)
      .get('/api/payments')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.payments)).toBe(true);
    expect(res.body.payments.length).toBeGreaterThan(0);
  });

  it('should return empty list for a user with no payments', async () => {
    const res = await request(app)
      .get('/api/payments')
      .set('Authorization', `Bearer ${token2}`);
    expect(res.status).toBe(200);
    expect(res.body.payments).toHaveLength(0);
  });

  it('should return 401 without auth header', async () => {
    const res = await request(app).get('/api/payments');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/payments/:paymentId', () => {
  it('should return a payment by id', async () => {
    const res = await request(app)
      .get(`/api/payments/${paymentId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.paymentId).toBe(paymentId);
  });

  it('should return 404 for a non-existent paymentId', async () => {
    const res = await request(app)
      .get('/api/payments/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('should return 401 without auth header', async () => {
    const res = await request(app).get(`/api/payments/${paymentId}`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/payments/:paymentId/refund', () => {
  it('should process a refund for a completed payment', async () => {
    const res = await request(app)
      .post(`/api/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/refund processed/i);
    expect(res.body.paymentId).toBe(paymentId);
  });

  it('should return 409 when payment is already refunded', async () => {
    // paymentId was just refunded above
    const res = await request(app)
      .post(`/api/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/only completed/i);
  });

  it('should return 404 for a non-existent paymentId', async () => {
    const res = await request(app)
      .post('/api/payments/00000000-0000-0000-0000-000000000000/refund')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('should return 401 without auth header', async () => {
    const res = await request(app).post(`/api/payments/${paymentId}/refund`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/invoices/:bookingId', () => {
  it('should return the invoice for an existing booking', async () => {
    const res = await request(app)
      .get(`/api/invoices/${bookingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.bookingId).toBe(bookingId);
    expect(res.body.invoiceId).toBeDefined();
    expect(res.body.amount).toBe(49.99);
  });

  it('should return 404 for a non-existent bookingId', async () => {
    const res = await request(app)
      .get('/api/invoices/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('should return 401 without auth header', async () => {
    const res = await request(app).get(`/api/invoices/${bookingId}`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/notifications', () => {
  it('should return notification history for the authenticated user', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.notifications)).toBe(true);
    expect(res.body.notifications.length).toBeGreaterThan(0);
    expect(res.body.notifications[0].message).toBeDefined();
  });

  it('should return empty array for a user with no notifications', async () => {
    // Register a fresh user with no seeded notifications
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'fresh@example.com', password: 'pass0000', name: 'Fresh' });
    const freshToken = regRes.body.token;
    // Clear their notifications to simulate empty state
    const freshUserId = regRes.body.userId;
    notifHistory.set(freshUserId, []);
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${freshToken}`);
    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(0);
  });

  it('should return 401 without auth header', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/notifications/preferences', () => {
  it('should return notification preferences for the authenticated user', async () => {
    const res = await request(app)
      .get('/api/notifications/preferences')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('email');
    expect(res.body).toHaveProperty('sms');
    expect(res.body).toHaveProperty('push');
  });

  it('should return default preferences for a user with no stored prefs', async () => {
    // Use a token for a userId that has no prefs entry
    const tempToken = makeToken({ userId: 'no-prefs-user', email: 'noprefs@example.com' });
    const res = await request(app)
      .get('/api/notifications/preferences')
      .set('Authorization', `Bearer ${tempToken}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(true);
    expect(res.body.sms).toBe(false);
  });

  it('should return 401 without auth header', async () => {
    const res = await request(app).get('/api/notifications/preferences');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /api/notifications/preferences', () => {
  it('should update notification preferences and return updated object', async () => {
    const res = await request(app)
      .put('/api/notifications/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ sms: true, push: false });
    expect(res.status).toBe(200);
    expect(res.body.sms).toBe(true);
    expect(res.body.push).toBe(false);
    // email should remain unchanged from the seeded default
    expect(res.body.email).toBe(true);
  });

  it('should allow updating a single preference field', async () => {
    const res = await request(app)
      .put('/api/notifications/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: false });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(false);
  });

  it('should return 400 when no preference fields are provided', async () => {
    const res = await request(app)
      .put('/api/notifications/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('should return 401 without auth header', async () => {
    const res = await request(app)
      .put('/api/notifications/preferences')
      .send({ sms: true });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/bookings/:bookingId', () => {
  it('should cancel a confirmed booking', async () => {
    // Create a fresh booking to cancel
    const slotRes = await request(app)
      .post('/api/slots')
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceId: 'svc-cancel', date: '2025-09-01', capacity: 3 });
    const cancelSlotId = slotRes.body.slotId;

    const bookRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ slotId: cancelSlotId });
    const cancelBookingId = bookRes.body.bookingId;

    const res = await request(app)
      .delete(`/api/bookings/${cancelBookingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/cancelled/i);
    expect(res.body.bookingId).toBe(cancelBookingId);
  });

  it('should return 409 when booking is already cancelled', async () => {
    // Create and immediately cancel a booking
    const slotRes = await request(app)
      .post('/api/slots')
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceId: 'svc-dbl-cancel', date: '2025-09-02', capacity: 3 });
    const dblSlotId = slotRes.body.slotId;

    const bookRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ slotId: dblSlotId });
    const dblBookingId = bookRes.body.bookingId;

    await request(app)
      .delete(`/api/bookings/${dblBookingId}`)
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .delete(`/api/bookings/${dblBookingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already cancelled/i);
  });

  it('should return 404 for a non-existent bookingId', async () => {
    const res = await request(app)
      .delete('/api/bookings/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('should return 401 without auth header', async () => {
    const res = await request(app).delete(`/api/bookings/${bookingId}`);
    expect(res.status).toBe(401);
  });
});
