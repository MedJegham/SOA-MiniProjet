# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
RUN addgroup -S platforma && adduser -S platforma -G platforma
COPY --from=builder /app/node_modules ./node_modules
COPY shared/ ./shared/
COPY services/auth-service/ ./services/auth-service/
RUN mkdir -p /app/data && chown -R platforma:platforma /app/data
USER platforma
CMD ["node", "services/auth-service/server.js"]
