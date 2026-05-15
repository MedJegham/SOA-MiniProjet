# Documentation GraphQL - Plateforme de Réservation Intelligente

## Accès à GraphQL

**URL:** `http://localhost:3000/graphql`

**GraphQL IDE:** Apollo Sandbox (interface interactive)

---

## 📋 Schéma complet

### Types

```graphql
"""Utilisateur de la plateforme"""
type User {
  id: ID!
  email: String!
  name: String!
  role: UserRole!
  createdAt: Int!
  updatedAt: Int
}

"""Rôle de l'utilisateur"""
enum UserRole {
  CLIENT
  STAFF
  ADMIN
}

"""Créneau disponible"""
type Slot {
  id: ID!
  serviceId: String!
  startTime: Int!        # Unix timestamp en ms
  endTime: Int!          # Unix timestamp en ms
  capacity: Int!
  booked: Int!
  available: Int!
  price: Float!
  createdAt: Int!
}

"""Réservation d'un client"""
type Booking {
  id: ID!
  userId: ID!
  user: User!
  slotId: ID!
  slot: Slot!
  status: BookingStatus!
  createdAt: Int!
}

"""Statut d'une réservation"""
enum BookingStatus {
  PENDING
  CONFIRMED
  CANCELLED
}

"""Paiement pour une réservation"""
type Payment {
  id: ID!
  bookingId: ID!
  booking: Booking!
  userId: ID!
  user: User!
  amount: Float!
  currency: String!
  status: PaymentStatus!
  paymentMethod: String!
  createdAt: Int!
  updatedAt: Int
}

"""Statut du paiement"""
enum PaymentStatus {
  PENDING
  COMPLETED
  FAILED
  REFUNDED
}

"""Facture/Invoice"""
type Invoice {
  id: ID!
  paymentId: ID!
  payment: Payment!
  invoiceNumber: String!
  totalAmount: Float!
  createdAt: Int!
}

"""Notification utilisateur"""
type Notification {
  id: ID!
  userId: ID!
  type: NotificationType!
  title: String!
  message: String!
  read: Boolean!
  createdAt: Int!
}

"""Type de notification"""
enum NotificationType {
  BOOKING_CONFIRMATION
  BOOKING_CANCELLED
  PAYMENT_SUCCESS
  PAYMENT_FAILED
  REMINDER
}

"""Résultat d'authentification"""
type AuthResult {
  token: String!
  user: User!
}

"""Résultat d'une opération"""
type OperationResult {
  success: Boolean!
  message: String!
}

"""Résultat de création de réservation"""
type BookingResult {
  success: Boolean!
  booking: Booking
  message: String!
}

"""Résultat de paiement"""
type PaymentResult {
  success: Boolean!
  payment: Payment
  message: String!
}

"""Résultat de créneau"""
type SlotResult {
  success: Boolean!
  slot: Slot
  message: String!
}

"""Liste paginée"""
type PaginatedBookings {
  items: [Booking!]!
  total: Int!
  page: Int!
  limit: Int!
}

type PaginatedNotifications {
  items: [Notification!]!
  total: Int!
  unreadCount: Int!
}
```

---

## 🔍 Queries

### Profil utilisateur

```graphql
query {
  """Récupérer le profil de l'utilisateur connecté"""
  me {
    id
    email
    name
    role
    createdAt
  }
  
  """Récupérer un utilisateur par ID"""
  user(id: "user-123") {
    id
    email
    name
    role
  }
}
```

**Réponse:**
```json
{
  "data": {
    "me": {
      "id": "user-123",
      "email": "user@example.com",
      "name": "John Doe",
      "role": "CLIENT",
      "createdAt": 1715779200000
    },
    "user": {
      "id": "user-123",
      "email": "user@example.com",
      "name": "John Doe",
      "role": "CLIENT"
    }
  }
}
```

---

### Créneaux

```graphql
query {
  """Récupérer les créneaux disponibles"""
  availableSlots(serviceId: "service-1") {
    id
    serviceId
    startTime
    endTime
    capacity
    booked
    available
    price
    createdAt
  }
  
  """Récupérer un créneau spécifique"""
  slot(id: "slot-456") {
    id
    serviceId
    startTime
    endTime
    capacity
    booked
    available
    price
  }
}
```

**Réponse:**
```json
{
  "data": {
    "availableSlots": [
      {
        "id": "slot-456",
        "serviceId": "service-1",
        "startTime": 1715779200000,
        "endTime": 1715782800000,
        "capacity": 5,
        "booked": 2,
        "available": 3,
        "price": 50.00,
        "createdAt": 1715770800000
      }
    ],
    "slot": {
      "id": "slot-456",
      "serviceId": "service-1",
      "startTime": 1715779200000,
      "endTime": 1715782800000,
      "capacity": 5,
      "booked": 2,
      "available": 3,
      "price": 50.00
    }
  }
}
```

---

### Réservations

```graphql
query {
  """Récupérer toutes les réservations de l'utilisateur"""
  myBookings {
    id
    status
    createdAt
    slot {
      id
      startTime
      endTime
      price
    }
    payment {
      status
      amount
    }
  }
  
  """Récupérer une réservation spécifique"""
  booking(id: "booking-789") {
    id
    userId
    user {
      name
      email
    }
    slotId
    slot {
      serviceId
      startTime
      endTime
      capacity
      booked
      price
    }
    status
    createdAt
  }
}
```

**Réponse:**
```json
{
  "data": {
    "myBookings": [
      {
        "id": "booking-789",
        "status": "CONFIRMED",
        "createdAt": 1715779200000,
        "slot": {
          "id": "slot-456",
          "startTime": 1715779200000,
          "endTime": 1715782800000,
          "price": 50.00
        },
        "payment": {
          "status": "COMPLETED",
          "amount": 50.00
        }
      }
    ],
    "booking": {
      "id": "booking-789",
      "userId": "user-123",
      "user": {
        "name": "John Doe",
        "email": "user@example.com"
      },
      "slotId": "slot-456",
      "slot": {
        "serviceId": "service-1",
        "startTime": 1715779200000,
        "endTime": 1715782800000,
        "capacity": 5,
        "booked": 3,
        "price": 50.00
      },
      "status": "CONFIRMED",
      "createdAt": 1715779200000
    }
  }
}
```

---

### Paiements

```graphql
query {
  """Récupérer un paiement"""
  payment(id: "payment-101") {
    id
    bookingId
    booking {
      id
      status
    }
    userId
    amount
    currency
    status
    paymentMethod
    createdAt
  }
}
```

---

### Notifications

```graphql
query {
  """Récupérer les notifications"""
  notifications(limit: 10, unreadOnly: false) {
    items {
      id
      type
      title
      message
      read
      createdAt
    }
    total
    unreadCount
  }
}
```

**Réponse:**
```json
{
  "data": {
    "notifications": {
      "items": [
        {
          "id": "notif-303",
          "type": "BOOKING_CONFIRMATION",
          "title": "Réservation confirmée",
          "message": "Votre réservation a été confirmée",
          "read": false,
          "createdAt": 1715779200000
        }
      ],
      "total": 5,
      "unreadCount": 2
    }
  }
}
```

---

## ✏️ Mutations

### Authentification

```graphql
mutation {
  """Enregistrer un nouvel utilisateur"""
  register(
    email: "user@example.com"
    password: "password123"
    name: "John Doe"
  ) {
    token
    user {
      id
      email
      name
      role
    }
  }
  
  """Connexion utilisateur"""
  login(email: "user@example.com", password: "password123") {
    token
    user {
      id
      email
      name
      role
    }
  }
  
  """Mettre à jour le profil"""
  updateProfile(name: "John Smith", email: "newemail@example.com") {
    id
    name
    email
    updatedAt
  }
}
```

**Réponse:**
```json
{
  "data": {
    "register": {
      "token": "eyJhbGc...",
      "user": {
        "id": "user-123",
        "email": "user@example.com",
        "name": "John Doe",
        "role": "CLIENT"
      }
    },
    "login": {
      "token": "eyJhbGc...",
      "user": {
        "id": "user-123",
        "email": "user@example.com",
        "name": "John Doe",
        "role": "CLIENT"
      }
    },
    "updateProfile": {
      "id": "user-123",
      "name": "John Smith",
      "email": "newemail@example.com",
      "updatedAt": 1715785800000
    }
  }
}
```

---

### Créneaux (Staff only)

```graphql
mutation {
  """Créer un nouveau créneau"""
  createSlot(
    serviceId: "service-1"
    startTime: 1715779200000
    endTime: 1715782800000
    capacity: 5
    price: 50.00
  ) {
    success
    slot {
      id
      startTime
      endTime
      capacity
      price
    }
    message
  }
}
```

---

### Réservations

```graphql
mutation {
  """Créer une réservation"""
  createBooking(slotId: "slot-456") {
    success
    booking {
      id
      status
      slot {
        startTime
        endTime
        price
      }
    }
    message
  }
  
  """Annuler une réservation"""
  cancelBooking(bookingId: "booking-789") {
    success
    booking {
      id
      status
    }
    message
  }
}
```

**Réponse:**
```json
{
  "data": {
    "createBooking": {
      "success": true,
      "booking": {
        "id": "booking-789",
        "status": "PENDING",
        "slot": {
          "startTime": 1715779200000,
          "endTime": 1715782800000,
          "price": 50.00
        }
      },
      "message": "Booking created successfully"
    }
  }
}
```

---

### Paiements

```graphql
mutation {
  """Traiter un paiement"""
  processPayment(
    bookingId: "booking-789"
    amount: 50.00
    paymentMethod: "credit_card"
    token: "tok_visa_123"
  ) {
    success
    payment {
      id
      status
      amount
      currency
    }
    message
  }
}
```

---

### Notifications

```graphql
mutation {
  """Marquer une notification comme lue"""
  markNotificationAsRead(notificationId: "notif-303") {
    success
    message
  }
}
```

---

## 🔔 Subscriptions (Websockets)

```graphql
"""S'abonner aux mises à jour de réservations"""
subscription {
  bookingUpdated(userId: "user-123") {
    id
    status
    createdAt
  }
}

"""S'abonner aux notifications de paiement"""
subscription {
  paymentUpdated(bookingId: "booking-789") {
    id
    status
    amount
  }
}

"""S'abonner aux notifications reçues"""
subscription {
  notificationReceived(userId: "user-123") {
    id
    type
    title
    message
  }
}
```

---

## 🔐 Authentification GraphQL

### Headers

```
Authorization: Bearer {JWT_TOKEN}
Content-Type: application/json
```

### Variable: Utiliser des variables GraphQL

```graphql
query GetBooking($bookingId: ID!) {
  booking(id: $bookingId) {
    id
    status
    slot {
      price
    }
  }
}
```

**Variables JSON:**
```json
{
  "bookingId": "booking-789"
}
```

---

## 💡 Exemples d'utilisation

### 1. Flux complet avec GraphQL

**Étape 1: Enregistrement et connexion**
```graphql
mutation {
  register(
    email: "user@example.com"
    password: "password123"
    name: "John Doe"
  ) {
    token
    user {
      id
      name
    }
  }
}
```

**Étape 2: Récupérer les créneaux**
```graphql
query {
  availableSlots(serviceId: "service-1") {
    id
    startTime
    endTime
    available
    price
  }
}
```

**Étape 3: Créer une réservation**
```graphql
mutation {
  createBooking(slotId: "slot-456") {
    success
    booking {
      id
      status
    }
  }
}
```

**Étape 4: Traiter le paiement**
```graphql
mutation {
  processPayment(
    bookingId: "booking-789"
    amount: 50.00
    paymentMethod: "credit_card"
    token: "tok_visa_123"
  ) {
    success
    payment {
      status
    }
  }
}
```

**Étape 5: Récupérer les notifications**
```graphql
query {
  notifications(limit: 5) {
    items {
      id
      type
      title
      message
    }
    unreadCount
  }
}
```

---

### 2. Requête complexe avec fragments

```graphql
fragment UserDetails on User {
  id
  email
  name
  role
  createdAt
}

fragment SlotDetails on Slot {
  id
  serviceId
  startTime
  endTime
  capacity
  booked
  price
}

fragment BookingDetails on Booking {
  id
  status
  createdAt
  user {
    ...UserDetails
  }
  slot {
    ...SlotDetails
  }
}

query {
  myBookings {
    ...BookingDetails
  }
}
```

---

### 3. Gestion des erreurs

```graphql
mutation {
  createBooking(slotId: "invalid-slot") {
    success
    booking {
      id
    }
    message
  }
}
```

**Réponse d'erreur:**
```json
{
  "errors": [
    {
      "message": "Slot not found",
      "extensions": {
        "code": "SLOT_NOT_FOUND",
        "status": 404
      }
    }
  ]
}
```

---

## 🧪 Test avec cURL

```bash
curl -X POST http://localhost:3000/graphql \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { me { id email name } }"
  }'
```

---

## 📊 Introspection GraphQL

Récupérer le schéma complet:

```graphql
query {
  __schema {
    types {
      name
      kind
      fields {
        name
        type {
          name
        }
      }
    }
  }
}
```

---

**GraphQL Version:** 1.0.0  
**Apollo Server:** 3.13.0  
**Dernière mise à jour:** Mai 2026
