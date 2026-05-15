FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY shared/ ./shared/
COPY services/auth-service/ ./services/auth-service/
RUN mkdir -p /app/data
CMD ["node", "services/auth-service/server.js"]
