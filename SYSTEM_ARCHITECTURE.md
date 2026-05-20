# SYSTEM_ARCHITECTURE

이 문서는 실제 파일을 읽어 확인한 구조만 정리합니다. 기준 파일은 `docs/KINGWAY_STORE_MASTER_SPEC.md`, `docker-compose.yml`, `backend/src/app.js`, `backend/src/server.js`, `backend/src/bootstrap.js`, `frontend/src/App.jsx`, `frontend/src/lib/api.js`입니다.

## 전체 구성

```text
Browser / LINE / Telegram
        |
        | HTTP
        v
frontend container: nginx + Vite build, port 5173 -> 80
        |
        | /api proxy 또는 same-origin API
        v
backend container: Node.js + Express, port 3000
        |
        | mysql2 pool
        v
mysql container: MySQL 8.0, port 3306
```

## Docker services

`docker-compose.yml`에서 확인된 서비스:

- `mysql`: `mysql:8.0`, container `kingway-mysql`, database `kingway_store`
- `backend`: `node:20-alpine`, container `kingway-backend`, command `sh -c "npm install && npm start"`
- `frontend`: build `./frontend/Dockerfile`, container `kingway-frontend`, nginx port `5173:80`

MySQL 초기 schema는 `./database/schema.sql`이 `/docker-entrypoint-initdb.d/schema.sql:ro`로 mount됩니다. 이후 backend 시작 시 `backend/src/bootstrap.js`의 `ensureV2Schema()`가 runtime 보정 컬럼과 테이블을 추가합니다.

## Backend startup

`backend/src/server.js` 시작 순서:

1. `ensureStorageDirectories()`
2. `ensureV2Schema()`
3. `validateTelegramConfig()`
4. `ensureDefaultAdmin()`
5. `ensureDefaultStaff()`
6. `app.listen(config.port)`

`backend/src/config.js` 기본값:

- `port`: `3000`
- `frontendBaseUrl`: 기본 production URL `https://pos.kingway.tw`
- MySQL 기본 host: `mysql`
- MySQL 기본 database: `kingway_store`
- timezone 관련 값: Docker env `TZ=Asia/Taipei`, cron timezone `Asia/Taipei`

## Express app 구조

`backend/src/app.js`에서 확인된 middleware와 mount:

- `cors`
- `express.json({ limit: "10mb" })`
- `requestLogger`
- app-level product/status/health/direct routes
- module routes under `/api/...`
- `/files` static route to `backend/storage`
- cron jobs
- `notFoundHandler`
- `errorHandler`

특이점:

- `GET /api/products`는 `backend/src/app.js`에 직접 정의된 route가 먼저 존재하고, 그 뒤에 `app.use("/api/products", productRoutes)`가 mount됩니다.
- `app.use("/api/orders", orderItemsEditRoutes)`가 `app.use("/api/orders", orderRoutes)`보다 먼저 mount됩니다. 두 파일 모두 `PUT /:id/items`를 정의합니다.
- `backend/src/routes/customerStatus.js` 파일은 존재하지만 `backend/src/app.js`에는 mount되지 않았고, `/api/customer-status` 기능은 app-level direct routes로 구현되어 있습니다.
- `backend/src/routes/telegram.js` 파일은 존재하지만 실제 mount는 `backend/src/routes/telegramWebhook.js`의 `POST /api/telegram/webhook`입니다.

## Frontend app 구조

`frontend/src/App.jsx`에서 확인된 public routes:

- `/purchase-confirm/manual`
- `/purchase-confirm/:token`
- `/surveys/:token`
- `/line-order`
- `/repair-reservation`
- `/coupon-center`
- `/google-review`
- `/progress`
- `/store-info`
- `/support`
- `/login`

`frontend/src/App.jsx`에서 확인된 protected routes:

- `/dashboard`
- `/customer-status`
- `/customers`
- `/products`
- `/inventory`
- `/suppliers`
- `/orders`
- `/orders/:id/edit`
- `/pos`
- `/purchase-confirmations`
- `/repairs`
- `/repairs/:id`
- `/coupons`
- `/surveys`
- `/staff-attendance`
- `/staff`
- `/kpi`
- `/payroll`
- `/settings`
- `/more`
- `/trash`

`frontend/src/lib/api.js`에서 확인된 API 동작:

- 기본 API prefix: `/api`
- `apiRequest(path)`는 local storage token을 `Authorization: Bearer ...`로 추가합니다.
- `apiUploadImage(path, file)`은 raw file body를 POST하고 `Content-Type`, `X-File-Name` header를 설정합니다.

## Auth and permissions

Backend:

- Login route: `backend/src/routes/auth.js`
- JWT secret: `config.jwtSecret`
- Token 만료: `12h`
- `authenticate`: `backend/src/middleware/auth.js`
- `authorize`: 현재 구현은 전달된 role 목록을 실제로 비교하지 않고, 인증 사용자 존재 여부만 확인합니다.

Frontend:

- 권한 helper: `frontend/src/lib/permissions.js`
- 제한 사용자 허용 경로: `/pos`, `/products`, `/repairs`, `/inventory`, `/suppliers`, `/customers`
- 일반 role: `ADMIN`, `MANAGER`, `CASHIER`, `REPAIR`, `INVENTORY`

## Storage

확인된 storage 사용:

- `backend/storage/products`: 상품 이미지 업로드
- `backend/storage/pdfs`: 구매확인 PDF
- `backend/storage/reports`: supplier report/xlsx/csv
- Express static mount: `/files`

상품 이미지 업로드는 `POST /api/products/images`이고 응답 `imageUrl`은 `/files/products/{fileName}` 형식입니다.

## Scheduled jobs

`backend/src/app.js`에서 확인된 cron:

- `0 21 * * *`: daily report, `sendDailyReport()`
- `30 13 * * *`: repair pickup reminder, `sendRepairPickupReminders()`
- `0 1 * * *`: repair storage fee update, `updateRepairStorageFees()`

모두 timezone `Asia/Taipei`로 설정되어 있습니다.

## Integration boundaries

LINE:

- 실제 webhook: `POST /api/line/webhook`
- service 중심 파일: `backend/src/services/lineWorkflowService.js`
- LINE group 저장 table: `line_group_registrations`
- webhook dedupe table: `line_webhook_events`

Telegram:

- 실제 webhook: `POST /api/telegram/webhook`
- route file: `backend/src/routes/telegramWebhook.js`
- service file: `backend/src/services/telegramService.js`
- chat session table: `telegram_chat_sessions`

POS:

- frontend page: `frontend/src/pages/POSPage.jsx`
- backend route: `POST /api/orders`
- DB tables: `orders`, `order_items`, `inventory_movements`, `purchase_confirmations`

Repairs:

- frontend pages: `frontend/src/pages/RepairsPage.jsx`, `frontend/src/pages/RepairDetailPage.jsx`
- backend route: `backend/src/routes/repairs.js`
- service file: `backend/src/services/repairService.js`
- DB tables: `repair_orders`, `repair_logs`, `surveys`

Customers:

- frontend page: `frontend/src/pages/CustomersPage.jsx`
- backend route: `backend/src/routes/customers.js`
- DB tables: `customers`, `customer_crm_events`, `follow_up_tasks`, plus related order/repair/coupon/survey/purchase confirmation tables
