CREATE TABLE IF NOT EXISTS order_accessory_install_confirmations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  order_item_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  source_key VARCHAR(191) NOT NULL,
  sku VARCHAR(100) NULL,
  item_name VARCHAR(150) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  note TEXT NULL,
  is_installed TINYINT(1) NOT NULL DEFAULT 0,
  is_tested TINYINT(1) NOT NULL DEFAULT 0,
  is_photo_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  checked_by_staff_id BIGINT UNSIGNED NULL,
  checked_by_staff_name VARCHAR(120) NULL,
  checked_at DATETIME NULL,
  cross_checked_by_staff_id BIGINT UNSIGNED NULL,
  cross_checked_by_staff_name VARCHAR(120) NULL,
  cross_checked_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_order_accessory_item (store_id, order_id, order_item_id),
  KEY idx_order_accessory_order (store_id, order_id),
  CONSTRAINT fk_order_accessory_install_confirmations_order
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_order_accessory_install_confirmations_order_item
    FOREIGN KEY (order_item_id) REFERENCES order_items(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
