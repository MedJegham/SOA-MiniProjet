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
COPY api-gateway/ ./api-gateway/
USER platforma
CMD ["node", "api-gateway/server.js"]
