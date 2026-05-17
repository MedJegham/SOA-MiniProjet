'use strict';

/**
 * Unit tests — Notification templates
 * Author: Louay Benmansour
 */

const { buildNotification, TEMPLATES } = require('../../services/notification-service/templates');

describe('buildNotification', () => {
  it('should return correct subject for user.registered', () => {
    const { subject, body } = buildNotification('user.registered', { name: 'Alice' });
    expect(subject).toBe('Bienvenue sur Platforma !');
    expect(body).toContain('Alice');
  });

  it('should use fallback name when name is missing', () => {
    const { body } = buildNotification('user.registered', {});
    expect(body).toContain('utilisateur');
  });

  it('should include bookingId in booking.confirmed', () => {
    const { subject, body } = buildNotification('booking.confirmed', { bookingId: 'bk-123' });
    expect(subject).toBe('Réservation confirmée');
    expect(body).toContain('bk-123');
  });

  it('should include bookingId in booking.cancelled', () => {
    const { body } = buildNotification('booking.cancelled', { bookingId: 'bk-456' });
    expect(body).toContain('bk-456');
  });

  it('should include amount and currency in payment.completed', () => {
    const { subject, body } = buildNotification('payment.completed', { amount: 45, currency: 'TND' });
    expect(subject).toBe('Paiement reçu');
    expect(body).toContain('45');
    expect(body).toContain('TND');
  });

  it('should default to TND when currency is missing', () => {
    const { body } = buildNotification('payment.completed', { amount: 30 });
    expect(body).toContain('TND');
  });

  it('should include bookingId in payment.failed', () => {
    const { body } = buildNotification('payment.failed', { bookingId: 'bk-789' });
    expect(body).toContain('bk-789');
  });

  it('should include invoiceId in invoice.generated', () => {
    const { body } = buildNotification('invoice.generated', {
      invoiceId: 'inv-001', amount: 50, currency: 'TND',
    });
    expect(body).toContain('inv-001');
    expect(body).toContain('50');
  });

  it('should return generic fallback for unknown topic', () => {
    const event = { foo: 'bar' };
    const { subject, body } = buildNotification('unknown.topic', event);
    expect(subject).toContain('unknown.topic');
    expect(body).toContain('foo');
  });

  it('should cover all defined TEMPLATES keys', () => {
    const topics = Object.keys(TEMPLATES);
    expect(topics.length).toBeGreaterThanOrEqual(6);
    topics.forEach((topic) => {
      const result = buildNotification(topic, {
        name: 'Test', bookingId: 'bk-x', amount: 10, currency: 'TND',
        invoiceId: 'inv-x', paymentId: 'pay-x',
      });
      expect(result.subject).toBeTruthy();
      expect(result.body).toBeTruthy();
    });
  });
});
