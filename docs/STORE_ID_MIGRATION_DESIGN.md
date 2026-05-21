# Store ID Migration Design

## 1. 현재 상태

현재 KINGWAY 시스템의 주요 운영 테이블에는 `store_id`가 없다.

1차 확인 대상 테이블:
- `customers`
- `orders`
- `repair_orders`
- `products`
- `coupons`

현재 구조는 single-tenant KINGWAY 台南 운영 구조이며, 하나의 매장 데이터를 전제로 고객, 주문, 수리, 상품, 쿠폰 데이터가 운영되고 있다.

## 2. 목표

- 100개 매장을 하나의 공통 시스템에서 운영한다.
- 모든 매장 데이터는 `store_id` 기준으로 분리한다.
- 매장별 코드 복사본을 만들지 않고 공통 코드베이스를 유지한다.
- KINGWAY 台南 기존 운영 데이터는 기본 매장 데이터로 보존한다.

## 3. 기본 원칙

- code is shared
- data is scoped by `store_id`
- all business queries must include `store_id`
- production migration은 staging rehearsal 후에만 진행한다.

## 4. `stores` 테이블 초안

```sql
CREATE TABLE stores (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  plan VARCHAR(32) NOT NULL DEFAULT 'standard',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_stores_code (code)
);
```

초기 기본 매장 후보:
- `id`: 1
- `code`: `kingway-tainan`
- `name`: `KINGWAY 台南`
- `status`: `active`
- `plan`: `standard`

## 5. `store_id` 추가 대상 1차 테이블

1차 migration 대상:
- `customers`
- `orders`
- `order_items`
- `repair_orders`
- `products`
- `coupons`
- `inventory_movements`
- `staff_users`
- `supplier_requests`
- `purchase_confirmations`

각 테이블에는 기본적으로 nullable `store_id`를 먼저 추가하고, backfill과 query scope 적용이 완료된 후 `NOT NULL` 전환을 검토한다.

## 6. Migration 전략

### Step 1. nullable `store_id` 추가

1차 대상 테이블에 nullable `store_id` 컬럼을 추가한다.

초기 컬럼 형태 후보:
```sql
ALTER TABLE customers ADD COLUMN store_id BIGINT UNSIGNED NULL;
```

각 테이블에는 이후 FK와 index 추가를 검토한다.

### Step 2. KINGWAY 台南 기본 store 생성

`stores` 테이블에 KINGWAY 台南 기본 매장을 생성한다.

```sql
INSERT INTO stores (id, code, name, status, plan)
VALUES (1, 'kingway-tainan', 'KINGWAY 台南', 'active', 'standard');
```

실제 production 적용 시에는 기존 `id=1` 충돌 여부를 먼저 확인해야 한다.

### Step 3. 기존 데이터 backfill

기존 single-tenant 운영 데이터는 모두 KINGWAY 台南 데이터로 보고 `store_id=1`을 backfill한다.

예:
```sql
UPDATE customers
SET store_id = 1
WHERE store_id IS NULL;
```

주의:
- production에서는 dry run과 row count 검증 후 진행한다.
- `store_id` 없는 bulk update는 금지한다.
- backfill 대상 row 수를 테이블별로 기록한다.

### Step 4. index 추가

주요 business query 기준으로 `store_id` 포함 index를 추가한다.

후보:
- `customers(store_id, phone)`
- `customers(store_id, line_user_id)`
- `orders(store_id, customer_id)`
- `orders(store_id, status)`
- `repair_orders(store_id, customer_id)`
- `repair_orders(store_id, status)`
- `products(store_id, sku)`
- `products(store_id, category)`
- `coupons(store_id, customer_id)`
- `inventory_movements(store_id, product_id)`

### Step 5. API query에 `store_id` scope 적용

모든 business query는 request context에서 확인된 `store_id`를 포함해야 한다.

예상 적용 기준:
- customer list/detail/history
- order list/detail/create/update
- repair order list/detail/create/update
- product list/detail/stock
- coupon issue/use/history
- inventory movement
- staff permission
- supplier workflow
- purchase confirmation

### Step 6. 이후 `NOT NULL` 전환 검토

다음 조건이 충족된 후 `store_id NOT NULL` 전환을 검토한다.

- staging backfill 완료
- query audit 완료
- API scope 적용 완료
- UI scope 적용 완료
- smoke test 완료
- production rehearsal 완료

## 7. 위험 사항

### `store_id` 없는 query

`store_id` scope가 누락된 query는 다른 매장의 고객, 주문, 수리, 상품, 쿠폰 데이터를 노출할 수 있다.

대응:
- query audit checklist 작성
- repository/service layer에서 `store_id` 필수화
- 테스트 데이터로 cross-store leakage 검증

### UNIQUE 제약 조건 충돌

single-tenant 기준 unique key가 multi-store 구조에서 충돌할 수 있다.

위험 후보:
- `line_user_id`
- `sku`
- `coupon code`
- staff login identifier
- supplier identifier

### `line_user_id` unique 충돌

LINE user identity를 store별로 분리할지, 전체 시스템에서 global identity로 유지할지 정책 결정이 필요하다.

검토 기준:
- 한 고객이 여러 매장과 관계를 가질 수 있는지
- LINE Official Account를 매장별로 분리할지
- CRM 통합 고객 모델을 도입할지

### `sku` unique 충돌

매장별 상품 운영을 허용하면 동일 SKU가 매장별로 존재할 수 있다.

대응 후보:
- `products.sku` unique를 `(store_id, sku)`로 변경
- global SKU catalog가 필요하면 별도 product catalog 모델 검토

### coupon code unique 충돌

쿠폰 코드는 고객 혼동과 중복 사용 위험 때문에 global unique 유지가 권장된다.

단, 매장별 쿠폰 namespace가 필요하면 `(store_id, code)` 정책을 별도로 검토한다.

### staff 권한과 store 권한 혼동

staff role만으로 데이터 접근을 판단하면 다른 매장 데이터 접근 위험이 있다.

대응:
- staff와 store 관계를 명확히 분리
- `staff_users.store_id` 또는 staff-store mapping 테이블 검토
- admin/global role과 store role 분리

### LINE/Telegram credential store별 분리 필요

LINE-first architecture를 유지하되, store별 notification credential과 channel 설정을 분리해야 한다.

주의:
- staging에는 운영 LINE/Telegram credential을 사용하지 않는다.
- production notification과 staging notification은 반드시 격리한다.

## 8. Unique Key 재설계 후보

| 대상 | 현재 후보 | 재설계 후보 | 비고 |
|---|---|---|---|
| `products.sku` | global unique | `(store_id, sku)` | 매장별 SKU 허용 시 필요 |
| `customers.line_user_id` | global unique 가능성 | store별 또는 global 정책 결정 | LINE OA 운영 방식에 따라 결정 |
| `orders.order_no` | global unique | global 유지 가능 | 고객/직원 추적 편의상 global 권장 |
| `coupons.code` | global unique | global 유지 권장 | 중복 사용 및 혼동 방지 |

## 9. Staged Rollout

### Phase 0: 문서화

- store_id migration 설계 문서 작성
- migration SQL draft 작성
- query audit checklist 작성
- 위험 테이블 및 unique key 목록 정리

### Phase 1: staging nullable `store_id`

- staging에서 `stores` 테이블 생성
- 1차 대상 테이블에 nullable `store_id` 추가
- migration 실행 전/후 schema 확인

### Phase 2: backfill

- KINGWAY 台南 기본 store 생성
- 기존 데이터 `store_id=1` backfill
- 테이블별 row count 검증
- backfill 결과 기록

### Phase 3: API scope

- API request context에 `store_id` 도입
- business query에 `store_id` 조건 추가
- cross-store data leakage 테스트 작성

### Phase 4: UI scope

- staff UI에서 현재 store context 표시
- store 권한에 따라 데이터 표시 제한
- mobile/desktop 모두 store scope 유지

### Phase 5: production rehearsal

- production 백업 기준 staging restore
- staging에서 migration rehearsal
- smoke test 및 rollback 계획 검증

### Phase 6: production rollout

- production backup 생성 및 checksum 기록
- migration dry run
- production migration 실행
- post-migration smoke test
- notification isolation 확인

## 10. 절대 금지

- production DB 직접 migration
- `store_id` 없는 bulk update
- 코드 복사본으로 매장별 분기
- 운영 LINE/Telegram credential을 staging에 사용

## 11. 다음 단계

- migration SQL draft 작성
- query audit checklist 작성
- `store_settings`는 이후 별도 문서에서 설계
