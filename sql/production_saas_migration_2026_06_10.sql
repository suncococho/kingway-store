-- Draft only. Do not execute without explicit user approval.
-- Target: production MySQL 3306 / kingway_store
-- Date: 2026-06-10
--
-- Goals:
-- 1) product_categories parity
-- 2) products.category_id nullable + backfill
-- 3) inventory_movements.store_id nullable + backfill
-- 4) products SKU uniqueness transition from UNIQUE(sku) to UNIQUE(store_id, sku)
-- 5) app_settings transition from PRIMARY(setting_scope) to UNIQUE(store_id, setting_scope)
-- 6) create public identity mapping tables for staging parity
--
-- Safety:
-- - Run production_saas_preflight_2026_06_10.sql first.
-- - No DROP/TRUNCATE/DELETE data statements.
-- - DDL is not transactionally rollbackable in MySQL.
-- - COMMIT is intentionally commented out.

SELECT
  DATABASE() AS current_database,
  @@hostname AS hostname,
  @@port AS port,
  NOW() AS started_at;

SELECT 'products' AS table_name, COUNT(*) AS row_count FROM products
UNION ALL SELECT 'inventory_movements', COUNT(*) FROM inventory_movements
UNION ALL SELECT 'app_settings', COUNT(*) FROM app_settings
UNION ALL SELECT 'stores', COUNT(*) FROM stores;

-- ============================================================================
-- Phase 1: create product_categories
-- ============================================================================

CREATE TABLE IF NOT EXISTS product_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_product_categories_store_code (store_id, code),
  UNIQUE KEY uk_product_categories_store_name (store_id, name),
  KEY idx_product_categories_store_active_sort (store_id, is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Phase 2: add products.category_id if missing
-- ============================================================================

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'products'
        AND column_name = 'category_id'
    ),
    'SELECT ''products.category_id already exists'' AS info',
    'ALTER TABLE products ADD COLUMN category_id BIGINT UNSIGNED NULL'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- Phase 3: inventory_movements.store_id add
-- ============================================================================

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'inventory_movements'
        AND column_name = 'store_id'
    ),
    'SELECT ''inventory_movements.store_id already exists'' AS info',
    'ALTER TABLE inventory_movements ADD COLUMN store_id BIGINT UNSIGNED NULL'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- Phase 4: indexes for product category and inventory store scope
-- ============================================================================

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'inventory_movements'
        AND index_name = 'idx_inventory_movements_store_id'
    ),
    'SELECT ''idx_inventory_movements_store_id already exists'' AS info',
    'ALTER TABLE inventory_movements ADD INDEX idx_inventory_movements_store_id (store_id)'
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
        AND index_name = 'idx_products_store_category_id'
    ),
    'SELECT ''idx_products_store_category_id already exists'' AS info',
    'ALTER TABLE products ADD INDEX idx_products_store_category_id (store_id, category_id)'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- Phase 5: products SKU uniqueness transition
-- Add store-scoped unique index first, then drop legacy single-column unique sku.
-- Preflight must prove products(store_id, sku) has no duplicates.
-- ============================================================================

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'products'
        AND index_name = 'uk_products_store_sku'
    ),
    'SELECT ''uk_products_store_sku already exists'' AS info',
    'ALTER TABLE products ADD UNIQUE KEY uk_products_store_sku (store_id, sku)'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @products_legacy_sku_unique_index := (
  SELECT index_name
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'products'
    AND non_unique = 0
    AND index_name <> 'PRIMARY'
  GROUP BY index_name
  HAVING COUNT(*) = 1
     AND SUM(column_name = 'sku') = 1
  ORDER BY IF(index_name = 'sku', 0, 1), index_name
  LIMIT 1
);

SET @ddl := IF(
  @products_legacy_sku_unique_index IS NULL,
  'SELECT ''legacy single-column products.sku unique index not found'' AS info',
  CONCAT('ALTER TABLE products DROP INDEX `', REPLACE(@products_legacy_sku_unique_index, '`', '``'), '`')
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- Phase 6: app_settings index transition
-- Add store-scoped unique index first, then drop PRIMARY(setting_scope) if present.
-- Preflight must prove app_settings(store_id, setting_scope) has no duplicates.
-- ============================================================================

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'app_settings'
        AND index_name = 'uk_app_settings_store_scope'
    ),
    'SELECT ''uk_app_settings_store_scope already exists'' AS info',
    'ALTER TABLE app_settings ADD UNIQUE KEY uk_app_settings_store_scope (store_id, setting_scope)'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @app_settings_primary_is_setting_scope := (
  SELECT IF(COUNT(*) = 1 AND SUM(column_name = 'setting_scope') = 1, 1, 0)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'app_settings'
    AND index_name = 'PRIMARY'
);

SET @ddl := IF(
  @app_settings_primary_is_setting_scope = 1,
  'ALTER TABLE app_settings DROP PRIMARY KEY',
  'SELECT ''app_settings PRIMARY(setting_scope) not present'' AS info'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- Phase 7: public identity mapping tables for staging parity
-- These tables are not directly required for the current auth deploy, but are
-- included for schema parity. No seed rows are inserted in this migration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS store_hostnames (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  hostname VARCHAR(255) NOT NULL,
  hostname_type ENUM('SUBDOMAIN','CUSTOM_DOMAIN','LEGACY') NOT NULL DEFAULT 'SUBDOMAIN',
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  verified_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_store_hostnames_hostname (hostname),
  KEY idx_store_hostnames_store_status (store_id, status),
  KEY idx_store_hostnames_store_primary (store_id, is_primary),
  CONSTRAINT fk_store_hostnames_store FOREIGN KEY (store_id) REFERENCES stores (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS store_liff_apps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  liff_id VARCHAR(80) NOT NULL,
  liff_name VARCHAR(150) NULL,
  route_scope ENUM('GENERAL','STORE_INFO','LINE_ORDER','REPAIR_RESERVATION','COUPON_CENTER','GOOGLE_REVIEW','PURCHASE_CONFIRMATION','SURVEY','SUPPORT') NOT NULL DEFAULT 'GENERAL',
  status ENUM('ACTIVE','INACTIVE','RETIRED') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_store_liff_apps_liff_id (liff_id),
  KEY idx_store_liff_apps_store_status (store_id, status),
  KEY idx_store_liff_apps_scope_status (route_scope, status),
  CONSTRAINT fk_store_liff_apps_store FOREIGN KEY (store_id) REFERENCES stores (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS store_line_channels (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  channel_id VARCHAR(120) NOT NULL,
  channel_name VARCHAR(150) NULL,
  channel_secret_ref VARCHAR(255) NOT NULL,
  channel_access_token_ref VARCHAR(255) NOT NULL,
  webhook_path_token VARCHAR(160) NOT NULL,
  webhook_path VARCHAR(255) NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('ACTIVE','INACTIVE','ROTATING') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_store_line_channels_channel_id (channel_id),
  UNIQUE KEY uk_store_line_channels_path_token (webhook_path_token),
  KEY idx_store_line_channels_store_status (store_id, status),
  KEY idx_store_line_channels_store_default (store_id, is_default),
  CONSTRAINT fk_store_line_channels_store FOREIGN KEY (store_id) REFERENCES stores (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Phase 8: category seed and backfill DML
-- This transaction starts after all planned DDL so a later ALTER does not
-- accidentally commit the seed/backfill before manual review.
-- ============================================================================

START TRANSACTION;

INSERT INTO product_categories (store_id, code, name, sort_order, is_active)
SELECT
  s.id AS store_id,
  seed.code,
  seed.name,
  seed.sort_order,
  1 AS is_active
FROM stores s
JOIN (
  SELECT 'EB' AS code, '電動自行車' AS name, 10 AS sort_order
  UNION ALL SELECT 'RP', '維修', 20
  UNION ALL SELECT 'PT', '配件', 30
  UNION ALL SELECT 'AC', '改裝套件', 40
  UNION ALL SELECT 'TR', '輪胎', 50
  UNION ALL SELECT 'LT', '燈具', 60
  UNION ALL SELECT 'LK', '鎖具', 70
  UNION ALL SELECT 'SE', '椅子', 80
  UNION ALL SELECT 'HB', '車把握把腳踏', 90
  UNION ALL SELECT 'CR', '載具', 100
  UNION ALL SELECT 'OT', '其他', 110
) seed
WHERE NOT EXISTS (
  SELECT 1
  FROM product_categories pc
  WHERE pc.store_id = s.id
    AND pc.code = seed.code
);

UPDATE products p
JOIN product_categories pc
  ON pc.store_id = p.store_id
 AND pc.code = CASE
    WHEN UPPER(COALESCE(p.category, '')) IN ('EB','RP','PT','AC','TR','LT','LK','SE','HB','CR','OT') THEN UPPER(p.category)
    WHEN UPPER(COALESCE(p.category, '')) = 'EBIKE' THEN 'EB'
    WHEN UPPER(COALESCE(p.category, '')) = 'REPAIR' THEN 'RP'
    WHEN UPPER(COALESCE(p.category, '')) = 'ACCESSORY' THEN 'PT'
    WHEN UPPER(COALESCE(p.category, '')) = 'OTHER' THEN 'OT'
    WHEN UPPER(COALESCE(p.category, '')) IN ('FK','BG','CL','FP') THEN 'PT'
    WHEN UPPER(COALESCE(p.category, '')) = 'TN' THEN 'AC'
    WHEN UPPER(COALESCE(p.category, '')) = 'ST' THEN 'SE'
    WHEN UPPER(COALESCE(p.category, '')) = 'HG' THEN 'HB'
    WHEN UPPER(COALESCE(p.category, '')) = 'LC' THEN 'LK'
    WHEN UPPER(COALESCE(p.category, '')) IN ('TY','EX') THEN 'OT'
    WHEN SUBSTRING_INDEX(SUBSTRING_INDEX(UPPER(COALESCE(p.sku, '')), '-', 2), '-', -1) IN ('EB','RP','PT','AC','TR','LT','LK','SE','HB','CR','OT')
      THEN SUBSTRING_INDEX(SUBSTRING_INDEX(UPPER(COALESCE(p.sku, '')), '-', 2), '-', -1)
    ELSE 'OT'
  END
SET p.category_id = pc.id
WHERE p.category_id IS NULL
  AND p.store_id IS NOT NULL;

UPDATE inventory_movements im
JOIN products p
  ON p.id = im.product_id
SET im.store_id = p.store_id
WHERE im.store_id IS NULL
  AND p.store_id IS NOT NULL;

-- ============================================================================
-- Phase 9: post-checks in the current transaction
-- ============================================================================

SELECT
  'products category_id NULL rows' AS metric,
  COUNT(*) AS row_count
FROM products
WHERE category_id IS NULL;

SELECT
  'inventory_movements store_id NULL rows' AS metric,
  COUNT(*) AS row_count
FROM inventory_movements
WHERE store_id IS NULL;

SELECT
  s.table_name,
  s.index_name,
  GROUP_CONCAT(s.column_name ORDER BY s.seq_in_index) AS columns_in_index,
  MIN(s.non_unique) AS non_unique
FROM information_schema.statistics s
WHERE s.table_schema = DATABASE()
  AND s.table_name IN ('products', 'inventory_movements', 'app_settings')
GROUP BY s.table_name, s.index_name
ORDER BY s.table_name, s.index_name;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('product_categories', 'store_hostnames', 'store_liff_apps', 'store_line_channels')
ORDER BY table_name;

-- Final action must be chosen manually after preview validation.
-- COMMIT;
-- ROLLBACK;
