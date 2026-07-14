SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND COLUMN_NAME = 'mileage_km'
);

SET @rollback_sql := IF(
  @column_exists > 0,
  'ALTER TABLE repair_orders DROP COLUMN mileage_km',
  'SELECT ''mileage_km does not exist'' AS message'
);

PREPARE stmt FROM @rollback_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
