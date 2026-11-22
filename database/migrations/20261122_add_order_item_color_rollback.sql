SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'color'
);

SET @rollback_sql := IF(
  @column_exists > 0,
  'ALTER TABLE order_items DROP COLUMN color',
  'SELECT ''order_items.color does not exist'' AS message'
);

PREPARE stmt FROM @rollback_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
