# ── Auth Service ─────────────────────────────────────────────────────────────
# gRPC service — handles authentication, JWT, and user profiles
# Port: 50051

# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine

LABEL maintainer="MedJegham & louaybenmansour" \
      service="auth-service" \
      version="1.0.1"

WORKDIR /app
RUN addgroup -S platforma && adduser -S platforma -G platforma
COPY --from=builder /app/node_modules ./node_modules
COPY shared/ ./shared/
COPY services/auth-service/ ./services/auth-service/
RUN mkdir -p /app/data && chown -R platforma:platforma /app/data
USER platforma

# Check that the gRPC port is reachable every 30s
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('net').createConnection(50051, 'localhost').on('connect', () => process.exit(0)).on('error', () => process.exit(1))"

CMD ["node", "services/auth-service/server.js"]
