# Documentation Technique - Plateforme de Réservation Intelligente

## Table des matières

1. [Introduction](#introduction)
2. [Stack technologique](#stack-technologique)
3. [Architecture détaillée](#architecture-détaillée)
4. [Microservices](#microservices)
5. [Communication gRPC](#communication-grpc)
6. [Intégration Kafka](#intégration-kafka)
7. [Implémentation REST](#implémentation-rest)
8. [Implémentation GraphQL](#implémentation-graphql)
9. [Base de données](#base-de-données)
10. [Déploiement](#déploiement)

---

## 📖 Introduction

La **Plateforme de Réservation Intelligente** est une application SOA (Service-Oriented Architecture) complète qui démontre l'intégration de plusieurs protocoles de communication modernes:

- **gRPC** pour la communication synchrone inter-services (HTTP/2, Protocol Buffers)
- **Kafka** pour la communication asynchrone par événements
- **REST** pour les opérations CRUD simples
- **GraphQL** pour les requêtes flexibles

---

## 🛠️ Stack technologique

### Backend
| Composant | Technologie | Version | Raison |
|-----------|------------|---------|--------|
| Runtime | Node.js | 20 LTS | Performance, écosystème npm riche |
| Framework REST | Express.js | 4.18.3 | Légère, flexible, standard industrie |
| Framework GraphQL | Apollo Server | 3.13.0 | Implémentation complète de GraphQL |
| gRPC | @grpc/grpc-js | 1.10.1 | Communication haute performance |
| Protobuf | @grpc/proto-loader | 0.7.10 | Sérialisation efficace |
| Message Broker | KafkaJS | 2.2.4 | Communication asynchrone |
| Base de données | SQLite3 | 5.1.7 | Légère, sans serveur |
| Authentification | JWT (jsonwebtoken) | 9.0.2 | Stateless, sécurisé |
| Hashage | bcryptjs | 2.4.3 | Sécurisation des mots de passe |
| Logging | Winston | 3.12.0 | Logging structuré |
| Testing | Jest | 29.7.0 | Framework complet de test |
| Hot Reload | Nodemon | 3.1.0 | Développement productif |

### Infrastructure
| Composant | Technologie |
|-----------|------------|
| Conteneurisation | Docker |
| Orchestration | Docker Compose |
| Message Broker | Kafka (Confluent 7.5.0) |
| Coordination | Zookeeper |

---

## 🏗️ Architecture détaillée

### Principes de conception

1. **Microservices Indépendants**
   - Chaque service est un processus Node.js indépendant
   - Responsabilité unique et bien définie
   - Déploiement indépendant possible

2. **Communication Multi-Protocoles**
   ```
   Clients
     ├─ REST (JSON sur HTTP)
     ├─ GraphQL (JSON sur HTTP)
     └─ WebSocket (futur)
   
   Services
     ├─ gRPC (Protocol Buffers sur HTTP/2)
     └─ Kafka (événements binaires)
   ```

3. **Isolation des données**
   ```
   Service A
     └─ Database A (SQLite)
   
   Service B
     └─ Database B (SQLite)
   
   (Aucun accès direct entre les données)
   ```

### Modèle de requête

```
1. Client → REST/GraphQL
   └─ HTTP(S) → API Gateway

2. API Gateway → Microservice
   └─ gRPC (HTTP/2) → Microservice

3. Microservice → Kafka
   └─ Événement → Autres services

4. Autres services écoutent Kafka
   └─ Réaction événementielle → DB update
```

---

## 🔧 Microservices

### 1. Auth Service (Port 50051)

#### Fichiers principaux
```
services/auth-service/
├── server.js          # Serveur gRPC
├── Dockerfile         # Conteneur Docker
```

#### Endpoints gRPC
```proto
service AuthService {
  rpc Authenticate(AuthRequest) returns (AuthResponse);
  rpc RegisterUser(RegisterRequest) returns (RegisterResponse);
  rpc ValidateToken(TokenRequest) returns (TokenResponse);
  rpc GetUserProfile(UserIdRequest) returns (UserProfile);
  rpc UpdateProfile(UpdateProfileRequest) returns (UpdateProfileResponse);
}
```

#### Flux d'authentification
```
1. Client: Login
   POST /api/auth/login
   {
     "email": "user@example.com",
     "password": "password123"
   }

2. API Gateway: Appel gRPC
   authClient.authenticate({ email, password })

3. Auth Service:
   - Hash le mot de passe reçu
   - Compare avec le hash en DB
   - Si OK → Génère JWT token
   - Retourne { token, userId, role, expiresIn }

4. API Gateway: Retourne au client
   {
     "token": "eyJhbGc...",
     "userId": "user-123",
     "role": "client"
   }

5. Client: Stocke le token
   localStorage.setItem('token', token)

6. Requêtes suivantes:
   Headers: Authorization: Bearer {token}

7. API Gateway: Valide le token
   authClient.validateToken({ token })
```

#### Base de données
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  passwordHash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'client',
  createdAt INTEGER,
  updatedAt INTEGER
);
```

---

### 2. Booking Service (Port 50052)

#### Endpoints gRPC
```proto
service BookingService {
  rpc CreateSlot(CreateSlotRequest) returns (SlotResponse);
  rpc BookSlot(BookSlotRequest) returns (BookingResponse);
  rpc CancelBooking(CancelRequest) returns (CancelResponse);
  rpc GetAvailableSlots(GetSlotsRequest) returns (SlotListResponse);
  rpc ListBookings(ListBookingsRequest) returns (BookingListResponse);
  rpc GetBooking(BookingIdRequest) returns (BookingDetailResponse);
}
```

#### Flux de réservation
```
1. Créer un créneau (Staff):
   POST /api/slots
   {
     "serviceId": "service-1",
     "startTime": 1715779200000,
     "endTime": 1715782800000,
     "capacity": 5,
     "price": 50
   }

2. Booking Service:
   - Crée une entrée dans la table slots
   - Retourne slotId

3. Réserver un créneau (Client):
   POST /api/bookings
   {
     "slotId": "slot-123"
   }

4. Booking Service:
   - Vérifie que booked < capacity
   - Crée une entrée bookings
   - Incrémente booked
   - Publie événement: booking-created
   - Retourne { bookingId, status: "pending" }

5. Kafka Message:
   Topic: booking-created
   {
     "bookingId": "booking-456",
     "userId": "user-123",
     "slotId": "slot-123",
     "timestamp": 1715779200000
   }

6. Payment Service écoute:
   - Reçoit booking-created
   - Crée une invoice
   - Publie: invoice-generated

7. Notification Service écoute:
   - Reçoit booking-created
   - Envoie notification de confirmation
```

#### Base de données
```sql
CREATE TABLE slots (
  id TEXT PRIMARY KEY,
  serviceId TEXT NOT NULL,
  startTime INTEGER NOT NULL,
  endTime INTEGER NOT NULL,
  capacity INTEGER DEFAULT 1,
  booked INTEGER DEFAULT 0,
  price REAL,
  createdAt INTEGER
);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  slotId TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  createdAt INTEGER
);
```

---

### 3. Payment Service (Port 50053)

#### Endpoints gRPC
```proto
service PaymentService {
  rpc ProcessPayment(PaymentRequest) returns (PaymentResponse);
  rpc GetPaymentStatus(PaymentIdRequest) returns (PaymentStatusResponse);
  rpc RefundPayment(RefundRequest) returns (RefundResponse);
  rpc GetInvoice(InvoiceIdRequest) returns (InvoiceResponse);
}
```

#### Flux de paiement
```
1. Booking Service publie: booking-created
   
2. Payment Service écoute:
   - Reçoit booking-created
   - Crée une invoice en attente de paiement

3. Client traite le paiement:
   POST /api/payments
   {
     "bookingId": "booking-456",
     "amount": 50,
     "paymentMethod": "credit_card",
     "token": "tok_visa"
   }

4. Payment Service:
   - Traite le paiement
   - Met à jour le statut: completed
   - Publie: payment-completed
   - Retourne confirmation

5. Kafka Messages:
   Topic: payment-completed
   {
     "bookingId": "booking-456",
     "status": "completed",
     "timestamp": 1715779300000
   }

6. Booking Service écoute:
   - Reçoit payment-completed
   - Met à jour statut booking: confirmed

7. Notification Service écoute:
   - Reçoit payment-completed
   - Envoie notification de confirmation de paiement
```

---

### 4. Notification Service (Port 50054)

#### Endpoints gRPC
```proto
service NotificationService {
  rpc SendNotification(NotificationRequest) returns (NotificationResponse);
  rpc GetNotifications(UserIdRequest) returns (NotificationListResponse);
  rpc MarkAsRead(NotificationIdRequest) returns (MarkReadResponse);
}
```

#### Système de notifications
```
Events écoutés:
  - booking-created → Notification de confirmation
  - payment-completed → Notification de paiement réussi
  - payment-failed → Notification d'erreur de paiement
  - booking-cancelled → Notification d'annulation

Chaque événement:
  1. Service écoute Kafka
  2. Crée une notification
  3. Stocke en DB
  4. (Futur) Envoie email/SMS
```

---

## 📡 Communication gRPC

### Configuration gRPC

```javascript
// Charger les proto files
const protoLoader = require('@grpc/proto-loader');
const grpc = require('@grpc/grpc-js');

const packageDef = protoLoader.loadSync(
  'shared/proto/auth.proto',
  {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  }
);

const authProto = grpc.loadPackageDefinition(packageDef).auth;

// Créer le serveur
const server = new grpc.Server();

// Ajouter le service
server.addService(authProto.AuthService.service, {
  authenticate: (call, callback) => {
    // Implémentation
  },
});

// Écouter
server.bindAsync(
  '0.0.0.0:50051',
  grpc.ServerCredentials.createInsecure(),
  (err, port) => {
    if (err) throw err;
    server.start();
  }
);
```

### Appels gRPC depuis API Gateway

```javascript
// Créer un client gRPC
const client = new authProto.AuthService(
  'localhost:50051',
  grpc.credentials.createInsecure()
);

// Appel gRPC (Promisified)
const grpcCall = (client, method, request) =>
  new Promise((resolve, reject) => {
    client[method](request, (err, response) => {
      if (err) reject(err);
      else resolve(response);
    });
  });

// Utilisation
const response = await grpcCall(
  authClient,
  'authenticate',
  { email: 'user@example.com', password: 'pass' }
);
```

### Avantages de gRPC

- **Performance:** HTTP/2, Protocol Buffers (binaire)
- **Typage fort:** Schéma Protobuf défini
- **Bidirectionnel:** Support streaming (futur)
- **Interopérabilité:** Fonctione avec plusieurs langages

---

## 🔄 Intégration Kafka

### Topics Kafka

```
Topic: booking-created
  Producer: Booking Service
  Consumers: Payment Service, Notification Service
  Schema:
  {
    bookingId: string,
    userId: string,
    slotId: string,
    timestamp: number
  }

Topic: payment-completed
  Producer: Payment Service
  Consumers: Booking Service, Notification Service
  Schema:
  {
    paymentId: string,
    bookingId: string,
    status: string,
    timestamp: number
  }

Topic: payment-failed
  Producer: Payment Service
  Consumers: Notification Service
  Schema:
  {
    paymentId: string,
    bookingId: string,
    reason: string,
    timestamp: number
  }
```

### Configuration Kafka

```javascript
const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'booking-service',
  brokers: ['localhost:9092'],
});

// Producer
const producer = kafka.producer();
await producer.connect();

await producer.send({
  topic: 'booking-created',
  messages: [
    {
      key: bookingId,
      value: JSON.stringify({
        bookingId,
        userId,
        slotId,
        timestamp: Date.now(),
      }),
    },
  ],
});

// Consumer
const consumer = kafka.consumer({ groupId: 'notification-group' });
await consumer.connect();
await consumer.subscribe({ topic: 'booking-created' });

await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    const event = JSON.parse(message.value.toString());
    // Traiter l'événement
  },
});
```

---

## 🌐 Implémentation REST

### Structure des endpoints

```
GET  /health                      # Santé du service
POST /api/auth/register           # Enregistrement
POST /api/auth/login              # Connexion
GET  /api/users/:userId           # Profil utilisateur
PUT  /api/users/:userId           # Modifier profil
POST /api/slots                   # Créer un créneau
GET  /api/slots                   # Lister les créneaux
POST /api/bookings                # Créer une réservation
GET  /api/bookings                # Lister les réservations
GET  /api/bookings/:bookingId     # Détail d'une réservation
DELETE /api/bookings/:bookingId   # Annuler une réservation
POST /api/payments                # Traiter un paiement
GET  /api/payments/:paymentId     # Statut de paiement
GET  /api/notifications           # Récupérer les notifications
PUT  /api/notifications/:id/read  # Marquer comme lue
```

### Exemple: Créer une réservation (REST)

```bash
curl -X POST http://localhost:3000/api/bookings \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "slotId": "slot-123"
  }'

Response:
{
  "success": true,
  "bookingId": "booking-456",
  "status": "pending",
  "message": "Booking created successfully"
}
```

---

## 📊 Implémentation GraphQL

### Schéma GraphQL

```graphql
type Query {
  # Users
  me: User
  user(id: ID!): User
  
  # Slots
  availableSlots(serviceId: ID!): [Slot!]!
  slot(id: ID!): Slot
  
  # Bookings
  myBookings: [Booking!]!
  booking(id: ID!): Booking
  
  # Payments
  payment(id: ID!): Payment
  
  # Notifications
  notifications(limit: Int): [Notification!]!
}

type Mutation {
  # Users
  register(email: String!, password: String!, name: String!): AuthResult!
  login(email: String!, password: String!): AuthResult!
  updateProfile(name: String, email: String): User!
  
  # Bookings
  createSlot(serviceId: ID!, startTime: Int!, endTime: Int!, capacity: Int!, price: Float!): Slot!
  createBooking(slotId: ID!): BookingResult!
  cancelBooking(bookingId: ID!): BookingResult!
  
  # Payments
  processPayment(bookingId: ID!, amount: Float!): PaymentResult!
}

type Subscription {
  bookingUpdated(userId: ID!): Booking!
  paymentUpdated(bookingId: ID!): Payment!
  notificationReceived(userId: ID!): Notification!
}
```

### Exemple: Requête GraphQL

```graphql
query {
  myBookings {
    id
    status
    slot {
      id
      startTime
      endTime
      price
    }
  }
}
```

---

## 💾 Base de données

### Schéma SQLite pour chaque service

#### Auth Service (auth.db)
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  passwordHash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'client',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER
);

CREATE INDEX idx_users_email ON users(email);
```

#### Booking Service (booking.db)
```sql
CREATE TABLE slots (
  id TEXT PRIMARY KEY,
  serviceId TEXT NOT NULL,
  startTime INTEGER NOT NULL,
  endTime INTEGER NOT NULL,
  capacity INTEGER DEFAULT 1,
  booked INTEGER DEFAULT 0,
  price REAL,
  createdAt INTEGER NOT NULL
);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  slotId TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  createdAt INTEGER NOT NULL
);

CREATE INDEX idx_bookings_userId ON bookings(userId);
CREATE INDEX idx_bookings_slotId ON bookings(slotId);
```

#### Payment Service (payment.db)
```sql
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  bookingId TEXT NOT NULL,
  userId TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'pending',
  paymentMethod TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  paymentId TEXT NOT NULL,
  invoiceNumber TEXT UNIQUE,
  totalAmount REAL,
  createdAt INTEGER NOT NULL
);

CREATE INDEX idx_payments_bookingId ON payments(bookingId);
CREATE INDEX idx_payments_userId ON payments(userId);
```

#### Notification Service (notif.db)
```sql
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT,
  message TEXT,
  read BOOLEAN DEFAULT 0,
  createdAt INTEGER NOT NULL
);

CREATE INDEX idx_notifications_userId ON notifications(userId);
```

---

## 🚀 Déploiement

### Development
```bash
docker-compose up
```

### Production (recommandations)

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  api-gateway:
    image: myregistry/platform-api-gateway:latest
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      AUTH_SERVICE_URL: auth-service:50051
      # ... autres vars
    depends_on:
      - auth-service
      - booking-service
      - payment-service
      - notification-service

  # Services...

  # TLS/SSL avec Nginx reverse proxy
  nginx:
    image: nginx:latest
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
```

### Environment Variables
```bash
NODE_ENV=production
PORT=3000

# gRPC Services
AUTH_SERVICE_URL=auth-service:50051
BOOKING_SERVICE_URL=booking-service:50052
PAYMENT_SERVICE_URL=payment-service:50053
NOTIFICATION_SERVICE_URL=notification-service:50054

# Kafka
KAFKA_BROKER=kafka:9092

# JWT
JWT_SECRET=your-secret-key-here
JWT_EXPIRY=24h

# Database
BOOKING_DB_PATH=/data/booking.db
# ... etc
```

---

**Documentation Version:** 1.0  
**Dernière mise à jour:** Mai 2026
