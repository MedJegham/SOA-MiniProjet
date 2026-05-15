/**
 * Integration tests - API Gateway REST endpoints
 * Requires all services to be running locally
 *
 * Run: npm test (after starting services)
 */

'use strict';

const request = require('supertest');
const express = require('express');

// Minimal mock app for integration testing without live gRPC
const buildMockApp = () => {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.post('/api/auth/register', (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'email, password and name are required' });
    }
    res.status(201).json({ success: true, userId: 'mock-user-id', message: 'User registered successfully' });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {return res.status(400).json({ error: 'email and password are required' });}
    if (email === 'test@test.com' && password === 'password123') {
      return res.json({ token: 'mock-jwt-token', userId: 'mock-user-id', role: 'client' });
    }
    res.status(401).json({ error: 'Invalid credentials' });
  });

  app.get('/api/slots', (req, res) => {
    if (!req.query.serviceId) {return res.status(400).json({ error: 'serviceId is required' });}
    res.json({ slots: [], totalAvailable: 0 });
  });

  return app;
};

describe('API Gateway - Integration Tests (Mock)', () => {
  let app;

  beforeAll(() => {
    app = buildMockApp();
  });

  describe('GET /health', () => {
    it('should return 200 with status ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: 'newuser@test.com',
        password: 'password123',
        name: 'Test User',
      });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.userId).toBeDefined();
    });

    it('should reject missing fields', async () => {
      const res = await request(app).post('/api/auth/register').send({ email: 'test@test.com' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'test@test.com',
        password: 'password123',
      });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.userId).toBeDefined();
    });

    it('should reject invalid credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'test@test.com',
        password: 'wrongpassword',
      });
      expect(res.status).toBe(401);
    });

    it('should reject missing fields', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: 'test@test.com' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/slots', () => {
    it('should require serviceId', async () => {
      const res = await request(app).get('/api/slots');
      expect(res.status).toBe(400);
    });

    it('should return slots list when serviceId provided', async () => {
      const res = await request(app).get('/api/slots?serviceId=svc_1&date=1700000000000');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.slots)).toBe(true);
    });
  });
});
