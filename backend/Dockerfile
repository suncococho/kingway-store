FROM node:20-alpine

WORKDIR /app

ARG REVISION
LABEL org.opencontainers.image.revision=$REVISION

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force

COPY src ./src

RUN mkdir -p /app/storage \
  && chown -R node:node /app

USER node

EXPOSE 3000
CMD ["node", "src/server.js"]
