-- Roll back store scope added to LINE group registrations.
-- WARNING: dropping store_id removes production audit/routing scope data for group registrations.
-- Run only after confirming no runtime depends on line_group_registrations.store_id.

SET @index_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'line_group_registrations'
    AND INDEX_NAME = 'idx_line_group_registrations_store_type_active'
);
SET @sql := IF(
  @index_exists > 0,
  'ALTER TABLE line_group_registrations DROP INDEX idx_line_group_registrations_store_type_active',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- No foreign key is added by the forward migration. If a future migration adds one,
-- drop that foreign key before dropping store_id.
SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'line_group_registrations'
    AND COLUMN_NAME = 'store_id'
);
SET @sql := IF(
  @column_exists > 0,
  'ALTER TABLE line_group_registrations DROP COLUMN store_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
