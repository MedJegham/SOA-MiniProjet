FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY shared/ ./shared/
COPY services/booking-service/ ./services/booking-service/
RUN mkdir -p /app/data
CMD ["node", "services/booking-service/server.js"]
