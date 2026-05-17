'use strict';

/**
 * Notification templates — maps Kafka topic → { subject, body }
 * Extracted from server.js for testability and reuse.
 * Author: Louay Benmansour
 */

const TEMPLATES = {
  'user.registered': (e) => ({
    subject: 'Bienvenue sur Platforma !',
    body: `Bonjour ${e.name || 'utilisateur'}, votre compte a été créé avec succès.`,
  }),
  'user.updated': (e) => ({
    subject: 'Profil mis à jour',
    body: `Bonjour ${e.name || 'utilisateur'}, votre profil a été mis à jour.`,
  }),
  'booking.confirmed': (e) => ({
    subject: 'Réservation confirmée',
    body: `Votre réservation #${e.bookingId} a été confirmée.`,
  }),
  'booking.cancelled': (e) => ({
    subject: 'Réservation annulée',
    body: `Votre réservation #${e.bookingId} a été annulée.`,
  }),
  'payment.completed': (e) => ({
    subject: 'Paiement reçu',
    body: `Votre paiement de ${e.amount} ${e.currency || 'TND'} a été traité avec succès.`,
  }),
  'payment.failed': (e) => ({
    subject: 'Échec du paiement',
    body: `Votre paiement pour la réservation #${e.bookingId} a échoué. Veuillez réessayer.`,
  }),
  'payment.refunded': (e) => ({
    subject: 'Remboursement effectué',
    body: `Votre remboursement de ${e.amount} ${e.currency || 'TND'} a été traité.`,
  }),
  'invoice.generated': (e) => ({
    subject: 'Facture disponible',
    body: `Votre facture #${e.invoiceId} est disponible. Montant: ${e.amount} ${e.currency || 'TND'}.`,
  }),
};

/**
 * Build notification content from a Kafka topic and event payload.
 * Falls back to a generic template for unknown topics.
 *
 * @param {string} topic  - Kafka topic name
 * @param {object} event  - Parsed event payload
 * @returns {{ subject: string, body: string }}
 */
const buildNotification = (topic, event) => {
  const builder = TEMPLATES[topic];
  if (builder) return builder(event);
  return {
    subject: `Événement: ${topic}`,
    body: JSON.stringify(event),
  };
};

module.exports = { buildNotification, TEMPLATES };
