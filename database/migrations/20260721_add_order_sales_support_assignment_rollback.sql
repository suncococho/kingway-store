-- Rollback optional support salesperson assignment fields.
-- Run only after confirming no required data remains.

SET @support_staff_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND INDEX_NAME = 'idx_orders_store_sales_support_staff'
);

SET @sql := IF(
  @support_staff_index_exists > 0,
  'ALTER TABLE orders
     DROP INDEX idx_orders_store_sales_support_staff',
  'SELECT ''idx_orders_store_sales_support_staff does not exist'' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


SET @support_staff_name_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'sales_support_staff_name'
);

SET @sql := IF(
  @support_staff_name_exists > 0,
  'ALTER TABLE orders
     DROP COLUMN sales_support_staff_name',
  'SELECT ''orders.sales_support_staff_name does not exist'' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


SET @support_staff_id_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'sales_support_staff_id'
);

SET @sql := IF(
  @support_staff_id_exists > 0,
  'ALTER TABLE orders
     DROP COLUMN sales_support_staff_id',
  'SELECT ''orders.sales_support_staff_id does not exist'' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
