-- Draft only. Do not execute without explicit approval.
-- Target: production MySQL 3306 / kingway_store
-- Goal: add SaaS tenant schema without overwriting production data.
--
-- Important safety rules:
-- 1) Never import staging over production.
-- 2) Preserve existing production rows and row counts.
-- 3) Backfill only NULL store_id values to store_id = 1.
-- 4) Do not include product SKU C-EB-001-S1 decisions in this schema file.
--
-- MySQL DDL note:
-- - CREATE TABLE / ALTER TABLE auto-commit in MySQL.
-- - The transaction below protects only the seed INSERT / NULL backfill DML.
-- - If DDL must be reversed after execution, restore from the pre-migration backup.

-- ============================================================================
-- Preview 0: environment and current row counts
-- ============================================================================

SELECT DATABASE() AS current_database, @@hostname AS hostname, @@port AS port, NOW() AS db_time;

SELECT 'customers' AS table_name, COUNT(*) AS row_count FROM customers
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL SELECT 'repair_orders', COUNT(*) FROM repair_orders
UNION ALL SELECT 'purchase_confirmations', COUNT(*) FROM purchase_confirmations
UNION ALL SELECT 'coupons', COUNT(*) FROM coupons;

-- ============================================================================
-- Preview 1: existing core store_id columns and SaaS table existence
-- ============================================================================

SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN (
    'customers',
    'products',
    'orders',
    'order_items',
    'repair_orders',
    'purchase_confirmations',
    'coupons'
  )
  AND column_name = 'store_id'
ORDER BY table_name;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'stores',
    'store_features',
    'store_line_settings',
    'platform_admin_users',
    'store_memberships'
  )
ORDER BY table_name;

-- ============================================================================
-- Phase 1: add store_id columns to production core tables if missing
-- ============================================================================

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'customers'
        AND column_name = 'store_id'
    ),
    'SELECT ''customers.store_id already exists'' AS info',
    'ALTER TABLE customers ADD COLUMN store_id BIGINT UNSIGNED DEFAULT NULL'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'customers'
        AND index_name = 'idx_customers_store_id'
    ),
    'SELECT ''idx_customers_store_id already exists'' AS info',
    'ALTER TABLE customers ADD INDEX idx_customers_store_id (store_id)'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'products'
        AND column_name = 'store_id'
    ),
    'SELECT ''products.store_id already exists'' AS info',
    'ALTER TABLE products ADD COLUMN store_id BIGINT UNSIGNED DEFAULT NULL'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'products'
        AND index_name = 'idx_products_store_id'
    ),
    'SELECT ''idx_products_store_id already exists'' AS info',
    'ALTER TABLE products ADD INDEX idx_products_store_id (store_id)'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'orders'
        AND column_name = 'store_id'
    ),
    'SELECT ''orders.store_id already exists'' AS info',
    'ALTER TABLE orders ADD COLUMN store_id BIGINT UNSIGNED DEFAULT NULL'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'orders'
        AND index_name = 'idx_orders_store_id'
    ),
    'SELECT ''idx_orders_store_id already exists'' AS info',
    'ALTER TABLE orders ADD INDEX idx_orders_store_id (store_id)'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'order_items'
        AND column_name = 'store_id'
    ),
    'SELECT ''order_items.store_id already exists'' AS info',
    'ALTER TABLE order_items ADD COLUMN store_id BIGINT UNSIGNED DEFAULT NULL'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'order_items'
        AND index_name = 'idx_order_items_store_id'
    ),
    'SELECT ''idx_order_items_store_id already exists'' AS info',
    'ALTER TABLE order_items ADD INDEX idx_order_items_store_id (store_id)'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'repair_orders'
        AND column_name = 'store_id'
    ),
    'SELECT ''repair_orders.store_id already exists'' AS info',
    'ALTER TABLE repair_orders ADD COLUMN store_id BIGINT UNSIGNED DEFAULT NULL'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'repair_orders'
        AND index_name = 'idx_repair_orders_store_id'
    ),
    'SELECT ''idx_repair_orders_store_id already exists'' AS info',
    'ALTER TABLE repair_orders ADD INDEX idx_repair_orders_store_id (store_id)'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'purchase_confirmations'
        AND column_name = 'store_id'
    ),
    'SELECT ''purchase_confirmations.store_id already exists'' AS info',
    'ALTER TABLE purchase_confirmations ADD COLUMN store_id BIGINT UNSIGNED DEFAULT NULL'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'purchase_confirmations'
        AND index_name = 'idx_purchase_confirmations_store_id'
    ),
    'SELECT ''idx_purchase_confirmations_store_id already exists'' AS info',
    'ALTER TABLE purchase_confirmations ADD INDEX idx_purchase_confirmations_store_id (store_id)'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'coupons'
        AND column_name = 'store_id'
    ),
    'SELECT ''coupons.store_id already exists'' AS info',
    'ALTER TABLE coupons ADD COLUMN store_id BIGINT UNSIGNED DEFAULT NULL'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'coupons'
        AND index_name = 'idx_coupons_store_id'
    ),
    'SELECT ''idx_coupons_store_id already exists'' AS info',
    'ALTER TABLE coupons ADD INDEX idx_coupons_store_id (store_id)'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- Phase 2: create SaaS foundation tables if missing
-- ============================================================================

CREATE TABLE IF NOT EXISTS stores (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  name VARCHAR(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  status ENUM('active','inactive','suspended') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  plan VARCHAR(80) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'single_store',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_stores_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS store_features (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  pos_enabled TINYINT(1) NOT NULL DEFAULT '1',
  orders_enabled TINYINT(1) NOT NULL DEFAULT '1',
  repairs_enabled TINYINT(1) NOT NULL DEFAULT '1',
  inventory_enabled TINYINT(1) NOT NULL DEFAULT '1',
  suppliers_enabled TINYINT(1) NOT NULL DEFAULT '1',
  coupons_enabled TINYINT(1) NOT NULL DEFAULT '1',
  purchase_confirmations_enabled TINYINT(1) NOT NULL DEFAULT '1',
  line_enabled TINYINT(1) NOT NULL DEFAULT '1',
  telegram_enabled TINYINT(1) NOT NULL DEFAULT '1',
  sales_dashboard_enabled TINYINT(1) NOT NULL DEFAULT '1',
  staff_management_enabled TINYINT(1) NOT NULL DEFAULT '1',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_store_features_store (store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS store_line_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  line_enabled TINYINT(1) NOT NULL DEFAULT '0',
  channel_id VARCHAR(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  channel_secret_ref VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  channel_secret_present TINYINT(1) NOT NULL DEFAULT '0',
  channel_access_token_ref VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  channel_access_token_present TINYINT(1) NOT NULL DEFAULT '0',
  liff_url VARCHAR(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  login_auth_url VARCHAR(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  webhook_path VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  customer_oa_name VARCHAR(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  staff_group_enabled TINYINT(1) NOT NULL DEFAULT '0',
  updated_by_staff_id BIGINT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  channel_secret_direct_value TEXT COLLATE utf8mb4_unicode_ci,
  channel_access_token_direct_value TEXT COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (id),
  UNIQUE KEY uk_store_line_settings_store (store_id),
  UNIQUE KEY uk_store_line_settings_channel_id (channel_id),
  UNIQUE KEY uk_store_line_settings_webhook_path (webhook_path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_admin_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  password_hash VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  display_name VARCHAR(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  role ENUM('PLATFORM_OWNER','PLATFORM_ADMIN','SUPPORT') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PLATFORM_ADMIN',
  is_active TINYINT(1) NOT NULL DEFAULT '1',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS store_memberships (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  staff_user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('owner','admin','staff') COLLATE utf8mb4_unicode_ci NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT '0',
  status ENUM('active','invited','disabled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_store_memberships_store_user (store_id, staff_user_id),
  KEY idx_store_memberships_user_status (staff_user_id, status),
  KEY idx_store_memberships_store_role_status (store_id, role, status),
  CONSTRAINT fk_store_memberships_staff_user
    FOREIGN KEY (staff_user_id) REFERENCES staff_users (id),
  CONSTRAINT fk_store_memberships_store
    FOREIGN KEY (store_id) REFERENCES stores (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Preview 2: post-DDL readiness before any DML
-- ============================================================================

SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN (
    'customers',
    'products',
    'orders',
    'order_items',
    'repair_orders',
    'purchase_confirmations',
    'coupons'
  )
  AND column_name = 'store_id'
ORDER BY table_name;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'stores',
    'store_features',
    'store_line_settings',
    'platform_admin_users',
    'store_memberships'
  )
ORDER BY table_name;

START TRANSACTION;

-- ============================================================================
-- Phase 3: seed store 1 / KINGWAY_TAINAN and minimum SaaS metadata
-- ============================================================================

INSERT INTO stores (
  id, code, name, status, plan
)
SELECT
  1,
  'KINGWAY_TAINAN',
  'KINGWAY 台南',
  'active',
  'single_store'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1
  FROM stores
  WHERE id = 1
     OR code = 'KINGWAY_TAINAN'
);

INSERT INTO store_features (
  store_id,
  pos_enabled,
  orders_enabled,
  repairs_enabled,
  inventory_enabled,
  suppliers_enabled,
  coupons_enabled,
  purchase_confirmations_enabled,
  line_enabled,
  telegram_enabled,
  sales_dashboard_enabled,
  staff_management_enabled
)
SELECT
  1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1
  FROM store_features
  WHERE store_id = 1
);

INSERT INTO store_line_settings (
  store_id,
  line_enabled,
  channel_id,
  channel_secret_ref,
  channel_secret_present,
  channel_access_token_ref,
  channel_access_token_present,
  liff_url,
  login_auth_url,
  webhook_path,
  customer_oa_name,
  staff_group_enabled,
  updated_by_staff_id,
  channel_secret_direct_value,
  channel_access_token_direct_value
)
SELECT
  1,
  1,
  NULL,
  'env:LINE_CHANNEL_SECRET',
  1,
  'env:LINE_CHANNEL_ACCESS_TOKEN',
  1,
  NULL,
  NULL,
  '/api/line/webhook',
  'KINGWAY 台南 OA',
  1,
  1,
  NULL,
  NULL
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1
  FROM store_line_settings
  WHERE store_id = 1
);

INSERT INTO store_memberships (
  store_id,
  staff_user_id,
  role,
  is_default,
  status
)
SELECT
  1,
  su.id,
  CASE
    WHEN su.username = 'admin' THEN 'owner'
    WHEN su.role IN ('ADMIN', 'MANAGER') THEN 'admin'
    ELSE 'staff'
  END,
  1,
  'active'
FROM staff_users su
WHERE su.is_active = 1
  AND NOT EXISTS (
    SELECT 1
    FROM store_memberships sm
    WHERE sm.store_id = 1
      AND sm.staff_user_id = su.id
  );

-- ============================================================================
-- Preview 3: NULL backfill candidates before UPDATE
-- ============================================================================

SELECT 'customers' AS table_name, COUNT(*) AS null_store_id_rows
FROM customers
WHERE store_id IS NULL
UNION ALL
SELECT 'products', COUNT(*) FROM products WHERE store_id IS NULL
UNION ALL
SELECT 'orders', COUNT(*) FROM orders WHERE store_id IS NULL
UNION ALL
SELECT 'order_items', COUNT(*) FROM order_items WHERE store_id IS NULL
UNION ALL
SELECT 'repair_orders', COUNT(*) FROM repair_orders WHERE store_id IS NULL
UNION ALL
SELECT 'purchase_confirmations', COUNT(*) FROM purchase_confirmations WHERE store_id IS NULL
UNION ALL
SELECT 'coupons', COUNT(*) FROM coupons WHERE store_id IS NULL;

-- ============================================================================
-- Phase 4: NULL-only backfill to store_id = 1
-- ============================================================================

UPDATE customers
SET store_id = 1
WHERE store_id IS NULL;

UPDATE products
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

UPDATE purchase_confirmations
SET store_id = 1
WHERE store_id IS NULL;

UPDATE coupons
SET store_id = 1
WHERE store_id IS NULL;

-- ============================================================================
-- Preview 4: post-backfill validation
-- ============================================================================

SELECT 'customers' AS table_name, COUNT(*) AS null_store_id_rows
FROM customers
WHERE store_id IS NULL
UNION ALL
SELECT 'products', COUNT(*) FROM products WHERE store_id IS NULL
UNION ALL
SELECT 'orders', COUNT(*) FROM orders WHERE store_id IS NULL
UNION ALL
SELECT 'order_items', COUNT(*) FROM order_items WHERE store_id IS NULL
UNION ALL
SELECT 'repair_orders', COUNT(*) FROM repair_orders WHERE store_id IS NULL
UNION ALL
SELECT 'purchase_confirmations', COUNT(*) FROM purchase_confirmations WHERE store_id IS NULL
UNION ALL
SELECT 'coupons', COUNT(*) FROM coupons WHERE store_id IS NULL;

SELECT 'customers' AS table_name, COUNT(*) AS row_count FROM customers
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL SELECT 'repair_orders', COUNT(*) FROM repair_orders
UNION ALL SELECT 'purchase_confirmations', COUNT(*) FROM purchase_confirmations
UNION ALL SELECT 'coupons', COUNT(*) FROM coupons;

SELECT id, code, name, status, plan
FROM stores
WHERE id = 1 OR code = 'KINGWAY_TAINAN';

SELECT store_id, role, status, COUNT(*) AS membership_count
FROM store_memberships
WHERE store_id = 1
GROUP BY store_id, role, status
ORDER BY role, status;

-- Final approval gate.
-- COMMIT;
-- ROLLBACK;

-- Rollback guidance:
-- 1) If COMMIT has not been executed yet, use ROLLBACK for the seed/backfill DML above.
-- 2) DDL in this file auto-commits in MySQL and is not reverted by ROLLBACK.
-- 3) If executed and later rejected, restore production from the approved pre-migration backup.
-- 4) Do not attempt ad-hoc DROP/TRUNCATE/DELETE rollback on production.
