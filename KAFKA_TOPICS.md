# Documentation Kafka Topics - Plateforme de Réservation Intelligente

## Vue d'ensemble

Kafka est utilisé pour découpler les microservices et permettre une communication asynchrone basée sur des événements. Chaque événement métier pertinent est publié sur un topic Kafka.

---

## 📋 Topics Kafka

### 1. Topic: `booking-created`

**Producteur:** Booking Service  
**Consommateurs:** Payment Service, Notification Service  
**Objectif:** Notifier des nouvelles réservations

#### Message Schema

```json
{
  "bookingId": "booking-789",
  "userId": "user-123",
  "slotId": "slot-456",
  "serviceId": "service-1",
  "status": "pending",
  "amount": 50.00,
  "currency": "USD",
  "timestamp": 1715779200000
}
```

#### Exemple de message

```json
{
  "bookingId": "booking-789",
  "userId": "user-123",
  "slotId": "slot-456",
  "serviceId": "service-1",
  "status": "pending",
  "amount": 50.00,
  "currency": "USD",
  "timestamp": 1715779200123
}
```

#### Consommateurs et actions

**Payment Service:**
- Reçoit l'événement `booking-created`
- Crée une invoice associée
- Initialise l'état de paiement à "pending"
- Publie `invoice-generated`

**Notification Service:**
- Reçoit l'événement `booking-created`
- Crée une notification de confirmation de réservation
- Marque la notification comme non-lue

#### Configuration Kafka

**Partition:** 1  
**Replication Factor:** 1  
**Retention:** 7 jours

---

### 2. Topic: `payment-completed`

**Producteur:** Payment Service  
**Consommateurs:** Booking Service, Notification Service  
**Objectif:** Notifier que le paiement d'une réservation a été complété

#### Message Schema

```json
{
  "paymentId": "payment-101",
  "bookingId": "booking-789",
  "userId": "user-123",
  "amount": 50.00,
  "currency": "USD",
  "status": "completed",
  "paymentMethod": "credit_card",
  "timestamp": 1715779300000
}
```

#### Consommateurs et actions

**Booking Service:**
- Reçoit l'événement `payment-completed`
- Met à jour le statut de la réservation de "pending" à "confirmed"
- Réduit la capacité disponible du créneau
- Publie `booking-confirmed`

**Notification Service:**
- Reçoit l'événement `payment-completed`
- Crée une notification de confirmation de paiement
- Crée un rappel pour la date de la réservation (futur)

---

### 3. Topic: `payment-failed`

**Producteur:** Payment Service  
**Consommateurs:** Booking Service, Notification Service  
**Objectif:** Notifier que le paiement a échoué

#### Message Schema

```json
{
  "paymentId": "payment-101",
  "bookingId": "booking-789",
  "userId": "user-123",
  "amount": 50.00,
  "reason": "Card declined",
  "timestamp": 1715779350000
}
```

#### Consommateurs et actions

**Booking Service:**
- Reçoit l'événement `payment-failed`
- Met à jour le statut de la réservation à "cancelled"
- Libère le créneau réservé
- Réduit le compteur "booked"

**Notification Service:**
- Reçoit l'événement `payment-failed`
- Crée une notification d'erreur de paiement avec message d'aide

---

### 4. Topic: `booking-cancelled`

**Producteur:** Booking Service  
**Consommateurs:** Payment Service, Notification Service  
**Objectif:** Notifier de l'annulation d'une réservation

#### Message Schema

```json
{
  "bookingId": "booking-789",
  "userId": "user-123",
  "slotId": "slot-456",
  "reason": "customer_request",
  "refundAmount": 50.00,
  "timestamp": 1715779400000
}
```

#### Consommateurs et actions

**Payment Service:**
- Reçoit l'événement `booking-cancelled`
- Marque le paiement comme "refunded"
- Publie `refund-completed`

**Notification Service:**
- Reçoit l'événement `booking-cancelled`
- Crée une notification d'annulation de réservation
- Inclut les détails de remboursement

---

### 5. Topic: `refund-completed`

**Producteur:** Payment Service  
**Consommateurs:** Notification Service  
**Objectif:** Notifier que le remboursement a été traité

#### Message Schema

```json
{
  "paymentId": "payment-101",
  "bookingId": "booking-789",
  "userId": "user-123",
  "refundAmount": 50.00,
  "status": "refunded",
  "timestamp": 1715779450000
}
```

#### Consommateurs et actions

**Notification Service:**
- Reçoit l'événement `refund-completed`
- Crée une notification de confirmation de remboursement
- Inclut les détails du remboursement

---

### 6. Topic: `slot-available`

**Producteur:** Booking Service  
**Consommateurs:** Notification Service  
**Objectif:** Notifier que des créneaux deviennent disponibles

#### Message Schema

```json
{
  "slotId": "slot-456",
  "serviceId": "service-1",
  "startTime": 1715779200000,
  "endTime": 1715782800000,
  "availableCapacity": 3,
  "timestamp": 1715779500000
}
```

#### Consommateurs et actions

**Notification Service:**
- Reçoit l'événement `slot-available`
- Peut envoyer des notifications aux utilisateurs intéressés (futur)

---

### 7. Topic: `user-registered`

**Producteur:** Auth Service  
**Consommateurs:** Notification Service  
**Objectif:** Notifier de l'enregistrement d'un nouvel utilisateur

#### Message Schema

```json
{
  "userId": "user-123",
  "email": "user@example.com",
  "name": "John Doe",
  "role": "client",
  "timestamp": 1715779200000
}
```

#### Consommateurs et actions

**Notification Service:**
- Reçoit l'événement `user-registered`
- Crée une notification de bienvenue
- Crée un profil de notification pour l'utilisateur

---

### 8. Topic: `user-updated`

**Producteur:** Auth Service  
**Consommateurs:** (Futur) Services qui ont besoin de synchroniser les données utilisateur  
**Objectif:** Notifier de la mise à jour du profil utilisateur

#### Message Schema

```json
{
  "userId": "user-123",
  "email": "newemail@example.com",
  "name": "John Smith",
  "timestamp": 1715779600000
}
```

---

## 📊 Diagramme de flux d'événements

```
Réservation créée
    │
    ▼
┌─────────────────────────────────────────────┐
│  Booking Service                            │
│  - Crée la réservation                      │
│  - Publie: booking-created                  │
└──────────────┬──────────────────────────────┘
               │
         Kafka │ booking-created
               │
      ┌────────┴────────────┐
      │                     │
      ▼                     ▼
  ┌───────────────┐  ┌──────────────────┐
  │ Payment Srv   │  │ Notification Srv │
  │ - Invoice     │  │ - Notif created  │
  │ - Awaits pay  │  └──────────────────┘
  └───────┬───────┘
          │
    Client paie
          │
          ▼
    ┌─────────────────────────────────────────────┐
    │  Payment Service                            │
    │  - Traite le paiement                       │
    │  - Succès? Publie: payment-completed        │
    │  - Échec? Publie: payment-failed            │
    └──────────────┬──────────────────────────────┘
                   │
         Kafka │ payment-completed
                   │
      ┌────────────┴─────────────┐
      │                          │
      ▼                          ▼
  ┌──────────────┐  ┌────────────────────┐
  │ Booking Srv  │  │ Notification Srv   │
  │ - Confirm    │  │ - Notif confirmed  │
  │ - Update DB  │  └────────────────────┘
  └──────────────┘
```

---

## 🔧 Configuration Kafka dans le code

### Producer (Booking Service)

```javascript
const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'booking-service',
  brokers: ['localhost:9092'],
});

const producer = kafka.producer();

async function publishBookingCreated(booking) {
  await producer.send({
    topic: 'booking-created',
    messages: [
      {
        key: booking.userId,
        value: JSON.stringify({
          bookingId: booking.id,
          userId: booking.userId,
          slotId: booking.slotId,
          serviceId: booking.serviceId,
          status: 'pending',
          amount: booking.amount,
          currency: 'USD',
          timestamp: Date.now(),
        }),
      },
    ],
  });
}
```

### Consumer (Payment Service)

```javascript
const consumer = kafka.consumer({ 
  groupId: 'payment-service-group' 
});

async function startBookingCreatedConsumer() {
  await consumer.subscribe({ topic: 'booking-created' });
  
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const event = JSON.parse(message.value.toString());
      
      // Créer une invoice
      const invoice = await createInvoice({
        bookingId: event.bookingId,
        userId: event.userId,
        amount: event.amount,
        currency: event.currency,
      });
      
      // Publier event
      await publishInvoiceGenerated(invoice);
    },
  });
}
```

---

## 📈 Statistiques des Topics

| Topic | Partitions | Replication Factor | Rétention | Volume estimé |
|-------|-----------|-------------------|-----------|---------------|
| booking-created | 1 | 1 | 7 jours | Élevé |
| payment-completed | 1 | 1 | 7 jours | Moyen |
| payment-failed | 1 | 1 | 7 jours | Bas |
| booking-cancelled | 1 | 1 | 7 jours | Bas |
| refund-completed | 1 | 1 | 7 jours | Très bas |
| slot-available | 1 | 1 | 7 jours | Moyen |
| user-registered | 1 | 1 | 30 jours | Très bas |
| user-updated | 1 | 1 | 7 jours | Très bas |

---

## 🔄 Flux d'événements: Scénarios complets

### Scénario 1: Réservation et paiement réussi

```
1. Client réserve un créneau
2. Booking Service crée la réservation
3. Booking Service publie: booking-created
4. Payment Service reçoit et crée une invoice
5. Payment Service publie: invoice-generated
6. Notification Service reçoit et crée une notification
7. Client paie
8. Payment Service traite le paiement
9. Payment Service publie: payment-completed
10. Booking Service reçoit et confirme la réservation
11. Booking Service met à jour le créneau (booked++)
12. Notification Service reçoit et envoie confirmation de paiement
```

### Scénario 2: Paiement échoué

```
1. Client paie
2. Paiement refusé
3. Payment Service publie: payment-failed
4. Booking Service reçoit et annule la réservation
5. Booking Service met à jour le créneau (booked--)
6. Booking Service publie: booking-cancelled
7. Notification Service reçoit et notifie l'utilisateur de l'erreur
8. Payment Service publie: refund-completed (si remboursement)
9. Notification Service reçoit et notifie du remboursement
```

### Scénario 3: Annulation de réservation

```
1. Client annule sa réservation
2. Booking Service annule la réservation
3. Booking Service met à jour le créneau (booked--)
4. Booking Service publie: booking-cancelled
5. Payment Service reçoit et traite le remboursement
6. Payment Service publie: refund-completed
7. Notification Service reçoit et notifie l'annulation et le remboursement
```

---

## 🧪 Tester les Topics Kafka

### Avec kafka-console-producer

```bash
# Produire un message
docker-compose exec kafka kafka-console-producer \
  --broker-list kafka:9092 \
  --topic booking-created

# Entrer le message JSON
{"bookingId":"booking-789","userId":"user-123","slotId":"slot-456","timestamp":1715779200000}
```

### Avec kafka-console-consumer

```bash
# Consommer les messages (depuis le début)
docker-compose exec kafka kafka-console-consumer \
  --bootstrap-server kafka:9092 \
  --topic booking-created \
  --from-beginning
```

### Lister les topics

```bash
docker-compose exec kafka kafka-topics \
  --bootstrap-server kafka:9092 \
  --list
```

---

## 📝 Monitoring et Debugging

### Vérifier les consumer groups

```bash
docker-compose exec kafka kafka-consumer-groups \
  --bootstrap-server kafka:9092 \
  --list

# Détails d'un groupe
docker-compose exec kafka kafka-consumer-groups \
  --bootstrap-server kafka:9092 \
  --group booking-service-group \
  --describe
```

### Logs des services

```bash
# Booking Service logs
docker-compose logs -f booking-service

# Payment Service logs
docker-compose logs -f payment-service

# Notification Service logs
docker-compose logs -f notification-service
```

---

## 🎯 Best Practices Kafka appliquées

1. **Clé de partition:** Utilisée pour garantir l'ordre des messages par utilisateur
2. **Consumer Groups:** Chaque service a son propre groupe pour éviter les doublons
3. **Idempotence:** Les consommateurs gèrent les messages en double
4. **Rétention:** Configurée selon les besoins métier (7 jours par défaut)
5. **Partitions:** Scalabilité future avec plusieurs partitions possible
6. **Schéma:** JSON structuré pour faciliter la désérialisation

---

**Kafka Configuration Version:** 1.0  
**Confluent Kafka:** 7.5.0  
**Dernière mise à jour:** Mai 2026
