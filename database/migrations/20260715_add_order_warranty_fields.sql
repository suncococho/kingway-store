SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'warranty_start_date'
);
SET @migration_sql := IF(
  @column_exists = 0,
  'ALTER TABLE orders ADD COLUMN warranty_start_date DATE NULL COMMENT ''保固起算日'' AFTER handover_confirmed_by_staff_id',
  'SELECT ''warranty_start_date already exists'' AS message'
);
PREPARE stmt FROM @migration_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'warranty_months'
);
SET @migration_sql := IF(
  @column_exists = 0,
  'ALTER TABLE orders ADD COLUMN warranty_months INT UNSIGNED NULL COMMENT ''保固期間（月）'' AFTER warranty_start_date',
  'SELECT ''warranty_months already exists'' AS message'
);
PREPARE stmt FROM @migration_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'warranty_mileage_limit_km'
);
SET @migration_sql := IF(
  @column_exists = 0,
  'ALTER TABLE orders ADD COLUMN warranty_mileage_limit_km INT UNSIGNED NULL COMMENT ''保固里程上限（km）'' AFTER warranty_months',
  'SELECT ''warranty_mileage_limit_km already exists'' AS message'
);
PREPARE stmt FROM @migration_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'warranty_note'
);
SET @migration_sql := IF(
  @column_exists = 0,
  'ALTER TABLE orders ADD COLUMN warranty_note TEXT NULL COMMENT ''保固備註'' AFTER warranty_mileage_limit_km',
  'SELECT ''warranty_note already exists'' AS message'
);
PREPARE stmt FROM @migration_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'warranty_terms_version'
);
SET @migration_sql := IF(
  @column_exists = 0,
  'ALTER TABLE orders ADD COLUMN warranty_terms_version VARCHAR(100) NULL COMMENT ''保固條款版本'' AFTER warranty_note',
  'SELECT ''warranty_terms_version already exists'' AS message'
);
PREPARE stmt FROM @migration_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
