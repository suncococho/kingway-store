# Production Schema Gap Patch Plan

작성일: 2026-06-05  
대상 SQL 초안: [production_saas_schema_gap_patch.sql](/volume1/docker/kingway-store/sql/production_saas_schema_gap_patch.sql)

## 1. 목적

이 문서는 production SaaS cutover blocker를 해소하기 위한 2차 schema-only patch 초안을 설명한다.

이번 초안은 아래 두 대상만 포함한다.

- `staff_users.store_id`
- `supplier_requests.store_id`

이번 turn에서 하지 않은 것:

- production DB 변경
- SQL 실행
- restart
- deploy

## 2. 왜 필요한가

현재 production runtime failure와 직접 연결된 schema gap은 아래 2개다.

### 2-1. `/api/login` `500`

원인:

- [backend/src/routes/auth.js](/volume1/docker/kingway-store/backend/src/routes/auth.js)
- `staff_users.store_id`를 select

현재 production 상태:

- `staff_users.store_id` 없음

### 2-2. `/api/dashboard/summary` `500`

원인:

- [backend/src/routes/dashboard.js](/volume1/docker/kingway-store/backend/src/routes/dashboard.js)
- `supplier_requests.store_id`를 where clause에서 사용

현재 production 상태:

- `supplier_requests.store_id` 없음

## 3. 포함 대상

### 3-1. `staff_users.store_id`

원칙:

- `BIGINT UNSIGNED DEFAULT NULL`
- column missing일 때만 추가
- `idx_staff_users_store_id` 추가
- 기존 row는 `WHERE store_id IS NULL`일 때만 `1`로 backfill

FK 정책:

- `stores(id)` FK는 이번 patch에서 보류
- 이유:
  - cutover blocker를 최소 범위로 해소하기 위함
  - FK까지 함께 넣으면 rollback / legacy data 검토 범위가 커짐

### 3-2. `supplier_requests.store_id`

원칙:

- `BIGINT UNSIGNED DEFAULT NULL`
- column missing일 때만 추가
- `idx_supplier_requests_store_id` 추가
- 기존 row는 `WHERE store_id IS NULL`일 때만 `1`로 backfill

## 4. 제외 / TODO 대상

이번 SQL에 포함하지 않는 후속 권장 대상:

- `supplier_request_items.store_id`
- `inventory_movements.store_id`
- `line_group_registrations.store_id`

이유:

- 지금 당장 runtime blocker를 만드는 핵심은 `staff_users` / `supplier_requests` 2개다
- 후속 3개는 cutover 이전 추가 검토 대상으로 남긴다

## 5. SQL 원칙

초안 SQL 원칙:

1. `information_schema`로 column 존재 확인 후 `ALTER`
2. `information_schema`로 index 존재 확인 후 `ADD INDEX`
3. backfill은 `WHERE store_id IS NULL`만
4. `DROP / TRUNCATE / DELETE` 없음
5. preview `SELECT` 포함
6. `START TRANSACTION`은 backfill DML 보호용
7. `COMMIT` 주석 처리

중요:

- MySQL `ALTER TABLE`은 auto-commit이므로 transaction rollback으로 구조 변경은 되돌릴 수 없다

## 6. 실행 전 / 후 row count 확인

초안은 아래 2개 table의 row count preview를 포함한다.

- `staff_users`
- `supplier_requests`

의도:

- 구조 변경 및 NULL-only backfill이 row count를 바꾸지 않는지 확인

## 7. store_id NULL 검증

초안은 아래 검증을 포함한다.

### 7-1. 실행 전

- column 존재 여부 preview
- 이미 column이 있으면:
  - `NULL store_id` count
  - `NOT NULL store_id` count

### 7-2. 실행 후 current transaction

- `staff_users.store_id IS NULL = 0`
- `supplier_requests.store_id IS NULL = 0`
- `store_id = 1` row count 확인

## 8. Rollback 기준

### 8-1. DML

- backfill DML은 `COMMIT` 전이면 `ROLLBACK` 가능

### 8-2. DDL

- `ALTER TABLE`은 MySQL auto-commit
- column/index 추가는 transaction rollback으로 되돌릴 수 없음

따라서 실질 rollback 기준:

- 사전 backup restore 필요

## 9. 후속 TODO

cutover 전 추가 검토/patch 필요 후보:

1. `supplier_request_items.store_id`
2. `inventory_movements.store_id`
3. `line_group_registrations.store_id`
4. runtime restart / deploy 전 read-only 재검증
5. login `200` / dashboard `200` baseline 재확인

## 10. 결론

현재 초안은 production cutover blocker를 최소 범위로 줄이는 schema-only patch draft다.

핵심 요약:

- 포함 대상: `staff_users.store_id`, `supplier_requests.store_id`
- backfill: `NULL -> 1` only
- FK는 이번 patch에서 보류
- 후속 TODO는 별도 단계로 유지
- 실제 실행은 하지 않음
