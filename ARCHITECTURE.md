# Architecture de la Plateforme de Réservation Intelligente

## Vue d'ensemble

La **Plateforme de Réservation Intelligente** suit une architecture microservices (SOA) moderne avec une séparation claire des responsabilités et une communication interservices utilisant gRPC et Kafka.

---

## 🏛️ Architecture générale

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                      │
│  (Web Browser / Mobile App / Desktop Client)                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               │ HTTP(S)
                               │
                    ┌──────────▼──────────────┐
                    │   API GATEWAY (3000)    │
                    │  ┌──────────────────┐   │
                    │  │ Express REST     │   │
                    │  │ Apollo GraphQL   │   │
                    │  │ Request Logger   │   │
                    │  │ Auth Middleware  │   │
                    │  └──────────────────┘   │
                    └──┬──┬──┬────────────────┘
         ┌──────────────┘  │  │  └──────────────────┐
         │                 │  │                     │
   gRPC  │          gRPC   │  │ gRPC              gRPC
         │                 │  │                     │
         ▼                 ▼  ▼                     ▼
    ┌─────────────┐ ┌──────────────┐ ┌───────────────────┐ ┌────────────────┐
    │ AUTH        │ │ BOOKING      │ │ PAYMENT           │ │ NOTIFICATION   │
    │ SERVICE     │ │ SERVICE      │ │ SERVICE           │ │ SERVICE        │
    │ Port: 50051 │ │ Port: 50052  │ │ Port: 50053       │ │ Port: 50054    │
    │             │ │              │ │                   │ │                │
    │ ┌─────────┐ │ │ ┌──────────┐ │ │ ┌───────────────┐ │ │ ┌────────────┐ │
    │ │ Logic   │ │ │ │ Logic    │ │ │ │ Logic         │ │ │ │ Logic      │ │
    │ │ Handler │ │ │ │ Handler  │ │ │ │ Handler       │ │ │ │ Handler    │ │
    │ │ (gRPC)  │ │ │ │ (gRPC)   │ │ │ │ (gRPC)        │ │ │ │ (gRPC)     │ │
    │ └─────────┘ │ │ └──────────┘ │ │ └───────────────┘ │ │ └────────────┘ │
    │             │ │              │ │                   │ │                │
    │ ┌─────────┐ │ │ ┌──────────┐ │ │ ┌───────────────┐ │ │ ┌────────────┐ │
    │ │ Kafka   │ │ │ │ Kafka    │ │ │ │ Kafka         │ │ │ │ Kafka      │ │
    │ │Consumer │ │ │ │Consumer  │ │ │ │ Consumer      │ │ │ │ Consumer   │ │
    │ └─────────┘ │ │ └──────────┘ │ │ └───────────────┘ │ │ └────────────┘ │
    └─────┬───────┘ └──────┬───────┘ └────────┬──────────┘ └────────┬────────┘
          │                │                   │                    │
          │           ┌─────▼──────────┐       │                    │
          │           │ SQLite3 DB     │       │                    │
          │           │ booking.db     │       │                    │
          │           └────────────────┘       │                    │
          │                                    │                    │
    ┌─────▼──────┐                      ┌─────▼─────────┐  ┌───────▼────────┐
    │ SQLite3 DB │                      │ SQLite3 DB    │  │ SQLite3 DB     │
    │ auth.db    │                      │ payment.db    │  │ notif.db       │
    └────────────┘                      └───────────────┘  └────────────────┘
          ▲
          │
          └──────────────────┬─────────────────┬────────────────┬─────────────┘
                             │                 │                │
                        ┌────▼──────────┬──────▼────┬───────────▼─────┐
                        │  KAFKA MESSAGE BUS (9092) │                 │
                        │  Zookeeper (2181)         │                 │
                        └─────────────────────────────────────────────┘
```

---

## 🔄 Flux de communication

### 1. Communication REST (Client → API Gateway)

```
Client (HTTP)
    │
    ▼
API Gateway (Express)
    │
    ├─ Valide la requête
    ├─ Authentifie le client (si nécessaire)
    ├─ Appelle le Microservice via gRPC
    │
    ▼
Microservice (gRPC)
    │
    ├─ Traite la requête
    ├─ Accède à la base de données
    ├─ Publie des événements Kafka (si pertinent)
    │
    ▼
API Gateway
    │
    ▼
Client (HTTP Response)
```

### 2. Communication GraphQL (Client → API Gateway)

```
Client (GraphQL Query)
    │
    ▼
API Gateway (Apollo Server)
    │
    ├─ Parse la requête GraphQL
    ├─ Valide le schéma
    ├─ Exécute les resolvers
    │
    ▼
Resolvers (appellent gRPC)
    │
    ▼
Microservices (gRPC)
    │
    ▼
API Gateway
    │
    ▼
Client (JSON Response)
```

### 3. Communication gRPC (API Gateway → Microservices)

```
API Gateway (gRPC Client)
    │
    ├─ Sérialise la requête en Protocol Buffers
    ├─ Envoie via HTTP/2
    │
    ▼
Microservice (gRPC Server)
    │
    ├─ Désérialise le Protobuf
    ├─ Traite la requête
    ├─ Retourne une réponse Protobuf
    │
    ▼
API Gateway
    │
    ├─ Désérialise la réponse
    ├─ Retourne au client
```

### 4. Communication Asynchrone (Kafka)

```
Microservice A (Producer)
    │
    ├─ Effectue une action
    ├─ Publie un événement sur un topic Kafka
    │
    ▼
Kafka Topic
    │
    ▼
Microservice B (Consumer)
Microservice C (Consumer)
    │
    ├─ Reçoit l'événement
    ├─ Traite l'événement
    ├─ Persiste les changements
```

---

## 🏢 Microservices

### Auth Service
- **Port gRPC:** 50051
- **Base de données:** `auth.db` (SQLite3)
- **Responsabilité:** Authentification, gestion des utilisateurs
- **Topics Kafka:** `user-registered`, `user-updated`

**Modèle de données:**
```sql
-- Users Table
id (PRIMARY KEY)
email (UNIQUE)
password (hashed)
name
role (client, admin, staff)
created_at
updated_at
```

### Booking Service
- **Port gRPC:** 50052
- **Base de données:** `booking.db` (SQLite3)
- **Responsabilité:** Gestion des créneaux et réservations
- **Topics Kafka:** `booking-created`, `booking-cancelled`, `slot-available`

**Modèle de données:**
```sql
-- Slots Table
id (PRIMARY KEY)
serviceId
startTime (unix timestamp)
endTime (unix timestamp)
capacity
booked
price
createdAt

-- Bookings Table
id (PRIMARY KEY)
userId
slotId
status (confirmed, pending, cancelled)
createdAt
```

### Payment Service
- **Port gRPC:** 50053
- **Base de données:** `payment.db` (SQLite3)
- **Responsabilité:** Traitement des paiements
- **Topics Kafka:** `payment-completed`, `payment-failed`, `refund-requested`

**Modèle de données:**
```sql
-- Payments Table
id (PRIMARY KEY)
bookingId
userId
amount
currency (USD, EUR, etc.)
status (pending, completed, failed, refunded)
paymentMethod
createdAt
updatedAt

-- Invoices Table
id (PRIMARY KEY)
paymentId
invoiceNumber
totalAmount
createdAt
```

### Notification Service
- **Port gRPC:** 50054
- **Base de données:** `notif.db` (SQLite3)
- **Responsabilité:** Envoi de notifications
- **Topics Kafka:** `booking-created`, `payment-completed`, `payment-failed`

**Modèle de données:**
```sql
-- Notifications Table
id (PRIMARY KEY)
userId
type (booking_confirmation, payment_success, reminder)
title
message
read (boolean)
createdAt
```

---

## 🔌 Points d'intégration

### Dépendances entre services

```
API Gateway
    │
    ├─→ Auth Service (pour valider les tokens)
    ├─→ Booking Service (pour les réservations)
    ├─→ Payment Service (pour les paiements)
    └─→ Notification Service (pour les notifications)

Booking Service
    │
    ├─→ Publishes: booking-created, booking-cancelled
    └─→ Subscribes: payment-completed (pour confirmer les réservations)

Payment Service
    │
    ├─→ Subscribes: booking-created (pour créer des invoices)
    └─→ Publishes: payment-completed, payment-failed

Notification Service
    │
    └─→ Subscribes: booking-created, payment-completed, booking-cancelled
```

---

## 📊 Scénario de flux complet: Réserver un créneau

1. **Client envoie REST/GraphQL** → API Gateway
   ```
   POST /api/bookings
   {
     "slotId": "slot-123",
     "userId": "user-456"
   }
   ```

2. **API Gateway:**
   - Valide le token JWT
   - Appelle `BookSlot` via gRPC → Booking Service

3. **Booking Service:**
   - Vérifie la disponibilité du créneau
   - Crée la réservation
   - Publie l'événement `booking-created` → Kafka

4. **Payment Service écoute Kafka:**
   - Reçoit `booking-created`
   - Crée une invoice
   - Publie `invoice-generated` → Kafka

5. **Notification Service écoute Kafka:**
   - Reçoit `booking-created`
   - Crée une notification
   - Stocke dans sa DB

6. **Booking Service écoute Kafka:**
   - Reçoit `payment-completed`
   - Met à jour le statut de la réservation

7. **Notification Service écoute Kafka:**
   - Reçoit `payment-completed`
   - Envoie une notification de confirmation

8. **API Gateway retourne** la réponse au client

---

## 🛡️ Sécurité

### Authentification
- JWT tokens générés par Auth Service
- Validés à chaque requête API
- Tokens inclus dans l'header `Authorization: Bearer {token}`

### Communication gRPC
- HTTP/2 pour le chiffrement par défaut
- TLS optionnel pour la production

### Isolation des données
- Chaque service a sa propre base de données
- Pas d'accès direct à d'autres BDs
- Communication exclusivement via gRPC/Kafka

---

## 📈 Scalabilité

### Horizontal Scaling
- Chaque microservice peut être déployé indépendamment
- Load balancing possible devant API Gateway
- Kafka gère la distribution des événements

### Vertical Scaling
- Augmentation des ressources (CPU, RAM)
- Ajustement de la taille des pools de connexions

---

## 🐳 Conteneurisation (Docker)

### Structure des conteneurs

```yaml
Services:
  - zookeeper (confluentinc/cp-zookeeper:7.5.0)
  - kafka (confluentinc/cp-kafka:7.5.0)
  - api-gateway (node:20-alpine)
  - auth-service (node:20-alpine)
  - booking-service (node:20-alpine)
  - payment-service (node:20-alpine)
  - notification-service (node:20-alpine)

Volumes:
  - auth-data (persistance DB auth)
  - booking-data (persistance DB booking)
  - payment-data (persistance DB payment)
  - notification-data (persistance DB notification)

Networks:
  - default (bridge network)
```

---

## 🔧 Déploiement

### En développement
```bash
docker-compose up
```

### En production
- Utiliser un registre Docker (Docker Hub, ECR, etc.)
- Kubernetes pour l'orchestration (optionnel)
- Reverse proxy (Nginx) devant API Gateway
- TLS/SSL pour la communication
- Secrets management pour les variables d'environnement
- Monitoring et alerting (Prometheus, Grafana)

---

## 📊 Monitoring et Logging

### Logging
- Tous les services utilisent `winston`
- Logs structurés au format JSON
- Niveaux: info, warn, error, debug

### Health Checks
- Endpoint `/health` sur API Gateway
- Docker health checks pour chaque service

---

## 🎓 Principes architecturaux appliqués

1. **Single Responsibility Principle (SRP)**
   - Chaque service a une responsabilité unique et bien définie

2. **Separation of Concerns**
   - Logique métier séparée des infrastructure concerns

3. **API-First Design**
   - Services communiquent exclusivement via APIs (gRPC, Kafka)

4. **Database per Service**
   - Chaque service possède sa propre BD

5. **Event-Driven Communication**
   - Services découplés via événements Kafka

6. **Circuit Breaker Pattern** (optionnel)
   - Peut être ajouté pour la résilience

---

**Architecture Version:** 1.0  
**Dernière mise à jour:** Mai 2026
