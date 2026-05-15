# Documentation Bases de Données - Plateforme de Réservation Intelligente

## Vue d'ensemble

Chaque microservice possède sa propre base de données SQLite indépendante, suivant le principe **"Database per Service"**. Cela garantit l'autonomie des services et évite le couplage des données.

---

## 🗄️ Bases de données

### 1. Auth Service Database (`auth.db`)

**Localisation:** `./data/auth.db`  
**Microservice:** Auth Service (Port 50051)  
**Type:** SQLite3  
**Responsabilité:** Gestion des utilisateurs et authentification

#### Schema

```sql
-- Table des utilisateurs
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

#### Colonnes détaillées

| Colonne | Type | Description | Exemple |
|---------|------|-------------|---------|
| `id` | TEXT | ID unique (UUID) | `user-123` |
| `email` | TEXT UNIQUE | Email de l'utilisateur | `user@example.com` |
| `passwordHash` | TEXT | Hash bcrypt du mot de passe | `$2b$10$...` |
| `name` | TEXT | Nom complet | `John Doe` |
| `role` | TEXT | Rôle (client, staff, admin) | `client` |
| `createdAt` | INTEGER | Timestamp création (ms) | `1715779200000` |
| `updatedAt` | INTEGER | Timestamp mise à jour (ms) | `1715785800000` |

#### Données d'exemple

```sql
INSERT INTO users VALUES 
(
  'user-123',
  'john@example.com',
  '$2b$10$abcdefghijklmnopqrstuvwxyz123456789',
  'John Doe',
  'client',
  1715779200000,
  1715779200000
);
```

#### Requêtes courantes

```sql
-- Récupérer un utilisateur par email
SELECT * FROM users WHERE email = 'john@example.com';

-- Vérifier si un email existe
SELECT COUNT(*) FROM users WHERE email = 'john@example.com';

-- Mettre à jour le profil
UPDATE users SET name = 'Jane Doe', updatedAt = 1715785800000 
WHERE id = 'user-123';

-- Lister tous les utilisateurs avec le rôle client
SELECT * FROM users WHERE role = 'client';
```

---

### 2. Booking Service Database (`booking.db`)

**Localisation:** `./data/booking.db`  
**Microservice:** Booking Service (Port 50052)  
**Type:** SQLite3  
**Responsabilité:** Gestion des créneaux et réservations

#### Schema

```sql
-- Table des créneaux disponibles
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

CREATE INDEX idx_slots_serviceId ON slots(serviceId);
CREATE INDEX idx_slots_startTime ON slots(startTime);

-- Table des réservations
CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  slotId TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  createdAt INTEGER NOT NULL
);

CREATE INDEX idx_bookings_userId ON bookings(userId);
CREATE INDEX idx_bookings_slotId ON bookings(slotId);
CREATE INDEX idx_bookings_status ON bookings(status);
```

#### Colonnes détaillées - Slots

| Colonne | Type | Description | Exemple |
|---------|------|-------------|---------|
| `id` | TEXT | ID unique du créneau | `slot-456` |
| `serviceId` | TEXT | Service associé | `service-1` |
| `startTime` | INTEGER | Début du créneau (ms) | `1715779200000` |
| `endTime` | INTEGER | Fin du créneau (ms) | `1715782800000` |
| `capacity` | INTEGER | Nombre max de réservations | `5` |
| `booked` | INTEGER | Nombre actuellement réservé | `2` |
| `price` | REAL | Prix du créneau | `50.00` |
| `createdAt` | INTEGER | Timestamp création | `1715770800000` |

#### Colonnes détaillées - Bookings

| Colonne | Type | Description | Exemple |
|---------|------|-------------|---------|
| `id` | TEXT | ID unique de la réservation | `booking-789` |
| `userId` | TEXT | Utilisateur qui a réservé | `user-123` |
| `slotId` | TEXT | Créneau réservé | `slot-456` |
| `status` | TEXT | État (pending, confirmed, cancelled) | `confirmed` |
| `createdAt` | INTEGER | Timestamp création | `1715779200000` |

#### Données d'exemple

```sql
-- Créneaux
INSERT INTO slots VALUES 
('slot-456', 'service-1', 1715779200000, 1715782800000, 5, 2, 50.00, 1715770800000);

-- Réservations
INSERT INTO bookings VALUES 
('booking-789', 'user-123', 'slot-456', 'confirmed', 1715779200000);
```

#### Requêtes courantes

```sql
-- Récupérer les créneaux disponibles
SELECT * FROM slots 
WHERE serviceId = 'service-1' 
  AND startTime > 1715779200000 
  AND booked < capacity;

-- Compter les disponibilités d'un créneau
SELECT capacity - booked as available FROM slots WHERE id = 'slot-456';

-- Lister les réservations d'un utilisateur
SELECT b.id, b.status, s.startTime, s.endTime, s.price 
FROM bookings b 
JOIN slots s ON b.slotId = s.id 
WHERE b.userId = 'user-123';

-- Incrémenter le compteur booked
UPDATE slots SET booked = booked + 1 WHERE id = 'slot-456';

-- Mettre à jour le statut d'une réservation
UPDATE bookings SET status = 'confirmed' WHERE id = 'booking-789';
```

---

### 3. Payment Service Database (`payment.db`)

**Localisation:** `./data/payment.db`  
**Microservice:** Payment Service (Port 50053)  
**Type:** SQLite3  
**Responsabilité:** Gestion des paiements et factures

#### Schema

```sql
-- Table des paiements
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

CREATE INDEX idx_payments_bookingId ON payments(bookingId);
CREATE INDEX idx_payments_userId ON payments(userId);
CREATE INDEX idx_payments_status ON payments(status);

-- Table des factures/invoices
CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  paymentId TEXT NOT NULL,
  invoiceNumber TEXT UNIQUE,
  totalAmount REAL,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY (paymentId) REFERENCES payments(id)
);

CREATE INDEX idx_invoices_paymentId ON invoices(paymentId);
```

#### Colonnes détaillées - Payments

| Colonne | Type | Description | Exemple |
|---------|------|-------------|---------|
| `id` | TEXT | ID unique du paiement | `payment-101` |
| `bookingId` | TEXT | Réservation associée | `booking-789` |
| `userId` | TEXT | Utilisateur payeur | `user-123` |
| `amount` | REAL | Montant du paiement | `50.00` |
| `currency` | TEXT | Devise | `USD` |
| `status` | TEXT | État (pending, completed, failed, refunded) | `completed` |
| `paymentMethod` | TEXT | Méthode (credit_card, debit_card, paypal) | `credit_card` |
| `createdAt` | INTEGER | Timestamp création | `1715779200000` |
| `updatedAt` | INTEGER | Timestamp mise à jour | `1715779210000` |

#### Colonnes détaillées - Invoices

| Colonne | Type | Description | Exemple |
|---------|------|-------------|---------|
| `id` | TEXT | ID unique de la facture | `invoice-202` |
| `paymentId` | TEXT | Paiement associé | `payment-101` |
| `invoiceNumber` | TEXT UNIQUE | Numéro de facture | `INV-2026-001` |
| `totalAmount` | REAL | Montant total | `50.00` |
| `createdAt` | INTEGER | Timestamp création | `1715779200000` |

#### Données d'exemple

```sql
-- Paiements
INSERT INTO payments VALUES 
('payment-101', 'booking-789', 'user-123', 50.00, 'USD', 'completed', 'credit_card', 1715779200000, 1715779210000);

-- Factures
INSERT INTO invoices VALUES 
('invoice-202', 'payment-101', 'INV-2026-001', 50.00, 1715779200000);
```

#### Requêtes courantes

```sql
-- Récupérer tous les paiements d'un utilisateur
SELECT * FROM payments WHERE userId = 'user-123' ORDER BY createdAt DESC;

-- Paiements en attente
SELECT * FROM payments WHERE status = 'pending' AND createdAt < 1715800000000;

-- Chiffre d'affaires total
SELECT SUM(amount) as total FROM payments WHERE status = 'completed';

-- Facture d'un paiement
SELECT i.*, p.amount FROM invoices i 
JOIN payments p ON i.paymentId = p.id 
WHERE p.id = 'payment-101';

-- Mettre à jour le statut d'un paiement
UPDATE payments SET status = 'completed', updatedAt = 1715779210000 
WHERE id = 'payment-101';
```

---

### 4. Notification Service Database (`notif.db`)

**Localisation:** `./data/notif.db`  
**Microservice:** Notification Service (Port 50054)  
**Type:** SQLite3  
**Responsabilité:** Gestion des notifications utilisateur

#### Schema

```sql
-- Table des notifications
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
CREATE INDEX idx_notifications_read ON notifications(read);
```

#### Colonnes détaillées

| Colonne | Type | Description | Exemple |
|---------|------|-------------|---------|
| `id` | TEXT | ID unique | `notif-303` |
| `userId` | TEXT | Utilisateur destinataire | `user-123` |
| `type` | TEXT | Type (booking_confirmation, payment_success, etc) | `booking_confirmation` |
| `title` | TEXT | Titre de la notification | `Réservation confirmée` |
| `message` | TEXT | Contenu du message | `Votre réservation...` |
| `read` | BOOLEAN | Lue ou non (0/1) | `0` |
| `createdAt` | INTEGER | Timestamp création | `1715779200000` |

#### Types de notifications

```
- booking_confirmation: Confirmation de réservation
- booking_cancelled: Annulation de réservation
- payment_success: Paiement réussi
- payment_failed: Paiement échoué
- refund_completed: Remboursement effectué
- reminder: Rappel avant la réservation
- welcome: Bienvenue nouvel utilisateur
```

#### Données d'exemple

```sql
INSERT INTO notifications VALUES 
(
  'notif-303',
  'user-123',
  'booking_confirmation',
  'Réservation confirmée',
  'Votre réservation pour le slot-456 a été confirmée',
  0,
  1715779200000
);
```

#### Requêtes courantes

```sql
-- Récupérer les notifications non lues d'un utilisateur
SELECT * FROM notifications 
WHERE userId = 'user-123' AND read = 0 
ORDER BY createdAt DESC;

-- Compter les notifications non lues
SELECT COUNT(*) as unread_count FROM notifications 
WHERE userId = 'user-123' AND read = 0;

-- Marquer comme lue
UPDATE notifications SET read = 1 WHERE id = 'notif-303';

-- Marquer toutes les notifications d'un utilisateur comme lues
UPDATE notifications SET read = 1 WHERE userId = 'user-123';

-- Récupérer les 10 dernières notifications
SELECT * FROM notifications 
WHERE userId = 'user-123' 
ORDER BY createdAt DESC 
LIMIT 10;

-- Supprimer les notifications anciennes (> 30 jours)
DELETE FROM notifications 
WHERE createdAt < 1715189200000;
```

---

## 📊 Relations entre les bases de données

```
Auth DB              Booking DB          Payment DB          Notification DB
┌─────────┐          ┌────────┐          ┌──────────┐         ┌───────────────┐
│ users   │          │ slots  │          │ payments │         │notifications │
│ id (PK) │◄─────────│slot_id │          │ id (PK)  │         │ id (PK)       │
│ email   │          │        │          │ booking_ │         │ user_id (FK)  │
│         │          │booking │          │ id (FK)  │         │ type          │
│         │          │ user_  │◄─────────├─ user_id │         │ message       │
│         │          │ id (FK)│          │ (FK)     │         │               │
│         │          │        │          │          │         │               │
└─────────┘          └────────┘          └──────────┘         └───────────────┘
     │                    │                    │                   │
     └────────────────────┴────────────────────┴───────────────────┘
                     Kafka Events
          (booking-created, payment-completed, etc.)
```

---

## 🔄 Cycle de vie des données

### Réservation (Booking lifecycle)

```
1. User enregistré (auth.db: users)
   ↓
2. Créneau créé (booking.db: slots)
   ↓
3. Réservation créée (booking.db: bookings)
   Kafka: booking-created
   ↓
4. Payment attendu (payment.db: payments - status: pending)
   Kafka: invoice-generated
   ↓
5. Paiement traité (payment.db: payments - status: completed)
   Kafka: payment-completed
   ↓
6. Réservation confirmée (booking.db: bookings - status: confirmed)
   Notification créée (notif.db: notifications)
   ↓
7. Annulation (optionnel)
   bookings.status = cancelled
   payments.status = refunded
   Kafka: booking-cancelled, refund-completed
```

---

## 🛠️ Opérations courantes

### Backup des bases de données

```bash
# Backup SQLite
sqlite3 ./data/auth.db ".backup ./backups/auth.db.backup"

# Ou avec système de fichier
cp ./data/auth.db ./backups/auth.db.$(date +%Y%m%d_%H%M%S).backup
```

### Réinitialiser une base de données

```bash
# Supprimer la base
rm ./data/booking.db

# Le service la recréera au démarrage
npm run dev:booking
```

### Accéder à une base de données

```bash
# Ouvrir SQLite CLI
sqlite3 ./data/booking.db

# Commandes utiles
.tables                    # Lister les tables
.schema                    # Afficher le schéma
SELECT * FROM slots;      # Requête simple
.exit                      # Quitter
```

---

## 📈 Performance et Index

### Index créés

```sql
-- Auth Service
CREATE INDEX idx_users_email ON users(email);

-- Booking Service
CREATE INDEX idx_slots_serviceId ON slots(serviceId);
CREATE INDEX idx_slots_startTime ON slots(startTime);
CREATE INDEX idx_bookings_userId ON bookings(userId);
CREATE INDEX idx_bookings_slotId ON bookings(slotId);
CREATE INDEX idx_bookings_status ON bookings(status);

-- Payment Service
CREATE INDEX idx_payments_bookingId ON payments(bookingId);
CREATE INDEX idx_payments_userId ON payments(userId);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_invoices_paymentId ON invoices(paymentId);

-- Notification Service
CREATE INDEX idx_notifications_userId ON notifications(userId);
CREATE INDEX idx_notifications_read ON notifications(read);
```

### Optimisation

- Les recherches par `userId` et `status` sont optimisées
- Les jointures sur `bookingId` et `slotId` sont rapides
- Les índices diminuent les temps de requête

---

## 🔒 Intégrité des données

### Contraintes appliquées

```sql
-- Unicité
UNIQUE(email)              -- Auth: pas d'email dupliqué
UNIQUE(invoiceNumber)      -- Payment: numéros uniques

-- Pas de NULL
NOT NULL sur les champs critiques

-- Foreign Keys (optionnel dans SQLite, activé en production)
PRAGMA foreign_keys = ON;
FOREIGN KEY (paymentId) REFERENCES payments(id)
```

---

## 📊 Taille estimée des données

**Basée sur 1000 utilisateurs, 10000 réservations/an:**

| BD | Tables | Estimation |
|----|--------|------------|
| auth.db | 1 | ~50 KB |
| booking.db | 2 | ~500 KB |
| payment.db | 2 | ~200 KB |
| notif.db | 1 | ~100 KB |
| **Total** | **6** | **~850 KB** |

---

## 🚀 Scalabilité future

Pour passer à la production:

1. **Migrer vers PostgreSQL** pour chaque service
2. **Ajouter des replica sets** pour la haute disponibilité
3. **Implémenter la réplication** des bases de données
4. **Ajouter des caches** (Redis) pour les lectures fréquentes

---

**Database Schema Version:** 1.0  
**SQLite Version:** 3.x  
**Dernière mise à jour:** Mai 2026
