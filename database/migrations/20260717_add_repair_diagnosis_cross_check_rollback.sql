SET @index_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND INDEX_NAME = 'idx_repair_orders_cross_check'
);
SET @rollback_sql := IF(
  @index_exists > 0,
  'ALTER TABLE repair_orders DROP INDEX idx_repair_orders_cross_check',
  'SELECT ''idx_repair_orders_cross_check does not exist'' AS message'
);
PREPARE stmt FROM @rollback_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND COLUMN_NAME = 'diagnosis_updated_at'
);
SET @rollback_sql := IF(@column_exists > 0, 'ALTER TABLE repair_orders DROP COLUMN diagnosis_updated_at', 'SELECT ''diagnosis_updated_at does not exist'' AS message');
PREPARE stmt FROM @rollback_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND COLUMN_NAME = 'diagnosis_updated_by_staff_id'
);
SET @rollback_sql := IF(@column_exists > 0, 'ALTER TABLE repair_orders DROP COLUMN diagnosis_updated_by_staff_id', 'SELECT ''diagnosis_updated_by_staff_id does not exist'' AS message');
PREPARE stmt FROM @rollback_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND COLUMN_NAME = 'cross_check_note'
);
SET @rollback_sql := IF(@column_exists > 0, 'ALTER TABLE repair_orders DROP COLUMN cross_check_note', 'SELECT ''cross_check_note does not exist'' AS message');
PREPARE stmt FROM @rollback_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND COLUMN_NAME = 'cross_checked_at'
);
SET @rollback_sql := IF(@column_exists > 0, 'ALTER TABLE repair_orders DROP COLUMN cross_checked_at', 'SELECT ''cross_checked_at does not exist'' AS message');
PREPARE stmt FROM @rollback_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND COLUMN_NAME = 'cross_checked_by_staff_id'
);
SET @rollback_sql := IF(@column_exists > 0, 'ALTER TABLE repair_orders DROP COLUMN cross_checked_by_staff_id', 'SELECT ''cross_checked_by_staff_id does not exist'' AS message');
PREPARE stmt FROM @rollback_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND COLUMN_NAME = 'cross_check_status'
);
SET @rollback_sql := IF(@column_exists > 0, 'ALTER TABLE repair_orders DROP COLUMN cross_check_status', 'SELECT ''cross_check_status does not exist'' AS message');
PREPARE stmt FROM @rollback_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
