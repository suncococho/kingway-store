-- Draft only. Do not execute without explicit approval.
-- Target: production MySQL 3306 / kingway_store
-- Goal: patch production schema gaps blocking SaaS cutover runtime
--
-- Scope included in this draft:
-- 1) staff_users.store_id
-- 2) supplier_requests.store_id
--
-- Safety:
-- - information_schema existence checks before ALTER / ADD INDEX
-- - backfill is NULL-only
-- - no DROP / TRUNCATE / DELETE
-- - COMMIT is commented out on purpose

-- ============================================================================
-- Preview 1: environment
-- ============================================================================

SELECT DATABASE() AS current_database, @@hostname AS hostname, @@port AS port, NOW() AS db_time;

-- ============================================================================
-- Preview 2: target table row counts
-- ============================================================================

SELECT 'staff_users' AS table_name, COUNT(*) AS row_count FROM staff_users
UNION ALL
SELECT 'supplier_requests', COUNT(*) FROM supplier_requests;

-- ============================================================================
-- Preview 3: current store_id column presence
-- ============================================================================

SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN ('staff_users', 'supplier_requests')
  AND column_name = 'store_id'
ORDER BY table_name;

-- ============================================================================
-- Preview 4: current NULL / filled counts if column already exists
-- ============================================================================

SET @preview_staff_users := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'staff_users'
        AND column_name = 'store_id'
    ),
    'SELECT ''staff_users'' AS table_name, COUNT(*) AS null_store_id_rows FROM staff_users WHERE store_id IS NULL
     UNION ALL
     SELECT ''staff_users_non_null'', COUNT(*) FROM staff_users WHERE store_id IS NOT NULL',
    'SELECT ''staff_users.store_id missing'' AS info'
  )
);
PREPARE stmt FROM @preview_staff_users;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @preview_supplier_requests := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'supplier_requests'
        AND column_name = 'store_id'
    ),
    'SELECT ''supplier_requests'' AS table_name, COUNT(*) AS null_store_id_rows FROM supplier_requests WHERE store_id IS NULL
     UNION ALL
     SELECT ''supplier_requests_non_null'', COUNT(*) FROM supplier_requests WHERE store_id IS NOT NULL',
    'SELECT ''supplier_requests.store_id missing'' AS info'
  )
);
PREPARE stmt FROM @preview_supplier_requests;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- Phase 1: add staff_users.store_id if missing
-- ============================================================================

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'staff_users'
        AND column_name = 'store_id'
    ),
    'SELECT ''staff_users.store_id already exists'' AS info',
    'ALTER TABLE staff_users ADD COLUMN store_id BIGINT UNSIGNED DEFAULT NULL'
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
        AND table_name = 'staff_users'
        AND index_name = 'idx_staff_users_store_id'
    ),
    'SELECT ''idx_staff_users_store_id already exists'' AS info',
    'ALTER TABLE staff_users ADD INDEX idx_staff_users_store_id (store_id)'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- Phase 2: add supplier_requests.store_id if missing
-- ============================================================================

SET @ddl := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'supplier_requests'
        AND column_name = 'store_id'
    ),
    'SELECT ''supplier_requests.store_id already exists'' AS info',
    'ALTER TABLE supplier_requests ADD COLUMN store_id BIGINT UNSIGNED DEFAULT NULL'
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
        AND table_name = 'supplier_requests'
        AND index_name = 'idx_supplier_requests_store_id'
    ),
    'SELECT ''idx_supplier_requests_store_id already exists'' AS info',
    'ALTER TABLE supplier_requests ADD INDEX idx_supplier_requests_store_id (store_id)'
  )
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- Preview 5: post-DDL readiness
-- ============================================================================

SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN ('staff_users', 'supplier_requests')
  AND column_name = 'store_id'
ORDER BY table_name;

START TRANSACTION;

-- ============================================================================
-- Phase 3: NULL-only backfill to store_id = 1
-- ============================================================================

UPDATE staff_users
SET store_id = 1
WHERE store_id IS NULL;

UPDATE supplier_requests
SET store_id = 1
WHERE store_id IS NULL;

-- ============================================================================
-- Preview 6: post-backfill validation in current transaction
-- ============================================================================

SELECT 'staff_users' AS table_name, COUNT(*) AS null_store_id_rows
FROM staff_users
WHERE store_id IS NULL
UNION ALL
SELECT 'supplier_requests', COUNT(*) FROM supplier_requests WHERE store_id IS NULL;

SELECT 'staff_users' AS table_name, COUNT(*) AS store_id_1_rows
FROM staff_users
WHERE store_id = 1
UNION ALL
SELECT 'supplier_requests', COUNT(*) FROM supplier_requests WHERE store_id = 1;

SELECT 'staff_users' AS table_name, COUNT(*) AS row_count FROM staff_users
UNION ALL
SELECT 'supplier_requests', COUNT(*) FROM supplier_requests;

-- Final action must be chosen manually after preview validation.
-- COMMIT;
-- ROLLBACK;
