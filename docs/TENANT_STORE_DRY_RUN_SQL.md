# Tenant / Store Dry-Run SQL

## 1. 목적

KINGWAY multi-tenant 전환 전, 실제 DB를 변경하지 않고 현재 데이터 상태를 확인하기 위한 읽기 전용 dry-run SQL 모음이다.

이 문서의 목적은 다음과 같다.

- 테이블별 row count 확인
- 고객 phone 중복 확인
- 주문번호 중복 확인
- LINE userId 중복 및 고객/직원 매핑 위험 확인
- 쿠폰 발급 중복 확인
- 수리, 구매확인, 재고이력 주요 데이터 수량 확인
- orphan 데이터 확인
- `tenant_id` / `store_id` backfill 전 위험 요소 파악

이 문서는 실행 계획이며, 실제 DB 변경을 하지 않는다.

## 2. 실행 전 주의사항

실행 전 확인:

- 현재 branch가 `beta/staging-architecture`인지 확인한다.
- 운영 DB에서 바로 실행하지 않는 것을 원칙으로 한다.
- 가능하면 staging DB 또는 운영 snapshot 복원 DB에서 먼저 실행한다.
- 운영 DB에서 실행해야 한다면 read-only 계정 또는 transaction read-only 모드 사용을 권장한다.
- 결과는 `docs/TENANT_STORE_DRY_RUN_RESULT_TEMPLATE.md` 형식에 맞춰 기록한다.
- 개인정보가 포함될 수 있으므로 phone, LINE userId, token은 보고서에 전체값을 노출하지 않는다.

권장 read-only 세션 예시:

```sql
SET SESSION TRANSACTION READ ONLY;
START TRANSACTION READ ONLY;
-- SELECT only
ROLLBACK;
```

주의:

- MySQL 권한이나 버전에 따라 read-only transaction 사용 가능 여부가 다를 수 있다.
- read-only transaction이 불가능해도 이 문서의 SQL은 반드시 조회문만 실행한다.

## 3. 절대 금지 SQL

dry-run 중 아래 SQL은 절대 실행하지 않는다.

```sql
ALTER TABLE ...
UPDATE ...
DELETE FROM ...
DROP TABLE ...
DROP INDEX ...
CREATE INDEX ...
INSERT INTO ...
TRUNCATE TABLE ...
REPLACE INTO ...
CREATE TABLE ...
```

금지 원칙:

- schema 변경 금지
- 데이터 변경 금지
- index 변경 금지
- migration 실행 금지
- backfill 실행 금지
- 임시 정리 작업 금지

## 4. 허용 SQL

dry-run에서 허용되는 SQL은 읽기 전용 조회에 한정한다.

허용 예시:

```sql
SELECT COUNT(*) FROM table_name;
SHOW COLUMNS FROM table_name;
SHOW INDEX FROM table_name;
SELECT column_name, COUNT(*) FROM table_name GROUP BY column_name;
SELECT ...
FROM child_table c
LEFT JOIN parent_table p ON p.id = c.parent_id
WHERE p.id IS NULL;
EXPLAIN SELECT ...
```

허용 원칙:

- `SELECT COUNT(*)`
- `SHOW COLUMNS`
- `SHOW INDEX`
- `SELECT ... GROUP BY`
- `SELECT ... LEFT JOIN ... WHERE ... IS NULL`
- `EXPLAIN SELECT`

## 5. 주요 테이블별 row count SQL

```sql
SELECT 'staff_users' AS table_name, COUNT(*) AS row_count FROM staff_users
UNION ALL
SELECT 'customers', COUNT(*) FROM customers
UNION ALL
SELECT 'products', COUNT(*) FROM products
UNION ALL
SELECT 'orders', COUNT(*) FROM orders
UNION ALL
SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL
SELECT 'inventory_movements', COUNT(*) FROM inventory_movements
UNION ALL
SELECT 'line_group_registrations', COUNT(*) FROM line_group_registrations
UNION ALL
SELECT 'purchase_confirmations', COUNT(*) FROM purchase_confirmations
UNION ALL
SELECT 'purchase_confirmation_tokens', COUNT(*) FROM purchase_confirmation_tokens
UNION ALL
SELECT 'repair_orders', COUNT(*) FROM repair_orders
UNION ALL
SELECT 'repair_logs', COUNT(*) FROM repair_logs
UNION ALL
SELECT 'coupons', COUNT(*) FROM coupons
UNION ALL
SELECT 'surveys', COUNT(*) FROM surveys
UNION ALL
SELECT 'staff_attendance', COUNT(*) FROM staff_attendance
UNION ALL
SELECT 'staff_kpi_logs', COUNT(*) FROM staff_kpi_logs
UNION ALL
SELECT 'app_settings', COUNT(*) FROM app_settings
UNION ALL
SELECT 'purchase_confirmation_requests', COUNT(*) FROM purchase_confirmation_requests
UNION ALL
SELECT 'customer_crm_events', COUNT(*) FROM customer_crm_events
UNION ALL
SELECT 'follow_up_tasks', COUNT(*) FROM follow_up_tasks
UNION ALL
SELECT 'supplier_requests', COUNT(*) FROM supplier_requests
UNION ALL
SELECT 'supplier_request_items', COUNT(*) FROM supplier_request_items
UNION ALL
SELECT 'operational_checklists', COUNT(*) FROM operational_checklists
UNION ALL
SELECT 'v2_workflow_events', COUNT(*) FROM v2_workflow_events
UNION ALL
SELECT 'line_chat_sessions', COUNT(*) FROM line_chat_sessions;
```

## 6. customers phone 중복 확인 SQL

### 6-1. phone NULL / 빈 값 수

```sql
SELECT
  COUNT(*) AS total_customers,
  SUM(CASE WHEN phone IS NULL OR phone = '' THEN 1 ELSE 0 END) AS missing_phone_count,
  SUM(CASE WHEN phone IS NOT NULL AND phone <> '' THEN 1 ELSE 0 END) AS has_phone_count
FROM customers;
```

### 6-2. 원본 phone 중복

```sql
SELECT
  phone,
  COUNT(*) AS duplicate_count
FROM customers
WHERE phone IS NOT NULL
  AND phone <> ''
GROUP BY phone
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, phone ASC;
```

보고서에는 phone 전체값 대신 masking 값을 기록한다.

### 6-3. Taiwan phone normalization 후 중복 후보

```sql
SELECT
  normalized_phone,
  COUNT(*) AS duplicate_count
FROM (
  SELECT
    CASE
      WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '.', ''), '(', ''), ')', '') LIKE '+886%'
        THEN CONCAT('0', SUBSTRING(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '.', ''), '(', ''), ')', ''), 5))
      WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '.', ''), '(', ''), ')', '') LIKE '886%'
        THEN CONCAT('0', SUBSTRING(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '.', ''), '(', ''), ')', ''), 4))
      ELSE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '.', ''), '(', ''), ')', '')
    END AS normalized_phone
  FROM customers
  WHERE phone IS NOT NULL
    AND phone <> ''
) normalized
WHERE normalized_phone IS NOT NULL
  AND normalized_phone <> ''
GROUP BY normalized_phone
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, normalized_phone ASC;
```

### 6-4. orders.customer_phone과 customers.phone 불일치 후보

```sql
SELECT
  o.id AS order_id,
  o.order_no,
  o.customer_id,
  o.customer_phone AS order_customer_phone,
  c.phone AS customer_phone
FROM orders o
INNER JOIN customers c ON c.id = o.customer_id
WHERE o.customer_phone IS NOT NULL
  AND o.customer_phone <> ''
  AND c.phone IS NOT NULL
  AND c.phone <> ''
  AND o.customer_phone <> c.phone
ORDER BY o.id DESC
LIMIT 200;
```

## 7. orders order_no 중복 확인 SQL

### 7-1. order_no NULL / 빈 값

```sql
SELECT
  COUNT(*) AS total_orders,
  SUM(CASE WHEN order_no IS NULL OR order_no = '' THEN 1 ELSE 0 END) AS missing_order_no_count
FROM orders;
```

### 7-2. order_no 중복

```sql
SELECT
  order_no,
  COUNT(*) AS duplicate_count
FROM orders
WHERE order_no IS NOT NULL
  AND order_no <> ''
GROUP BY order_no
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, order_no ASC;
```

### 7-3. 주문번호 prefix 분포

```sql
SELECT
  CASE
    WHEN order_no LIKE 'POS-%' THEN 'POS'
    WHEN order_no LIKE 'LINE-%' THEN 'LINE'
    WHEN order_no LIKE 'ORD-%' THEN 'ORD'
    WHEN order_no LIKE 'REP-%' THEN 'REP'
    ELSE 'OTHER'
  END AS order_no_prefix,
  COUNT(*) AS order_count
FROM orders
GROUP BY order_no_prefix
ORDER BY order_count DESC;
```

## 8. LINE userId 중복/매핑 확인 SQL

### 8-1. customers.line_user_id NULL / 보유 수

```sql
SELECT
  COUNT(*) AS total_customers,
  SUM(CASE WHEN line_user_id IS NULL OR line_user_id = '' THEN 1 ELSE 0 END) AS missing_line_user_id_count,
  SUM(CASE WHEN line_user_id IS NOT NULL AND line_user_id <> '' THEN 1 ELSE 0 END) AS has_line_user_id_count
FROM customers;
```

### 8-2. customers.line_user_id 중복

```sql
SELECT
  line_user_id,
  COUNT(*) AS duplicate_count
FROM customers
WHERE line_user_id IS NOT NULL
  AND line_user_id <> ''
GROUP BY line_user_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, line_user_id ASC;
```

### 8-3. staff_users.line_user_id 중복

```sql
SELECT
  line_user_id,
  COUNT(*) AS duplicate_count
FROM staff_users
WHERE line_user_id IS NOT NULL
  AND line_user_id <> ''
GROUP BY line_user_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, line_user_id ASC;
```

### 8-4. customer와 staff가 같은 LINE userId를 공유하는 사례

```sql
SELECT
  c.id AS customer_id,
  c.name AS customer_name,
  s.id AS staff_user_id,
  s.username,
  s.display_name
FROM customers c
INNER JOIN staff_users s ON s.line_user_id = c.line_user_id
WHERE c.line_user_id IS NOT NULL
  AND c.line_user_id <> ''
ORDER BY c.id ASC, s.id ASC;
```

### 8-5. line_chat_sessions 중복 후보

```sql
SELECT
  line_user_id,
  flow_type,
  COUNT(*) AS duplicate_count
FROM line_chat_sessions
GROUP BY line_user_id, flow_type
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, line_user_id ASC, flow_type ASC;
```

### 8-6. line_group_registrations 중복 후보

```sql
SELECT
  line_group_id,
  COUNT(*) AS duplicate_count
FROM line_group_registrations
WHERE line_group_id IS NOT NULL
  AND line_group_id <> ''
GROUP BY line_group_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, line_group_id ASC;
```

## 9. coupon 발급 중복 확인 SQL

### 9-1. coupon type/status 분포

```sql
SELECT
  coupon_type,
  status,
  is_used,
  COUNT(*) AS coupon_count
FROM coupons
GROUP BY coupon_type, status, is_used
ORDER BY coupon_type ASC, status ASC, is_used ASC;
```

### 9-2. 고객별 coupon type 중복

```sql
SELECT
  customer_id,
  coupon_type,
  COUNT(*) AS coupon_count
FROM coupons
GROUP BY customer_id, coupon_type
HAVING COUNT(*) > 1
ORDER BY coupon_count DESC, customer_id ASC, coupon_type ASC;
```

### 9-3. coupon code 중복

```sql
SELECT
  code,
  COUNT(*) AS duplicate_count
FROM coupons
WHERE code IS NOT NULL
  AND code <> ''
GROUP BY code
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, code ASC;
```

### 9-4. Google review coupon pending/approved/used 현황

```sql
SELECT
  status,
  is_used,
  COUNT(*) AS coupon_count
FROM coupons
WHERE coupon_type = 'google_review'
GROUP BY status, is_used
ORDER BY status ASC, is_used ASC;
```

### 9-5. new friend coupon 현황

```sql
SELECT
  status,
  is_used,
  COUNT(*) AS coupon_count
FROM coupons
WHERE coupon_type = 'new_friend'
GROUP BY status, is_used
ORDER BY status ASC, is_used ASC;
```

## 10. repair_orders / purchase_confirmations / inventory_movements count 확인 SQL

### 10-1. repair_orders status count

```sql
SELECT
  status,
  COUNT(*) AS repair_count
FROM repair_orders
GROUP BY status
ORDER BY repair_count DESC, status ASC;
```

### 10-2. repair_orders source / reservation status count

```sql
SELECT
  source,
  reservation_status,
  COUNT(*) AS repair_count
FROM repair_orders
GROUP BY source, reservation_status
ORDER BY repair_count DESC;
```

### 10-3. purchase_confirmations status count

```sql
SELECT
  status,
  COUNT(*) AS confirmation_count,
  SUM(CASE WHEN pdf_path IS NOT NULL AND pdf_path <> '' THEN 1 ELSE 0 END) AS has_pdf_count
FROM purchase_confirmations
GROUP BY status
ORDER BY confirmation_count DESC, status ASC;
```

### 10-4. purchase_confirmation_tokens status count

```sql
SELECT
  CASE
    WHEN used_at IS NOT NULL THEN 'USED'
    WHEN expires_at < NOW() THEN 'EXPIRED'
    ELSE 'ACTIVE'
  END AS token_status,
  COUNT(*) AS token_count
FROM purchase_confirmation_tokens
GROUP BY token_status
ORDER BY token_count DESC;
```

### 10-5. inventory_movements type count

```sql
SELECT
  movement_type,
  COUNT(*) AS movement_count,
  SUM(quantity) AS quantity_sum
FROM inventory_movements
GROUP BY movement_type
ORDER BY movement_count DESC, movement_type ASC;
```

### 10-6. products category / active count

```sql
SELECT
  category,
  is_active,
  COUNT(*) AS product_count,
  SUM(stock) AS total_stock
FROM products
GROUP BY category, is_active
ORDER BY category ASC, is_active DESC;
```

## 11. orphan 데이터 확인 SQL

### 11-1. orders.customer_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM orders o
LEFT JOIN customers c ON c.id = o.customer_id
WHERE o.customer_id IS NOT NULL
  AND c.id IS NULL;
```

### 11-2. orders.created_by orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM orders o
LEFT JOIN staff_users s ON s.id = o.created_by
WHERE o.created_by IS NOT NULL
  AND s.id IS NULL;
```

### 11-3. order_items.order_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM order_items oi
LEFT JOIN orders o ON o.id = oi.order_id
WHERE o.id IS NULL;
```

### 11-4. order_items.product_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM order_items oi
LEFT JOIN products p ON p.id = oi.product_id
WHERE p.id IS NULL;
```

### 11-5. repair_orders.customer_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM repair_orders ro
LEFT JOIN customers c ON c.id = ro.customer_id
WHERE ro.customer_id IS NOT NULL
  AND c.id IS NULL;
```

### 11-6. repair_orders.approved_by_staff_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM repair_orders ro
LEFT JOIN staff_users s ON s.id = ro.approved_by_staff_id
WHERE ro.approved_by_staff_id IS NOT NULL
  AND s.id IS NULL;
```

### 11-7. repair_logs.repair_order_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM repair_logs rl
LEFT JOIN repair_orders ro ON ro.id = rl.repair_order_id
WHERE ro.id IS NULL;
```

### 11-8. coupons.customer_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM coupons cp
LEFT JOIN customers c ON c.id = cp.customer_id
WHERE cp.customer_id IS NOT NULL
  AND c.id IS NULL;
```

### 11-9. coupons.order_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM coupons cp
LEFT JOIN orders o ON o.id = cp.order_id
WHERE cp.order_id IS NOT NULL
  AND o.id IS NULL;
```

### 11-10. coupons.approved_by_staff_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM coupons cp
LEFT JOIN staff_users s ON s.id = cp.approved_by_staff_id
WHERE cp.approved_by_staff_id IS NOT NULL
  AND s.id IS NULL;
```

### 11-11. purchase_confirmations.order_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM purchase_confirmations pc
LEFT JOIN orders o ON o.id = pc.order_id
WHERE pc.order_id IS NOT NULL
  AND o.id IS NULL;
```

### 11-12. purchase_confirmations.customer_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM purchase_confirmations pc
LEFT JOIN customers c ON c.id = pc.customer_id
WHERE pc.customer_id IS NOT NULL
  AND c.id IS NULL;
```

### 11-13. purchase_confirmation_tokens.order_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM purchase_confirmation_tokens pct
LEFT JOIN orders o ON o.id = pct.order_id
WHERE pct.order_id IS NOT NULL
  AND o.id IS NULL;
```

### 11-14. purchase_confirmation_tokens.customer_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM purchase_confirmation_tokens pct
LEFT JOIN customers c ON c.id = pct.customer_id
WHERE pct.customer_id IS NOT NULL
  AND c.id IS NULL;
```

### 11-15. inventory_movements.product_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM inventory_movements im
LEFT JOIN products p ON p.id = im.product_id
WHERE im.product_id IS NOT NULL
  AND p.id IS NULL;
```

### 11-16. inventory_movements.created_by orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM inventory_movements im
LEFT JOIN staff_users s ON s.id = im.created_by
WHERE im.created_by IS NOT NULL
  AND s.id IS NULL;
```

### 11-17. staff_attendance.staff_user_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM staff_attendance sa
LEFT JOIN staff_users s ON s.id = sa.staff_user_id
WHERE sa.staff_user_id IS NOT NULL
  AND s.id IS NULL;
```

### 11-18. staff_kpi_logs.staff_user_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM staff_kpi_logs skl
LEFT JOIN staff_users s ON s.id = skl.staff_user_id
WHERE skl.staff_user_id IS NOT NULL
  AND s.id IS NULL;
```

### 11-19. supplier_requests.requested_by_staff_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM supplier_requests sr
LEFT JOIN staff_users s ON s.id = sr.requested_by_staff_id
WHERE sr.requested_by_staff_id IS NOT NULL
  AND s.id IS NULL;
```

### 11-20. supplier_request_items.supplier_request_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM supplier_request_items sri
LEFT JOIN supplier_requests sr ON sr.id = sri.supplier_request_id
WHERE sri.supplier_request_id IS NOT NULL
  AND sr.id IS NULL;
```

### 11-21. supplier_request_items.product_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM supplier_request_items sri
LEFT JOIN products p ON p.id = sri.product_id
WHERE sri.product_id IS NOT NULL
  AND p.id IS NULL;
```

### 11-22. surveys.customer_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM surveys sv
LEFT JOIN customers c ON c.id = sv.customer_id
WHERE sv.customer_id IS NOT NULL
  AND c.id IS NULL;
```

### 11-23. surveys.order_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM surveys sv
LEFT JOIN orders o ON o.id = sv.order_id
WHERE sv.order_id IS NOT NULL
  AND o.id IS NULL;
```

### 11-24. customer_crm_events.customer_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM customer_crm_events cce
LEFT JOIN customers c ON c.id = cce.customer_id
WHERE cce.customer_id IS NOT NULL
  AND c.id IS NULL;
```

### 11-25. follow_up_tasks.customer_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM follow_up_tasks ft
LEFT JOIN customers c ON c.id = ft.customer_id
WHERE ft.customer_id IS NOT NULL
  AND c.id IS NULL;
```

### 11-26. operational_checklists.staff_user_id orphan

```sql
SELECT
  COUNT(*) AS orphan_count
FROM operational_checklists oc
LEFT JOIN staff_users s ON s.id = oc.staff_user_id
WHERE oc.staff_user_id IS NOT NULL
  AND s.id IS NULL;
```

## 12. dry-run 결과 기록 방식

dry-run 실행 결과는 `docs/TENANT_STORE_DRY_RUN_RESULT_TEMPLATE.md` 형식에 맞춰 기록한다.

기록 원칙:

- SQL 실행 일시를 기록한다.
- 대상 DB가 운영인지 staging인지 기록한다.
- branch와 commit hash를 기록한다.
- read-only 계정 또는 read-only transaction 사용 여부를 기록한다.
- row count summary를 표로 기록한다.
- duplicate 결과는 group 수와 affected row 수 중심으로 기록한다.
- orphan 결과는 count 중심으로 기록한다.
- sample id는 필요한 경우에만 제한적으로 기록한다.
- phone, LINE userId, token은 masking한다.
- dry-run 중 어떤 변경 SQL도 실행하지 않았음을 명시한다.

결과 문서 위치:

```text
docs/TENANT_STORE_DRY_RUN_RESULT_TEMPLATE.md
```

## 13. 원칙

이 문서는 실행 계획이며 실제 DB 변경을 하지 않는다.

최종 원칙:

- dry-run은 읽기 전용이다.
- 실제 `UPDATE`, `ALTER`, `DELETE`, `DROP`, `CREATE INDEX`, `INSERT`를 실행하지 않는다.
- dry-run SQL은 데이터 상태를 관찰하기 위한 것이다.
- dry-run 결과를 검토한 뒤 별도 승인으로 migration 계획을 진행한다.
- 운영 서버에는 이 문서의 SQL을 변경 목적으로 사용하지 않는다.
