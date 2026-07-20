-- WARNING: this rollback removes staff assignment snapshots from historical order and repair records.
-- Run only after confirming the business accepts losing sales_staff_name and repair_staff_name history.

SET @orders_sales_staff_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND INDEX_NAME = 'idx_orders_store_sales_staff'
);
SET @sql := IF(
  @orders_sales_staff_idx_exists > 0,
  'ALTER TABLE orders DROP INDEX idx_orders_store_sales_staff',
  'SELECT ''idx_orders_store_sales_staff does not exist'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @orders_sales_staff_name_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'sales_staff_name'
);
SET @sql := IF(
  @orders_sales_staff_name_exists > 0,
  'ALTER TABLE orders DROP COLUMN sales_staff_name',
  'SELECT ''orders.sales_staff_name does not exist'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @orders_sales_staff_id_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'sales_staff_id'
);
SET @sql := IF(
  @orders_sales_staff_id_exists > 0,
  'ALTER TABLE orders DROP COLUMN sales_staff_id',
  'SELECT ''orders.sales_staff_id does not exist'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @repair_staff_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND INDEX_NAME = 'idx_repair_orders_store_repair_staff'
);
SET @sql := IF(
  @repair_staff_idx_exists > 0,
  'ALTER TABLE repair_orders DROP INDEX idx_repair_orders_store_repair_staff',
  'SELECT ''idx_repair_orders_store_repair_staff does not exist'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @repair_staff_name_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND COLUMN_NAME = 'repair_staff_name'
);
SET @sql := IF(
  @repair_staff_name_exists > 0,
  'ALTER TABLE repair_orders DROP COLUMN repair_staff_name',
  'SELECT ''repair_orders.repair_staff_name does not exist'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @repair_staff_id_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repair_orders'
    AND COLUMN_NAME = 'repair_staff_id'
);
SET @sql := IF(
  @repair_staff_id_exists > 0,
  'ALTER TABLE repair_orders DROP COLUMN repair_staff_id',
  'SELECT ''repair_orders.repair_staff_id does not exist'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
