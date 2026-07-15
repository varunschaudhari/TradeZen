FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache curl

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p logs

EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:5001/health || exit 1

CMD ["node", "src/app.js"]
