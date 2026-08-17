FROM node:20-alpine

WORKDIR /app/backend

ARG REVISION
LABEL org.opencontainers.image.revision=$REVISION

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund   && npm cache clean --force

COPY backend/src ./src
COPY shared/warrantyRepairAdditionalTerms.json /app/shared/warrantyRepairAdditionalTerms.json

RUN mkdir -p /app/backend/storage   && chown -R node:node /app

USER node

EXPOSE 3000
CMD ["node", "src/server.js"]
