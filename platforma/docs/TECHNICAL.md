# Documentation Technique — Platforma

## 1. Vue d'ensemble

Platforma est une **plateforme de réservation intelligente** basée sur une architecture microservices.  
Elle permet à des clients de s'inscrire, de consulter des créneaux disponibles, de réserver, de payer et de recevoir des notifications automatiques à chaque étape.

---

## 2. Architecture microservices

### Schéma de communication

```
┌──────────────────────────────────────────────────────────────────┐
│                          CLIENT                                  │
│              REST (HTTP/1.1 + JSON) / GraphQL                    │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                       API GATEWAY  :3000                         │
│   Express + Apollo Server                                        │
│   • Endpoints REST                                               │
│   • Interface GraphQL                                            │
│   • Middleware d'authentification JWT                            │
└────┬──────────────┬──────────────┬──────────────┬───────────────┘
     │ gRPC         │ gRPC         │ gRPC         │ gRPC
     │ :50051       │ :50052       │ :50053       │ :50054
     ▼              ▼              ▼              ▼
┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐
│  Auth   │  │ Booking  │  │ Payment  │  │Notification  │
│ Service │  │ Service  │  │ Service  │  │  Service     │
│SQLite3  │  │ SQLite3  │  │ SQLite3  │  │  RxDB        │
└────┬────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘
     │             │              │               │
     └─────────────┴──────────────┴───────────────┘
                           │
                    ┌──────▼──────┐
                    │    Kafka    │
                    │   Broker   │
                    │   :9092    │
                    └────────────┘
```

### Principes respectés

- **Séparation des responsabilités** : chaque microservice a un domaine métier unique
- **Base de données par service** : aucun service ne partage sa base de données
- **Communication synchrone** : gRPC (HTTP/2 + Protobuf) entre Gateway et services
- **Communication asynchrone** : Kafka pour les événements métier inter-services
- **Indépendance** : chaque service peut démarrer et fonctionner sans les autres

---

## 3. Contrats gRPC (.proto)

### 3.1 auth.proto

```protobuf
service AuthService {
  rpc Authenticate(AuthRequest)         returns (AuthResponse);
  rpc ValidateToken(TokenRequest)       returns (TokenResponse);
  rpc RegisterUser(RegisterRequest)     returns (RegisterResponse);
  rpc GetUserProfile(UserIdRequest)     returns (UserProfile);
  rpc UpdateProfile(UpdateProfileRequest) returns (UpdateProfileResponse);
}
```

**Messages clés :**
- `AuthRequest` : `{ email, password }`
- `AuthResponse` : `{ token, userId, role, expiresIn }`
- `TokenResponse` : `{ valid, userId, email, role }`
- `UserProfile` : `{ id, email, name, role, createdAt, updatedAt }`

### 3.2 booking.proto

```protobuf
service BookingService {
  rpc CreateSlot(CreateSlotRequest)         returns (SlotResponse);
  rpc BookSlot(BookSlotRequest)             returns (BookingResponse);
  rpc CancelBooking(CancelRequest)          returns (CancelResponse);
  rpc GetAvailableSlots(GetSlotsRequest)    returns (SlotListResponse);
  rpc ListBookings(ListBookingsRequest)     returns (BookingListResponse);
  rpc GetBooking(BookingIdRequest)          returns (BookingDetailResponse);
}
```

**Messages clés :**
- `CreateSlotRequest` : `{ serviceId, startTime, endTime, capacity, price }`
- `BookSlotRequest` : `{ userId, slotId }`
- `BookingDetail` : `{ id, userId, slot, status, totalPrice, createdAt, cancelledAt }`

### 3.3 payment.proto

```protobuf
service PaymentService {
  rpc ProcessPayment(PaymentRequest)        returns (PaymentResponse);
  rpc RefundPayment(RefundRequest)          returns (RefundResponse);
  rpc GetPaymentStatus(PaymentIdRequest)    returns (PaymentStatusResponse);
  rpc GetInvoice(InvoiceRequest)            returns (InvoiceResponse);
  rpc ListPayments(ListPaymentsRequest)     returns (PaymentListResponse);
}
```

**Messages clés :**
- `PaymentRequest` : `{ bookingId, userId, amount, method, currency }`
- `PaymentResponse` : `{ success, paymentId, status, message }`
- `Invoice` : `{ id, paymentId, bookingId, amount, currency, issuedAt, pdfUrl, status }`

### 3.4 notification.proto

```protobuf
service NotificationService {
  rpc SendNotification(NotificationRequest)             returns (NotificationResponse);
  rpc GetNotificationPreferences(UserIdRequest)         returns (PreferencesResponse);
  rpc UpdatePreferences(UpdatePreferencesRequest)       returns (PreferencesResponse);
  rpc GetNotificationHistory(UserIdRequest)             returns (HistoryResponse);
}
```

**Messages clés :**
- `NotificationRequest` : `{ userId, type, subject, body, recipientEmail, recipientPhone, data }`
- `PreferencesResponse` : `{ userId, emailNotifications, smsNotifications, pushNotifications, types, updatedAt }`

---

## 4. Endpoints REST détaillés

### Auth

#### POST /api/auth/register
```json
// Body
{ "email": "alice@test.com", "password": "pass123", "name": "Alice", "role": "client" }

// Réponse 201
{ "success": true, "userId": "uuid", "message": "User registered successfully" }
```

#### POST /api/auth/login
```json
// Body
{ "email": "alice@test.com", "password": "pass123" }

// Réponse 200
{ "token": "eyJ...", "userId": "uuid", "role": "client" }
```

#### GET /api/users/:userId
```json
// Header: Authorization: Bearer <token>
// Réponse 200
{ "id": "uuid", "email": "alice@test.com", "name": "Alice", "role": "client", "createdAt": 1747267200000 }
```

### Slots

#### POST /api/slots
```json
// Header: Authorization: Bearer <token>
// Body
{ "serviceId": "svc_1", "startTime": 1747270800000, "endTime": 1747274400000, "capacity": 5, "price": 50.0 }

// Réponse 201
{ "success": true, "slotId": "uuid", "message": "Slot created successfully" }
```

#### GET /api/slots?serviceId=svc_1&date=1747267200000
```json
// Réponse 200
{
  "slots": [{ "id": "uuid", "startTime": 1747270800000, "endTime": 1747274400000, "capacity": 5, "booked": 2, "price": 50.0 }],
  "totalAvailable": 3
}
```

### Bookings

#### POST /api/bookings
```json
// Header: Authorization: Bearer <token>
// Body
{ "slotId": "slot-uuid" }

// Réponse 201
{ "success": true, "bookingId": "uuid", "message": "Booking confirmed" }
```

#### DELETE /api/bookings/:bookingId
```json
// Header: Authorization: Bearer <token>
// Body (optionnel)
{ "reason": "Changement de planning" }

// Réponse 200
{ "success": true, "message": "Booking cancelled successfully" }
```

### Payments

#### POST /api/payments
```json
// Header: Authorization: Bearer <token>
// Body
{ "bookingId": "bk-uuid", "amount": 50.0, "method": "card", "currency": "TND" }

// Réponse 201
{ "success": true, "paymentId": "uuid", "status": "completed", "message": "Payment processed successfully" }
```

#### POST /api/payments/:paymentId/refund
```json
// Header: Authorization: Bearer <token>
// Body
{ "reason": "Service non rendu" }

// Réponse 200
{ "success": true, "message": "Refund processed successfully", "refundedAmount": 50.0 }
```

---

## 5. Schéma GraphQL

### Types principaux

```graphql
type User       { id, email, name, role, createdAt }
type Slot       { id, serviceId, startTime, endTime, capacity, booked, price }
type BookingDetail { id, userId, slot, status, totalPrice, createdAt, cancelledAt }
type PaymentStatus { paymentId, bookingId, amount, method, status, createdAt }
type Invoice    { id, paymentId, bookingId, amount, currency, issuedAt, pdfUrl, status }
type NotificationItem { id, userId, type, subject, body, status, createdAt, sentAt }
```

### Queries disponibles

| Query | Auth | Description |
|---|---|---|
| `me` | ✅ | Profil de l'utilisateur connecté |
| `user(id)` | ❌ | Profil par ID |
| `slots(serviceId, date)` | ❌ | Créneaux disponibles |
| `booking(id)` | ✅ | Détail d'une réservation |
| `myBookings(limit, offset)` | ✅ | Mes réservations |
| `payment(id)` | ✅ | Statut d'un paiement |
| `myPayments(limit, offset)` | ✅ | Mes paiements |
| `invoice(bookingId)` | ✅ | Facture d'une réservation |
| `myNotifications` | ✅ | Historique des notifications |
| `notificationPreferences` | ✅ | Préférences de notification |

### Mutations disponibles

| Mutation | Auth | Description |
|---|---|---|
| `register(email, password, name, role)` | ❌ | Créer un compte |
| `login(email, password)` | ❌ | Se connecter |
| `updateProfile(name, email)` | ✅ | Modifier le profil |
| `createSlot(serviceId, startTime, endTime, capacity, price)` | ✅ | Créer un créneau |
| `bookSlot(slotId)` | ✅ | Réserver un créneau |
| `cancelBooking(bookingId, reason)` | ✅ | Annuler une réservation |
| `processPayment(bookingId, amount, method, currency)` | ✅ | Payer |
| `refundPayment(paymentId, reason)` | ✅ | Rembourser |
| `updateNotificationPreferences(...)` | ✅ | Modifier les préférences |

**Justification de GraphQL** : GraphQL est utilisé pour permettre au client de récupérer exactement les champs dont il a besoin (ex: récupérer une réservation avec les détails du créneau et le statut du paiement en une seule requête), évitant le sur-chargement de données (over-fetching) inhérent à REST.

---

## 6. Topics Kafka — détail

### Flux métier principal

```
[Client] → POST /api/auth/register
    → auth-service publie → user.registered
        → notification-service consomme → envoie email de bienvenue

[Client] → POST /api/bookings
    → booking-service publie → booking.confirmed
        → payment-service consomme → prêt à traiter le paiement
        → notification-service consomme → envoie confirmation de réservation

[Client] → POST /api/payments
    → payment-service publie → payment.completed + invoice.generated
        → notification-service consomme → envoie confirmation de paiement + facture

[Client] → DELETE /api/bookings/:id
    → booking-service publie → booking.cancelled
        → payment-service consomme → remboursement automatique
        → notification-service consomme → envoie notification d'annulation
    → payment-service publie → payment.refunded
        → notification-service consomme → envoie confirmation de remboursement
```

### Structure des messages

**booking.confirmed**
```json
{
  "bookingId": "uuid",
  "userId": "uuid",
  "slotId": "uuid",
  "serviceId": "svc_1",
  "amount": 50.0,
  "createdAt": 1747270800000
}
```

**payment.completed**
```json
{
  "paymentId": "uuid",
  "bookingId": "uuid",
  "userId": "uuid",
  "amount": 50.0,
  "currency": "TND",
  "completedAt": 1747270900000
}
```

**notification.sent**
```json
{
  "notificationId": "uuid",
  "userId": "uuid",
  "type": "email",
  "subject": "Réservation confirmée",
  "sentAt": 1747270950000
}
```

---

## 7. Bases de données

### auth-service — SQLite3

**Table `users`**
| Colonne | Type | Description |
|---|---|---|
| id | TEXT PK | UUID |
| email | TEXT UNIQUE | Email de l'utilisateur |
| passwordHash | TEXT | Hash bcrypt |
| name | TEXT | Nom complet |
| role | TEXT | `client`, `provider`, `admin` |
| createdAt | INTEGER | Timestamp ms |
| updatedAt | INTEGER | Timestamp ms |

**Table `sessions`**
| Colonne | Type | Description |
|---|---|---|
| id | TEXT PK | UUID |
| userId | TEXT FK | Référence users |
| token | TEXT | JWT |
| expiresAt | INTEGER | Timestamp ms |

### booking-service — SQLite3

**Table `slots`** : créneaux disponibles (serviceId, startTime, endTime, capacity, booked, price)  
**Table `bookings`** : réservations (userId, slotId, status, createdAt, cancelledAt, cancelReason)

### payment-service — SQLite3

**Table `payments`** : paiements (bookingId, userId, amount, method, status, currency, completedAt)  
**Table `invoices`** : factures (paymentId, bookingId, amount, currency, status, issuedAt)

### notification-service — RxDB (NoSQL)

Utilise **RxDB avec l'adaptateur LokiJS** pour le stockage NoSQL persistant côté Node.js.

**Collection `notifications`**
```json
{
  "id": "uuid",
  "userId": "uuid",
  "type": "email | sms | push",
  "subject": "string",
  "body": "string",
  "status": "pending | sent | failed",
  "failureReason": "string",
  "createdAt": 1747270800000,
  "sentAt": 1747270900000
}
```

**Collection `preferences`**
```json
{
  "userId": "uuid",
  "emailNotifications": true,
  "smsNotifications": false,
  "pushNotifications": false,
  "bookingConfirmed": true,
  "bookingCancelled": true,
  "paymentReceived": true,
  "paymentFailed": true,
  "reminderBeforeSlot": true,
  "updatedAt": 1747270800000
}
```

**Justification de RxDB** : RxDB est utilisé pour le notification-service car les notifications sont des documents semi-structurés avec des champs variables (`data`, `failureReason`, etc.), ce qui correspond mieux à un modèle NoSQL. RxDB offre également une API réactive et des requêtes flexibles adaptées à la consultation d'historiques.

---

## 8. Gestion des erreurs gRPC

Chaque service utilise les codes de statut gRPC standards :

| Code gRPC | HTTP équivalent | Cas d'usage |
|---|---|---|
| `INVALID_ARGUMENT` | 400 | Champs manquants ou invalides |
| `UNAUTHENTICATED` | 401 | Identifiants incorrects |
| `NOT_FOUND` | 404 | Ressource inexistante |
| `ALREADY_EXISTS` | 409 | Email déjà utilisé, double réservation |
| `UNAVAILABLE` | 409 | Créneau complet |
| `FAILED_PRECONDITION` | 422 | État incompatible (ex: rembourser un paiement non complété) |
| `INTERNAL` | 500 | Erreur serveur interne |

---

## 9. Sécurité

- **Authentification** : JWT signé avec `jsonwebtoken`, expiration 7 jours
- **Mots de passe** : hashés avec `bcryptjs` (salt rounds: 12)
- **Middleware** : validation du token JWT sur toutes les routes protégées via `validateToken` gRPC
- **Variables sensibles** : gérées via `.env` (ne jamais committer `.env`)

---

## 10. Conteneurisation Docker

Le projet est entièrement conteneurisé avec Docker Compose :

- **Zookeeper** : coordination Kafka
- **Kafka** : broker de messages (Confluent Platform 7.5)
- **4 microservices** : chacun avec son propre Dockerfile multi-stage
- **API Gateway** : exposé sur le port 3000
- **Volumes persistants** : données SQLite3 et RxDB conservées entre les redémarrages

```bash
# Démarrer
docker-compose up --build

# Arrêter
docker-compose down

# Supprimer les volumes (reset complet)
docker-compose down -v
```
