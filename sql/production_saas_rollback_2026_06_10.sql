-- Draft only. Do not execute without explicit user approval.
-- Target: production MySQL 3306 / kingway_store
-- Date: 2026-06-10
--
-- Rollback principle:
-- - MySQL DDL is auto-commit and is not safely transactional.
-- - Production rollback should use the verified pre-migration backup restore.
-- - This file is only an emergency/manual rollback draft.
--
-- Critical warning:
-- - Restoring legacy UNIQUE(sku) can fail if duplicate SKU values were created
--   across different stores after migration.
-- - Restoring PRIMARY(setting_scope) can fail if multiple stores now have the
--   same app_settings.setting_scope after migration.

SELECT
  DATABASE() AS current_database,
  @@hostname AS hostname,
  @@port AS port,
  NOW() AS rollback_checked_at;

-- ============================================================================
-- 1. Rollback blockers
-- Review these before running any DDL below.
-- ============================================================================

SELECT
  sku,
  COUNT(*) AS duplicate_count,
  GROUP_CONCAT(id ORDER BY id) AS product_ids
FROM products
WHERE sku IS NOT NULL
  AND sku <> ''
GROUP BY sku
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, sku
LIMIT 100;

SELECT
  setting_scope,
  COUNT(*) AS duplicate_count
FROM app_settings
GROUP BY setting_scope
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, setting_scope
LIMIT 100;

-- Stop here unless the two duplicate checks above are empty.

-- ============================================================================
-- 2. Restore legacy products UNIQUE(sku), then remove store-scoped unique index
-- ============================================================================

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'products'
        AND index_name = 'sku'
    ),
    'SELECT ''products.sku index already exists'' AS info',
    'ALTER TABLE products ADD UNIQUE KEY sku (sku)'
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
        AND index_name = 'uk_products_store_sku'
    ),
    'ALTER TABLE products DROP INDEX uk_products_store_sku',
    'SELECT ''uk_products_store_sku not present'' AS info'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 3. Restore app_settings PRIMARY(setting_scope), then remove store-scoped unique
-- ============================================================================

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'app_settings'
        AND index_name = 'PRIMARY'
    ),
    'SELECT ''app_settings PRIMARY already exists'' AS info',
    'ALTER TABLE app_settings ADD PRIMARY KEY (setting_scope)'
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
        AND table_name = 'app_settings'
        AND index_name = 'uk_app_settings_store_scope'
    ),
    'ALTER TABLE app_settings DROP INDEX uk_app_settings_store_scope',
    'SELECT ''uk_app_settings_store_scope not present'' AS info'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 4. Drop new secondary indexes
-- ============================================================================

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'products'
        AND index_name = 'idx_products_store_category_id'
    ),
    'ALTER TABLE products DROP INDEX idx_products_store_category_id',
    'SELECT ''idx_products_store_category_id not present'' AS info'
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
        AND table_name = 'inventory_movements'
        AND index_name = 'idx_inventory_movements_store_id'
    ),
    'ALTER TABLE inventory_movements DROP INDEX idx_inventory_movements_store_id',
    'SELECT ''idx_inventory_movements_store_id not present'' AS info'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 5. Drop nullable columns added by this migration
-- This is schema-destructive. Prefer backup restore.
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
    'ALTER TABLE products DROP COLUMN category_id',
    'SELECT ''products.category_id not present'' AS info'
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
        AND table_name = 'inventory_movements'
        AND column_name = 'store_id'
    ),
    'ALTER TABLE inventory_movements DROP COLUMN store_id',
    'SELECT ''inventory_movements.store_id not present'' AS info'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 6. Drop staging-parity tables created by this migration
-- This removes any rows created after migration. Prefer backup restore.
-- ============================================================================

DROP TABLE IF EXISTS store_line_channels;
DROP TABLE IF EXISTS store_liff_apps;
DROP TABLE IF EXISTS store_hostnames;
DROP TABLE IF EXISTS product_categories;

-- ============================================================================
-- 7. Post-rollback inspection
-- ============================================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('product_categories', 'store_hostnames', 'store_liff_apps', 'store_line_channels')
ORDER BY table_name;

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
