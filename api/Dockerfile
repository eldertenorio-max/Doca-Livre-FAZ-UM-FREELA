FROM node:22-alpine
RUN apk add --no-cache xz curl \
  && curl -fsSL -o /tmp/postgrest.tar.xz https://github.com/PostgREST/postgrest/releases/download/v16.5/postgrest-v16.5-linux-static-x86-64.tar.xz \
  && tar -xJf /tmp/postgrest.tar.xz -C /usr/local/bin \
  && rm /tmp/postgrest.tar.xz
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js migrar.mjs arquivos.mjs start.mjs auth.mjs rotasAuth.mjs email.mjs control-center.mjs ./
COPY sql ./sql
COPY server-functions ./server-functions
ENV PORT=8080
EXPOSE 8080
CMD ["node", "start.mjs"]
