CREATE TABLE store_transfers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  from_store_id BIGINT UNSIGNED NOT NULL,
  to_store_id BIGINT UNSIGNED NOT NULL,
  transfer_no VARCHAR(80) NOT NULL,
  status ENUM('DRAFT','SHIPPED','PARTIALLY_RECEIVED','RECEIVED','DISCREPANCY','CANCELED') NOT NULL DEFAULT 'DRAFT',
  shipped_at DATETIME NULL,
  received_at DATETIME NULL,
  created_by_staff_id BIGINT UNSIGNED NULL,
  received_by_staff_id BIGINT UNSIGNED NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_transfers_company_no (company_id, transfer_no),
  KEY idx_store_transfers_company_status_created (company_id, status, created_at),
  KEY idx_store_transfers_from_store_status (from_store_id, status),
  KEY idx_store_transfers_to_store_status (to_store_id, status),
  CONSTRAINT fk_store_transfers_company
    FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_store_transfers_from_store
    FOREIGN KEY (from_store_id) REFERENCES stores(id),
  CONSTRAINT fk_store_transfers_to_store
    FOREIGN KEY (to_store_id) REFERENCES stores(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE store_transfer_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  transfer_id BIGINT UNSIGNED NOT NULL,
  from_product_id BIGINT UNSIGNED NOT NULL,
  to_product_id BIGINT UNSIGNED NOT NULL,
  sku_snapshot VARCHAR(120) NOT NULL,
  product_name_snapshot VARCHAR(255) NOT NULL,
  quantity_shipped INT UNSIGNED NOT NULL,
  quantity_received INT UNSIGNED NOT NULL DEFAULT 0,
  unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_store_transfer_items_transfer (transfer_id),
  KEY idx_store_transfer_items_from_product (from_product_id),
  KEY idx_store_transfer_items_to_product (to_product_id),
  CONSTRAINT fk_store_transfer_items_transfer
    FOREIGN KEY (transfer_id) REFERENCES store_transfers(id),
  CONSTRAINT fk_store_transfer_items_from_product
    FOREIGN KEY (from_product_id) REFERENCES products(id),
  CONSTRAINT fk_store_transfer_items_to_product
    FOREIGN KEY (to_product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback:
-- DROP TABLE IF EXISTS store_transfer_items;
-- DROP TABLE IF EXISTS store_transfers;
