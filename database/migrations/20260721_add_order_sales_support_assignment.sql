-- Adds optional support salesperson snapshots for shared sales.
-- Apply to staging only after backup and explicit review.
-- Existing orders remain unchanged.

SET @support_staff_id_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'sales_support_staff_id'
);

SET @sql := IF(
  @support_staff_id_exists = 0,
  'ALTER TABLE orders
     ADD COLUMN sales_support_staff_id BIGINT UNSIGNED NULL
     COMMENT ''共同銷售支援人員 staff_users.id snapshot reference''
     AFTER sales_staff_name',
  'SELECT ''orders.sales_support_staff_id already exists'' AS message'
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
  @support_staff_name_exists = 0,
  'ALTER TABLE orders
     ADD COLUMN sales_support_staff_name VARCHAR(100) NULL
     COMMENT ''共同銷售支援人員姓名快照''
     AFTER sales_support_staff_id',
  'SELECT ''orders.sales_support_staff_name already exists'' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


SET @support_staff_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND INDEX_NAME = 'idx_orders_store_sales_support_staff'
);

SET @sql := IF(
  @support_staff_index_exists = 0,
  'ALTER TABLE orders
     ADD INDEX idx_orders_store_sales_support_staff
       (store_id, sales_support_staff_id)',
  'SELECT ''idx_orders_store_sales_support_staff already exists'' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
