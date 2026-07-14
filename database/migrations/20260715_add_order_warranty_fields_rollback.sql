SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'warranty_terms_version'
);
SET @rollback_sql := IF(
  @column_exists > 0,
  'ALTER TABLE orders DROP COLUMN warranty_terms_version',
  'SELECT ''warranty_terms_version does not exist'' AS message'
);
PREPARE stmt FROM @rollback_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'warranty_note'
);
SET @rollback_sql := IF(
  @column_exists > 0,
  'ALTER TABLE orders DROP COLUMN warranty_note',
  'SELECT ''warranty_note does not exist'' AS message'
);
PREPARE stmt FROM @rollback_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'warranty_mileage_limit_km'
);
SET @rollback_sql := IF(
  @column_exists > 0,
  'ALTER TABLE orders DROP COLUMN warranty_mileage_limit_km',
  'SELECT ''warranty_mileage_limit_km does not exist'' AS message'
);
PREPARE stmt FROM @rollback_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'warranty_months'
);
SET @rollback_sql := IF(
  @column_exists > 0,
  'ALTER TABLE orders DROP COLUMN warranty_months',
  'SELECT ''warranty_months does not exist'' AS message'
);
PREPARE stmt FROM @rollback_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'warranty_start_date'
);
SET @rollback_sql := IF(
  @column_exists > 0,
  'ALTER TABLE orders DROP COLUMN warranty_start_date',
  'SELECT ''warranty_start_date does not exist'' AS message'
);
PREPARE stmt FROM @rollback_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
