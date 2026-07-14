SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND COLUMN_NAME = 'mileage_km'
);

SET @migration_sql := IF(
  @column_exists = 0,
  'ALTER TABLE repair_orders ADD COLUMN mileage_km INT UNSIGNED NULL COMMENT ''目前行駛里程（km）''',
  'SELECT ''mileage_km already exists'' AS message'
);

PREPARE stmt FROM @migration_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
