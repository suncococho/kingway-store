CREATE TABLE store_replenishment_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_no VARCHAR(64) NOT NULL,
  company_id BIGINT UNSIGNED NOT NULL,
  requesting_store_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  requested_by_staff_user_id BIGINT UNSIGNED NULL,
  note TEXT NULL,
  submitted_at DATETIME NULL,
  fulfilled_at DATETIME NULL,
  canceled_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_replenishment_requests_no (request_no),
  KEY idx_srr_company_status_created (company_id, status, created_at),
  KEY idx_srr_store_status_created (requesting_store_id, status, created_at),
  CONSTRAINT fk_srr_company
    FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_srr_requesting_store
    FOREIGN KEY (requesting_store_id) REFERENCES stores(id),
  CONSTRAINT fk_srr_requested_by_staff
    FOREIGN KEY (requested_by_staff_user_id) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE store_replenishment_request_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT UNSIGNED NOT NULL,
  hq_product_id BIGINT UNSIGNED NOT NULL,
  requested_sku VARCHAR(128) NOT NULL,
  requested_product_name VARCHAR(255) NOT NULL,
  target_store_product_id BIGINT UNSIGNED NULL,
  quantity_requested INT UNSIGNED NOT NULL,
  quantity_fulfilled INT UNSIGNED NOT NULL DEFAULT 0,
  unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'REQUESTED',
  transfer_id BIGINT UNSIGNED NULL,
  transfer_item_id BIGINT UNSIGNED NULL,
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_srri_request (request_id),
  KEY idx_srri_hq_product (hq_product_id),
  KEY idx_srri_transfer (transfer_id),
  KEY idx_srri_status (status),
  CONSTRAINT fk_srri_request
    FOREIGN KEY (request_id) REFERENCES store_replenishment_requests(id),
  CONSTRAINT fk_srri_hq_product
    FOREIGN KEY (hq_product_id) REFERENCES products(id),
  CONSTRAINT fk_srri_target_store_product
    FOREIGN KEY (target_store_product_id) REFERENCES products(id),
  CONSTRAINT fk_srri_transfer
    FOREIGN KEY (transfer_id) REFERENCES store_transfers(id),
  CONSTRAINT fk_srri_transfer_item
    FOREIGN KEY (transfer_item_id) REFERENCES store_transfer_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
