FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY shared/ ./shared/
COPY services/payment-service/ ./services/payment-service/
RUN mkdir -p /app/data
CMD ["node", "services/payment-service/server.js"]
