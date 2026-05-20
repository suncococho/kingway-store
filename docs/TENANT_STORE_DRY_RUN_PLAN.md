# Tenant / Store Dry-Run Plan

## 1. dry-run 목적

KINGWAY multi-tenant 전환 전, 실제 DB를 변경하지 않고 현재 데이터 상태와 `tenant_id` / `store_id` backfill 위험을 확인한다.

dry-run의 목적은 다음과 같다.

- 현재 테이블별 row count 확인
- KINGWAY 台南 seed store로 귀속 가능한 데이터 범위 확인
- `store_id` backfill 전 orphan / duplicate / NULL 위험 확인
- 고객, LINE binding, 주문번호, 쿠폰 정책 충돌 가능성 확인
- migration 실행 전 rollback rehearsal 준비 수준 확인
- 운영 DB 변경 없이 보고서만 생성

이 문서는 dry-run 계획서이며, 실제 DB 변경을 승인하지 않는다.

## 2. DB 변경 없이 확인할 항목

dry-run에서 허용되는 작업:

- `SELECT`
- `COUNT`
- `GROUP BY`
- `LEFT JOIN` 기반 orphan 확인
- duplicate 후보 조회
- NULL 비율 확인
- index / column metadata 조회
- report 파일 또는 문서 작성

dry-run에서 금지되는 작업:

- `UPDATE`
- `ALTER`
- `DELETE`
- `INSERT`
- `TRUNCATE`
- migration 실행
- FK / index 변경
- 운영 서버 재시작
- docker-compose 수정

원칙:

- dry-run은 read-only여야 한다.
- 실제 운영 DB에 어떤 값도 쓰지 않는다.
- dry-run 결과는 migration 설계와 rollback rehearsal 입력 자료로만 사용한다.

## 3. 테이블별 row count 확인 계획

기본 row count 대상은 `database/schema.sql` 기준 전체 테이블이다.

| 테이블명 | 확인 내용 | 목적 |
|---|---|---|
| `staff_users` | 전체 직원 수, active/inactive 수 | 직원/store 귀속 범위 확인 |
| `customers` | 전체 고객 수, LINE/phone/null phone 수 | 고객 backfill 및 identity 위험 확인 |
| `products` | 전체 상품 수, active/inactive 수, category별 수 | SKU/store scope 위험 확인 |
| `orders` | 전체 주문 수, 상태별/일자별 수 | 주문 backfill 범위 확인 |
| `order_items` | 전체 주문품목 수, category snapshot별 수 | REPAIR 주문 분류 확인 |
| `inventory_movements` | 전체 재고이력 수, movement type별 수 | product 연결 및 stock 이력 확인 |
| `line_group_registrations` | 전체 LINE group 수, type별 수 | LINE group store 귀속 확인 |
| `purchase_confirmations` | 전체 구매확인서 수, status별 수, PDF 보유 수 | PDF/customer/order 연결 확인 |
| `purchase_confirmation_tokens` | 전체 token 수, used/unused/expired 수 | token leakage 위험 확인 |
| `repair_orders` | 전체 수리공單 수, status별 수 | 수리 workflow backfill 범위 확인 |
| `repair_logs` | 전체 수리 로그 수 | repair order orphan 확인 |
| `coupons` | 전체 쿠폰 수, type/status/used별 수 | 쿠폰 중복/정책 위험 확인 |
| `surveys` | 전체 설문 수 | customer/order 연결 확인 |
| `staff_attendance` | 전체 출퇴근 기록 수 | payroll/KPI 연결 확인 |
| `staff_kpi_logs` | 전체 KPI 로그 수 | polymorphic ref 위험 확인 |
| `app_settings` | scope별 설정 수 | store/system 설정 분리 필요 확인 |
| `purchase_confirmation_requests` | 전체 요청 수, status별 수 | legacy 테이블 유지 여부 판단 |
| `customer_crm_events` | 전체 CRM event 수 | customer orphan 확인 |
| `follow_up_tasks` | 전체 follow-up task 수, status별 수 | customer/staff 연결 확인 |
| `supplier_requests` | 전체 발주/반품 수, status별 수 | supplier flow backfill 범위 확인 |
| `supplier_request_items` | 전체 발주/반품 품목 수 | product/request orphan 확인 |
| `operational_checklists` | 전체 checklist 수, 날짜별 수 | staff/store 귀속 확인 |
| `v2_workflow_events` | 전체 workflow event 수, event/ref type별 수 | audit/log scope 위험 확인 |
| `line_chat_sessions` | 전체 LINE session 수, flow별 수 | LINE flow session 중복 위험 확인 |

권장 SQL 예시:

```sql
SELECT 'customers' AS table_name, COUNT(*) AS row_count FROM customers;
SELECT customer_type, COUNT(*) FROM customers GROUP BY customer_type;
SELECT status, COUNT(*) FROM orders GROUP BY status;
SELECT product_category_snapshot, COUNT(*) FROM order_items GROUP BY product_category_snapshot;
```

## 4. store_id backfill 대상 테이블 목록

P0 backfill 대상:

- `staff_users`
- `customers`
- `products`
- `orders`
- `order_items`
- `inventory_movements`
- `line_group_registrations`
- `purchase_confirmations`
- `purchase_confirmation_tokens`
- `repair_orders`
- `repair_logs`
- `coupons`
- `staff_attendance`
- `staff_kpi_logs`
- `app_settings`
- `customer_crm_events`
- `follow_up_tasks`
- `supplier_requests`
- `supplier_request_items`
- `v2_workflow_events`
- `line_chat_sessions`

P1 backfill 대상:

- `surveys`
- `purchase_confirmation_requests`
- `operational_checklists`

장기/조건부 대상:

- future `suppliers`
- future `staff_store_access`
- future tenant/store-specific notification settings

## 5. KINGWAY 台南 seed store 기준

dry-run은 기존 모든 운영 데이터를 아래 seed tenant/store에 귀속한다는 가정으로 검증한다.

- tenant code: `kingway`
- store code: `kingway-tainan`
- store name: `KINGWAY 台南`
- locale: `zh-TW`
- timezone: `Asia/Taipei`
- currency: `TWD`

dry-run에서 확인할 seed 전제:

- 기존 데이터는 단일 독립 매장 KINGWAY 台南 기준으로 생성되었다.
- 기존 customers/orders/repairs/products/coupons는 seed store로 backfill 가능해야 한다.
- LINE group/session도 seed store 기준으로 귀속 가능해야 한다.
- Telegram 잔존 데이터가 있으면 seed store 기준으로만 해석하고 새 workflow로 확장하지 않는다.

## 6. NULL / orphan / duplicate 데이터 확인 항목

### 6-1. NULL 확인

확인 대상:

- `customers.phone`
- `customers.line_user_id`
- `orders.customer_id`
- `orders.customer_phone`
- `orders.created_by`
- `order_items.order_id`
- `order_items.product_id`
- `repair_orders.customer_id`
- `repair_orders.order_id`
- `coupons.customer_id`
- `coupons.order_id`
- `coupons.approved_by_staff_id`
- `purchase_confirmations.order_id`
- `purchase_confirmations.customer_id`
- `purchase_confirmations.pdf_path`
- `staff_users.line_user_id`
- `supplier_requests.requested_by_staff_id`
- `supplier_request_items.product_id`
- `line_chat_sessions.line_user_id`

주의:

- NULL 자체가 항상 오류는 아니다.
- offline customer, manual purchase confirmation, pending coupon 등 정상 NULL 가능성을 구분한다.
- backfill 위험은 "정상 NULL"과 "연결 누락 NULL"을 분리해 판단한다.

### 6-2. orphan 확인

권장 확인:

```sql
-- orders.customer_id orphan
SELECT COUNT(*) AS orphan_orders
FROM orders o
LEFT JOIN customers c ON c.id = o.customer_id
WHERE o.customer_id IS NOT NULL
  AND c.id IS NULL;

-- order_items.order_id orphan
SELECT COUNT(*) AS orphan_order_items
FROM order_items oi
LEFT JOIN orders o ON o.id = oi.order_id
WHERE o.id IS NULL;

-- order_items.product_id orphan
SELECT COUNT(*) AS orphan_order_item_products
FROM order_items oi
LEFT JOIN products p ON p.id = oi.product_id
WHERE p.id IS NULL;

-- repair_orders.customer_id orphan
SELECT COUNT(*) AS orphan_repairs
FROM repair_orders ro
LEFT JOIN customers c ON c.id = ro.customer_id
WHERE c.id IS NULL;

-- coupons.customer_id orphan
SELECT COUNT(*) AS orphan_coupons
FROM coupons cp
LEFT JOIN customers c ON c.id = cp.customer_id
WHERE c.id IS NULL;
```

추가 orphan 대상:

- `inventory_movements.product_id`
- `inventory_movements.created_by`
- `repair_logs.repair_order_id`
- `purchase_confirmations.order_id`
- `purchase_confirmations.customer_id`
- `purchase_confirmation_tokens.order_id`
- `purchase_confirmation_tokens.customer_id`
- `surveys.customer_id`
- `surveys.order_id`
- `staff_attendance.staff_user_id`
- `staff_kpi_logs.staff_user_id`
- `supplier_requests.requested_by_staff_id`
- `supplier_request_items.supplier_request_id`
- `supplier_request_items.product_id`
- `customer_crm_events.customer_id`
- `follow_up_tasks.customer_id`
- `operational_checklists.staff_user_id`

### 6-3. duplicate 확인

중복 위험 확인 대상:

- customer phone
- customer LINE userId
- staff username
- staff LINE userId
- product SKU
- order_no
- coupon code
- purchase confirmation token
- LINE group id
- LINE chat session user/flow

권장 SQL 예시:

```sql
SELECT phone, COUNT(*) AS cnt
FROM customers
WHERE phone IS NOT NULL AND phone <> ''
GROUP BY phone
HAVING COUNT(*) > 1;

SELECT line_user_id, COUNT(*) AS cnt
FROM customers
WHERE line_user_id IS NOT NULL AND line_user_id <> ''
GROUP BY line_user_id
HAVING COUNT(*) > 1;

SELECT order_no, COUNT(*) AS cnt
FROM orders
GROUP BY order_no
HAVING COUNT(*) > 1;

SELECT code, COUNT(*) AS cnt
FROM coupons
GROUP BY code
HAVING COUNT(*) > 1;
```

## 7. LINE user / customer phone / order_no / coupon issue 중복 위험 확인

### 7-1. LINE user 위험

확인 항목:

- `customers.line_user_id` 중복
- `staff_users.line_user_id` 중복
- customer와 staff가 같은 LINE userId를 공유하는 사례
- `line_chat_sessions.line_user_id + flow_type` 중복
- `line_group_registrations.line_group_id` 중복

주의:

- LINE userId는 고객 onboarding, phone binding, 쿠폰, 수리예약, 구매확인에서 핵심 키다.
- tenant/store scope 전환 전 중복 위험을 반드시 확인한다.

### 7-2. customer phone 위험

확인 항목:

- 동일 phone 고객 수
- phone NULL 고객 수
- phone format 불일치
- `+886`, `886`, `09` normalization 후 중복 후보
- orders.customer_phone과 customers.phone 불일치

주의:

- phone backfill은 보수적으로 수행한다.
- 기존 non-null phone 또는 LINE userId를 덮어쓰지 않는다.
- Chinese text가 깨져 보이면 placeholder로 단정하지 말고 저장 byte를 확인한다.

### 7-3. order_no 위험

확인 항목:

- `orders.order_no` 중복
- POS/LINE/수리 견적 주문번호 prefix 분포
- NULL 또는 빈 order_no 여부
- 날짜 기반 order_no 충돌 가능성

주의:

- store별 unique 전환 시 기존 전역 unique와 충돌하지 않아야 한다.
- 100개 매장 SaaS에서는 store별 prefix 또는 sequence 전략이 필요하다.

### 7-4. coupon issue 위험

확인 항목:

- 고객별 `new_friend` 쿠폰 개수
- 고객별 `google_review` 쿠폰 개수
- used/rejected/pending 상태별 중복
- EBIKE 전용 쿠폰의 eligible category 누락
- coupon.order_id orphan
- 승인자 staff orphan

권장 SQL 예시:

```sql
SELECT customer_id, coupon_type, COUNT(*) AS cnt
FROM coupons
GROUP BY customer_id, coupon_type
HAVING COUNT(*) > 1;
```

주의:

- 신규친구 쿠폰은 NT$500, LINE friend add + phone binding, 1인 1회.
- Google 리뷰 쿠폰은 NT$1500, 자동발급 금지, staff 승인 후 발급, 1인 1회.
- dry-run에서는 중복 후보만 보고하고 자동 수정하지 않는다.

## 8. backfill 전후 비교 방식

dry-run 단계에서는 실제 backfill을 하지 않는다. 대신 "backfill 예상 결과"를 계산한다.

비교 방식:

1. backfill 전 row count
2. seed store로 귀속 가능한 row count
3. parent 기준으로 귀속 가능한 child row count
4. orphan으로 인해 귀속 불확실한 row count
5. duplicate로 인해 unique 전환 위험이 있는 row count
6. 정상 NULL과 위험 NULL 분리
7. 예상 backfill 후 `store_id IS NULL` 잔여 수 추정

예상 보고 예시:

| 테이블 | row_count | seed_backfill_expected | orphan_risk | duplicate_risk | expected_null_after_backfill | 판단 |
|---|---:|---:|---:|---:|---:|---|
| `customers` | 1000 | 1000 | 0 | 12 | 0 | phone duplicate 확인 필요 |
| `orders` | 5000 | 5000 | 3 | 0 | 0 | customer orphan 확인 필요 |
| `order_items` | 9000 | 8995 | 5 | 0 | 5 | order/product orphan 처리 필요 |

## 9. dry-run report 형식

dry-run report는 실제 SQL 실행 결과를 아래 형식으로 정리한다.

권장 파일명:

```text
tenant-store-dry-run-report-{YYYYMMDD-HHmm}.md
```

권장 섹션:

```md
# Tenant Store Dry-Run Report

## 실행 정보
- 실행일:
- 대상 DB:
- 실행자:
- branch:
- commit hash:
- read-only 여부:

## Seed 기준
- tenant code:
- store code:
- store name:

## Row Count Summary
| table | row_count | note |
|---|---:|---|

## NULL Summary
| table | column | null_count | expected | note |
|---|---|---:|---|---|

## Orphan Summary
| relation | orphan_count | sample_ids | risk |
|---|---:|---|---|

## Duplicate Summary
| key | duplicate_group_count | affected_rows | risk |
|---|---:|---:|---|

## Backfill Estimate
| table | expected_backfill_rows | expected_remaining_null | blocker |
|---|---:|---:|---|

## Flow Risk Summary
- LINE:
- Customers:
- Orders:
- Repairs:
- Coupons:
- Inventory:
- Suppliers:
- Staff/KPI:

## 결론
- 진행 가능:
- 선행 정리 필요:
- migration 전 필수 확인:
```

주의:

- report는 read-only query 결과만 포함한다.
- sample id를 포함할 경우 개인정보 노출을 최소화한다.
- 고객 전화번호 전체값을 노출하지 않고 masking한다.

## 10. rollback rehearsal 전제 조건

rollback rehearsal은 dry-run report 이후 진행한다.

전제 조건:

- 운영 DB full backup 절차가 문서화되어 있어야 한다.
- staging DB restore가 가능해야 한다.
- Git snapshot 기준이 있어야 한다.
- migration forward SQL과 rollback SQL이 모두 준비되어야 한다.
- rollback 후 row count 비교 기준이 있어야 한다.
- LINE webhook/POS/수리/쿠폰 주요 flow smoke test가 준비되어야 한다.

rollback rehearsal에서 확인할 것:

- tenants/stores 생성 rollback
- nullable 컬럼 추가 rollback
- index 추가 rollback
- backfill rollback 또는 full restore
- unique key 변경 rollback
- API scope 변경 Git rollback
- LINE webhook 정상 복구

## 11. 실제 UPDATE/ALTER/DELETE 금지 원칙

dry-run 단계에서는 절대 실제 변경 SQL을 실행하지 않는다.

금지 SQL:

```sql
UPDATE ...
ALTER TABLE ...
DELETE FROM ...
INSERT INTO ...
TRUNCATE TABLE ...
DROP TABLE ...
CREATE INDEX ...
DROP INDEX ...
```

허용 SQL:

```sql
SELECT ...
SHOW COLUMNS ...
SHOW INDEX ...
EXPLAIN SELECT ...
```

최종 원칙:

- dry-run은 관찰만 한다.
- dry-run은 데이터를 고치지 않는다.
- dry-run은 migration을 실행하지 않는다.
- dry-run은 운영 서버를 재시작하지 않는다.
- dry-run 결과가 승인된 뒤에만 별도 migration 계획으로 이동한다.
