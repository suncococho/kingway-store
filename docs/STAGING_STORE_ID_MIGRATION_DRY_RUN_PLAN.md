# Staging Store ID Migration Dry-Run Plan

## 1. Current Mismatch Summary

Current active backend code expects `store_id` scope in authenticated business routes, but the currently connected DB schema does not provide the required store schema.

Observed read-only verification result:

- `stores` table: missing
- `tenant_id` columns: missing
- `store_id` columns: missing from all currently connected DB tables
- `staff_users.store_id`: missing, but `backend/src/routes/auth.js` selects it during login
- core scoped routes already use `req.storeId` and SQL `store_id` predicates

High-risk active code expectations include:

| Table | Current code expectation | Current DB state |
|---|---|---|
| `staff_users` | login reads `store_id` and JWT includes `storeId` | `store_id` missing |
| `customers` | customer list/create/update scopes by `store_id` | `store_id` missing |
| `orders` | order list/detail/create/update scopes by `store_id` | `store_id` missing |
| `order_items` | order item edit and repair classification scopes by `store_id` | `store_id` missing |
| `products` | dashboard/orders/repairs/inventory/suppliers scope by `store_id` | `store_id` missing |
| `repair_orders` | repair routes scope through `store_id` or customer store | `store_id` missing |
| `coupons` | coupon routes validate customer/order store scope | related `store_id` missing |
| `inventory_movements` | inventory and order stock flows use `store_id` | `store_id` missing |
| `supplier_requests` | dashboard and supplier routes use `store_id` | `store_id` missing |
| `purchase_confirmations` | admin routes and generation use `store_id` | `store_id` missing |

This means the code is ahead of the current DB schema. Before self-service onboarding, staging must rehearse the `store_id` migration safely.

## 2. Why `store_id=1` Hardcoding Fallback Is Forbidden

Do not add route-level or SQL-level fallback such as:

```js
const storeId = req.storeId || 1;
```

```sql
WHERE store_id = COALESCE(?, 1)
```

Reasons:

- It hides schema/auth mismatch instead of fixing it.
- It makes staging appear healthy while leaving production unsafe.
- It can silently attach future stores' data to KINGWAY 台南.
- It can bind wrong staff/customer/order/coupon records to the seed store.
- It blocks true multi-store SaaS because missing resolver/scope becomes invisible.
- It conflicts with the existing rule that backend request scope is the final data isolation boundary.
- It creates rollback problems because wrong `store_id=1` writes look valid at row level.

Allowed compatibility is only controlled migration/backfill of existing single-store KINGWAY 台南 data to seed `store_id=1`, after dry-run row counts and backup.

## 3. Migration Goal

Staging migration rehearsal goals:

- Create a canonical `stores` table in staging.
- Seed the existing KINGWAY 台南 store as `id=1`.
- Add nullable `store_id` columns to tables currently required by active code.
- Backfill existing single-store data to `store_id=1`.
- Add basic indexes required for scoped query performance.
- Verify missing `store_id` counts are zero for required tables.
- Keep columns nullable during rehearsal.
- Avoid unique key redesign during this phase.
- Avoid production changes.

This dry run is not self-service onboarding implementation.

## 4. Target Environment Confirmation Procedure

Before any staging execution, confirm the target DB is truly staging.

Required checks:

```sql
SELECT DATABASE() AS current_database;
```

```sql
SHOW TABLES;
```

```sql
SELECT COUNT(*) AS staff_count FROM staff_users;
SELECT COUNT(*) AS customer_count FROM customers;
SELECT COUNT(*) AS order_count FROM orders;
SELECT COUNT(*) AS product_count FROM products;
```

Operational checks:

- Confirm container name / host / port belongs to staging.
- Confirm no production LINE / Telegram credential is loaded.
- Confirm frontend/backend staging URLs are not production URLs.
- Confirm a fresh DB backup exists before any schema execution.
- Confirm this plan is being executed from a staging branch/environment only.

Production DB must not be targeted by this dry run.

## 5. Backup / Rollback Principles

Backup principles:

- Take a full DB dump before schema changes.
- Store backup outside the DB container.
- Record backup filename, timestamp, DB name, row counts, and operator.
- Verify backup restore procedure exists before migration execution.

Rollback principles:

- Because this phase only adds nullable columns and backfills seed values, rollback should be straightforward but still rehearsed.
- Rollback must be tested in staging before production consideration.
- Do not drop original business data.
- Do not change global unique keys in this phase.
- Do not convert `store_id` to `NOT NULL` in this phase.
- Do not add hard foreign keys until row counts, orphan checks, and route scope tests pass.

## 6. Stores Seed Plan

Seed the existing operating store as `id=1`.

Recommended staging seed:

```sql
-- DRAFT ONLY. Do not run without backup and staging confirmation.
CREATE TABLE stores (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(100) NOT NULL,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(120) NULL,
  region VARCHAR(100) NULL,
  address VARCHAR(255) NULL,
  phone VARCHAR(40) NULL,
  timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Taipei',
  locale VARCHAR(20) NOT NULL DEFAULT 'zh-TW',
  currency VARCHAR(10) NOT NULL DEFAULT 'TWD',
  status VARCHAR(40) NOT NULL DEFAULT 'active',
  plan VARCHAR(80) NOT NULL DEFAULT 'single_store',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_stores_code (code),
  UNIQUE KEY uk_stores_slug (slug),
  INDEX idx_stores_status (status)
);
```

```sql
-- DRAFT ONLY. Existing KINGWAY 台南 seed.
INSERT INTO stores (
  id,
  code,
  name,
  slug,
  region,
  address,
  timezone,
  locale,
  currency,
  status,
  plan
)
VALUES (
  1,
  'KINGWAY_TAINAN',
  'KINGWAY 台南',
  'kingway-tainan',
  '台南',
  '台南市東區東門路二段245號',
  'Asia/Taipei',
  'zh-TW',
  'TWD',
  'active',
  'single_store'
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  slug = VALUES(slug),
  region = VALUES(region),
  address = VALUES(address),
  timezone = VALUES(timezone),
  locale = VALUES(locale),
  currency = VALUES(currency),
  status = VALUES(status),
  plan = VALUES(plan);
```

Seed rules:

- `id=1` is only for migrating existing KINGWAY 台南 data.
- New future stores must not assume sequential ids in application code.
- Public URLs should use slug, not numeric id.
- No code should hardcode `store_id=1`.

## 7. Nullable `store_id` Add Target Tables

Required because active code already expects these tables to have `store_id`:

- `staff_users`
- `customers`
- `orders`
- `order_items`
- `products`
- `repair_orders`
- `coupons`
- `inventory_movements`
- `supplier_requests`
- `purchase_confirmations`

These columns must be nullable first.

## 8. Optional / Future `store_id` Add Target Tables

Recommended for full multi-store safety, but can be staged after active-code mismatch is handled:

- `app_settings`
- `customer_crm_events`
- `follow_up_tasks`
- `line_chat_sessions`
- `line_group_registrations`
- `line_webhook_events`
- `operational_checklists`
- `order_payment_events`
- `purchase_confirmation_requests`
- `purchase_confirmation_tokens`
- `repair_logs`
- `staff_attendance`
- `staff_kpi_logs`
- `supplier_request_items`
- `surveys`
- `telegram_chat_sessions`
- `v2_workflow_events`

For LINE-related tables, coordinate with the LINE multi-store resolver plan before production rollout.

## 9. Dry-Run Row Count SQL

Run before schema changes and save output.

```sql
SELECT 'staff_users' AS table_name, COUNT(*) AS total_rows FROM staff_users
UNION ALL SELECT 'customers', COUNT(*) FROM customers
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'repair_orders', COUNT(*) FROM repair_orders
UNION ALL SELECT 'coupons', COUNT(*) FROM coupons
UNION ALL SELECT 'inventory_movements', COUNT(*) FROM inventory_movements
UNION ALL SELECT 'supplier_requests', COUNT(*) FROM supplier_requests
UNION ALL SELECT 'purchase_confirmations', COUNT(*) FROM purchase_confirmations;
```

Optional/future table counts:

```sql
SELECT 'app_settings' AS table_name, COUNT(*) AS total_rows FROM app_settings
UNION ALL SELECT 'customer_crm_events', COUNT(*) FROM customer_crm_events
UNION ALL SELECT 'follow_up_tasks', COUNT(*) FROM follow_up_tasks
UNION ALL SELECT 'line_chat_sessions', COUNT(*) FROM line_chat_sessions
UNION ALL SELECT 'line_group_registrations', COUNT(*) FROM line_group_registrations
UNION ALL SELECT 'line_webhook_events', COUNT(*) FROM line_webhook_events
UNION ALL SELECT 'operational_checklists', COUNT(*) FROM operational_checklists
UNION ALL SELECT 'order_payment_events', COUNT(*) FROM order_payment_events
UNION ALL SELECT 'purchase_confirmation_requests', COUNT(*) FROM purchase_confirmation_requests
UNION ALL SELECT 'purchase_confirmation_tokens', COUNT(*) FROM purchase_confirmation_tokens
UNION ALL SELECT 'repair_logs', COUNT(*) FROM repair_logs
UNION ALL SELECT 'staff_attendance', COUNT(*) FROM staff_attendance
UNION ALL SELECT 'staff_kpi_logs', COUNT(*) FROM staff_kpi_logs
UNION ALL SELECT 'supplier_request_items', COUNT(*) FROM supplier_request_items
UNION ALL SELECT 'surveys', COUNT(*) FROM surveys
UNION ALL SELECT 'telegram_chat_sessions', COUNT(*) FROM telegram_chat_sessions
UNION ALL SELECT 'v2_workflow_events', COUNT(*) FROM v2_workflow_events;
```

Confirm existing column state:

```sql
SELECT
  t.TABLE_NAME,
  CASE WHEN c.COLUMN_NAME IS NULL THEN 'NO' ELSE 'YES' END AS has_store_id
FROM INFORMATION_SCHEMA.TABLES t
LEFT JOIN INFORMATION_SCHEMA.COLUMNS c
  ON c.TABLE_SCHEMA = t.TABLE_SCHEMA
 AND c.TABLE_NAME = t.TABLE_NAME
 AND c.COLUMN_NAME = 'store_id'
WHERE t.TABLE_SCHEMA = DATABASE()
ORDER BY t.TABLE_NAME;
```

## 10. ALTER TABLE Draft

Required active-code tables:

```sql
-- DRAFT ONLY. Do not run without staging backup.
ALTER TABLE staff_users ADD COLUMN store_id BIGINT UNSIGNED NULL;
ALTER TABLE customers ADD COLUMN store_id BIGINT UNSIGNED NULL;
ALTER TABLE orders ADD COLUMN store_id BIGINT UNSIGNED NULL;
ALTER TABLE order_items ADD COLUMN store_id BIGINT UNSIGNED NULL;
ALTER TABLE products ADD COLUMN store_id BIGINT UNSIGNED NULL;
ALTER TABLE repair_orders ADD COLUMN store_id BIGINT UNSIGNED NULL;
ALTER TABLE coupons ADD COLUMN store_id BIGINT UNSIGNED NULL;
ALTER TABLE inventory_movements ADD COLUMN store_id BIGINT UNSIGNED NULL;
ALTER TABLE supplier_requests ADD COLUMN store_id BIGINT UNSIGNED NULL;
ALTER TABLE purchase_confirmations ADD COLUMN store_id BIGINT UNSIGNED NULL;
```

Indexes:

```sql
-- DRAFT ONLY. Index names should be checked for existing duplicates first.
CREATE INDEX idx_staff_users_store_id ON staff_users(store_id);
CREATE INDEX idx_customers_store_id ON customers(store_id);
CREATE INDEX idx_customers_store_phone ON customers(store_id, phone);
CREATE INDEX idx_customers_store_line_user ON customers(store_id, line_user_id);
CREATE INDEX idx_orders_store_id ON orders(store_id);
CREATE INDEX idx_orders_store_business_date ON orders(store_id, business_date);
CREATE INDEX idx_orders_store_order_no ON orders(store_id, order_no);
CREATE INDEX idx_order_items_store_id ON order_items(store_id);
CREATE INDEX idx_order_items_store_order ON order_items(store_id, order_id);
CREATE INDEX idx_products_store_id ON products(store_id);
CREATE INDEX idx_products_store_sku ON products(store_id, sku);
CREATE INDEX idx_repair_orders_store_id ON repair_orders(store_id);
CREATE INDEX idx_coupons_store_id ON coupons(store_id);
CREATE INDEX idx_inventory_movements_store_id ON inventory_movements(store_id);
CREATE INDEX idx_supplier_requests_store_id ON supplier_requests(store_id);
CREATE INDEX idx_purchase_confirmations_store_id ON purchase_confirmations(store_id);
```

Optional/future tables should follow the same nullable-first pattern in a separate rehearsal.

## 11. Backfill SQL Draft

Backfill only after the seed store exists and row counts are saved.

```sql
-- DRAFT ONLY. Existing single-store KINGWAY 台南 data backfill.
UPDATE staff_users SET store_id = 1 WHERE store_id IS NULL;
UPDATE customers SET store_id = 1 WHERE store_id IS NULL;
UPDATE orders SET store_id = 1 WHERE store_id IS NULL;
UPDATE order_items SET store_id = 1 WHERE store_id IS NULL;
UPDATE products SET store_id = 1 WHERE store_id IS NULL;
UPDATE repair_orders SET store_id = 1 WHERE store_id IS NULL;
UPDATE coupons SET store_id = 1 WHERE store_id IS NULL;
UPDATE inventory_movements SET store_id = 1 WHERE store_id IS NULL;
UPDATE supplier_requests SET store_id = 1 WHERE store_id IS NULL;
UPDATE purchase_confirmations SET store_id = 1 WHERE store_id IS NULL;
```

Optional/future backfill draft:

```sql
-- DRAFT ONLY. Run only in a later phase if those columns are added.
UPDATE app_settings SET store_id = 1 WHERE store_id IS NULL;
UPDATE customer_crm_events SET store_id = 1 WHERE store_id IS NULL;
UPDATE follow_up_tasks SET store_id = 1 WHERE store_id IS NULL;
UPDATE line_chat_sessions SET store_id = 1 WHERE store_id IS NULL;
UPDATE line_group_registrations SET store_id = 1 WHERE store_id IS NULL;
UPDATE line_webhook_events SET store_id = 1 WHERE store_id IS NULL;
UPDATE operational_checklists SET store_id = 1 WHERE store_id IS NULL;
UPDATE order_payment_events SET store_id = 1 WHERE store_id IS NULL;
UPDATE purchase_confirmation_requests SET store_id = 1 WHERE store_id IS NULL;
UPDATE purchase_confirmation_tokens SET store_id = 1 WHERE store_id IS NULL;
UPDATE repair_logs SET store_id = 1 WHERE store_id IS NULL;
UPDATE staff_attendance SET store_id = 1 WHERE store_id IS NULL;
UPDATE staff_kpi_logs SET store_id = 1 WHERE store_id IS NULL;
UPDATE supplier_request_items SET store_id = 1 WHERE store_id IS NULL;
UPDATE surveys SET store_id = 1 WHERE store_id IS NULL;
UPDATE telegram_chat_sessions SET store_id = 1 WHERE store_id IS NULL;
UPDATE v2_workflow_events SET store_id = 1 WHERE store_id IS NULL;
```

## 12. Verification SQL

Seed store verification:

```sql
SELECT id, code, name, slug, status, plan
FROM stores
WHERE id = 1;
```

Required table missing counts:

```sql
SELECT 'staff_users' AS table_name, COUNT(*) AS missing_store_id FROM staff_users WHERE store_id IS NULL
UNION ALL SELECT 'customers', COUNT(*) FROM customers WHERE store_id IS NULL
UNION ALL SELECT 'orders', COUNT(*) FROM orders WHERE store_id IS NULL
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items WHERE store_id IS NULL
UNION ALL SELECT 'products', COUNT(*) FROM products WHERE store_id IS NULL
UNION ALL SELECT 'repair_orders', COUNT(*) FROM repair_orders WHERE store_id IS NULL
UNION ALL SELECT 'coupons', COUNT(*) FROM coupons WHERE store_id IS NULL
UNION ALL SELECT 'inventory_movements', COUNT(*) FROM inventory_movements WHERE store_id IS NULL
UNION ALL SELECT 'supplier_requests', COUNT(*) FROM supplier_requests WHERE store_id IS NULL
UNION ALL SELECT 'purchase_confirmations', COUNT(*) FROM purchase_confirmations WHERE store_id IS NULL;
```

Basic login schema verification:

```sql
SHOW COLUMNS FROM staff_users LIKE 'store_id';
SELECT id, username, role, is_active, store_id
FROM staff_users
ORDER BY id;
```

Core route readiness checks:

```sql
SELECT COUNT(*) AS products_in_store_1 FROM products WHERE store_id = 1;
SELECT COUNT(*) AS customers_in_store_1 FROM customers WHERE store_id = 1;
SELECT COUNT(*) AS orders_in_store_1 FROM orders WHERE store_id = 1;
SELECT COUNT(*) AS repairs_in_store_1 FROM repair_orders WHERE store_id = 1;
```

Index verification:

```sql
SHOW INDEX FROM staff_users;
SHOW INDEX FROM customers;
SHOW INDEX FROM orders;
SHOW INDEX FROM products;
```

## 13. Rollback SQL Draft

Preferred rollback is full DB restore from backup.

Column-level rollback draft for staging only:

```sql
-- DRAFT ONLY. Staging rollback if no dependent code/data writes need preservation.
ALTER TABLE purchase_confirmations DROP COLUMN store_id;
ALTER TABLE supplier_requests DROP COLUMN store_id;
ALTER TABLE inventory_movements DROP COLUMN store_id;
ALTER TABLE coupons DROP COLUMN store_id;
ALTER TABLE repair_orders DROP COLUMN store_id;
ALTER TABLE products DROP COLUMN store_id;
ALTER TABLE order_items DROP COLUMN store_id;
ALTER TABLE orders DROP COLUMN store_id;
ALTER TABLE customers DROP COLUMN store_id;
ALTER TABLE staff_users DROP COLUMN store_id;
DROP TABLE stores;
```

If indexes were created separately and the DB requires explicit index drops first:

```sql
-- DRAFT ONLY. Confirm actual index names with SHOW INDEX before running.
DROP INDEX idx_purchase_confirmations_store_id ON purchase_confirmations;
DROP INDEX idx_supplier_requests_store_id ON supplier_requests;
DROP INDEX idx_inventory_movements_store_id ON inventory_movements;
DROP INDEX idx_coupons_store_id ON coupons;
DROP INDEX idx_repair_orders_store_id ON repair_orders;
DROP INDEX idx_products_store_sku ON products;
DROP INDEX idx_products_store_id ON products;
DROP INDEX idx_order_items_store_order ON order_items;
DROP INDEX idx_order_items_store_id ON order_items;
DROP INDEX idx_orders_store_order_no ON orders;
DROP INDEX idx_orders_store_business_date ON orders;
DROP INDEX idx_orders_store_id ON orders;
DROP INDEX idx_customers_store_line_user ON customers;
DROP INDEX idx_customers_store_phone ON customers;
DROP INDEX idx_customers_store_id ON customers;
DROP INDEX idx_staff_users_store_id ON staff_users;
```

Rollback warning:

- Do not use column rollback after production-like writes have occurred unless restore impact is understood.
- Full backup restore is safer for rehearsal validation.

## 14. Production Apply Prohibition Conditions

Do not apply to production if any of these are true:

- Target DB identity is not confirmed.
- Full backup and restore rehearsal are missing.
- Current staging migration dry run has not passed.
- `stores` seed row cannot be verified.
- Required tables still have missing `store_id` after backfill.
- Login with existing admin/staff cannot produce a valid `storeId`.
- Dashboard/customers/orders/products/repairs smoke tests fail.
- LINE public route store resolver is still assumed for multi-store production.
- Any route has hardcoded `store_id=1` fallback.
- Unique key redesign has not been reviewed for multi-store conflicts.
- Rollback SQL or restore plan is missing.
- Production LINE/Telegram credentials would be used in staging.

## 15. Staging Execution Checklist

Preflight:

- [ ] Confirm DB host/container/database is staging.
- [ ] Confirm no production credentials are loaded.
- [ ] Run current table and column inventory.
- [ ] Save baseline row counts.
- [ ] Create full DB backup.
- [ ] Verify backup file exists.

Schema:

- [ ] Create `stores` table.
- [ ] Insert KINGWAY 台南 seed store as `id=1`.
- [ ] Add nullable `store_id` to required active-code tables.
- [ ] Add indexes.

Backfill:

- [ ] Backfill required active-code tables to `store_id=1`.
- [ ] Save affected row counts.
- [ ] Confirm no required table has null `store_id`.

Smoke test:

- [ ] Existing admin/staff login works.
- [ ] JWT/user payload includes `storeId: 1`.
- [ ] Dashboard loads.
- [ ] Customers list loads.
- [ ] Orders list/detail loads.
- [ ] Products route behavior is reviewed separately because it currently has mixed auth/scope state.
- [ ] Repairs list/detail loads.
- [ ] Inventory/supplier scoped routes load if enabled.

Post-check:

- [ ] Save verification SQL output.
- [ ] Save error logs.
- [ ] Confirm no production notification was sent.
- [ ] Confirm rollback plan remains valid.

## 16. Next Safe Step

Generate a staging-only SQL dry-run bundle from this plan:

- `SHOW` / row-count SQL
- `CREATE TABLE stores` draft
- nullable `ALTER TABLE` draft
- index draft
- backfill draft
- verification SQL
- rollback SQL

Then run only the read-only preflight section first and compare it to this document before any schema changes.
