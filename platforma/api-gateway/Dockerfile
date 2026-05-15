FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY shared/ ./shared/
COPY api-gateway/ ./api-gateway/
CMD ["node", "api-gateway/server.js"]
