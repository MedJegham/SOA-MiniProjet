# Screenshots — Platforma

Ce dossier contient les captures d'écran de démonstration de la plateforme.

## Contenu

| Fichier | Description |
|---------|-------------|
| `apollo-sandbox.png` | Apollo Sandbox — requête GraphQL `myBookings` |
| `postman-register.png` | Postman — `POST /api/auth/register` (201 Created) |
| `postman-booking.png` | Postman — `POST /api/bookings` (201 Created) |
| `postman-payment.png` | Postman — `POST /api/payments` (201 Created) |
| `kafka-logs.png` | Logs Kafka — topics `booking.confirmed` et `payment.completed` |

## Comment reproduire

### Apollo Sandbox
1. `docker-compose up`
2. Ouvrir `http://localhost:3000/sandbox`
3. Exécuter la mutation `login` pour obtenir un token
4. Ajouter le header `Authorization: Bearer <token>`
5. Exécuter `query { myBookings(limit: 5, offset: 0) { bookings { id status } total } }`

### Postman
Importer la collection : `platforma/docs/Platforma.postman_collection.json`

### Logs Kafka
```bash
docker-compose exec kafka kafka-console-consumer \
  --bootstrap-server kafka:9092 \
  --topic booking.confirmed \
  --from-beginning
```
