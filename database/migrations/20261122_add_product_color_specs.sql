SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'color'
);

SET @migration_sql := IF(
  @column_exists = 0,
  'ALTER TABLE products ADD COLUMN color VARCHAR(80) NULL COMMENT ''可選顏色（不分 SKU，如：黑、白、灰）''',
  'SELECT ''color already exists'' AS message'
);

PREPARE stmt FROM @migration_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'specs'
);

SET @migration_sql := IF(
  @column_exists = 0,
  'ALTER TABLE products ADD COLUMN specs TEXT NULL COMMENT ''商品規格（馬達、電池等）'' AFTER color',
  'SELECT ''specs already exists'' AS message'
);

PREPARE stmt FROM @migration_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
