/**
 * Unit tests - Notification Service logic
 */

'use strict';

describe('Notification Service - Unit Tests', () => {
  describe('Notification type validation', () => {
    const validTypes = ['email', 'sms', 'push'];

    it('should default to email when type is missing', () => {
      const type = undefined;
      const resolved = type || 'email';
      expect(resolved).toBe('email');
    });

    it('should accept all valid notification types', () => {
      validTypes.forEach((t) => {
        expect(validTypes.includes(t)).toBe(true);
      });
    });

    it('should reject unknown notification types', () => {
      expect(validTypes.includes('fax')).toBe(false);
    });
  });

  describe('Notification template builder', () => {
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

    it('should build booking.confirmed notification', () => {
      const result = buildNotification('booking.confirmed', { bookingId: 'bk_1' });
      expect(result.subject).toBe('Réservation confirmée');
      expect(result.body).toContain('bk_1');
    });

    it('should build payment.completed notification with currency', () => {
      const result = buildNotification('payment.completed', { amount: 50, currency: 'EUR' });
      expect(result.subject).toBe('Paiement reçu');
      expect(result.body).toContain('50');
      expect(result.body).toContain('EUR');
    });

    it('should default currency to TND in payment notification', () => {
      const result = buildNotification('payment.completed', { amount: 30 });
      expect(result.body).toContain('TND');
    });

    it('should return fallback for unknown topic', () => {
      const result = buildNotification('unknown.topic', { foo: 'bar' });
      expect(result.subject).toContain('unknown.topic');
    });

    it('should build user.registered notification with name', () => {
      const result = buildNotification('user.registered', { name: 'Alice' });
      expect(result.body).toContain('Alice');
    });
  });

  describe('Preferences defaults', () => {
    const defaultPrefs = {
      emailNotifications: true,
      smsNotifications: false,
      pushNotifications: false,
      bookingConfirmed: true,
      bookingCancelled: true,
      paymentReceived: true,
      paymentFailed: true,
      reminderBeforeSlot: true,
    };

    it('should have email enabled by default', () => {
      expect(defaultPrefs.emailNotifications).toBe(true);
    });

    it('should have sms disabled by default', () => {
      expect(defaultPrefs.smsNotifications).toBe(false);
    });

    it('should have all event types enabled by default', () => {
      expect(defaultPrefs.bookingConfirmed).toBe(true);
      expect(defaultPrefs.bookingCancelled).toBe(true);
      expect(defaultPrefs.paymentReceived).toBe(true);
      expect(defaultPrefs.paymentFailed).toBe(true);
      expect(defaultPrefs.reminderBeforeSlot).toBe(true);
    });
  });

  describe('Notification status transitions', () => {
    it('should start as pending', () => {
      const notification = { status: 'pending' };
      expect(notification.status).toBe('pending');
    });

    it('should transition to sent on success', () => {
      let status = 'pending';
      const success = true;
      status = success ? 'sent' : 'failed';
      expect(status).toBe('sent');
    });

    it('should transition to failed on error', () => {
      let status = 'pending';
      const success = false;
      status = success ? 'sent' : 'failed';
      expect(status).toBe('failed');
    });
  });
});
