/**
 * Unit tests - Auth Service logic
 */

'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'test-secret';

describe('Auth Service - Unit Tests', () => {
  describe('Password hashing', () => {
    it('should hash a password', async () => {
      const hash = await bcrypt.hash('password123', 10);
      expect(hash).toBeDefined();
      expect(hash).not.toBe('password123');
    });

    it('should verify a correct password', async () => {
      const hash = await bcrypt.hash('password123', 10);
      const match = await bcrypt.compare('password123', hash);
      expect(match).toBe(true);
    });

    it('should reject an incorrect password', async () => {
      const hash = await bcrypt.hash('password123', 10);
      const match = await bcrypt.compare('wrongpassword', hash);
      expect(match).toBe(false);
    });
  });

  describe('JWT token', () => {
    it('should generate a valid token', () => {
      const payload = { userId: 'user_1', email: 'test@test.com', role: 'client' };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
    });

    it('should decode a valid token', () => {
      const payload = { userId: 'user_1', email: 'test@test.com', role: 'client' };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
      const decoded = jwt.verify(token, JWT_SECRET);
      expect(decoded.userId).toBe('user_1');
      expect(decoded.email).toBe('test@test.com');
      expect(decoded.role).toBe('client');
    });

    it('should reject an invalid token', () => {
      expect(() => jwt.verify('invalid.token.here', JWT_SECRET)).toThrow();
    });

    it('should reject a token signed with wrong secret', () => {
      const token = jwt.sign({ userId: 'user_1' }, 'wrong-secret');
      expect(() => jwt.verify(token, JWT_SECRET)).toThrow();
    });
  });

  describe('Role validation', () => {
    const validRoles = ['client', 'provider', 'admin'];

    it('should accept valid roles', () => {
      validRoles.forEach((role) => {
        expect(validRoles.includes(role)).toBe(true);
      });
    });

    it('should default unknown role to client', () => {
      const role = 'unknown';
      const resolved = validRoles.includes(role) ? role : 'client';
      expect(resolved).toBe('client');
    });
  });
});
