# DOCKER_COMMANDS

이 문서는 `docker-compose.yml`, `backend/package.json`, `frontend/package.json`에서 확인한 운영/개발 명령만 정리합니다.

## Services

`docker-compose.yml` 기준:

| Service | Container | Image/build | Port |
| --- | --- | --- | --- |
| `mysql` | `kingway-mysql` | `mysql:8.0` | `3306:3306` |
| `backend` | `kingway-backend` | `node:20-alpine` | `3000:3000` |
| `frontend` | `kingway-frontend` | `./frontend/Dockerfile` | `5173:80` |

## Start

```bash
docker compose up --build
```

백그라운드 실행:

```bash
docker compose up -d --build
```

## Stop

```bash
docker compose stop
```

전체 compose 종료:

```bash
docker compose down
```

주의: `docker compose down -v`는 `mysql_data` volume을 삭제할 수 있으므로 운영 DB에서는 사용 전 별도 확인이 필요합니다.

## Logs

```bash
docker logs kingway-backend
docker logs kingway-frontend
docker logs kingway-mysql
```

최근 로그만 확인:

```bash
docker logs --tail 200 kingway-backend
```

## Health check

Backend health route는 `backend/src/app.js`에서 확인됩니다.

```bash
curl http://127.0.0.1:3000/health
```

예상 응답:

```json
{"ok":true}
```

## MySQL access

`docker-compose.yml`의 기본 env:

- `MYSQL_DATABASE=kingway_store`
- `MYSQL_USER=kingway`
- `MYSQL_PASSWORD=kingway`

컨테이너 내부에서 접속:

```bash
docker exec -it kingway-mysql mysql -ukingway -pkingway kingway_store
```

호스트에서 접속:

```bash
mysql -h127.0.0.1 -P3306 -ukingway -pkingway kingway_store
```

table 확인:

```sql
SHOW TABLES;
```

status 집계 예시:

```sql
SELECT status, COUNT(*) FROM orders GROUP BY status;
SELECT status, COUNT(*) FROM repair_orders GROUP BY status;
```

## Backend package scripts

`backend/package.json`에서 확인:

```bash
npm start
npm run dev
npm run migrate:products
npm run migrate:verify
npm run migrate:orders-csv
npm run migrate:v2
npm run sync:product-categories
```

실제 script:

- `start`: `node src/server.js`
- `dev`: `node --watch src/server.js`
- `migrate:products`: `node scripts/importProducts.js`
- `migrate:verify`: `node scripts/verifyMigration.js`
- `migrate:orders-csv`: `node scripts/importOrderItemsCsv.js`
- `migrate:v2`: `node scripts/applyV2Schema.js`
- `sync:product-categories`: `node scripts/syncProductCategoriesFromSku.js`

## Frontend package scripts

`frontend/package.json`에서 확인:

```bash
npm run dev
npm run build
npm run preview
```

실제 script:

- `dev`: `vite`
- `build`: `vite build`
- `preview`: `vite preview --host 0.0.0.0`

## Runtime schema

초기 schema:

```text
database/schema.sql
```

Backend 시작 시 runtime 보정:

```text
backend/src/bootstrap.js
```

운영에서 schema 관련 문제를 볼 때는 `database/schema.sql`만 보지 말고 `ensureV2Schema()`도 같이 확인해야 합니다.

## Important env keys

`backend/src/config.js`에서 확인된 주요 env:

- `NODE_ENV`
- `PORT`
- `JWT_SECRET`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`
- `FRONTEND_BASE_URL`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `LINE_UNIFIED_QA_MODE`
- `LINE_QA_GROUP_ID`
- `TELEGRAM_NOTIFY_BOT_TOKEN`
- `TELEGRAM_STOCK_BOT_TOKEN`
- `TELEGRAM_ORDER_GROUP_ID`
- `TELEGRAM_HQ_GROUP_ID`
- `TELEGRAM_STOCK_GROUP_ID`
- `TELEGRAM_REPAIR_CONFIRM_GROUP_ID`
- `TELEGRAM_ALLOWED_STAFF_IDS`
- `TELEGRAM_ALLOWED_CHAT_IDS`
