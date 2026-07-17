SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND COLUMN_NAME = 'cross_check_status'
);
SET @migration_sql := IF(
  @column_exists = 0,
  'ALTER TABLE repair_orders ADD COLUMN cross_check_status ENUM(''PENDING'',''APPROVED'',''NEEDS_REVISION'') NOT NULL DEFAULT ''PENDING'' COMMENT ''維修報價前交叉確認狀態'' AFTER inspection_notes',
  'SELECT ''cross_check_status already exists'' AS message'
);
PREPARE stmt FROM @migration_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND COLUMN_NAME = 'cross_checked_by_staff_id'
);
SET @migration_sql := IF(
  @column_exists = 0,
  'ALTER TABLE repair_orders ADD COLUMN cross_checked_by_staff_id BIGINT UNSIGNED NULL COMMENT ''維修報價交叉確認員工'' AFTER cross_check_status',
  'SELECT ''cross_checked_by_staff_id already exists'' AS message'
);
PREPARE stmt FROM @migration_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND COLUMN_NAME = 'cross_checked_at'
);
SET @migration_sql := IF(
  @column_exists = 0,
  'ALTER TABLE repair_orders ADD COLUMN cross_checked_at DATETIME NULL COMMENT ''維修報價交叉確認時間'' AFTER cross_checked_by_staff_id',
  'SELECT ''cross_checked_at already exists'' AS message'
);
PREPARE stmt FROM @migration_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND COLUMN_NAME = 'cross_check_note'
);
SET @migration_sql := IF(
  @column_exists = 0,
  'ALTER TABLE repair_orders ADD COLUMN cross_check_note TEXT NULL COMMENT ''維修報價交叉確認備註'' AFTER cross_checked_at',
  'SELECT ''cross_check_note already exists'' AS message'
);
PREPARE stmt FROM @migration_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND COLUMN_NAME = 'diagnosis_updated_by_staff_id'
);
SET @migration_sql := IF(
  @column_exists = 0,
  'ALTER TABLE repair_orders ADD COLUMN diagnosis_updated_by_staff_id BIGINT UNSIGNED NULL COMMENT ''初步診斷最後更新員工'' AFTER cross_check_note',
  'SELECT ''diagnosis_updated_by_staff_id already exists'' AS message'
);
PREPARE stmt FROM @migration_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND COLUMN_NAME = 'diagnosis_updated_at'
);
SET @migration_sql := IF(
  @column_exists = 0,
  'ALTER TABLE repair_orders ADD COLUMN diagnosis_updated_at DATETIME NULL COMMENT ''初步診斷最後更新時間'' AFTER diagnosis_updated_by_staff_id',
  'SELECT ''diagnosis_updated_at already exists'' AS message'
);
PREPARE stmt FROM @migration_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND INDEX_NAME = 'idx_repair_orders_cross_check'
);
SET @migration_sql := IF(
  @index_exists = 0,
  'ALTER TABLE repair_orders ADD INDEX idx_repair_orders_cross_check (store_id, cross_check_status, cross_checked_at)',
  'SELECT ''idx_repair_orders_cross_check already exists'' AS message'
);
PREPARE stmt FROM @migration_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
