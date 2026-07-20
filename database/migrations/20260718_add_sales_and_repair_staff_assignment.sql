-- Adds optional staff assignment snapshots for orders and repair orders.
-- Safe to run repeatedly: columns and indexes are added only when missing.
-- Existing rows are not backfilled to preserve historical audit meaning.

SET @orders_sales_staff_id_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'sales_staff_id'
);
SET @sql := IF(
  @orders_sales_staff_id_exists = 0,
  'ALTER TABLE orders ADD COLUMN sales_staff_id BIGINT UNSIGNED NULL COMMENT ''銷售人員 staff_users.id snapshot reference'' AFTER created_by',
  'SELECT ''orders.sales_staff_id already exists'' AS message'
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
  @orders_sales_staff_name_exists = 0,
  'ALTER TABLE orders ADD COLUMN sales_staff_name VARCHAR(100) NULL COMMENT ''銷售人員顯示名稱快照'' AFTER sales_staff_id',
  'SELECT ''orders.sales_staff_name already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @orders_sales_staff_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND INDEX_NAME = 'idx_orders_store_sales_staff'
);
SET @sql := IF(
  @orders_sales_staff_idx_exists = 0,
  'ALTER TABLE orders ADD INDEX idx_orders_store_sales_staff (store_id, sales_staff_id)',
  'SELECT ''idx_orders_store_sales_staff already exists'' AS message'
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
  @repair_staff_id_exists = 0,
  'ALTER TABLE repair_orders ADD COLUMN repair_staff_id BIGINT UNSIGNED NULL COMMENT ''維修人員 staff_users.id snapshot reference'' AFTER approved_by_staff_id',
  'SELECT ''repair_orders.repair_staff_id already exists'' AS message'
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
  @repair_staff_name_exists = 0,
  'ALTER TABLE repair_orders ADD COLUMN repair_staff_name VARCHAR(100) NULL COMMENT ''維修人員顯示名稱快照'' AFTER repair_staff_id',
  'SELECT ''repair_orders.repair_staff_name already exists'' AS message'
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
  @repair_staff_idx_exists = 0,
  'ALTER TABLE repair_orders ADD INDEX idx_repair_orders_store_repair_staff (store_id, repair_staff_id)',
  'SELECT ''idx_repair_orders_store_repair_staff already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
