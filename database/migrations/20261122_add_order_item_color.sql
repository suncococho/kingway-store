SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'color'
);

SET @migration_sql := IF(
  @column_exists = 0,
  'ALTER TABLE order_items ADD COLUMN color VARCHAR(80) NULL COMMENT ''訂單品項車身顏色（顏色不分 SKU）''',
  'SELECT ''order_items.color already exists'' AS message'
);

PREPARE stmt FROM @migration_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
