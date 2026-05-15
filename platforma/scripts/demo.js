#!/usr/bin/env node
/**
 * Script de démonstration — Platforma
 * Exécute un scénario métier complet via l'API REST :
 *   1. Inscription
 *   2. Connexion
 *   3. Création d'un créneau
 *   4. Réservation
 *   5. Paiement
 *   6. Consultation de la facture
 *   7. Historique des notifications
 *   8. Annulation + remboursement automatique
 *
 * Usage:
 *   node scripts/demo.js [--base-url http://localhost:3000]
 */

'use strict';

const http  = require('http');
const https = require('https');
const url   = require('url');

// ── Config ────────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const urlFlag = args.indexOf('--base-url');
const BASE    = urlFlag !== -1 ? args[urlFlag + 1] : 'http://localhost:3000';

// ── Colours ───────────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  red:    '\x1b[31m',
  grey:   '\x1b[90m',
};

const ok    = (msg) => console.log(`${C.green}  ✔ ${C.reset}${msg}`);
const info  = (msg) => console.log(`${C.cyan}  ℹ ${C.reset}${msg}`);
const warn  = (msg) => console.log(`${C.yellow}  ⚠ ${C.reset}${msg}`);
const fail  = (msg) => console.log(`${C.red}  ✘ ${C.reset}${msg}`);
const title = (msg) => console.log(`\n${C.bold}${C.yellow}▶ ${msg}${C.reset}`);
const dim   = (msg) => console.log(`${C.grey}    ${msg}${C.reset}`);

// ── HTTP helper ───────────────────────────────────────────────────────────────
const request = (method, path, body, token) =>
  new Promise((resolve, reject) => {
    const parsed  = url.parse(`${BASE}${path}`);
    const payload = body ? JSON.stringify(body) : null;
    const lib     = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token   ? { 'Authorization': `Bearer ${token}` }          : {}),
      },
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (payload) { req.write(payload); }
    req.end();
  });

// ── Assertion helper ──────────────────────────────────────────────────────────
const assert = (condition, message) => {
  if (!condition) {
    fail(message);
    process.exit(1);
  }
};

// ── Demo data ─────────────────────────────────────────────────────────────────
const timestamp = Date.now();
const USER = {
  email:    `demo_${timestamp}@platforma.tn`,
  password: 'Demo@1234',
  name:     'Demo User',
  role:     'client',
};

// ── Main scenario ─────────────────────────────────────────────────────────────
const run = async () => {
  console.log(`\n${C.bold}╔══════════════════════════════════════════════╗`);
  console.log(`║   Platforma — Démonstration scénario métier  ║`);
  console.log(`╚══════════════════════════════════════════════╝${C.reset}`);
  info(`API Gateway : ${BASE}`);

  // ── 0. Health check ──────────────────────────────────────────────────────
  title('0. Health Check');
  const health = await request('GET', '/health');
  assert(health.status === 200, `Health check failed: ${health.status}`);
  ok(`API Gateway opérationnelle (status: ${health.body.status})`);

  // ── 1. Inscription ───────────────────────────────────────────────────────
  title('1. Inscription');
  dim(`Email : ${USER.email}`);
  const reg = await request('POST', '/api/auth/register', USER);
  assert(reg.status === 201, `Register failed ${reg.status}: ${JSON.stringify(reg.body)}`);
  const userId = reg.body.userId;
  ok(`Utilisateur créé — userId: ${userId}`);

  // ── 2. Connexion ─────────────────────────────────────────────────────────
  title('2. Connexion');
  const login = await request('POST', '/api/auth/login', {
    email: USER.email, password: USER.password,
  });
  assert(login.status === 200, `Login failed ${login.status}: ${JSON.stringify(login.body)}`);
  const token = login.body.token;
  ok(`JWT obtenu — role: ${login.body.role}`);
  dim(`Token: ${token.substring(0, 40)}...`);

  // ── 3. Profil utilisateur ────────────────────────────────────────────────
  title('3. Consultation du profil');
  const profile = await request('GET', `/api/users/${userId}`, null, token);
  assert(profile.status === 200, `GetProfile failed: ${profile.status}`);
  ok(`Profil récupéré — ${profile.body.name} (${profile.body.email})`);

  // ── 4. Création d'un créneau ─────────────────────────────────────────────
  title('4. Création d\'un créneau');
  const tomorrow    = Date.now() + 86400000;
  const slotPayload = {
    serviceId: 'svc-coiffure-001',
    startTime: tomorrow,
    endTime:   tomorrow + 3600000,
    capacity:  5,
    price:     45.0,
  };
  dim(`Service: ${slotPayload.serviceId} | Prix: ${slotPayload.price} TND | Capacité: ${slotPayload.capacity}`);
  const slotRes = await request('POST', '/api/slots', slotPayload, token);
  assert(slotRes.status === 201, `CreateSlot failed ${slotRes.status}: ${JSON.stringify(slotRes.body)}`);
  const slotId = slotRes.body.slotId;
  ok(`Créneau créé — slotId: ${slotId}`);

  // ── 5. Consultation des créneaux disponibles ─────────────────────────────
  title('5. Créneaux disponibles');
  const slotsRes = await request('GET', `/api/slots?serviceId=svc-coiffure-001&date=${tomorrow}`);
  assert(slotsRes.status === 200, `GetSlots failed: ${slotsRes.status}`);
  ok(`${slotsRes.body.totalAvailable} place(s) disponible(s) sur ${slotsRes.body.slots.length} créneau(x)`);

  // ── 6. Réservation ───────────────────────────────────────────────────────
  title('6. Réservation du créneau');
  const bookRes = await request('POST', '/api/bookings', { slotId }, token);
  assert(bookRes.status === 201, `BookSlot failed ${bookRes.status}: ${JSON.stringify(bookRes.body)}`);
  const bookingId = bookRes.body.bookingId;
  ok(`Réservation confirmée — bookingId: ${bookingId}`);
  ok(`Statut: ${bookRes.body.status}`);

  // ── 7. Détail de la réservation ──────────────────────────────────────────
  title('7. Détail de la réservation');
  const bookDetail = await request('GET', `/api/bookings/${bookingId}`, null, token);
  assert(bookDetail.status === 200, `GetBooking failed: ${bookDetail.status}`);
  ok(`Réservation #${bookDetail.body.id || bookingId} — statut: ${bookDetail.body.status}`);

  // ── 8. Paiement ──────────────────────────────────────────────────────────
  title('8. Traitement du paiement');
  const payPayload = { bookingId, amount: 45.0, method: 'card', currency: 'TND' };
  dim(`Montant: ${payPayload.amount} ${payPayload.currency} | Méthode: ${payPayload.method}`);
  const payRes = await request('POST', '/api/payments', payPayload, token);
  assert(payRes.status === 201, `ProcessPayment failed ${payRes.status}: ${JSON.stringify(payRes.body)}`);
  const paymentId = payRes.body.paymentId;
  ok(`Paiement traité — paymentId: ${paymentId}`);
  ok(`Statut: ${payRes.body.status}`);

  // ── 9. Facture ───────────────────────────────────────────────────────────
  title('9. Consultation de la facture');
  const invRes = await request('GET', `/api/invoices/${bookingId}`, null, token);
  if (invRes.status === 200) {
    const inv = invRes.body;
    ok(`Facture #${inv.id} — Montant: ${inv.amount} ${inv.currency}`);
    ok(`Statut: ${inv.status}`);
  } else {
    warn(`Facture non disponible (${invRes.status}) — normal si le paiement est en cours`);
  }

  // ── 10. Historique des notifications ────────────────────────────────────
  title('10. Notifications');
  const notifRes = await request('GET', '/api/notifications', null, token);
  assert(notifRes.status === 200, `GetNotifications failed: ${notifRes.status}`);
  const notifs = notifRes.body.notifications || [];
  ok(`${notifs.length} notification(s) reçue(s)`);
  notifs.slice(0, 3).forEach((n) => {
    dim(`[${n.type || 'email'}] ${n.subject || n.body || JSON.stringify(n)}`);
  });

  // ── 11. Préférences de notification ─────────────────────────────────────
  title('11. Mise à jour des préférences de notification');
  const prefRes = await request('PUT', '/api/notifications/preferences', {
    emailNotifications: true,
    smsNotifications:   false,
    pushNotifications:  true,
  }, token);
  assert(prefRes.status === 200, `UpdatePreferences failed: ${prefRes.status}`);
  ok('Préférences mises à jour');

  // ── 12. Annulation de la réservation ────────────────────────────────────
  title('12. Annulation de la réservation');
  const cancelRes = await request('DELETE', `/api/bookings/${bookingId}`,
    { reason: 'Démonstration — annulation test' }, token);
  assert(cancelRes.status === 200, `CancelBooking failed ${cancelRes.status}: ${JSON.stringify(cancelRes.body)}`);
  ok(`Réservation annulée — ${cancelRes.body.message || 'OK'}`);

  // ── 13. Vérification du remboursement automatique ───────────────────────
  title('13. Vérification du remboursement automatique (via Kafka)');
  // Give Kafka a moment to process the event
  await new Promise((r) => setTimeout(r, 1500));
  const payStatus = await request('GET', `/api/payments/${paymentId}`, null, token);
  if (payStatus.status === 200) {
    const status = payStatus.body.status;
    if (status === 'refunded') {
      ok(`Remboursement automatique confirmé — statut: ${status}`);
    } else {
      warn(`Statut paiement: ${status} (le remboursement Kafka peut prendre quelques secondes)`);
    }
  } else {
    warn(`Impossible de vérifier le statut du paiement (${payStatus.status})`);
  }

  // ── 14. GraphQL — requête flexible ──────────────────────────────────────
  title('14. GraphQL — Requête flexible (myBookings)');
  const gqlBody = {
    query: `query {
      myBookings(limit: 5, offset: 0) {
        bookings { id status totalPrice createdAt }
        total
      }
    }`,
  };
  const gqlRes = await request('POST', '/graphql', gqlBody, token);
  if (gqlRes.status === 200 && !gqlRes.body.errors) {
    const data = gqlRes.body.data.myBookings;
    ok(`GraphQL OK — ${data.total} réservation(s) au total`);
    data.bookings.forEach((b) => {
      dim(`  #${b.id.substring(0, 8)}... | statut: ${b.status} | prix: ${b.totalPrice} TND`);
    });
  } else {
    warn(`GraphQL: ${JSON.stringify(gqlRes.body.errors || gqlRes.body)}`);
  }

  // ── Résumé ───────────────────────────────────────────────────────────────
  console.log(`\n${C.bold}${C.green}╔══════════════════════════════════════════════╗`);
  console.log(`║         Scénario terminé avec succès !       ║`);
  console.log(`╚══════════════════════════════════════════════╝${C.reset}\n`);

  console.log('  Ressources créées :');
  info(`userId    : ${userId}`);
  info(`slotId    : ${slotId}`);
  info(`bookingId : ${bookingId}`);
  info(`paymentId : ${paymentId}`);
  console.log('');
};

run().catch((err) => {
  fail(`Erreur inattendue : ${err.message}`);
  if (err.code === 'ECONNREFUSED') {
    warn(`L'API Gateway n'est pas accessible sur ${BASE}`);
    warn('Assurez-vous que les services sont démarrés : docker-compose up');
  }
  process.exit(1);
});
