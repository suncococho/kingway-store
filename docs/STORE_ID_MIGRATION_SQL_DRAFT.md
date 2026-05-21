# Store ID Migration SQL Draft

## 1. 목적

이 문서는 KINGWAY SaaS 100매장 구조 전환을 위한 nullable `store_id` migration SQL 초안이다.

목적:
- `store_id` 기반 multi-store 구조 전환을 위한 SQL draft 작성
- production 적용 전 staging rehearsal 기준 정리
- 실제 migration 실행 전 위험 요소와 검증 쿼리 사전 정의

중요:
- 이 문서의 SQL은 실행용 확정본이 아니다.
- 이번 단계에서는 SQL 실행, migration 파일 생성, DB 수정 모두 금지한다.
- 모든 SQL은 staging rehearsal에서 먼저 검증한 뒤 production 적용 여부를 판단한다.

## 2. `stores` 테이블 draft SQL

```sql
-- DRAFT ONLY. DO NOT EXECUTE DIRECTLY.
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

KINGWAY 台南 기본 store draft:

```sql
-- DRAFT ONLY. DO NOT EXECUTE DIRECTLY.
INSERT INTO stores (id, code, name, status, plan)
VALUES (1, 'kingway-tainan', 'KINGWAY 台南', 'active', 'standard');
```

주의:
- 실제 적용 전 `stores` 테이블 존재 여부를 확인해야 한다.
- `id=1` 충돌 여부를 먼저 확인해야 한다.
- production에는 staging rehearsal 없이 적용하지 않는다.

## 3. 1차 Migration 대상 테이블

1차 nullable `store_id` 추가 대상:

- `customers`
- `orders`
- `order_items`
- `repair_orders`
- `products`
- `coupons`
- `inventory_movements`
- `supplier_requests`
- `purchase_confirmations`
- `staff_users`

## 4. Nullable `store_id` ALTER TABLE Draft

아래 SQL은 draft이며 실행 금지다.

```sql
-- DRAFT ONLY. DO NOT EXECUTE DIRECTLY.
ALTER TABLE customers
ADD COLUMN store_id BIGINT UNSIGNED NULL;

ALTER TABLE orders
ADD COLUMN store_id BIGINT UNSIGNED NULL;

ALTER TABLE order_items
ADD COLUMN store_id BIGINT UNSIGNED NULL;

ALTER TABLE repair_orders
ADD COLUMN store_id BIGINT UNSIGNED NULL;

ALTER TABLE products
ADD COLUMN store_id BIGINT UNSIGNED NULL;

ALTER TABLE coupons
ADD COLUMN store_id BIGINT UNSIGNED NULL;

ALTER TABLE inventory_movements
ADD COLUMN store_id BIGINT UNSIGNED NULL;

ALTER TABLE supplier_requests
ADD COLUMN store_id BIGINT UNSIGNED NULL;

ALTER TABLE purchase_confirmations
ADD COLUMN store_id BIGINT UNSIGNED NULL;

ALTER TABLE staff_users
ADD COLUMN store_id BIGINT UNSIGNED NULL;
```

주의:
- 실제 schema에 이미 `store_id`가 있는지 먼저 확인해야 한다.
- column 위치 지정은 DB별 영향과 readability를 검토한 뒤 결정한다.
- foreign key는 backfill과 query scope 검증 후 별도 단계에서 검토한다.
- 처음부터 `NOT NULL`을 적용하지 않는다.

## 5. Index Draft

아래 SQL은 draft이며 실행 금지다.

```sql
-- DRAFT ONLY. DO NOT EXECUTE DIRECTLY.
CREATE INDEX idx_customers_store_id ON customers(store_id);
CREATE INDEX idx_orders_store_id ON orders(store_id);
CREATE INDEX idx_order_items_store_id ON order_items(store_id);
CREATE INDEX idx_repair_orders_store_id ON repair_orders(store_id);
CREATE INDEX idx_products_store_id ON products(store_id);
CREATE INDEX idx_coupons_store_id ON coupons(store_id);
CREATE INDEX idx_inventory_movements_store_id ON inventory_movements(store_id);
CREATE INDEX idx_supplier_requests_store_id ON supplier_requests(store_id);
CREATE INDEX idx_purchase_confirmations_store_id ON purchase_confirmations(store_id);
CREATE INDEX idx_staff_users_store_id ON staff_users(store_id);
```

business query 기준 composite index 후보:

```sql
-- DRAFT ONLY. DO NOT EXECUTE DIRECTLY.
CREATE INDEX idx_customers_store_phone ON customers(store_id, phone);
CREATE INDEX idx_customers_store_line_user ON customers(store_id, line_user_id);

CREATE INDEX idx_orders_store_customer ON orders(store_id, customer_id);
CREATE INDEX idx_orders_store_status ON orders(store_id, status);

CREATE INDEX idx_order_items_store_order ON order_items(store_id, order_id);

CREATE INDEX idx_repair_orders_store_customer ON repair_orders(store_id, customer_id);
CREATE INDEX idx_repair_orders_store_status ON repair_orders(store_id, status);

CREATE INDEX idx_products_store_category ON products(store_id, category);

CREATE INDEX idx_coupons_store_customer ON coupons(store_id, customer_id);
CREATE INDEX idx_inventory_movements_store_product ON inventory_movements(store_id, product_id);
```

주의:
- 실제 index명 중복 여부를 먼저 확인해야 한다.
- 큰 테이블에서는 index 생성 시 lock과 downtime 위험이 있다.
- production 적용 전 staging에서 생성 시간과 lock 영향을 측정한다.

## 6. Composite Unique Key 후보

### `products(store_id, sku)`

매장별 SKU 중복 허용이 필요하면 `products.sku` 단독 unique 대신 `(store_id, sku)` unique를 검토한다.

```sql
-- DRAFT ONLY. DO NOT EXECUTE DIRECTLY.
-- Existing unique key name must be confirmed before dropping.
-- ALTER TABLE products DROP INDEX uniq_products_sku;
-- ALTER TABLE products ADD UNIQUE KEY uniq_products_store_sku (store_id, sku);
```

주의:
- 기존 unique key 이름을 반드시 확인해야 한다.
- duplicate SKU 존재 여부를 먼저 검증해야 한다.
- global product catalog 정책이 필요하면 별도 설계가 필요하다.

### 기타 후보 검토

| 대상 | 후보 정책 | 비고 |
|---|---|---|
| `customers.line_user_id` | global 유지 또는 `(store_id, line_user_id)` | LINE OA 운영 방식에 따라 결정 |
| `orders.order_no` | global unique 유지 가능 | 주문 추적 편의상 global 유지 권장 |
| `coupons.code` | global unique 유지 권장 | 쿠폰 중복 사용과 고객 혼동 방지 |
| `staff_users` login identifier | global 또는 store-scoped 정책 결정 | staff-store 권한 모델과 함께 설계 필요 |
| supplier identifier | global 또는 store-scoped 정책 결정 | 공급사 정산 정책에 따라 결정 |

## 7. Backfill Draft

아래 SQL은 draft이며 실행 금지다.

KINGWAY 台南 기존 데이터를 기본 store `id=1`로 backfill하는 초안이다.

```sql
-- DRAFT ONLY. DO NOT EXECUTE DIRECTLY.
-- DO NOT RUN IN PRODUCTION WITHOUT STAGING REHEARSAL.

UPDATE customers
SET store_id = 1
WHERE store_id IS NULL;

UPDATE orders
SET store_id = 1
WHERE store_id IS NULL;

UPDATE order_items
SET store_id = 1
WHERE store_id IS NULL;

UPDATE repair_orders
SET store_id = 1
WHERE store_id IS NULL;

UPDATE products
SET store_id = 1
WHERE store_id IS NULL;

UPDATE coupons
SET store_id = 1
WHERE store_id IS NULL;

UPDATE inventory_movements
SET store_id = 1
WHERE store_id IS NULL;

UPDATE supplier_requests
SET store_id = 1
WHERE store_id IS NULL;

UPDATE purchase_confirmations
SET store_id = 1
WHERE store_id IS NULL;

UPDATE staff_users
SET store_id = 1
WHERE store_id IS NULL;
```

주의:
- `WHERE store_id IS NULL` 조건 없는 bulk update는 금지한다.
- production에서는 backfill 전 row count를 기록한다.
- backfill 후 NULL count를 다시 확인한다.
- 대용량 테이블은 batch update 전략을 별도로 검토한다.

## 8. Verification Query Draft

### NULL count 확인

```sql
-- DRAFT ONLY. READ-ONLY VERIFICATION QUERY.
SELECT 'customers' AS table_name, COUNT(*) AS null_store_id_count
FROM customers
WHERE store_id IS NULL
UNION ALL
SELECT 'orders', COUNT(*)
FROM orders
WHERE store_id IS NULL
UNION ALL
SELECT 'order_items', COUNT(*)
FROM order_items
WHERE store_id IS NULL
UNION ALL
SELECT 'repair_orders', COUNT(*)
FROM repair_orders
WHERE store_id IS NULL
UNION ALL
SELECT 'products', COUNT(*)
FROM products
WHERE store_id IS NULL
UNION ALL
SELECT 'coupons', COUNT(*)
FROM coupons
WHERE store_id IS NULL
UNION ALL
SELECT 'inventory_movements', COUNT(*)
FROM inventory_movements
WHERE store_id IS NULL
UNION ALL
SELECT 'supplier_requests', COUNT(*)
FROM supplier_requests
WHERE store_id IS NULL
UNION ALL
SELECT 'purchase_confirmations', COUNT(*)
FROM purchase_confirmations
WHERE store_id IS NULL
UNION ALL
SELECT 'staff_users', COUNT(*)
FROM staff_users
WHERE store_id IS NULL;
```

### row count 확인

```sql
-- DRAFT ONLY. READ-ONLY VERIFICATION QUERY.
SELECT 'customers' AS table_name, COUNT(*) AS row_count FROM customers
UNION ALL
SELECT 'orders', COUNT(*) FROM orders
UNION ALL
SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL
SELECT 'repair_orders', COUNT(*) FROM repair_orders
UNION ALL
SELECT 'products', COUNT(*) FROM products
UNION ALL
SELECT 'coupons', COUNT(*) FROM coupons
UNION ALL
SELECT 'inventory_movements', COUNT(*) FROM inventory_movements
UNION ALL
SELECT 'supplier_requests', COUNT(*) FROM supplier_requests
UNION ALL
SELECT 'purchase_confirmations', COUNT(*) FROM purchase_confirmations
UNION ALL
SELECT 'staff_users', COUNT(*) FROM staff_users;
```

### orphan check

```sql
-- DRAFT ONLY. READ-ONLY VERIFICATION QUERY.
SELECT 'customers' AS table_name, COUNT(*) AS orphan_store_id_count
FROM customers c
LEFT JOIN stores s ON s.id = c.store_id
WHERE c.store_id IS NOT NULL
  AND s.id IS NULL
UNION ALL
SELECT 'orders', COUNT(*)
FROM orders o
LEFT JOIN stores s ON s.id = o.store_id
WHERE o.store_id IS NOT NULL
  AND s.id IS NULL
UNION ALL
SELECT 'order_items', COUNT(*)
FROM order_items oi
LEFT JOIN stores s ON s.id = oi.store_id
WHERE oi.store_id IS NOT NULL
  AND s.id IS NULL
UNION ALL
SELECT 'repair_orders', COUNT(*)
FROM repair_orders ro
LEFT JOIN stores s ON s.id = ro.store_id
WHERE ro.store_id IS NOT NULL
  AND s.id IS NULL
UNION ALL
SELECT 'products', COUNT(*)
FROM products p
LEFT JOIN stores s ON s.id = p.store_id
WHERE p.store_id IS NOT NULL
  AND s.id IS NULL
UNION ALL
SELECT 'coupons', COUNT(*)
FROM coupons co
LEFT JOIN stores s ON s.id = co.store_id
WHERE co.store_id IS NOT NULL
  AND s.id IS NULL
UNION ALL
SELECT 'inventory_movements', COUNT(*)
FROM inventory_movements im
LEFT JOIN stores s ON s.id = im.store_id
WHERE im.store_id IS NOT NULL
  AND s.id IS NULL
UNION ALL
SELECT 'supplier_requests', COUNT(*)
FROM supplier_requests sr
LEFT JOIN stores s ON s.id = sr.store_id
WHERE sr.store_id IS NOT NULL
  AND s.id IS NULL
UNION ALL
SELECT 'purchase_confirmations', COUNT(*)
FROM purchase_confirmations pc
LEFT JOIN stores s ON s.id = pc.store_id
WHERE pc.store_id IS NOT NULL
  AND s.id IS NULL
UNION ALL
SELECT 'staff_users', COUNT(*)
FROM staff_users su
LEFT JOIN stores s ON s.id = su.store_id
WHERE su.store_id IS NOT NULL
  AND s.id IS NULL;
```

## 9. Rollback Concept

Rollback은 backup restore 기준으로 설계한다.

원칙:
- destructive migration을 하지 않는다.
- `DROP COLUMN`, `DROP TABLE`, `DELETE` 기반 rollback에 의존하지 않는다.
- production 적용 전 backup과 checksum을 기록한다.
- staging rehearsal에서 restore 절차와 rollback 시간을 검증한다.
- production migration 중 문제 발생 시 임의 SQL 되돌리기보다 검증된 backup restore 절차를 우선한다.

## 10. 위험 사항

### long table lock

대용량 테이블에 `ALTER TABLE` 또는 index 생성 시 long table lock이 발생할 수 있다.

대응:
- staging에서 실행 시간 측정
- online DDL 가능 여부 확인
- 필요 시 batch migration 또는 maintenance window 검토

### production downtime

schema 변경과 index 생성이 production API 응답 지연 또는 downtime을 유발할 수 있다.

대응:
- production rehearsal 후 rollout window 결정
- migration 전후 smoke test 계획 수립
- rollback 기준 명확화

### `store_id` 없는 query

business query에 `store_id` scope가 누락되면 매장 간 데이터가 섞일 수 있다.

대응:
- query audit checklist 작성
- API/service/repository layer에서 `store_id` 필수화
- cross-store leakage 테스트 작성

### unique 충돌

기존 single-tenant unique key가 multi-store 정책과 충돌할 수 있다.

대응:
- unique key 목록 사전 확인
- duplicate data 사전 점검
- global unique와 store-scoped unique 정책 분리

### cross-store leakage

고객, 주문, 수리, 쿠폰, 상품 데이터가 다른 매장에 노출될 수 있다.

대응:
- 모든 read/write query에 `store_id` 조건 포함
- staff 권한과 store scope 분리
- LINE/notification credential store별 격리

## 11. 절대 금지

- production 직접 실행
- staging rehearsal 없이 실행
- `DELETE` 기반 migration
- `NOT NULL` 즉시 적용
- `store_id` 없는 bulk update
- 운영 LINE/Telegram credential을 staging에 사용
- 코드 복사본으로 매장별 분기

## 12. 최종 원칙

- migration은 단계적으로 진행한다.
- 모든 단계는 staging rehearsal 후 production에 진행한다.
- 먼저 nullable `store_id`를 추가하고, backfill과 query scope 적용 후 `NOT NULL` 전환을 검토한다.
- data는 `store_id` 기준으로 분리하고, code는 공통 코드베이스를 유지한다.
