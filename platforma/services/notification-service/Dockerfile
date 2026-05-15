FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY shared/ ./shared/
COPY services/notification-service/ ./services/notification-service/
RUN mkdir -p /app/data
CMD ["node", "services/notification-service/server.js"]
