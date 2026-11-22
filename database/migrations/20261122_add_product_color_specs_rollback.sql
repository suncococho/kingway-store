SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'specs'
);

SET @rollback_sql := IF(
  @column_exists > 0,
  'ALTER TABLE products DROP COLUMN specs',
  'SELECT ''specs does not exist'' AS message'
);

PREPARE stmt FROM @rollback_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'color'
);

SET @rollback_sql := IF(
  @column_exists > 0,
  'ALTER TABLE products DROP COLUMN color',
  'SELECT ''color does not exist'' AS message'
);

PREPARE stmt FROM @rollback_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
