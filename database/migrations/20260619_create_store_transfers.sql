CREATE TABLE IF NOT EXISTS store_transfers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  from_store_id BIGINT UNSIGNED NOT NULL,
  to_store_id BIGINT UNSIGNED NOT NULL,
  transfer_no VARCHAR(80) NOT NULL,
  status ENUM('DRAFT','SHIPPED','PARTIALLY_RECEIVED','RECEIVED','DISCREPANCY','CANCELED') NOT NULL DEFAULT 'DRAFT',
  shipped_at DATETIME NULL,
  received_at DATETIME NULL,
  created_by_staff_id BIGINT UNSIGNED NULL,
  shipped_by_staff_id BIGINT UNSIGNED NULL,
  received_by_staff_id BIGINT UNSIGNED NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_transfers_company_no (company_id, transfer_no),
  KEY idx_store_transfers_company (company_id),
  KEY idx_store_transfers_from_store (from_store_id),
  KEY idx_store_transfers_to_store (to_store_id),
  KEY idx_store_transfers_status (status),
  KEY idx_store_transfers_shipped_at (shipped_at),
  KEY idx_store_transfers_received_at (received_at),
  CONSTRAINT fk_store_transfers_company
    FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_store_transfers_from_store
    FOREIGN KEY (from_store_id) REFERENCES stores(id),
  CONSTRAINT fk_store_transfers_to_store
    FOREIGN KEY (to_store_id) REFERENCES stores(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS store_transfer_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  transfer_id BIGINT UNSIGNED NOT NULL,
  from_product_id BIGINT UNSIGNED NOT NULL,
  to_product_id BIGINT UNSIGNED NOT NULL,
  sku_snapshot VARCHAR(120) NOT NULL,
  product_name_snapshot VARCHAR(255) NOT NULL,
  quantity_shipped INT UNSIGNED NOT NULL,
  quantity_received INT UNSIGNED NOT NULL DEFAULT 0,
  unit_cost DECIMAL(12,2) NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_store_transfer_items_transfer (transfer_id),
  KEY idx_store_transfer_items_from_product (from_product_id),
  KEY idx_store_transfer_items_to_product (to_product_id),
  KEY idx_store_transfer_items_sku_snapshot (sku_snapshot),
  CONSTRAINT fk_store_transfer_items_transfer
    FOREIGN KEY (transfer_id) REFERENCES store_transfers(id),
  CONSTRAINT fk_store_transfer_items_from_product
    FOREIGN KEY (from_product_id) REFERENCES products(id),
  CONSTRAINT fk_store_transfer_items_to_product
    FOREIGN KEY (to_product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @add_shipped_by_staff_id := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE store_transfers ADD COLUMN shipped_by_staff_id BIGINT UNSIGNED NULL AFTER created_by_staff_id',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'store_transfers'
    AND COLUMN_NAME = 'shipped_by_staff_id'
);
PREPARE stmt FROM @add_shipped_by_staff_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_store_transfer_items_sku_idx := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE store_transfer_items ADD KEY idx_store_transfer_items_sku_snapshot (sku_snapshot)',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'store_transfer_items'
    AND INDEX_NAME = 'idx_store_transfer_items_sku_snapshot'
);
PREPARE stmt FROM @add_store_transfer_items_sku_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_store_transfers_company_idx := (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE store_transfers ADD KEY idx_store_transfers_company (company_id)', 'SELECT 1')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'store_transfers'
    AND INDEX_NAME = 'idx_store_transfers_company'
);
PREPARE stmt FROM @add_store_transfers_company_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_store_transfers_from_store_idx := (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE store_transfers ADD KEY idx_store_transfers_from_store (from_store_id)', 'SELECT 1')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'store_transfers'
    AND INDEX_NAME = 'idx_store_transfers_from_store'
);
PREPARE stmt FROM @add_store_transfers_from_store_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_store_transfers_to_store_idx := (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE store_transfers ADD KEY idx_store_transfers_to_store (to_store_id)', 'SELECT 1')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'store_transfers'
    AND INDEX_NAME = 'idx_store_transfers_to_store'
);
PREPARE stmt FROM @add_store_transfers_to_store_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_store_transfers_status_idx := (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE store_transfers ADD KEY idx_store_transfers_status (status)', 'SELECT 1')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'store_transfers'
    AND INDEX_NAME = 'idx_store_transfers_status'
);
PREPARE stmt FROM @add_store_transfers_status_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_store_transfers_shipped_at_idx := (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE store_transfers ADD KEY idx_store_transfers_shipped_at (shipped_at)', 'SELECT 1')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'store_transfers'
    AND INDEX_NAME = 'idx_store_transfers_shipped_at'
);
PREPARE stmt FROM @add_store_transfers_shipped_at_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_store_transfers_received_at_idx := (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE store_transfers ADD KEY idx_store_transfers_received_at (received_at)', 'SELECT 1')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'store_transfers'
    AND INDEX_NAME = 'idx_store_transfers_received_at'
);
PREPARE stmt FROM @add_store_transfers_received_at_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
