# Tenant / Store Schema Draft

## 1. 목적

KINGWAY 台南 獨立門市管理系統을 multi-tenant SaaS 구조로 전환하기 위한 실제 DB schema 초안이다.

이 문서는 설계 초안이며, 이 문서만으로 운영 DB에 적용하면 안 된다.

금지 사항:

- 운영 DB에 바로 적용 금지
- migration 즉시 실행 금지
- backfill 없는 `NOT NULL` 전환 금지
- unique key를 한 번에 재설계 금지
- rollback SQL 없이 운영 반영 금지

관련 기준 문서:

- `docs/KINGWAY_STORE_MASTER_SPEC.md`
- `docs/MULTI_TENANT_ARCHITECTURE.md`
- `docs/TENANT_STORE_TABLE_MAPPING.md`
- `docs/MULTI_TENANT_MIGRATION_PHASES.md`

## 2. tenants 테이블 초안

tenant는 SaaS 계약/운영 주체다. 한 tenant는 하나 이상의 store를 가질 수 있다.

```sql
CREATE TABLE tenants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(150) NOT NULL,
  status ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_tenants_code (code),
  INDEX idx_tenants_status (status)
);
```

필드 설명:

| 필드 | 설명 |
|---|---|
| `id` | 내부 PK |
| `code` | tenant 식별 코드. 예: `kingway` |
| `name` | tenant 표시명 |
| `status` | 사용 상태 |
| `created_at` | 생성일 |
| `updated_at` | 수정일 |

## 3. stores 테이블 초안

store는 실제 운영 매장/지점이다.

```sql
CREATE TABLE stores (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(100) NOT NULL,
  name VARCHAR(150) NOT NULL,
  region VARCHAR(100) NULL,
  address VARCHAR(255) NULL,
  phone VARCHAR(40) NULL,
  status ENUM('ACTIVE', 'INACTIVE', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_stores_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  UNIQUE KEY uk_stores_tenant_code (tenant_id, code),
  INDEX idx_stores_tenant_status (tenant_id, status),
  INDEX idx_stores_region (region)
);
```

필드 설명:

| 필드 | 설명 |
|---|---|
| `id` | 내부 PK |
| `tenant_id` | 소속 tenant |
| `code` | store 식별 코드. 예: `kingway-tainan` |
| `name` | 매장명 |
| `region` | 지역. 예: `台南` |
| `address` | 매장 주소 |
| `phone` | 매장 전화번호 |
| `status` | 매장 상태 |
| `created_at` | 생성일 |
| `updated_at` | 수정일 |

## 4. 현재 KINGWAY 台南 seed 값

기존 운영 데이터는 최초 전환 시 아래 seed tenant/store에 귀속한다.

```sql
-- 설계 예시. 운영 DB에 바로 실행 금지.
INSERT INTO tenants (code, name, status)
VALUES ('kingway', 'KINGWAY', 'ACTIVE');

INSERT INTO stores (tenant_id, code, name, region, address, phone, status)
VALUES (
  {kingway_tenant_id},
  'kingway-tainan',
  'KINGWAY 台南',
  '台南',
  '台南市東區東門路二段245號',
  NULL,
  'ACTIVE'
);
```

seed 원칙:

- tenant code: `kingway`
- store code: `kingway-tainan`
- locale: `zh-TW`
- timezone: `Asia/Taipei`
- currency: `TWD`
- 기존 operational data는 모두 이 seed store에 귀속
- backfill 전 dry-run row count 필수

## 5. staff/users와 store 연결 방식

현재 주요 직원 테이블은 `staff_users`다.

### 5-1. 1차 초안: staff_users에 store_id 추가

```sql
ALTER TABLE staff_users
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL,
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_staff_users_tenant (tenant_id),
  ADD INDEX idx_staff_users_store (store_id),
  ADD INDEX idx_staff_users_store_role (store_id, role);
```

의미:

| 필드 | 설명 |
|---|---|
| `tenant_id` | 직원 소속 tenant |
| `store_id` | 직원 기본 소속 store |
| `role` | 현재 role 유지: `ADMIN`, `MANAGER`, `CASHIER`, `REPAIR`, `INVENTORY` |

### 5-2. 본사 관리자 예외 처리

본사/platform 관리자는 특정 store 하나에만 묶이지 않을 수 있다.

권장 방식:

- 일반 매장 직원: `tenant_id` + `store_id` 필수
- 매장 관리자: `tenant_id` + `store_id` 필수
- 본사 관리자: `tenant_id`는 있고 `store_id`는 NULL 허용 가능
- SaaS platform admin: 별도 `is_platform_admin` 또는 별도 권한 테이블 검토

장기적으로는 다중 매장 권한을 위해 join table이 더 안전하다.

```sql
CREATE TABLE staff_store_access (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  staff_user_id BIGINT UNSIGNED NOT NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NULL,
  role VARCHAR(50) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_staff_store_access (staff_user_id, tenant_id, store_id),
  INDEX idx_staff_store_access_staff (staff_user_id),
  INDEX idx_staff_store_access_store (store_id),
  INDEX idx_staff_store_access_tenant_role (tenant_id, role)
);
```

1차 전환에서는 `staff_users.store_id`를 우선 사용하고, 100개 매장 운영이 본격화되면 `staff_store_access`로 확장하는 방식을 권장한다.

## 6. 주요 운영 테이블 nullable store_id 추가 초안

처음에는 반드시 nullable로 추가한다.

### 6-1. customers

```sql
ALTER TABLE customers
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL,
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_customers_tenant (tenant_id),
  ADD INDEX idx_customers_store (store_id),
  ADD INDEX idx_customers_store_phone (store_id, phone),
  ADD INDEX idx_customers_store_line_user (store_id, line_user_id);
```

주의:

- 기존 `line_user_id UNIQUE`는 바로 제거하지 않는다.
- phone / LINE userId는 backfill과 중복 검증 후 store scope unique로 재설계한다.
- 고객 병합 금지.

### 6-2. orders

```sql
ALTER TABLE orders
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL,
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_orders_tenant (tenant_id),
  ADD INDEX idx_orders_store (store_id),
  ADD INDEX idx_orders_store_business_date (store_id, business_date),
  ADD INDEX idx_orders_store_order_no (store_id, order_no),
  ADD INDEX idx_orders_store_customer (store_id, customer_id);
```

주의:

- `order_no UNIQUE`는 store scope로 재설계 필요.
- 예약금/잔금/완납 흐름은 store scope 안에서만 조회한다.
- 구매확인은 완납 후 시작.

### 6-3. order_items

```sql
ALTER TABLE order_items
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL,
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_order_items_tenant (tenant_id),
  ADD INDEX idx_order_items_store (store_id),
  ADD INDEX idx_order_items_store_order (store_id, order_id),
  ADD INDEX idx_order_items_store_product (store_id, product_id),
  ADD INDEX idx_order_items_store_category (store_id, product_category_snapshot);
```

주의:

- `order_id`로 store를 파생할 수 있지만, query safety를 위해 직접 컬럼을 둔다.
- `product_category_snapshot = REPAIR`가 있으면 수리 주문으로 유지.

### 6-4. repair_orders

```sql
ALTER TABLE repair_orders
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL,
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_repair_orders_tenant (tenant_id),
  ADD INDEX idx_repair_orders_store (store_id),
  ADD INDEX idx_repair_orders_store_status (store_id, status, reservation_date),
  ADD INDEX idx_repair_orders_store_customer (store_id, customer_id);
```

주의:

- LINE 예약, staff 승인, 견적, 완료 알림 모두 store scope 필수.
- `order_id` 연결 시 같은 store인지 검증 필요.

### 6-5. products

```sql
ALTER TABLE products
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL,
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_products_tenant (tenant_id),
  ADD INDEX idx_products_store (store_id),
  ADD INDEX idx_products_store_category (store_id, category),
  ADD INDEX idx_products_store_stock (store_id, stock, reorder_level),
  ADD INDEX idx_products_store_sku (store_id, sku);
```

주의:

- 현재 `sku UNIQUE`는 store 또는 tenant scope로 재설계 필요.
- visible category label은 반드시 zh-TW 유지.
- product image path도 store/tenant 분리 필요.

### 6-6. inventory_movements

```sql
ALTER TABLE inventory_movements
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL,
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_inventory_movements_tenant (tenant_id),
  ADD INDEX idx_inventory_movements_store (store_id),
  ADD INDEX idx_inventory_movements_store_product (store_id, product_id, created_at),
  ADD INDEX idx_inventory_movements_store_reference (store_id, reference_type, reference_id);
```

주의:

- product의 store와 movement의 store가 반드시 같아야 한다.
- 입고/출고/조정/판매/발주 입고 모두 store scope 필수.

### 6-7. coupons

```sql
ALTER TABLE coupons
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL,
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_coupons_tenant (tenant_id),
  ADD INDEX idx_coupons_store (store_id),
  ADD INDEX idx_coupons_store_customer_type (store_id, customer_id, coupon_type),
  ADD INDEX idx_coupons_store_status (store_id, status),
  ADD INDEX idx_coupons_store_code (store_id, code);
```

주의:

- 신규친구 쿠폰: tenant/store 기준 1인 1회.
- Google 리뷰 쿠폰: 자동발급 금지, staff 승인 후 발급.
- EBIKE category only 유지.
- `code UNIQUE`는 전역 유지 또는 store scope 전환 여부를 별도 결정.

### 6-8. purchase_confirmations

```sql
ALTER TABLE purchase_confirmations
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL,
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_purchase_confirmations_tenant (tenant_id),
  ADD INDEX idx_purchase_confirmations_store (store_id),
  ADD INDEX idx_purchase_confirmations_store_order (store_id, order_id),
  ADD INDEX idx_purchase_confirmations_store_customer (store_id, customer_id),
  ADD INDEX idx_purchase_confirmations_store_status (store_id, status, created_at);
```

주의:

- PDF path는 store/tenant별 경로로 분리해야 한다.
- public token 조회에서 cross-store leakage 방지 필요.

### 6-9. purchase_confirmation_tokens

```sql
ALTER TABLE purchase_confirmation_tokens
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL,
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_purchase_confirmation_tokens_tenant (tenant_id),
  ADD INDEX idx_purchase_confirmation_tokens_store (store_id),
  ADD INDEX idx_purchase_confirmation_tokens_store_token (store_id, token),
  ADD INDEX idx_purchase_confirmation_tokens_store_order (store_id, order_id);
```

주의:

- token은 tenant-bound signed token으로 전환 권장.
- token 전역 unique 유지 여부는 보안 정책에 따라 결정.

### 6-10. attendance

현재 테이블명은 `staff_attendance`다.

```sql
ALTER TABLE staff_attendance
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL,
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_staff_attendance_tenant (tenant_id),
  ADD INDEX idx_staff_attendance_store (store_id),
  ADD INDEX idx_staff_attendance_store_staff (store_id, staff_user_id, check_in_at);
```

주의:

- 직원의 근무 store 기준으로 기록한다.
- 본사 관리자가 여러 store를 보는 경우도 조회 scope 필요.

### 6-11. kpi / payroll

현재 KPI 테이블은 `staff_kpi_logs`다. payroll은 별도 테이블 없이 `staff_users + staff_attendance` 기반 summary route가 있다.

```sql
ALTER TABLE staff_kpi_logs
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL,
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_staff_kpi_logs_tenant (tenant_id),
  ADD INDEX idx_staff_kpi_logs_store (store_id),
  ADD INDEX idx_staff_kpi_logs_store_staff (store_id, staff_user_id, created_at),
  ADD INDEX idx_staff_kpi_logs_store_ref (store_id, ref_type, ref_id);
```

주의:

- `ref_type/ref_id`가 polymorphic이므로 store_id가 없으면 cross-store 집계 위험.
- payroll summary는 staff_attendance store scope를 기준으로 계산한다.

### 6-12. suppliers

현재 별도 `suppliers` 테이블은 없고, `supplier_requests.supplier_name` 문자열을 사용한다.

1차 대상:

```sql
ALTER TABLE supplier_requests
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL,
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_supplier_requests_tenant (tenant_id),
  ADD INDEX idx_supplier_requests_store (store_id),
  ADD INDEX idx_supplier_requests_store_status (store_id, status, created_at),
  ADD INDEX idx_supplier_requests_store_supplier (store_id, supplier_name);

ALTER TABLE supplier_request_items
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL,
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_supplier_request_items_tenant (tenant_id),
  ADD INDEX idx_supplier_request_items_store (store_id),
  ADD INDEX idx_supplier_request_items_store_request (store_id, supplier_request_id),
  ADD INDEX idx_supplier_request_items_store_product (store_id, product_id);
```

장기 초안:

```sql
CREATE TABLE suppliers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NULL,
  code VARCHAR(100) NOT NULL,
  name VARCHAR(150) NOT NULL,
  contact_name VARCHAR(120) NULL,
  phone VARCHAR(40) NULL,
  line_group_id VARCHAR(100) NULL,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_suppliers_tenant_code (tenant_id, code),
  INDEX idx_suppliers_store (store_id),
  INDEX idx_suppliers_name (name)
);
```

주의:

- 1차 전환에서는 기존 `supplier_name` 유지 가능.
- 100개 매장 SaaS에서는 supplier master 분리가 필요할 가능성이 높다.

### 6-13. LINE / Telegram 관련 테이블

대상:

- `line_group_registrations`
- `line_chat_sessions`
- `v2_workflow_events`

```sql
ALTER TABLE line_group_registrations
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL,
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_line_group_registrations_tenant (tenant_id),
  ADD INDEX idx_line_group_registrations_store (store_id),
  ADD INDEX idx_line_group_registrations_store_type (store_id, registration_type);

ALTER TABLE line_chat_sessions
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL,
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_line_chat_sessions_tenant (tenant_id),
  ADD INDEX idx_line_chat_sessions_store (store_id),
  ADD INDEX idx_line_chat_sessions_store_user_flow (store_id, line_user_id, flow_type);

ALTER TABLE v2_workflow_events
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL,
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_v2_workflow_events_tenant (tenant_id),
  ADD INDEX idx_v2_workflow_events_store (store_id),
  ADD INDEX idx_v2_workflow_events_store_ref (store_id, ref_type, ref_id, created_at);
```

주의:

- LINE webhook은 tenant/store resolution 후 처리해야 한다.
- LINE group id unique는 tenant/store 범위 재검토 필요.
- Telegram은 legacy 잔존 흐름만 scope 검증하고 새 workflow를 추가하지 않는다.

## 7. index 설계

### 7-1. 기본 index

모든 주요 운영 테이블에 아래 중 하나 이상을 둔다.

```sql
INDEX idx_{table}_tenant (tenant_id)
INDEX idx_{table}_store (store_id)
```

조회가 많은 테이블은 복합 index를 우선한다.

### 7-2. customer phone + store_id

```sql
INDEX idx_customers_store_phone (store_id, phone)
```

추후 중복 검증 후 unique 검토:

```sql
UNIQUE KEY uk_customers_store_phone (store_id, phone)
```

주의:

- phone이 NULL인 고객이 존재한다.
- OFFLINE_NO_PHONE 고객 때문에 바로 unique 적용하면 안 된다.
- phone normalization 정책 확정 필요.

### 7-3. order_no + store_id

```sql
INDEX idx_orders_store_order_no (store_id, order_no)
```

추후 전환 후보:

```sql
UNIQUE KEY uk_orders_store_order_no (store_id, order_no)
```

주의:

- 기존 `order_no UNIQUE`와 충돌 가능.
- POS/LINE/수리 견적 주문번호 생성 규칙을 store별로 검증해야 한다.

### 7-4. coupon type + customer + store_id

```sql
INDEX idx_coupons_store_customer_type (store_id, customer_id, coupon_type)
```

추후 정책 확정 후 unique 후보:

```sql
UNIQUE KEY uk_coupons_store_customer_type (store_id, customer_id, coupon_type)
```

주의:

- 신규친구 쿠폰과 Google 리뷰 쿠폰은 각각 1인 1회.
- used/rejected 상태까지 unique로 막을지 정책 결정 필요.
- Google 리뷰 재신청 정책과 충돌하지 않게 검토 필요.

## 8. unique key 재설계 주의사항

현재 전역 unique 가능성이 있는 항목:

- `staff_users.username`
- `staff_users.line_user_id`
- `customers.line_user_id`
- `products.sku`
- `orders.order_no`
- `coupons.code`
- `purchase_confirmations.token`
- `purchase_confirmation_tokens.token`
- `line_group_registrations.line_group_id`
- `line_chat_sessions.line_user_id + flow_type`

재설계 원칙:

- 운영 중 바로 drop하지 않는다.
- 먼저 duplicate dry-run을 수행한다.
- store scope unique로 바꿀지 tenant scope unique로 바꿀지 테이블별로 결정한다.
- public token류는 보안상 전역 unique 유지가 더 안전할 수 있다.
- customer identity는 tenant 기준으로 공유할지 store 기준으로 분리할지 먼저 결정한다.

권장 초안:

| 항목 | 권장 unique 범위 | 비고 |
|---|---|---|
| `staff_users.username` | tenant | 본사/매장 직원 로그인 충돌 방지 |
| `staff_users.line_user_id` | tenant 또는 global | 같은 LINE 직원 계정을 여러 tenant에서 쓸지 결정 필요 |
| `customers.line_user_id` | tenant | cross-store 고객 공유 여부 결정 전까지 tenant 기준 |
| `customers.phone` | store 또는 tenant | phone normalization 후 적용 |
| `products.sku` | store | 매장별 SKU 운영 가능성 고려 |
| `orders.order_no` | store | store별 prefix 권장 |
| `coupons.code` | global 또는 store | 고객 입력 쿠폰이면 global이 안전 |
| `purchase_confirmation_tokens.token` | global | public token 보안상 global 권장 |
| `line_group_registrations.line_group_id` | tenant | 같은 LINE group 재사용 가능성 낮음 |
| `line_chat_sessions.line_user_id + flow_type` | store | LINE flow 세션 분리 필요 |

## 9. migration 원칙

### 9-1. 처음에는 nullable

모든 주요 테이블의 `tenant_id`, `store_id`는 처음에 nullable로 추가한다.

이유:

- 기존 row backfill 전 서비스 중단 방지
- migration lock 위험 축소
- 단계별 검증 가능
- rollback 가능성 확보

### 9-2. backfill 후 검증

backfill은 seed store 기준으로 시작한다.

검증 항목:

- 각 테이블 row count
- `tenant_id IS NULL` count
- `store_id IS NULL` count
- customer/order/repair/coupon/PDF 연결
- LINE binding 고객 조회
- REPAIR 포함 주문의 수리관리 표시
- inventory movement와 product store 일치
- coupon one-per-customer 정책 유지

### 9-3. 검증 후 NOT NULL

아래 조건을 만족한 뒤에만 `NOT NULL`을 검토한다.

- P0 테이블 null count가 0
- 신규 생성 API가 tenant/store를 항상 기록
- staging에서 end-to-end flow 통과
- rollback rehearsal 완료
- 운영 백업 완료

### 9-4. rollback SQL 별도 준비

각 migration은 별도 rollback SQL을 준비한다.

rollback 예시 범위:

- 신규 index 제거
- 신규 nullable column 제거
- seed tenant/store 제거
- backfill 값 null 복구
- unique key 원복

운영에서는 부분 rollback보다 DB 백업 restore가 더 안전할 수 있다.

## 10. 운영 적용 금지 원칙

이 schema draft를 운영 DB에 바로 적용하지 않는다.

운영 반영 전 필수 조건:

- DB full backup
- Git snapshot
- staging restore test
- migration rehearsal
- rollback rehearsal
- 주요 flow 검증
- LINE webhook 검증
- POS 주문 검증
- 수리관리 검증
- 쿠폰 발급/승인 검증
- 구매확인 PDF 검증

최종 원칙:

- 설계
- staging
- dry-run
- backfill
- 검증
- rollback rehearsal
- 운영 반영

이 순서를 건너뛰지 않는다.
