# Tenant / Store Dry-Run Execution Checklist

## 1. 목적

실제 운영 DB에서 KINGWAY multi-tenant 전환 전 SELECT-only dry-run을 수행하기 위한 실행 순서 체크리스트다.

이 문서는 dry-run 실행 절차를 정리한 문서이며, DB 변경을 승인하지 않는다.

관련 문서:

- `docs/TENANT_STORE_DRY_RUN_PLAN.md`
- `docs/TENANT_STORE_DRY_RUN_SQL.md`
- `docs/TENANT_STORE_DRY_RUN_RESULT_TEMPLATE.md`
- `docs/TENANT_STORE_SCHEMA_DRAFT.md`
- `docs/MULTI_TENANT_MIGRATION_PHASES.md`

## 2. 실행 전 확인

dry-run 실행 전 아래 항목을 확인한다.

| 확인 항목 | 상태 | 메모 |
|---|---|---|
| 최신 NAS backup 존재 여부 | YES / NO |  |
| backup 생성 시각 확인 | YES / NO |  |
| backup 파일 위치 확인 | YES / NO |  |
| rollback backup 위치 확인 | YES / NO |  |
| backup restore 가능성 확인 | YES / NO |  |
| Git snapshot branch 또는 기준 commit 확인 | YES / NO |  |
| 현재 branch가 `beta/staging-architecture`인지 확인 | YES / NO |  |
| 현재 git commit hash 기록 | YES / NO |  |
| 운영 시간 여부 확인 | YES / NO |  |
| 고객/직원 사용량이 낮은 시간대인지 확인 | YES / NO |  |
| 실행자가 SELECT-only 원칙을 확인했는가 | YES / NO |  |
| 결과 기록 문서 준비 | YES / NO |  |

명령 확인 예시:

```sh
git branch --show-current
git rev-parse HEAD
```

주의:

- 이 단계에서 `git add`, `git commit`, `git reset`, 배포 명령은 실행하지 않는다.
- backup 확인은 dry-run 실행 전 안전 기준이다.
- dry-run은 SELECT-only지만, 운영 DB 접근 전에는 항상 rollback 기준점을 확인한다.

## 3. dry-run 실행 원칙

허용:

- `SHOW COLUMNS`
- `SHOW INDEX`
- `SELECT COUNT(*)`
- `SELECT ... GROUP BY`
- `SELECT ... LEFT JOIN ... WHERE ... IS NULL`
- `EXPLAIN SELECT`

금지:

- `ALTER`
- `UPDATE`
- `DELETE`
- `DROP`
- `CREATE INDEX`
- `INSERT`
- `TRUNCATE`
- migration 실행
- docker-compose 수정
- 운영 서버 재시작

필수 원칙:

- SELECT-only
- ALTER/UPDATE/DELETE/DROP 금지
- 결과 기록 필수
- 개인정보 masking
- phone, LINE userId, token 전체값 기록 금지
- 결과는 `docs/TENANT_STORE_DRY_RUN_RESULT_TEMPLATE.md`에 맞춰 정리

## 4. 실행 순서

아래 순서대로 실행한다.

### STEP 1. SHOW COLUMNS

목적:

- 실제 운영 DB 컬럼 상태 확인
- 문서화된 schema와 실제 DB 차이 확인
- tenant/store 관련 컬럼이 이미 존재하는지 확인

예시:

```sql
SHOW COLUMNS FROM customers;
SHOW COLUMNS FROM orders;
SHOW COLUMNS FROM order_items;
SHOW COLUMNS FROM repair_orders;
SHOW COLUMNS FROM products;
SHOW COLUMNS FROM inventory_movements;
SHOW COLUMNS FROM coupons;
SHOW COLUMNS FROM purchase_confirmations;
SHOW COLUMNS FROM staff_users;
SHOW COLUMNS FROM staff_attendance;
SHOW COLUMNS FROM staff_kpi_logs;
SHOW COLUMNS FROM supplier_requests;
SHOW COLUMNS FROM supplier_request_items;
SHOW COLUMNS FROM line_group_registrations;
SHOW COLUMNS FROM line_chat_sessions;
SHOW COLUMNS FROM v2_workflow_events;
```

기록 위치:

- 결과 템플릿 6장 index/schema 메모
- 필요 시 별도 schema diff 메모

### STEP 2. SHOW INDEX

목적:

- 현재 unique key / index 확인
- multi-tenant unique 재설계 위험 확인
- 기존 전역 unique 확인

예시:

```sql
SHOW INDEX FROM staff_users;
SHOW INDEX FROM customers;
SHOW INDEX FROM products;
SHOW INDEX FROM orders;
SHOW INDEX FROM coupons;
SHOW INDEX FROM purchase_confirmations;
SHOW INDEX FROM purchase_confirmation_tokens;
SHOW INDEX FROM line_group_registrations;
SHOW INDEX FROM line_chat_sessions;
```

기록 위치:

- 결과 템플릿 6장 index 상태 기록

### STEP 3. COUNT(*)

목적:

- 전체 row count baseline 생성
- backfill 대상 row 수 확인
- migration 전후 비교 기준 확보

실행 대상:

- `customers`
- `orders`
- `order_items`
- `repair_orders`
- `products`
- `inventory_movements`
- `coupons`
- `purchase_confirmations`
- `staff_users`
- `staff_attendance`
- `staff_kpi_logs`
- `supplier_requests`
- `supplier_request_items`
- `line_group_registrations`
- `line_chat_sessions`
- `v2_workflow_events`

기록 위치:

- 결과 템플릿 3장 테이블별 row count 기록

### STEP 4. duplicate check

목적:

- unique key 재설계 전 중복 위험 확인
- backfill 후 tenant/store scoped unique 적용 가능성 판단

필수 확인:

- customers phone duplicate
- normalized phone duplicate
- orders order_no duplicate
- customers.line_user_id duplicate
- staff_users.line_user_id duplicate
- customer/staff LINE userId 공유
- coupons customer + coupon_type duplicate
- coupons code duplicate
- line_group_id duplicate
- line_chat_sessions user/flow duplicate

기록 위치:

- 결과 템플릿 4장 duplicate 검증 기록

위험 신호:

- duplicate customer phone
- duplicate order_no
- duplicate LINE userId
- duplicate coupon issue

### STEP 5. orphan check

목적:

- parent-child 관계가 깨진 row 확인
- backfill 시 store 귀속이 불가능한 row 확인

필수 확인:

- `orders.customer_id -> customers.id`
- `orders.created_by -> staff_users.id`
- `order_items.order_id -> orders.id`
- `order_items.product_id -> products.id`
- `repair_orders.customer_id -> customers.id`
- `repair_logs.repair_order_id -> repair_orders.id`
- `coupons.customer_id -> customers.id`
- `coupons.order_id -> orders.id`
- `purchase_confirmations.order_id -> orders.id`
- `purchase_confirmations.customer_id -> customers.id`
- `purchase_confirmation_tokens.order_id -> orders.id`
- `purchase_confirmation_tokens.customer_id -> customers.id`
- `inventory_movements.product_id -> products.id`
- `staff_attendance.staff_user_id -> staff_users.id`
- `staff_kpi_logs.staff_user_id -> staff_users.id`
- `supplier_requests.requested_by_staff_id -> staff_users.id`
- `supplier_request_items.supplier_request_id -> supplier_requests.id`
- `supplier_request_items.product_id -> products.id`

기록 위치:

- 결과 템플릿 5장 orphan summary

위험 신호:

- orphan rows가 1개 이상 존재
- 특히 order/order_items/product/customer 연결 orphan
- purchase confirmation PDF 연결 orphan
- inventory movement product orphan

### STEP 6. NULL check

목적:

- 정상 NULL과 위험 NULL 구분
- backfill 및 NOT NULL 전환 전 차단 요소 확인

필수 확인:

- `customers.phone`
- `customers.line_user_id`
- `orders.customer_id`
- `orders.customer_phone`
- `orders.created_by`
- `repair_orders.customer_id`
- `repair_orders.order_id`
- `coupons.customer_id`
- `coupons.order_id`
- `purchase_confirmations.order_id`
- `purchase_confirmations.customer_id`
- `purchase_confirmations.pdf_path`
- `staff_users.line_user_id`
- `line_chat_sessions.line_user_id`

기록 위치:

- 결과 템플릿 5장 NULL summary

주의:

- NULL이 모두 문제는 아니다.
- OFFLINE_NO_PHONE 고객, pending coupon, manual purchase confirmation 등 정상 NULL을 구분한다.
- critical field NULL은 BLOCKER 가능성이 있다.

### STEP 7. EXPLAIN SELECT

목적:

- 주요 dry-run query와 향후 scoped query 성능 위험 확인
- count/orphan/duplicate query가 운영 DB에 과부하를 주지 않는지 확인
- 향후 `store_id` index 필요성을 검토

권장 대상:

```sql
EXPLAIN SELECT COUNT(*) FROM customers;
EXPLAIN SELECT phone, COUNT(*) FROM customers GROUP BY phone;
EXPLAIN SELECT order_no, COUNT(*) FROM orders GROUP BY order_no;
EXPLAIN SELECT COUNT(*) FROM order_items oi LEFT JOIN orders o ON o.id = oi.order_id WHERE o.id IS NULL;
EXPLAIN SELECT COUNT(*) FROM inventory_movements im LEFT JOIN products p ON p.id = im.product_id WHERE p.id IS NULL;
```

기록 위치:

- 결과 템플릿 6장 index 상태 기록
- 위험 요소 및 메모

## 5. 결과 저장 방식

dry-run 결과는 아래 문서를 복사해 실행 결과 문서로 작성한다.

원본 템플릿:

```text
docs/TENANT_STORE_DRY_RUN_RESULT_TEMPLATE.md
```

권장 결과 파일명:

```text
docs/TENANT_STORE_DRY_RUN_RESULT_YYYYMMDD.md
```

필수 기록:

- 실행 날짜
- 실행자
- 서버
- 대상 DB
- branch
- git commit hash
- backup 파일 위치
- SELECT-only 여부
- row count 결과
- duplicate 결과
- orphan 결과
- NULL 결과
- index 상태
- 위험 요소
- 최종 판정: SAFE / WARNING / BLOCKER

개인정보 기록 원칙:

- phone 전체값 기록 금지
- LINE userId 전체값 기록 금지
- token 전체값 기록 금지
- sample id는 필요한 경우 최소한으로 기록

## 6. 위험 신호(BLOCKER)

아래 항목은 BLOCKER로 간주할 수 있다.

| 위험 신호 | 설명 | 조치 |
|---|---|---|
| duplicate customer phone | phone 기준 고객 중복이 많아 backfill/unique 전환 위험 | 병합 금지. 원인 분석 먼저 |
| duplicate order_no | store scoped unique 전환 전 주문번호 충돌 위험 | 주문번호 생성 규칙 점검 |
| orphan rows | parent 없는 child row 존재 | backfill 전 원인 분석 |
| NULL critical fields | 필수 연결 키 누락 | 정상 NULL인지 확인 |
| LINE binding inconsistency | customer/staff LINE userId 충돌, LINE session 중복 | LINE flow 분리 전략 필요 |
| coupon issue duplicates | 1인 1회 쿠폰 정책 위반 가능성 | 자동 수정 금지, 케이스 분석 |
| purchase confirmation orphan | PDF/order/customer 연결 위험 | 구매확인서 보존 전략 필요 |
| inventory product orphan | 재고이력과 상품 연결 깨짐 | 재고 backfill 차단 가능 |
| staff orphan | attendance/KPI/payroll 계산 위험 | 직원 데이터 정리 필요 |

BLOCKER 원칙:

- BLOCKER가 있으면 migration SQL 작성 전 원인 분석을 먼저 한다.
- BLOCKER가 있으면 backfill 실행 금지.
- BLOCKER가 있으면 운영 반영 금지.

## 7. dry-run 후 단계

dry-run 이후 진행 순서:

1. 결과 문서 작성
2. 결과 리뷰
3. SAFE / WARNING / BLOCKER 판정
4. BLOCKER 해결 계획 수립
5. migration SQL 초안 작성
6. rollback SQL 초안 작성
7. staging rehearsal
8. rollback rehearsal
9. production approval
10. production 적용 window 결정

주의:

- dry-run 결과가 SAFE여도 바로 운영 DB를 변경하지 않는다.
- migration SQL은 별도 승인 후 작성한다.
- staging rehearsal 없이 production 진행 금지.
- rollback rehearsal 없이 production 진행 금지.

## 8. 최종 원칙

- dry-run은 SELECT-only다.
- dry-run은 실제 DB를 변경하지 않는다.
- dry-run 결과가 SAFE여도 운영 DB를 바로 변경하지 않는다.
- 반드시 staging rehearsal 후 production 진행한다.
- 운영 반영 전 DB backup, Git snapshot, rollback rehearsal이 필요하다.
- LINE-first 운영 흐름과 KINGWAY 台南 기존 업무 흐름을 깨면 안 된다.
- 고객/주문/수리/쿠폰/LINE binding 데이터는 임의 병합하거나 덮어쓰지 않는다.
