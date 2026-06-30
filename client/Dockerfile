FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Build the SPA to call the API/socket on the SAME origin (relative URLs) so one reverse
# proxy / tunnel serves everything: empty → axios baseURL '' and io() → same origin, and
# nginx (nginx.conf) proxies /api + /socket.io to the server. Works for localhost AND a
# shared tunnel. Override via build args if the API is ever hosted on a separate domain.
ARG VITE_API_URL=""
ARG VITE_SOCKET_URL=""
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD curl -f http://localhost/nginx-health || exit 1
CMD ["nginx", "-g", "daemon off;"]
