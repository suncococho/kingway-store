-- Add store scope to LINE group registrations.
-- Safe staged flow:
-- 1) add nullable store_id, 2) backfill only when registrar maps to exactly one store,
-- 3) report unresolved rows, 4) enforce NOT NULL only when none remain, 5) add store/type/active index.
-- This migration intentionally does not add a foreign key because existing schema.sql
-- does not define stores and production FK policy/type compatibility must be confirmed first.

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'line_group_registrations'
    AND COLUMN_NAME = 'store_id'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE line_group_registrations ADD COLUMN store_id BIGINT UNSIGNED NULL AFTER source_type',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE line_group_registrations lgr
JOIN (
  SELECT
    lgr_inner.id,
    MIN(su.store_id) AS inferred_store_id,
    COUNT(DISTINCT su.store_id) AS distinct_store_count
  FROM line_group_registrations lgr_inner
  JOIN staff_users su
    ON su.line_user_id = lgr_inner.registered_by_line_user_id
  WHERE lgr_inner.store_id IS NULL
    AND lgr_inner.registered_by_line_user_id IS NOT NULL
    AND lgr_inner.registered_by_line_user_id <> ''
    AND su.store_id IS NOT NULL
  GROUP BY lgr_inner.id
) inferred
  ON inferred.id = lgr.id
 AND inferred.distinct_store_count = 1
SET lgr.store_id = inferred.inferred_store_id
WHERE lgr.store_id IS NULL;

SET @unresolved_line_group_registrations := (
  SELECT COUNT(*)
  FROM line_group_registrations
  WHERE store_id IS NULL
);

SELECT @unresolved_line_group_registrations AS unresolved_line_group_registrations;

SET @store_id_nullable := (
  SELECT IS_NULLABLE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'line_group_registrations'
    AND COLUMN_NAME = 'store_id'
);
SET @sql := IF(
  @store_id_nullable = 'YES' AND @unresolved_line_group_registrations = 0,
  'ALTER TABLE line_group_registrations MODIFY COLUMN store_id BIGINT UNSIGNED NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'line_group_registrations'
    AND INDEX_NAME = 'idx_line_group_registrations_store_type_active'
);
SET @sql := IF(
  @index_exists = 0,
  'ALTER TABLE line_group_registrations ADD INDEX idx_line_group_registrations_store_type_active (store_id, registration_type, is_active)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
