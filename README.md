# Platforma — Plateforme de Réservation Intelligente

Application microservices développée en Node.js dans le cadre du mini-projet SoA & Microservices (A.U. 2025-26).

## Architecture

```
Client (REST / GraphQL)
        │
        ▼
  ┌─────────────┐
  │ API Gateway │  :3000  — REST + GraphQL
  └──────┬──────┘
         │ gRPC (HTTP/2 + Protobuf)
    ┌────┴──────────────────────────┐
    │           │          │        │
    ▼           ▼          ▼        ▼
 Auth       Booking    Payment  Notification
:50051      :50052     :50053    :50054
SQLite3     SQLite3    SQLite3    RxDB
    │           │          │        │
    └───────────┴──────────┴────────┘
                     │
               Kafka Broker :9092
```

### Microservices

| Service | Port gRPC | Base de données | Rôle |
|---|---|---|---|
| auth-service | 50051 | SQLite3 | Inscription, login, JWT, profils |
| booking-service | 50052 | SQLite3 | Créneaux, réservations, annulations |
| payment-service | 50053 | SQLite3 | Paiements, remboursements, factures |
| notification-service | 50054 | **RxDB (NoSQL)** | Notifications, préférences, historique |

---

## Prérequis

- [Node.js](https://nodejs.org/) v20+
- [Docker](https://www.docker.com/) & Docker Compose (recommandé)
- npm v9+

---

## Installation et exécution

### Option 1 — Docker Compose (recommandé)

```bash
# Cloner le dépôt
git clone https://github.com/louaybenmansour/platforma.git
cd platforma

# Copier les variables d'environnement
cp platforma/.env.example platforma/.env

# Lancer tous les services
docker-compose up --build
```

L'API Gateway sera disponible sur `http://localhost:3000`.

### Option 2 — Exécution locale

**1. Démarrer Kafka (via Docker)**
```bash
docker-compose up zookeeper kafka -d
```

**2. Installer les dépendances**
```bash
cd platforma
npm install
```

**3. Configurer l'environnement**
```bash
cp .env.example .env
# Éditer .env si nécessaire
```

**4. Démarrer chaque service dans un terminal séparé**
```bash
npm run auth          # Auth Service      → :50051
npm run booking       # Booking Service   → :50052
npm run payment       # Payment Service   → :50053
npm run notification  # Notification Svc  → :50054
npm run gateway       # API Gateway       → :3000
```

---

## Tests

```bash
cd platforma

# Tous les tests
npm test

# Tests unitaires uniquement
npm run test:unit

# Tests d'intégration uniquement
npm run test:integration

# Avec couverture de code
npm run test:coverage
```

---

## Endpoints REST

Base URL : `http://localhost:3000`

### Authentification

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | ❌ | Créer un compte |
| POST | `/api/auth/login` | ❌ | Se connecter, obtenir un JWT |
| GET | `/api/users/:userId` | ✅ | Consulter un profil |
| PUT | `/api/users/:userId` | ✅ | Modifier un profil |

### Créneaux (Slots)

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/slots` | ✅ | Créer un créneau |
| GET | `/api/slots?serviceId=&date=` | ❌ | Lister les créneaux disponibles |

### Réservations

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/bookings` | ✅ | Créer une réservation |
| GET | `/api/bookings` | ✅ | Lister mes réservations |
| GET | `/api/bookings/:bookingId` | ✅ | Détail d'une réservation |
| DELETE | `/api/bookings/:bookingId` | ✅ | Annuler une réservation |

### Paiements

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/payments` | ✅ | Effectuer un paiement |
| GET | `/api/payments` | ✅ | Lister mes paiements |
| GET | `/api/payments/:paymentId` | ✅ | Statut d'un paiement |
| POST | `/api/payments/:paymentId/refund` | ✅ | Demander un remboursement |
| GET | `/api/invoices/:bookingId` | ✅ | Obtenir une facture |

### Notifications

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/notifications` | ✅ | Historique des notifications |
| GET | `/api/notifications/preferences` | ✅ | Consulter les préférences |
| PUT | `/api/notifications/preferences` | ✅ | Modifier les préférences |

> **Auth** : Ajouter le header `Authorization: Bearer <token>` pour les routes protégées.

---

## Interface GraphQL

Disponible sur `http://localhost:3000/graphql`  
Sandbox Apollo : `http://localhost:3000/sandbox`

### Queries principales

```graphql
# Profil de l'utilisateur connecté
query { me { id email name role } }

# Créneaux disponibles
query { slots(serviceId: "svc_1", date: 1747267200000) {
  slots { id startTime endTime price capacity booked }
  totalAvailable
}}

# Mes réservations
query { myBookings(limit: 10, offset: 0) {
  bookings { id status totalPrice createdAt slot { startTime endTime } }
  total
}}

# Mes paiements
query { myPayments { payments { id amount status method } total } }
```

### Mutations principales

```graphql
# Inscription
mutation { register(email: "user@test.com", password: "pass123", name: "Alice") {
  token userId role
}}

# Connexion
mutation { login(email: "user@test.com", password: "pass123") {
  token userId role
}}

# Réserver un créneau
mutation { bookSlot(slotId: "slot-uuid") { success bookingId message } }

# Payer une réservation
mutation { processPayment(bookingId: "bk-uuid", amount: 50.0, method: "card") {
  success paymentId status
}}
```

---

## Topics Kafka

| Topic | Producteur | Consommateur(s) | Déclencheur |
|---|---|---|---|
| `user.registered` | auth-service | notification-service | Inscription d'un utilisateur |
| `user.updated` | auth-service | — | Mise à jour du profil |
| `slot.created` | booking-service | — | Création d'un créneau |
| `booking.confirmed` | booking-service | payment-service, notification-service | Réservation confirmée |
| `booking.cancelled` | booking-service | payment-service, notification-service | Annulation d'une réservation |
| `payment.initiated` | payment-service | — | Début du traitement paiement |
| `payment.completed` | payment-service | booking-service, notification-service | Paiement réussi |
| `payment.failed` | payment-service | booking-service, notification-service | Paiement échoué |
| `payment.refunded` | payment-service | notification-service | Remboursement effectué |
| `invoice.generated` | payment-service | notification-service | Facture générée |
| `notification.sent` | notification-service | — | Notification envoyée |

---

## Bases de données

| Service | Type | Technologie | Fichier / Répertoire |
|---|---|---|---|
| auth-service | SQL | SQLite3 | `data/auth.db` |
| booking-service | SQL | SQLite3 | `data/booking.db` |
| payment-service | SQL | SQLite3 | `data/payment.db` |
| notification-service | **NoSQL** | **RxDB + LokiJS** | `data/notification-rxdb/` |

---

## Variables d'environnement

Voir [`platforma/.env.example`](platforma/.env.example) pour la liste complète.

| Variable | Défaut | Description |
|---|---|---|
| `JWT_SECRET` | `platforma-secret-...` | Clé secrète JWT |
| `KAFKA_BROKER` | `localhost:9092` | Adresse du broker Kafka |
| `PORT` | `3000` | Port de l'API Gateway |
| `AUTH_GRPC_PORT` | `50051` | Port gRPC auth-service |
| `BOOKING_GRPC_PORT` | `50052` | Port gRPC booking-service |
| `PAYMENT_GRPC_PORT` | `50053` | Port gRPC payment-service |
| `NOTIFICATION_GRPC_PORT` | `50054` | Port gRPC notification-service |

---

## Structure du projet

```
platforma/
├── api-gateway/
│   ├── server.js          # REST + GraphQL + clients gRPC
│   └── Dockerfile
├── services/
│   ├── auth-service/      # SQLite3 — JWT, bcrypt
│   ├── booking-service/   # SQLite3 — créneaux, réservations
│   ├── payment-service/   # SQLite3 — paiements, factures
│   └── notification-service/ # RxDB (NoSQL) — notifications
├── shared/
│   ├── logger.js          # Logger Winston partagé
│   └── proto/             # Contrats gRPC (.proto)
│       ├── auth.proto
│       ├── booking.proto
│       ├── payment.proto
│       └── notification.proto
├── tests/
│   ├── unit/              # Tests unitaires Jest
│   └── integration/       # Tests d'intégration
├── .env.example
└── package.json
```
