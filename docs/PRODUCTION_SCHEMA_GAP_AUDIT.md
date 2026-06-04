# Production Schema Gap Audit

작성일: 2026-06-05  
목적: production `3000` runtime / 현재 repo SaaS 코드가 요구하는 DB schema와 production `3306` 실제 schema 차이를 read-only로 감사

## 1. 범위

이번 감사에서 수행한 것:

- `backend/src` 전체 `store_id` 참조 grep
- production `3306` `information_schema` read-only 확인
- 핵심 runtime failure API와 schema gap 연결
- cutover 전 필요한 schema-only migration 목록 정리

이번 turn에서 하지 않은 것:

- code 수정
- DB write
- restart
- deploy

## 2. Repo 기준 `store_id` 참조 테이블

`backend/src` grep 기준으로 `store_id`를 직접 참조하거나 store-scoped 동작을 기대하는 핵심 테이블은 아래와 같다.

### 2-1. core business tables

- `customers`
- `products`
- `orders`
- `order_items`
- `repair_orders`
- `purchase_confirmations`
- `coupons`

### 2-2. auth / staff / SaaS tables

- `staff_users`
- `stores`
- `store_features`
- `store_line_settings`
- `store_memberships`
- `platform_admin_users`

### 2-3. inventory / supplier / stock tables

- `supplier_requests`
- `supplier_request_items`
- `inventory_movements`

### 2-4. LINE / group registration related

- `line_group_registrations`

주의:

- `line_group_registrations`는 현재 코드상 `store_id` scoped query를 직접 사용하지 않는다.
- 즉시 cutover blocker column이라기보다 후속 multi-store hardening 후보에 가깝다.

## 3. Production `3306` 실제 schema 상태

### 3-1. `store_id` 존재

- `customers` -> 있음
- `products` -> 있음
- `orders` -> 있음
- `order_items` -> 있음
- `repair_orders` -> 있음
- `purchase_confirmations` -> 있음
- `coupons` -> 있음
- `store_features` -> 있음
- `store_line_settings` -> 있음
- `store_memberships` -> 있음

### 3-2. `store_id` 없음

- `staff_users` -> 없음
- `supplier_requests` -> 없음
- `supplier_request_items` -> 없음
- `inventory_movements` -> 없음
- `line_group_registrations` -> 없음
- `stores` -> 없음
- `platform_admin_users` -> 없음

해석:

- `stores` / `platform_admin_users`는 table identity상 `store_id`가 없어도 자연스럽다.
- 하지만 `staff_users`, `supplier_requests`, `supplier_request_items`, `inventory_movements`는 현재 repo code 기준으로 중요한 gap이다.

## 4. 특히 확인한 핵심 테이블

### 4-1. `staff_users`

production columns:

- `id`
- `username`
- `password_hash`
- `display_name`
- `line_user_id`
- `role`
- `is_active`
- `created_at`
- `updated_at`
- `telegram_user_id`
- `telegram_username`

결론:

- `store_id` 없음

### 4-2. `supplier_requests`

production columns:

- `id`
- `request_type`
- `status`
- `supplier_name`
- `note`
- `requested_by_staff_id`
- `supplier_response_note`
- `supplier_responded_at`
- `created_at`
- `updated_at`

결론:

- `store_id` 없음

### 4-3. `supplier_request_items`

production columns:

- `id`
- `supplier_request_id`
- `product_id`
- `quantity`
- `received_quantity`
- `reason`
- `note`
- `created_at`

결론:

- `store_id` 없음

### 4-4. `inventory_movements`

production columns:

- `id`
- `product_id`
- `movement_type`
- `quantity`
- `reference_type`
- `reference_id`
- `created_by`
- `notes`
- `created_at`

결론:

- `store_id` 없음

### 4-5. `line_group_registrations`

production columns:

- `id`
- `line_group_id`
- `source_type`
- `registration_type`
- `group_name`
- `registered_by_line_user_id`
- `is_active`
- `created_at`
- `updated_at`

결론:

- `store_id` 없음
- 현재 code는 이 table을 global query로 읽고 있어 즉시 runtime failure를 만들지는 않음
- 그러나 multi-store strict isolation 관점에서는 후속 migration 후보

## 5. 현재 production `3000` failure API 와 schema gap 연결

### 5-1. `/api/login` `500`

원인 파일:

- [backend/src/routes/auth.js](/volume1/docker/kingway-store/backend/src/routes/auth.js)

문제 쿼리:

- `SELECT id, username, password_hash, role, display_name, is_active, store_id FROM staff_users ...`

schema gap:

- `staff_users.store_id` 없음

영향:

- 일반 staff login 실패
- 결과적으로 정상 auth flow 자체가 깨짐

### 5-2. `/api/dashboard/summary` `500`

원인 파일:

- [backend/src/routes/dashboard.js](/volume1/docker/kingway-store/backend/src/routes/dashboard.js)

문제 쿼리 중 하나:

- `(SELECT COUNT(*) FROM supplier_requests WHERE store_id = ? AND status IN (...))`

schema gap:

- `supplier_requests.store_id` 없음

영향:

- dashboard summary 실패

## 6. 잠재적으로 영향받는 API / 기능

### 6-1. `staff_users.store_id` 관련

영향 가능성이 높은 코드:

- `auth.js`
- `lineOrder.js`
  - active staff lookup with `store_id = ?`
- staff-scoped assignment / default staff resolution logic

예상 영향:

- login
- LINE order / coupon / purchase flow 일부
- store-scoped staff assignment

### 6-2. `supplier_requests.store_id` 관련

영향 가능성이 높은 코드:

- `dashboard.js`
- `inventory.js`
- `suppliers.js`
- `telegramWebhook.js`

예상 영향:

- dashboard summary
- supplier request list / status transitions
- inventory receive / restock flow
- supplier/stock group operational flow

### 6-3. `supplier_request_items.store_id` 관련

현재 코드에서는 주로 `supplier_requests`와 `products.store_id`를 통해 join한다.

판단:

- 즉시 failure의 주원인은 아니지만, multi-store isolation을 강화하려면 추가가 바람직하다.

### 6-4. `inventory_movements.store_id` 관련

현재 코드에서는 product join 기반으로 일부 scope를 보완하지만, movement row 자체는 store column이 없다.

판단:

- inventory auditability / direct filter / future reporting을 위해 추가가 바람직하다.

### 6-5. `line_group_registrations.store_id` 관련

현재 code는 global query:

- `line.js`
- `settingsService.js`
- `staffLineNotify.js`

판단:

- 현재 즉시 runtime blocker는 아님
- 그러나 multi-store strict routing / LINE group separation 전에는 schema + query design이 필요

## 7. 필요한 schema-only migration 목록

### 7-1. 즉시 cutover blocker 해소용

우선순위 높음:

1. `staff_users`
   - add `store_id BIGINT UNSIGNED DEFAULT NULL`
   - index 추가 필요
   - 기존 active staff를 `store_id = 1`로 backfill 필요

2. `supplier_requests`
   - add `store_id BIGINT UNSIGNED DEFAULT NULL`
   - index 추가 필요
   - 기존 row를 `store_id = 1`로 backfill 필요

### 7-2. strong store-scope completion용

우선순위 중간:

3. `supplier_request_items`
   - add `store_id BIGINT UNSIGNED DEFAULT NULL`
   - index 추가 권장
   - parent `supplier_requests` / linked `products` 기준 backfill 검토

4. `inventory_movements`
   - add `store_id BIGINT UNSIGNED DEFAULT NULL`
   - index 추가 권장
   - `product_id` join 또는 `reference_type/reference_id` 기준 backfill 검토

### 7-3. later hardening / LINE isolation용

우선순위 낮음:

5. `line_group_registrations`
   - add `store_id BIGINT UNSIGNED DEFAULT NULL`
   - current runtime blocker는 아님
   - multi-store LINE group routing 분리 전 설계 필요

## 8. Seed / Backfill 필요 여부

### 8-1. 필요한 backfill

- `staff_users.store_id`
  - 필요
  - 기존 active staff는 단일 store 운영 기준 `store_id = 1`

- `supplier_requests.store_id`
  - 필요
  - 기존 운영 row는 `store_id = 1`

### 8-2. 권장 backfill

- `supplier_request_items.store_id`
  - parent request 또는 product row 기준 보수적 backfill

- `inventory_movements.store_id`
  - product join 기준 backfill이 가장 단순

### 8-3. 설계 필요

- `line_group_registrations.store_id`
  - 단순 `1` backfill 자체는 가능
  - 하지만 registration ownership / group sharing 정책을 먼저 확정하는 편이 안전

## 9. 권장 실행 순서

1. production full backup 재확인
2. `staff_users.store_id` migration
3. `staff_users.store_id=1` backfill
4. `supplier_requests.store_id` migration
5. `supplier_requests.store_id=1` backfill
6. login baseline 재확인
7. dashboard summary baseline 재확인
8. 필요 시 `supplier_request_items.store_id` migration + backfill
9. 필요 시 `inventory_movements.store_id` migration + backfill
10. inventory / supplier operational flow smoke test
11. 마지막으로 runtime/code promotion or restart decision

## 10. Risk

주요 risk:

1. `staff_users.store_id` 추가 시 auth / assignment logic가 즉시 활성화됨
2. `supplier_requests.store_id` 추가 후 dashboard / inventory / suppliers route가 같은 column을 쓰기 시작함
3. `supplier_request_items` / `inventory_movements`는 단순 column 추가보다 historical backfill 기준이 중요
4. `line_group_registrations`는 잘못 backfill 하면 multi-store LINE routing 설계가 꼬일 수 있음

완화:

- schema-only + NULL 허용으로 시작
- backfill은 `NULL -> 1` only
- dry-run count 먼저
- cutover 전 read-only verification 반복

## 11. Blocker 여부

- `예, blocker`

즉시 cutover blocker:

- `staff_users.store_id` 없음
- `supplier_requests.store_id` 없음

그 결과:

- `/api/login` 실패
- `/api/dashboard/summary` 실패

추가 blocker 후보:

- runtime이 repo code snapshot과 불일치하는 상태
- 즉, schema 보완만으로 끝나지 않고, 최종적으로는 runtime refresh / controlled deploy plan이 별도로 필요

## 12. 결론

production `3306`는 core business 7개 table의 `store_id`는 이미 준비됐지만, SaaS cutover에 필요한 보조 schema는 아직 덜 올라와 있다.

핵심 요약:

1. core data tables는 대체로 준비됨
2. `staff_users.store_id` missing
3. `supplier_requests.store_id` missing
4. `supplier_request_items` / `inventory_movements`도 후속 보강 필요
5. `line_group_registrations.store_id`는 later hardening 항목
6. 현재 상태에서는 schema gap 때문에 cutover / restart를 바로 진행하면 안 된다
