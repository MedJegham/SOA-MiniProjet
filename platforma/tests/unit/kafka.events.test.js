/**
 * Unit tests - Kafka event payload validation
 * Author: Louay Benmansour
 */

'use strict';

// ── Helpers (mirrors what services produce) ───────────────────────────────────

const buildBookingCreatedEvent = ({ bookingId, userId, slotId }) => ({
  bookingId,
  userId,
  slotId,
  timestamp: Date.now(),
});

const buildPaymentCompletedEvent = ({ paymentId, bookingId, amount, currency }) => ({
  paymentId,
  bookingId,
  amount,
  currency: currency || 'TND',
  status: 'completed',
  timestamp: Date.now(),
});

const buildNotificationEvent = ({ userId, type, subject, body }) => ({
  userId,
  type,
  subject,
  body,
  timestamp: Date.now(),
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Kafka Event Payloads', () => {
  describe('booking.confirmed event', () => {
    it('should contain required fields', () => {
      const event = buildBookingCreatedEvent({
        bookingId: 'bk-001',
        userId: 'usr-001',
        slotId: 'slot-001',
      });
      expect(event).toHaveProperty('bookingId');
      expect(event).toHaveProperty('userId');
      expect(event).toHaveProperty('slotId');
      expect(event).toHaveProperty('timestamp');
    });

    it('timestamp should be a recent epoch ms', () => {
      const event = buildBookingCreatedEvent({
        bookingId: 'bk-002', userId: 'usr-002', slotId: 'slot-002',
      });
      expect(event.timestamp).toBeGreaterThan(1_700_000_000_000);
      expect(event.timestamp).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('payment.completed event', () => {
    it('should contain required fields', () => {
      const event = buildPaymentCompletedEvent({
        paymentId: 'pay-001',
        bookingId: 'bk-001',
        amount: 45.0,
      });
      expect(event).toHaveProperty('paymentId');
      expect(event).toHaveProperty('bookingId');
      expect(event).toHaveProperty('amount');
      expect(event.status).toBe('completed');
      expect(event.currency).toBe('TND');
    });

    it('amount should be positive', () => {
      const event = buildPaymentCompletedEvent({
        paymentId: 'pay-002', bookingId: 'bk-002', amount: 50.0,
      });
      expect(event.amount).toBeGreaterThan(0);
    });
  });

  describe('notification event', () => {
    it('should contain userId, type, and body', () => {
      const event = buildNotificationEvent({
        userId: 'usr-001',
        type: 'booking_confirmed',
        subject: 'Réservation confirmée',
        body: 'Votre réservation #bk-001 est confirmée.',
      });
      expect(event.userId).toBe('usr-001');
      expect(event.type).toBe('booking_confirmed');
      expect(event.body).toBeTruthy();
    });
  });

  describe('Topic routing', () => {
    const TOPIC_CONSUMERS = {
      'booking.confirmed':  ['payment-service', 'notification-service'],
      'booking.cancelled':  ['payment-service', 'notification-service'],
      'payment.completed':  ['booking-service', 'notification-service'],
      'payment.failed':     ['booking-service', 'notification-service'],
      'payment.refunded':   ['notification-service'],
      'user.registered':    ['notification-service'],
    };

    it.each(Object.entries(TOPIC_CONSUMERS))(
      'topic "%s" should have at least one consumer',
      (topic, consumers) => {
        expect(consumers.length).toBeGreaterThan(0);
      }
    );

    it('notification-service should consume booking events', () => {
      const notifTopics = Object.entries(TOPIC_CONSUMERS)
        .filter(([, consumers]) => consumers.includes('notification-service'))
        .map(([topic]) => topic);
      expect(notifTopics).toContain('booking.confirmed');
      expect(notifTopics).toContain('payment.completed');
    });
  });
});
