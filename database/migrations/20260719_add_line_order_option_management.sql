-- LINE customer order option management.
-- Forward-only structure change: no existing rows are modified or backfilled.
-- Safe to run repeatedly: tables, columns, and indexes are created only when missing.

CREATE TABLE IF NOT EXISTS line_order_option_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,
  page_title VARCHAR(150) NOT NULL DEFAULT '選擇您需要的配件',
  page_description VARCHAR(500) NOT NULL DEFAULT '可依照需求選擇配件，也可以略過此步驟',
  allow_skip TINYINT(1) NOT NULL DEFAULT 1,
  show_out_of_stock TINYINT(1) NOT NULL DEFAULT 1,
  show_prices TINYINT(1) NOT NULL DEFAULT 1,
  created_by_staff_id BIGINT UNSIGNED NULL,
  updated_by_staff_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_line_order_option_settings_store (store_id),
  INDEX idx_line_order_option_settings_enabled (store_id, is_enabled),
  CONSTRAINT fk_line_order_option_settings_created_by
    FOREIGN KEY (created_by_staff_id) REFERENCES staff_users(id),
  CONSTRAINT fk_line_order_option_settings_updated_by
    FOREIGN KEY (updated_by_staff_id) REFERENCES staff_users(id)
);

CREATE TABLE IF NOT EXISTS line_order_option_groups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(40) NOT NULL,
  label VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  is_required TINYINT(1) NOT NULL DEFAULT 0,
  min_select INT UNSIGNED NOT NULL DEFAULT 0,
  max_select INT UNSIGNED NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by_staff_id BIGINT UNSIGNED NULL,
  updated_by_staff_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  UNIQUE KEY uk_line_order_option_groups_store_code_active (store_id, code, deleted_at),
  INDEX idx_line_order_option_groups_store_sort (store_id, deleted_at, is_active, sort_order, id),
  CONSTRAINT fk_line_order_option_groups_created_by
    FOREIGN KEY (created_by_staff_id) REFERENCES staff_users(id),
  CONSTRAINT fk_line_order_option_groups_updated_by
    FOREIGN KEY (updated_by_staff_id) REFERENCES staff_users(id)
);

CREATE TABLE IF NOT EXISTS line_order_option_group_products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  option_group_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  custom_display_name VARCHAR(150) NULL,
  custom_price DECIMAL(12,2) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_line_order_option_group_products_group_product (option_group_id, product_id),
  INDEX idx_line_order_option_group_products_store_group_sort (store_id, option_group_id, is_active, sort_order, id),
  INDEX idx_line_order_option_group_products_product (store_id, product_id),
  CONSTRAINT fk_line_order_option_group_products_group
    FOREIGN KEY (option_group_id) REFERENCES line_order_option_groups(id),
  CONSTRAINT fk_line_order_option_group_products_product
    FOREIGN KEY (product_id) REFERENCES products(id)
);

SET @line_option_group_id_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'line_option_group_id'
);
SET @sql := IF(
  @line_option_group_id_exists = 0,
  'ALTER TABLE order_items ADD COLUMN line_option_group_id BIGINT UNSIGNED NULL COMMENT ''LINE訂單選配群組ID快照'' AFTER line_total',
  'SELECT ''order_items.line_option_group_id already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @line_option_group_code_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'line_option_group_code'
);
SET @sql := IF(
  @line_option_group_code_exists = 0,
  'ALTER TABLE order_items ADD COLUMN line_option_group_code VARCHAR(40) NULL COMMENT ''LINE訂單選配群組代碼快照'' AFTER line_option_group_id',
  'SELECT ''order_items.line_option_group_code already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @line_option_group_label_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'line_option_group_label'
);
SET @sql := IF(
  @line_option_group_label_exists = 0,
  'ALTER TABLE order_items ADD COLUMN line_option_group_label VARCHAR(120) NULL COMMENT ''LINE訂單選配群組名稱快照'' AFTER line_option_group_code',
  'SELECT ''order_items.line_option_group_label already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @order_items_line_option_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND INDEX_NAME = 'idx_order_items_line_option_group'
);
SET @sql := IF(
  @order_items_line_option_idx_exists = 0,
  'ALTER TABLE order_items ADD INDEX idx_order_items_line_option_group (store_id, line_option_group_id)',
  'SELECT ''idx_order_items_line_option_group already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
