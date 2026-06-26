CREATE TABLE IF NOT EXISTS repair_order_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  repair_order_id BIGINT UNSIGNED NOT NULL,
  uploaded_by VARCHAR(40) NOT NULL DEFAULT 'customer',
  file_type ENUM('image','video') NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  public_url VARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_repair_order_attachments_repair (store_id, repair_order_id, created_at),
  INDEX idx_repair_order_attachments_store_created (store_id, created_at)
);
