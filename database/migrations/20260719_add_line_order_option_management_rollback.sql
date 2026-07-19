-- Rollback for LINE customer order option management.
-- Removes only structures introduced by 20260719_add_line_order_option_management.sql.

SET @order_items_line_option_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND INDEX_NAME = 'idx_order_items_line_option_group'
);
SET @sql := IF(
  @order_items_line_option_idx_exists > 0,
  'ALTER TABLE order_items DROP INDEX idx_order_items_line_option_group',
  'SELECT ''idx_order_items_line_option_group does not exist'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @line_option_group_label_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'line_option_group_label'
);
SET @sql := IF(
  @line_option_group_label_exists > 0,
  'ALTER TABLE order_items DROP COLUMN line_option_group_label',
  'SELECT ''order_items.line_option_group_label does not exist'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @line_option_group_code_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'line_option_group_code'
);
SET @sql := IF(
  @line_option_group_code_exists > 0,
  'ALTER TABLE order_items DROP COLUMN line_option_group_code',
  'SELECT ''order_items.line_option_group_code does not exist'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @line_option_group_id_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'line_option_group_id'
);
SET @sql := IF(
  @line_option_group_id_exists > 0,
  'ALTER TABLE order_items DROP COLUMN line_option_group_id',
  'SELECT ''order_items.line_option_group_id does not exist'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP TABLE IF EXISTS line_order_option_group_products;
DROP TABLE IF EXISTS line_order_option_groups;
DROP TABLE IF EXISTS line_order_option_settings;
