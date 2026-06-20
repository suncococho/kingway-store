CREATE TABLE company_store_settlements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  settlement_no VARCHAR(80) NOT NULL,
  company_id BIGINT UNSIGNED NOT NULL,
  hq_store_id BIGINT UNSIGNED NOT NULL,
  target_store_id BIGINT UNSIGNED NOT NULL,
  target_relationship_type ENUM('DIRECT_STORE','FRANCHISE_STORE') NOT NULL,
  settlement_month CHAR(7) NOT NULL,
  status ENUM('DRAFT','CONFIRMED','PARTIALLY_PAID','PAID','CANCELED') NOT NULL DEFAULT 'DRAFT',
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  confirmed_at DATETIME NULL,
  paid_at DATETIME NULL,
  generated_by_staff_id BIGINT UNSIGNED NULL,
  confirmed_by_staff_id BIGINT UNSIGNED NULL,
  paid_by_staff_id BIGINT UNSIGNED NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_store_settlements_no (settlement_no),
  KEY idx_company_store_settlements_company (company_id),
  KEY idx_company_store_settlements_hq_store (hq_store_id),
  KEY idx_company_store_settlements_target_store (target_store_id),
  KEY idx_company_store_settlements_month (settlement_month),
  KEY idx_company_store_settlements_status (status),
  CONSTRAINT fk_company_store_settlements_company
    FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_company_store_settlements_hq_store
    FOREIGN KEY (hq_store_id) REFERENCES stores(id),
  CONSTRAINT fk_company_store_settlements_target_store
    FOREIGN KEY (target_store_id) REFERENCES stores(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE company_store_settlement_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  settlement_id BIGINT UNSIGNED NOT NULL,
  transfer_id BIGINT UNSIGNED NOT NULL,
  transfer_item_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  sku_snapshot VARCHAR(120) NOT NULL,
  product_name_snapshot VARCHAR(255) NOT NULL,
  quantity_received INT UNSIGNED NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  source_received_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_company_store_settlement_items_settlement (settlement_id),
  KEY idx_company_store_settlement_items_transfer (transfer_id),
  KEY idx_company_store_settlement_items_transfer_item (transfer_item_id),
  KEY idx_company_store_settlement_items_product (product_id),
  CONSTRAINT fk_company_store_settlement_items_settlement
    FOREIGN KEY (settlement_id) REFERENCES company_store_settlements(id),
  CONSTRAINT fk_company_store_settlement_items_transfer
    FOREIGN KEY (transfer_id) REFERENCES store_transfers(id),
  CONSTRAINT fk_company_store_settlement_items_transfer_item
    FOREIGN KEY (transfer_item_id) REFERENCES store_transfer_items(id),
  CONSTRAINT fk_company_store_settlement_items_product
    FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
