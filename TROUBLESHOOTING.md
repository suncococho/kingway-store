# TROUBLESHOOTING

이 문서는 실제 코드와 DB 확인 중 발견한 운영 확인 포인트를 정리합니다. 코드 수정 없이 문서화만 했습니다.

## Backend health

Route:

- `GET /health`

Command:

```bash
curl http://127.0.0.1:3000/health
```

Expected:

```json
{"ok":true}
```

## Container status

```bash
docker ps
docker logs --tail 200 kingway-backend
docker logs --tail 200 kingway-frontend
docker logs --tail 200 kingway-mysql
```

## MySQL connection

```bash
mysql -h127.0.0.1 -P3306 -ukingway -pkingway kingway_store
```

Basic checks:

```sql
SHOW TABLES;
SELECT status, COUNT(*) FROM orders GROUP BY status;
SELECT status, COUNT(*) FROM repair_orders GROUP BY status;
SELECT status, COUNT(*) FROM supplier_requests GROUP BY status;
```

## Schema mismatch

초기 schema는 `database/schema.sql`입니다. 하지만 backend 시작 시 `backend/src/bootstrap.js`의 `ensureV2Schema()`가 추가 table/column/index를 보정합니다.

스키마 문제를 볼 때 확인 순서:

1. `database/schema.sql`
2. `backend/src/bootstrap.js`
3. 현재 DB `SHOW CREATE TABLE table_name`
4. backend startup log

## Encoding issue

Master spec rule:

- 중국어가 `?`, `??`, `???`처럼 보이면 placeholder라고 단정하지 말고 실제 저장 byte를 확인해야 합니다.

DB charset 확인:

```sql
SHOW VARIABLES LIKE 'character_set%';
SHOW FULL COLUMNS FROM customers;
```

현재 Docker MySQL command는 `utf8mb4` 관련 옵션을 사용합니다.

## Auth issue

Files:

- `backend/src/routes/auth.js`
- `backend/src/middleware/auth.js`
- `frontend/src/lib/api.js`

확인할 것:

- `POST /api/login` 또는 `POST /api/auth/login`
- local storage token 존재 여부
- request header `Authorization: Bearer ...`
- backend `JWT_SECRET`

주의:

- 현재 `authorize()` middleware는 전달된 role 목록을 실제 role과 비교하지 않고 인증 사용자 존재 여부만 확인합니다.

## API prefix issue

Frontend helper:

- `frontend/src/lib/api.js`

기본 prefix:

- `/api`

`LineOrderPage.jsx`는 일부 direct fetch로 `/api/line-order/...`를 직접 호출합니다.

## Product list issue

`GET /api/products`는 두 위치가 관련됩니다.

- direct route in `backend/src/app.js`
- router in `backend/src/routes/products.js`

Direct route가 먼저 등록되어 있습니다. 상품 목록 응답 문제를 볼 때 두 파일 모두 확인해야 합니다.

## Product image does not show

관련 파일:

- `backend/src/routes/products.js`
- `frontend/src/pages/ProductsPage.jsx`
- `frontend/src/components/ProductImage.jsx`

확인 순서:

1. 업로드 route: `POST /api/products/images`
2. 응답 `imageUrl`이 `/files/products/...`인지 확인
3. 파일 위치: `backend/storage/products`
4. static mount: `/files`
5. DB column: `products.image_url`
6. frontend fallback `無圖` 발생 여부

## Repair not visible in repair management

Master rule:

- 수리 category 상품이 포함된 주문은 수리 주문입니다.

확인 query:

```sql
SELECT oi.order_id, oi.product_category_snapshot
FROM order_items oi
WHERE oi.product_category_snapshot = 'REPAIR';
```

관련 code:

- `backend/src/routes/orders.js`
- `backend/src/routes/repairs.js`

수리 판정 조건:

- `orders.repair_order_id IS NOT NULL`
- `orders.source = 'repair_quote'`
- 연결된 `repair_orders.order_id`
- `order_items.product_category_snapshot = 'REPAIR'`

## Repair reservation not accepted

관련 파일:

- `backend/src/services/repairService.js`

확인된 예약 가능 요일:

- Tuesday
- Wednesday
- Sunday

예약 time slot:

- `14:00`
- `15:00`
- `16:00`
- `18:00`
- `19:00`

수리 예약 상태 확인:

```sql
SELECT id, repair_no, status, reservation_status, reservation_date, reservation_time
FROM repair_orders
ORDER BY id DESC
LIMIT 20;
```

## Repair estimate/customer response issue

관련 route:

- `POST /api/repairs/:id/estimate`
- `POST /api/repairs/:id/customer-response`
- `POST /api/repairs/:id/approve`

관련 column:

- `repair_orders.status`
- `repair_orders.quote_status`
- `repair_orders.customer_estimate_response`

수리 시작 조건:

- `customer_estimate_response = approved`

## Purchase confirmation issue

관련 route:

- `POST /api/orders/:id/purchase-confirmation`
- `GET /api/purchase-confirmations/public/:token`
- `POST /api/purchase-confirmations/public/:token`
- `GET /api/purchase-confirmations/public/:token/pdf`
- `POST /api/orders/:id/confirm-handover`

확인 table:

- `purchase_confirmations`
- `purchase_confirmation_tokens`
- `orders`

확인할 column:

- `purchase_confirmations.status`
- `purchase_confirmations.pdf_path`
- `orders.final_payment_status`
- `orders.handover_confirmed_at`

Master rule:

- 구매확인은 주문 완납 이후 시작합니다.

## Coupon issue

관련 route:

- `GET /api/coupons`
- `POST /api/coupons/issue`
- `POST /api/coupons/request-google-review`
- `POST /api/coupons/approve-google-review/:id`
- `POST /api/coupons/reject-google-review/:id`

확인 table:

- `coupons`

중복 확인:

```sql
SELECT customer_id, coupon_type, COUNT(*)
FROM coupons
GROUP BY customer_id, coupon_type
HAVING COUNT(*) > 1;
```

주의:

- Master spec은 `EBIKE` only라고 표현합니다.
- 현재 상품 category code는 `EB`이고, 일부 주문 item snapshot은 `EBIKE` 또는 `REPAIR`처럼 legacy/internal label을 사용합니다.

## Customer search issue

관련 file:

- `backend/src/routes/customers.js`

확인된 주의사항:

- 기본 query가 `WHERE COALESCE(crm_stage, '') <> 'deleted'`를 사용합니다.
- search 조건을 볼 때 SQL 조립 방식을 같이 확인해야 합니다.

삭제 고객 확인:

```sql
SELECT id, name, phone, line_user_id, crm_stage
FROM customers
WHERE crm_stage = 'deleted'
ORDER BY id DESC
LIMIT 20;
```

## LINE webhook issue

Route:

- `POST /api/line/webhook`

Files:

- `backend/src/routes/line.js`
- `backend/src/services/lineWorkflowService.js`
- `backend/src/services/lineClient.js`

확인할 env:

- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `LINE_UNIFIED_QA_MODE`
- `LINE_QA_GROUP_ID`

확인 table:

- `line_webhook_events`
- `line_group_registrations`
- `line_chat_sessions`

Group registration commands:

- `/register admin`
- `/register staff`
- `/register repair`
- `/register inventory`
- `/register daily`

## Telegram webhook issue

Route:

- `POST /api/telegram/webhook`

Mounted file:

- `backend/src/routes/telegramWebhook.js`

Not mounted file:

- `backend/src/routes/telegram.js`

확인할 env:

- `TELEGRAM_NOTIFY_BOT_TOKEN`
- `TELEGRAM_STOCK_BOT_TOKEN`
- `TELEGRAM_ORDER_GROUP_ID`
- `TELEGRAM_HQ_GROUP_ID`
- `TELEGRAM_STOCK_GROUP_ID`
- `TELEGRAM_REPAIR_CONFIRM_GROUP_ID`

주의:

- Telegram은 현재 코드에 존재하지만 master spec은 LINE-first입니다.
- 신규 핵심 업무를 Telegram 중심으로 바꾸면 spec과 충돌할 수 있습니다.

## Supplier request issue

관련 routes:

- `GET /api/suppliers/requests`
- `POST /api/suppliers/requests`
- `POST /api/suppliers/:id/receive`
- `POST /api/suppliers/:id/return-done`
- `GET /api/suppliers/monthly`

확인 table:

- `supplier_requests`
- `supplier_request_items`
- `inventory_movements`

Status:

- `PENDING_SUPPLIER`
- `APPROVED`
- `REJECTED`
- `PARTIALLY_RECEIVED`
- `RECEIVED`
- `RETURN_CONFIRMED`
- `CANCELED`

## Known code cautions confirmed during read

다음은 코드 읽기 중 확인된 운영 주의사항입니다. 이 문서 작업에서는 코드 수정하지 않았습니다.

- `backend/src/routes/customerStatus.js`는 존재하지만 `backend/src/app.js`에 mount되어 있지 않습니다.
- `backend/src/routes/telegram.js`는 존재하지만 `backend/src/app.js`에 mount되어 있지 않습니다.
- `GET /api/products`는 `backend/src/app.js` direct route가 먼저 등록되어 있고 `backend/src/routes/products.js` router가 뒤에 mount됩니다.
- `PUT /api/orders/:id/items`는 `backend/src/routes/orderItemsEdit.js`와 `backend/src/routes/orders.js` 양쪽에 정의되어 있으며, `orderItemsEditRoutes`가 먼저 mount됩니다.
- `authorize()` middleware는 전달된 role 목록을 실제 role과 비교하지 않습니다.
- `backend/src/routes/telegramWebhook.js`의 `/lowstock auto` command에는 query parameter 구성에서 `supplierFilter` 참조를 확인해야 합니다.
- `backend/src/routes/orders.js`의 `POST /api/orders` 예약금/잔금 계산 구간은 변수 선언 순서를 확인해야 합니다.

## Useful SQL snippets

최근 주문:

```sql
SELECT id, order_no, status, final_payment_status, unpaid_balance, created_at
FROM orders
ORDER BY id DESC
LIMIT 20;
```

최근 수리:

```sql
SELECT id, repair_no, status, reservation_status, quote_status, customer_estimate_response, created_at
FROM repair_orders
ORDER BY id DESC
LIMIT 20;
```

최근 LINE webhook:

```sql
SELECT id, event_id, event_type, created_at
FROM line_webhook_events
ORDER BY id DESC
LIMIT 20;
```

최근 workflow event:

```sql
SELECT id, event_type, entity_type, entity_id, created_at
FROM v2_workflow_events
ORDER BY id DESC
LIMIT 20;
```
