# Documentation API REST - Plateforme de Réservation Intelligente

## Base URL
```
http://localhost:3000
```

## Format des réponses

### Succès (2xx)
```json
{
  "success": true,
  "data": { ... },
  "message": "Opération réussie"
}
```

### Erreur (4xx/5xx)
```json
{
  "error": "Description de l'erreur",
  "code": "ERROR_CODE",
  "status": 400
}
```

---

## Authentification

### Headers requis
```
Authorization: Bearer {JWT_TOKEN}
Content-Type: application/json
```

---

## 🔐 Auth Endpoints

### 1. Enregistrement
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "name": "John Doe",
  "role": "client"
}
```

**Réponse (201):**
```json
{
  "success": true,
  "userId": "user-123",
  "message": "User registered successfully"
}
```

**Erreurs:**
- `400` - Email, password ou name manquants
- `409` - Email déjà utilisé

---

### 2. Connexion
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

**Réponse (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": "user-123",
  "role": "client"
}
```

**Erreurs:**
- `400` - Email ou password manquants
- `401` - Identifiants invalides

---

### 3. Récupérer le profil
```http
GET /api/users/{userId}
Authorization: Bearer {token}
```

**Réponse (200):**
```json
{
  "id": "user-123",
  "email": "user@example.com",
  "name": "John Doe",
  "role": "client",
  "createdAt": 1715779200000
}
```

**Erreurs:**
- `401` - Non authentifié
- `404` - Utilisateur non trouvé

---

### 4. Mettre à jour le profil
```http
PUT /api/users/{userId}
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "John Smith",
  "email": "newemail@example.com"
}
```

**Réponse (200):**
```json
{
  "success": true,
  "user": {
    "id": "user-123",
    "email": "newemail@example.com",
    "name": "John Smith",
    "role": "client",
    "updatedAt": 1715785800000
  }
}
```

---

## 📅 Slots Endpoints

### 1. Créer un créneau
```http
POST /api/slots
Authorization: Bearer {token}
Content-Type: application/json

{
  "serviceId": "service-1",
  "startTime": 1715779200000,
  "endTime": 1715782800000,
  "capacity": 5,
  "price": 50.00
}
```

**Réponse (201):**
```json
{
  "success": true,
  "slotId": "slot-456",
  "message": "Slot created successfully"
}
```

**Erreurs:**
- `400` - Données invalides
- `401` - Non authentifié (doit avoir le rôle "staff")

---

### 2. Lister les créneaux disponibles
```http
GET /api/slots?serviceId=service-1&available=true
Authorization: Bearer {token}
```

**Paramètres query:**
- `serviceId` (requis): ID du service
- `available` (optionnel): `true/false` pour filtrer les créneaux disponibles
- `startDate` (optionnel): Date min (timestamp ms)
- `endDate` (optionnel): Date max (timestamp ms)

**Réponse (200):**
```json
{
  "slots": [
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
  "total": 1
}
```

---

### 3. Récupérer un créneau
```http
GET /api/slots/{slotId}
Authorization: Bearer {token}
```

**Réponse (200):**
```json
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
```

---

## 🎫 Bookings Endpoints

### 1. Créer une réservation
```http
POST /api/bookings
Authorization: Bearer {token}
Content-Type: application/json

{
  "slotId": "slot-456"
}
```

**Réponse (201):**
```json
{
  "success": true,
  "bookingId": "booking-789",
  "status": "pending",
  "message": "Booking created successfully"
}
```

**Erreurs:**
- `400` - SlotId manquant
- `401` - Non authentifié
- `409` - Créneau complet ou déjà réservé par ce client

---

### 2. Lister les réservations
```http
GET /api/bookings?status=confirmed&limit=10&offset=0
Authorization: Bearer {token}
```

**Paramètres query:**
- `status` (optionnel): `pending`, `confirmed`, `cancelled`
- `limit` (optionnel): Nombre de résultats (défaut: 10, max: 100)
- `offset` (optionnel): Décalage pour pagination (défaut: 0)

**Réponse (200):**
```json
{
  "bookings": [
    {
      "id": "booking-789",
      "userId": "user-123",
      "slotId": "slot-456",
      "status": "confirmed",
      "createdAt": 1715779200000,
      "slot": {
        "id": "slot-456",
        "startTime": 1715779200000,
        "endTime": 1715782800000,
        "price": 50.00
      }
    }
  ],
  "total": 1,
  "page": 0,
  "limit": 10
}
```

---

### 3. Récupérer une réservation
```http
GET /api/bookings/{bookingId}
Authorization: Bearer {token}
```

**Réponse (200):**
```json
{
  "id": "booking-789",
  "userId": "user-123",
  "slotId": "slot-456",
  "status": "confirmed",
  "createdAt": 1715779200000,
  "slot": {
    "id": "slot-456",
    "serviceId": "service-1",
    "startTime": 1715779200000,
    "endTime": 1715782800000,
    "capacity": 5,
    "booked": 3,
    "price": 50.00
  },
  "payment": {
    "id": "payment-101",
    "status": "completed",
    "amount": 50.00
  }
}
```

---

### 4. Annuler une réservation
```http
DELETE /api/bookings/{bookingId}
Authorization: Bearer {token}
```

**Réponse (200):**
```json
{
  "success": true,
  "bookingId": "booking-789",
  "status": "cancelled",
  "message": "Booking cancelled successfully"
}
```

**Erreurs:**
- `401` - Non authentifié
- `403` - Vous ne pouvez pas annuler cette réservation
- `404` - Réservation non trouvée
- `409` - Réservation déjà annulée

---

## 💳 Payments Endpoints

### 1. Traiter un paiement
```http
POST /api/payments
Authorization: Bearer {token}
Content-Type: application/json

{
  "bookingId": "booking-789",
  "amount": 50.00,
  "paymentMethod": "credit_card",
  "token": "tok_visa_123"
}
```

**Paramètres:**
- `bookingId` (requis): ID de la réservation
- `amount` (requis): Montant du paiement
- `paymentMethod` (requis): `credit_card`, `debit_card`, `paypal`
- `token` (requis): Token du système de paiement

**Réponse (200):**
```json
{
  "success": true,
  "paymentId": "payment-101",
  "status": "completed",
  "amount": 50.00,
  "currency": "USD",
  "message": "Payment processed successfully"
}
```

**Erreurs:**
- `400` - Données invalides
- `401` - Non authentifié
- `402` - Paiement refusé
- `404` - Réservation non trouvée

---

### 2. Récupérer le statut d'un paiement
```http
GET /api/payments/{paymentId}
Authorization: Bearer {token}
```

**Réponse (200):**
```json
{
  "id": "payment-101",
  "bookingId": "booking-789",
  "userId": "user-123",
  "amount": 50.00,
  "currency": "USD",
  "status": "completed",
  "paymentMethod": "credit_card",
  "createdAt": 1715779200000,
  "updatedAt": 1715779210000
}
```

---

### 3. Remboursement (Refund)
```http
POST /api/payments/{paymentId}/refund
Authorization: Bearer {token}
Content-Type: application/json

{
  "reason": "Customer request"
}
```

**Réponse (200):**
```json
{
  "success": true,
  "paymentId": "payment-101",
  "status": "refunded",
  "refundAmount": 50.00,
  "message": "Refund processed successfully"
}
```

---

### 4. Récupérer une facture
```http
GET /api/invoices/{invoiceId}
Authorization: Bearer {token}
```

**Réponse (200):**
```json
{
  "id": "invoice-202",
  "invoiceNumber": "INV-2026-001",
  "paymentId": "payment-101",
  "totalAmount": 50.00,
  "currency": "USD",
  "createdAt": 1715779200000
}
```

---

## 🔔 Notifications Endpoints

### 1. Récupérer les notifications
```http
GET /api/notifications?limit=10&unreadOnly=false
Authorization: Bearer {token}
```

**Paramètres query:**
- `limit` (optionnel): Nombre de notifications (défaut: 10)
- `unreadOnly` (optionnel): `true` pour uniquement les non-lues

**Réponse (200):**
```json
{
  "notifications": [
    {
      "id": "notif-303",
      "userId": "user-123",
      "type": "booking_confirmation",
      "title": "Réservation confirmée",
      "message": "Votre réservation a été confirmée",
      "read": false,
      "createdAt": 1715779200000
    },
    {
      "id": "notif-304",
      "userId": "user-123",
      "type": "payment_success",
      "title": "Paiement réussi",
      "message": "Votre paiement a été traité",
      "read": true,
      "createdAt": 1715779210000
    }
  ],
  "total": 2,
  "unreadCount": 1
}
```

---

### 2. Marquer une notification comme lue
```http
PUT /api/notifications/{notificationId}/read
Authorization: Bearer {token}
```

**Réponse (200):**
```json
{
  "success": true,
  "notificationId": "notif-303",
  "read": true,
  "message": "Notification marked as read"
}
```

---

### 3. Marquer toutes les notifications comme lues
```http
PUT /api/notifications/mark-all-read
Authorization: Bearer {token}
```

**Réponse (200):**
```json
{
  "success": true,
  "marked": 5,
  "message": "All notifications marked as read"
}
```

---

## ❤️ Health Check

### Vérifier la santé du service
```http
GET /health
```

**Réponse (200):**
```json
{
  "status": "ok",
  "service": "api-gateway",
  "timestamp": 1715779200000,
  "uptime": 3600000
}
```

---

## 🔄 Codes d'erreur

| Code | Signification |
|------|---------------|
| `400` | Bad Request - Requête invalide |
| `401` | Unauthorized - Non authentifié |
| `403` | Forbidden - Accès refusé |
| `404` | Not Found - Ressource non trouvée |
| `409` | Conflict - Conflit de données |
| `500` | Internal Server Error - Erreur serveur |

---

## 📋 Exemples d'utilisation complets

### Flux complet: Réserver et payer

```bash
# 1. Enregistrement
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123",
    "name": "John Doe"
  }'

# 2. Connexion
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
# Récupérer le token: eyJhbGc...

# 3. Lister les créneaux disponibles
curl -X GET "http://localhost:3000/api/slots?serviceId=service-1&available=true" \
  -H "Authorization: Bearer eyJhbGc..."

# 4. Créer une réservation
curl -X POST http://localhost:3000/api/bookings \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json" \
  -d '{
    "slotId": "slot-456"
  }'
# Récupérer bookingId: booking-789

# 5. Traiter le paiement
curl -X POST http://localhost:3000/api/payments \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json" \
  -d '{
    "bookingId": "booking-789",
    "amount": 50.00,
    "paymentMethod": "credit_card",
    "token": "tok_visa_123"
  }'

# 6. Récupérer les notifications
curl -X GET "http://localhost:3000/api/notifications?unreadOnly=true" \
  -H "Authorization: Bearer eyJhbGc..."
```

---

**API Version:** 1.0.0  
**Dernière mise à jour:** Mai 2026
