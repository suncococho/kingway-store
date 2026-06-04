# Production SaaS Schema Migration Plan

작성일: 2026-06-05  
대상 SQL 초안: [production_saas_schema_migration.sql](/volume1/docker/kingway-store/sql/production_saas_schema_migration.sql)

## 1. 목적

이 문서는 production `3306`에 SaaS 기본 스키마를 추가하는 `schema-only migration` 초안을 설명한다.

이번 산출물은 실행용 초안이며, 현재 turn에서는 아래를 하지 않았다.

- production DB 변경
- staging DB 변경
- migration SQL 실행
- 배포

핵심 원칙:

- staging DB를 production에 덮어쓰지 않는다.
- 기존 production row를 보존한다.
- 기존 운영 데이터는 `store_id=1 / KINGWAY_TAINAN`에 귀속한다.
- backfill은 `store_id IS NULL` row만 대상으로 한다.

## 2. 추가 대상

### 2-1. 기존 운영 테이블에 추가할 컬럼

- `customers.store_id`
- `products.store_id`
- `orders.store_id`
- `order_items.store_id`
- `repair_orders.store_id`
- `purchase_confirmations.store_id`
- `coupons.store_id`

### 2-2. 추가할 index

- `idx_customers_store_id`
- `idx_products_store_id`
- `idx_orders_store_id`
- `idx_order_items_store_id`
- `idx_repair_orders_store_id`
- `idx_purchase_confirmations_store_id`
- `idx_coupons_store_id`

### 2-3. 새로 생성할 SaaS 테이블

- `stores`
- `store_features`
- `store_line_settings`
- `platform_admin_users`
- `store_memberships`

## 3. 기준 스키마

초안의 기준은 아래 2개다.

1. production `3306`의 현재 `SHOW CREATE TABLE`
2. staging `3310`의 현재 SaaS 테이블 정의

적용 방향:

- core business table은 staging과 동일하게 `store_id BIGINT UNSIGNED DEFAULT NULL`만 추가
- 기존 운영 PK/UK/FK는 유지
- 새 `store_id` 컬럼에는 우선 단일 index만 추가
- 기존 운영 row를 보존하기 위해 `NOT NULL` 강제는 이번 단계에서 하지 않음

## 4. seed store / metadata 전략

초안은 아래 seed row를 포함한다.

### 4-1. `stores`

- `id = 1`
- `code = KINGWAY_TAINAN`
- `name = KINGWAY 台南`
- `status = active`
- `plan = single_store`

### 4-2. `store_features`

store 1에 대해 기본 기능을 모두 `1`로 seed 한다.

목적:

- SaaS 기능 gate가 켜져 있어도 기존 KINGWAY 운영 기능이 갑자기 숨겨지지 않도록 보수적으로 유지

### 4-3. `store_line_settings`

store 1에 대해 아래 placeholder/legacy-compatible seed를 사용한다.

- `line_enabled = 1`
- `channel_secret_ref = 'env:LINE_CHANNEL_SECRET'`
- `channel_access_token_ref = 'env:LINE_CHANNEL_ACCESS_TOKEN'`
- `channel_secret_present = 1`
- `channel_access_token_present = 1`
- `webhook_path = '/api/line/webhook'`
- `customer_oa_name = 'KINGWAY 台南 OA'`
- `staff_group_enabled = 1`

주의:

- raw secret/token은 SQL에 넣지 않는다.
- `channel_id`, `liff_url`, `login_auth_url`는 이번 초안에서 강제 seed 하지 않는다.
- exact runtime value 정합성은 별도 LINE cutover 검증이 필요하다.

### 4-4. `store_memberships`

기존 active `staff_users`를 store 1 membership으로 seed 한다.

기본 규칙:

- `username = admin` -> `owner`
- `role in (ADMIN, MANAGER)` -> `admin`
- 그 외 active staff -> `staff`

이 방식은 기존 운영 계정을 보존하면서 최소 store-scoped membership을 마련하기 위한 보수적 seed다.

## 5. backfill 방식

backfill 원칙:

- `UPDATE ... SET store_id = 1 WHERE store_id IS NULL`

대상:

- `customers`
- `products`
- `orders`
- `order_items`
- `repair_orders`
- `purchase_confirmations`
- `coupons`

이 방식이 중요한 이유:

- 기존 row count를 바꾸지 않는다.
- 이미 `store_id`가 채워진 row를 덮어쓰지 않는다.
- 추후 일부 row가 다른 store로 귀속돼도 이번 migration이 그 값을 훼손하지 않는다.

## 6. preview / validation 구성

SQL 초안은 아래 preview를 포함한다.

1. 현재 DB/host/port와 대상 row count
2. 기존 `store_id` 컬럼 존재 여부
3. SaaS 신규 테이블 존재 여부
4. DDL 이후 `store_id` 컬럼과 테이블이 실제로 준비됐는지 재확인
5. backfill 전 `NULL store_id` row 수
6. backfill 후 `NULL store_id` row 수
7. backfill 후 row count 유지 여부
8. `stores.id=1 / KINGWAY_TAINAN` seed 확인
9. `store_memberships` seed 분포 확인

## 7. transaction / rollback 주의

이 초안은 `START TRANSACTION`과 `-- COMMIT` / `-- ROLLBACK`를 포함하지만, 범위는 제한적이다.

정확한 해석:

- `CREATE TABLE` / `ALTER TABLE`은 MySQL에서 auto-commit 된다.
- 따라서 transaction은 seed insert / NULL backfill DML 보호용이다.
- DDL이 실제로 실행된 뒤에는 `ROLLBACK`으로 구조 변경을 되돌릴 수 없다.

실제 rollback 기준:

1. `COMMIT` 전이면 DML은 `ROLLBACK`
2. DDL rollback이 필요하면 사전 백업에서 restore
3. production에서 임의 `DROP/TRUNCATE/DELETE` rollback은 금지

## 8. 실행 순서

권장 순서:

1. production full backup 완료 확인
2. rehearsal DB에서 먼저 실행
3. preview 결과 확인
4. DDL 적용 결과 확인
5. `NULL store_id` candidate 수 확인
6. seed row 확인
7. backfill 결과와 row count 유지 확인
8. 승인 시에만 마지막 `COMMIT`

## 9. 이번 schema SQL에 포함하지 않은 항목

이번 초안은 아래를 의도적으로 제외한다.

- staging -> production data merge
- `C-EB-001-S1` SKU 결정
- merge candidate 36건 insert
- manual review 대상 32건 처리
- test-like row 처리

## 10. 남은 blocker / TODO

### 10-1. product mapping blocker

이전 preview 결과 기준, merge SQL에는 아래 blocker가 남아 있다.

- production `products`에 `C-EB-001-S1` 없음
- 영향 `order_items` 4건

이 문제는 schema migration 대상이 아니다.

따라서:

- 이번 SQL에는 포함하지 않는다.
- merge SQL 실행 전 별도 승인/결정이 필요하다.

### 10-2. LINE runtime alignment

`store_line_settings` seed는 최소 metadata 기반 초안이다.

실제 운영 전에는 아래 정합성이 추가 확인돼야 한다.

- legacy webhook path 사용 방식
- store 1 LINE channel metadata
- LIFF / login auth URL 실제값
- staff group send runtime

### 10-3. platform admin bootstrap

`platform_admin_users` 테이블은 생성하지만, 이번 초안은 계정 bootstrap row를 강제 insert 하지 않는다.

이유:

- password hash를 SQL 초안에 고정하지 않기 위함
- platform 계정 bootstrap은 별도 승인 단계로 분리하는 편이 안전하기 때문

## 11. 결론

이 초안은 production 데이터를 지우지 않고 SaaS 구조만 올리기 위한 최소 schema migration draft다.

핵심 요약:

- core table `store_id` 추가
- SaaS 신규 테이블 5개 생성
- `stores.id=1 / KINGWAY_TAINAN` seed
- `NULL store_id`만 `1`로 backfill
- 기존 row count 유지 확인 preview 포함
- `C-EB-001-S1` 문제는 별도 TODO로 분리
- 실제 실행은 하지 않음

## 12. Preflight Review Result

검토일: 2026-06-05

preflight 판정:

- `조건부 통과`

검토 결과:

1. `DROP / TRUNCATE / DELETE` 실행문은 없다.
2. `C-EB-001-S1` 관련 product mapping은 이 SQL에 포함되지 않았다.
3. core table backfill `UPDATE`는 모두 `WHERE store_id IS NULL`로 제한되어 있다.
4. core business table row count는 구조상 유지된다.
   - `ALTER TABLE`은 컬럼/index만 추가
   - `UPDATE`는 기존 row 수정만 수행
   - 증가하는 row는 `stores`, `store_features`, `store_line_settings`, `store_memberships` 같은 신규 SaaS 테이블뿐이다.
5. `ALTER TABLE ADD COLUMN`과 `ADD INDEX`는 직접 실행하지 않고, `information_schema` 확인 후 dynamic SQL로 분기하므로 이미 존재할 때 즉시 실패하지 않도록 작성되어 있다.

### 12-1. 확인된 위험

가장 중요한 위험:

1. MySQL DDL auto-commit
   - `CREATE TABLE` / `ALTER TABLE`은 transaction으로 되돌릴 수 없다.
   - 따라서 `ROLLBACK`은 seed insert / backfill DML만 되돌릴 수 있다.
   - DDL rollback은 사전 백업 restore만 가능하다.

2. `stores.id=1` seed 충돌 가능성
   - 현재 `INSERT INTO stores ... WHERE NOT EXISTS (id = 1 OR code = 'KINGWAY_TAINAN')` 방식이다.
   - 만약 production에 이미 `id=1`이지만 다른 `code`인 row가 있으면 insert는 skip 된다.
   - 그 상태에서 `store_features` / `store_line_settings` / `store_memberships`가 `store_id=1`에 연결되면 잘못된 store에 귀속될 수 있다.
   - 따라서 실행 전 preview에서 반드시 `stores.id=1`이 비어 있거나, 이미 `code='KINGWAY_TAINAN'`인지 확인해야 한다.

3. `store_line_settings.webhook_path` unique 충돌 가능성
   - seed는 `webhook_path='/api/line/webhook'`를 사용한다.
   - 테이블이 이미 있고 다른 row가 같은 webhook path를 쓰고 있으면 insert가 unique key로 실패할 수 있다.
   - 현재 SQL은 `store_id=1` 존재 여부만 보고 insert 여부를 결정하므로, cross-store webhook path 충돌까지는 사전 차단하지 않는다.

4. `CREATE TABLE IF NOT EXISTS`의 한계
   - 테이블이 이미 존재하지만 staging 기준과 구조가 다르면, 이 SQL은 차이를 자동 보정하지 않는다.
   - 즉, “존재 여부”에는 안전하지만 “정확히 같은 구조”를 보장하지는 않는다.

### 12-2. 실행 전 추가 확인 권장

실행 전 아래 preview를 별도로 확인하는 것이 안전하다.

```sql
SELECT id, code, name, status, plan
FROM stores
WHERE id = 1 OR code = 'KINGWAY_TAINAN';

SELECT id, store_id, webhook_path
FROM store_line_settings
WHERE webhook_path = '/api/line/webhook';
```

### 12-3. 수정 필요 여부

- `있음`

권장 수정:

1. `stores` seed 전에 `id=1` / `code=KINGWAY_TAINAN` 정합성 preview를 더 명시적으로 강제
2. `store_line_settings.webhook_path` 충돌 preview를 SQL 본문에 추가
3. 실행 전 reviewer가 `stores.id=1`과 webhook path uniqueness를 수동 승인하도록 체크리스트 강화

현재 초안은 문서화와 리뷰 기준으로는 유효하지만, production에서 바로 실행하기에는 위 2개 seed collision risk를 먼저 확인하는 편이 안전하다.
