# Production Backend Restart Preflight

작성일: 2026-06-05  
목적: production backend `3000` restart 전 read-only 최종 확인

## 1. 범위

이번 확인에서 하지 않은 것:

- code 수정
- DB write
- restart
- deploy
- docker compose up

## 2. Git 상태

`git status --short` 결과:

- clean

판정:

- restart 전 문서화되지 않은 local change 없음

## 3. Backend route mount 확인

[backend/src/app.js](/volume1/docker/kingway-store/backend/src/app.js) 기준 SaaS / core route mount 확인:

- `/api/store`
- `/api/storefront`
- `/api/system`
- `/api/platform-auth`
- `/api/saas-admin`
- `/api/store-features`
- `/api/products`
- `/api/auth`
- `/api/dashboard`
- `/api/orders`
- `/api/purchase-confirmations`
- `/api/repairs`

판정:

- repo code 기준 SaaS route surface는 mount 되어 있음

## 4. Production `3306` schema 확인

아래 table의 `store_id` column 존재를 read-only로 확인했다.

- `staff_users` -> 있음
- `supplier_requests` -> 있음
- `customers` -> 있음
- `products` -> 있음
- `orders` -> 있음
- `order_items` -> 있음
- `repair_orders` -> 있음
- `purchase_confirmations` -> 있음
- `coupons` -> 있음

## 5. `/api/login` restart 후 가능성

[backend/src/routes/auth.js](/volume1/docker/kingway-store/backend/src/routes/auth.js) 의 login query가 요구하는 column:

- `id`
- `username`
- `password_hash`
- `role`
- `display_name`
- `is_active`
- `store_id`

production `staff_users`에서 위 column 존재 확인 완료.

판정:

- schema 관점에서 restart 후 `/api/login`은 성공 가능 상태
- 실제 성공 여부는 restart 후 테스트 계정으로 HTTP `200` 확인 필요

## 6. `/api/dashboard/summary` restart 후 가능성

[backend/src/routes/dashboard.js](/volume1/docker/kingway-store/backend/src/routes/dashboard.js) summary query가 요구하는 핵심 column:

- `customers.store_id`
- `products.store_id`
- `products.stock`
- `products.reorder_level`
- `orders.store_id`
- `orders.total_amount`
- `orders.business_date`
- `orders.is_reservation_order`
- `orders.final_payment_status`
- `supplier_requests.store_id`
- `supplier_requests.status`

production `3306`에서 위 column 존재 확인 완료.

판정:

- schema 관점에서 restart 후 `/api/dashboard/summary`는 성공 가능 상태
- 실제 성공 여부는 restart 후 authenticated request로 HTTP `200` 확인 필요

## 7. Current backend health

`GET http://127.0.0.1:3000/health`

결과:

- HTTP `200 OK`
- body: `{"ok":true}`

판정:

- 현재 backend process health는 정상

## 8. Backup 확인

backup directory:

- `/volume1/docker/kingway-store/backups/production-pre-saas/20260605_004301`

확인 결과:

- directory 존재
- `mysql_kingway_store.sql.gz` 존재

## 9. Restart 후 테스트할 API 목록

restart 직후 우선 확인:

- `GET /health`
- `POST /api/login`
- `POST /api/auth/login`
- `GET /api/dashboard/summary`
- `GET /api/products`
- `GET /api/orders`
- `GET /api/repairs`
- `GET /api/purchase-confirmations`
- `GET /api/system/saas-status`
- `GET /api/store/settings`
- `GET /api/store/settings/line`
- `GET /api/store-features/me`
- `GET /api/saas-admin/stores`

주의:

- protected routes는 정상 login token 또는 적절한 platform token으로 확인해야 한다.
- raw password / raw token은 로그나 문서에 남기지 않는다.

## 10. Preflight 판정

preflight 결과:

- `통과`

남은 blocker:

- restart 후 실제 runtime smoke test 미실시
- `supplier_request_items.store_id`, `inventory_movements.store_id`, `line_group_registrations.store_id`는 후속 hardening TODO로 남아 있음

restart 가능 여부:

- `가능`

조건:

- restart 직후 위 API checklist를 순서대로 확인
- login / dashboard가 실패하면 즉시 runtime logs와 schema query를 비교
- 이번 preflight에서는 restart를 수행하지 않음
