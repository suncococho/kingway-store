CREATE DATABASE IF NOT EXISTS kingway_store CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE kingway_store;

CREATE TABLE IF NOT EXISTS staff_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  line_user_id VARCHAR(100) NULL UNIQUE,
  role ENUM('ADMIN', 'MANAGER', 'CASHIER', 'REPAIR', 'INVENTORY') NOT NULL DEFAULT 'CASHIER',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(30) NULL,
  line_user_id VARCHAR(100) NULL UNIQUE,
  customer_type ENUM('LINE','OFFLINE_WITH_PHONE','OFFLINE_NO_PHONE') NOT NULL DEFAULT 'LINE',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  category ENUM('EBIKE', 'REPAIR', 'ACCESSORY', 'OTHER') NOT NULL DEFAULT 'OTHER',
  price DECIMAL(12,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  reorder_level INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(50) NOT NULL UNIQUE,
  customer_id BIGINT UNSIGNED NULL,
  customer_name VARCHAR(120) NULL,
  customer_phone VARCHAR(30) NULL,
  customer_type ENUM('LINE','OFFLINE_WITH_PHONE','OFFLINE_NO_PHONE') NOT NULL DEFAULT 'LINE',
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_method ENUM('CASH', 'CARD', 'LINE_PAY', 'TRANSFER', 'OTHER') NOT NULL DEFAULT 'CASH',
  status ENUM('PENDING', 'COMPLETED', 'CANCELED') NOT NULL DEFAULT 'COMPLETED',
  notes TEXT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  business_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_orders_staff FOREIGN KEY (created_by) REFERENCES staff_users(id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  sku_snapshot VARCHAR(100) NOT NULL,
  product_name_snapshot VARCHAR(150) NOT NULL,
  product_category_snapshot ENUM('EBIKE', 'REPAIR', 'ACCESSORY', 'OTHER') NOT NULL DEFAULT 'OTHER',
  quantity INT NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  line_total DECIMAL(12,2) NOT NULL,
  line_option_group_id BIGINT UNSIGNED NULL COMMENT 'LINE訂單選配群組ID快照',
  line_option_group_code VARCHAR(40) NULL COMMENT 'LINE訂單選配群組代碼快照',
  line_option_group_label VARCHAR(120) NULL COMMENT 'LINE訂單選配群組名稱快照',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id)
);

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
  CONSTRAINT fk_line_order_option_settings_created_by FOREIGN KEY (created_by_staff_id) REFERENCES staff_users(id),
  CONSTRAINT fk_line_order_option_settings_updated_by FOREIGN KEY (updated_by_staff_id) REFERENCES staff_users(id)
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
  CONSTRAINT fk_line_order_option_groups_created_by FOREIGN KEY (created_by_staff_id) REFERENCES staff_users(id),
  CONSTRAINT fk_line_order_option_groups_updated_by FOREIGN KEY (updated_by_staff_id) REFERENCES staff_users(id)
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
  CONSTRAINT fk_line_order_option_group_products_group FOREIGN KEY (option_group_id) REFERENCES line_order_option_groups(id),
  CONSTRAINT fk_line_order_option_group_products_product FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT UNSIGNED NOT NULL,
  movement_type ENUM('IN', 'OUT', 'ADJUST', 'SALE', 'RESTOCK', 'ADJUSTMENT') NOT NULL,
  quantity INT NOT NULL,
  reference_type VARCHAR(50) NULL,
  reference_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_inventory_movements_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_inventory_movements_staff FOREIGN KEY (created_by) REFERENCES staff_users(id)
);

CREATE TABLE IF NOT EXISTS line_group_registrations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  line_group_id VARCHAR(100) NOT NULL UNIQUE,
  source_type ENUM('group', 'room') NOT NULL,
  registration_type ENUM('admin', 'staff', 'repair', 'inventory', 'daily') NOT NULL DEFAULT 'daily',
  group_name VARCHAR(150) NOT NULL,
  registered_by_line_user_id VARCHAR(100) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_confirmations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NULL,
  customer_id BIGINT UNSIGNED NULL,
  token VARCHAR(120) NULL UNIQUE,
  status ENUM('PENDING', 'COMPLETED', 'EXPIRED', 'CANCELED') NOT NULL DEFAULT 'PENDING',
  buyer_name VARCHAR(120) NULL,
  buyer_phone VARCHAR(40) NULL,
  buyer_id_number VARCHAR(40) NULL,
  delivery_checks_json LONGTEXT NULL,
  staff_explanations_json LONGTEXT NULL,
  terms_accepted TINYINT(1) NOT NULL DEFAULT 0,
  final_confirmation_accepted TINYINT(1) NOT NULL DEFAULT 0,
  signature_data LONGTEXT NULL,
  html_snapshot LONGTEXT NULL,
  pdf_path VARCHAR(255) NULL,
  submitted_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_by_line_user_id VARCHAR(100) NULL,
  CONSTRAINT fk_purchase_confirmations_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_purchase_confirmations_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS purchase_confirmation_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(120) NOT NULL UNIQUE,
  order_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_purchase_confirmation_tokens_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_purchase_confirmation_tokens_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS repair_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  customer_type ENUM('LINE','OFFLINE_WITH_PHONE','OFFLINE_NO_PHONE') NOT NULL DEFAULT 'LINE',
  source ENUM('LINE','WEB','POS') NOT NULL DEFAULT 'WEB',
  bike_model VARCHAR(150) NOT NULL,
  issue_description TEXT NOT NULL,
  reservation_date DATE NOT NULL,
  reservation_day VARCHAR(20) NOT NULL,
  status ENUM(
    'reserved',
    'checking',
    'estimate_pending_approval',
    'estimate_approved',
    'estimate_rejected',
    'repairing',
    'completed_waiting_pickup',
    'picked_up',
    'canceled'
  ) NOT NULL DEFAULT 'reserved',
  estimate_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  base_fee DECIMAL(12,2) NOT NULL DEFAULT 400,
  storage_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  approved_by_staff_id BIGINT UNSIGNED NULL,
  completed_at DATETIME NULL,
  picked_up_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_repair_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_repair_orders_staff FOREIGN KEY (approved_by_staff_id) REFERENCES staff_users(id)
);

CREATE TABLE IF NOT EXISTS repair_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  repair_order_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(80) NOT NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_repair_logs_order FOREIGN KEY (repair_order_id) REFERENCES repair_orders(id)
);

CREATE TABLE IF NOT EXISTS coupons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  coupon_type ENUM('new_friend', 'google_review') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,
  is_used TINYINT(1) NOT NULL DEFAULT 0,
  issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at DATETIME NULL,
  approved_by_staff_id BIGINT UNSIGNED NULL,
  order_id BIGINT UNSIGNED NULL,
  CONSTRAINT fk_coupons_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_coupons_staff FOREIGN KEY (approved_by_staff_id) REFERENCES staff_users(id),
  CONSTRAINT fk_coupons_order FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS surveys (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  rating INT NOT NULL,
  feedback TEXT NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  token VARCHAR(120) NULL UNIQUE,
  CONSTRAINT fk_surveys_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_surveys_order FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS staff_attendance (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  staff_user_id BIGINT UNSIGNED NOT NULL,
  check_in_at DATETIME NOT NULL,
  check_out_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_staff_attendance_staff FOREIGN KEY (staff_user_id) REFERENCES staff_users(id)
);

CREATE TABLE IF NOT EXISTS staff_kpi_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  staff_user_id BIGINT UNSIGNED NOT NULL,
  action_type VARCHAR(80) NOT NULL,
  ref_type VARCHAR(80) NULL,
  ref_id BIGINT UNSIGNED NULL,
  score INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_staff_kpi_logs_staff FOREIGN KEY (staff_user_id) REFERENCES staff_users(id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  store_id BIGINT UNSIGNED NULL,
  setting_scope ENUM('STORE', 'SYSTEM') NOT NULL,
  payload_json LONGTEXT NOT NULL,
  updated_by_staff_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_app_settings_store_scope (store_id, setting_scope),
  INDEX idx_app_settings_store_scope (store_id, setting_scope)
);

CREATE INDEX idx_orders_business_date ON orders (business_date);
CREATE INDEX idx_inventory_movements_product ON inventory_movements (product_id, created_at);
CREATE INDEX idx_purchase_confirmations_order ON purchase_confirmations (order_id);
CREATE INDEX idx_purchase_confirmations_status_created ON purchase_confirmations (status, created_at);
CREATE INDEX idx_repair_orders_status ON repair_orders (status, reservation_date);
CREATE INDEX idx_coupons_customer_type ON coupons (customer_id, coupon_type);
CREATE INDEX idx_staff_attendance_staff ON staff_attendance (staff_user_id, check_in_at);
CREATE INDEX idx_staff_kpi_logs_staff ON staff_kpi_logs (staff_user_id, created_at);

CREATE TABLE IF NOT EXISTS purchase_confirmation_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id VARCHAR(50) NOT NULL,
  customer_id INT NOT NULL,
  status VARCHAR(50) DEFAULT 'REQUESTED',
  requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  approved_at DATETIME,
  rejected_at DATETIME
);

CREATE TABLE IF NOT EXISTS customer_crm_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  stage VARCHAR(80) NULL,
  note TEXT NULL,
  created_by_staff_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_customer_crm_events_customer (customer_id, created_at)
);

CREATE TABLE IF NOT EXISTS follow_up_tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  action_type ENUM('3_day','7_day','14_day','manual') NOT NULL,
  status ENUM('pending','sent','done','canceled') NOT NULL DEFAULT 'pending',
  message TEXT NULL,
  created_by_staff_id BIGINT UNSIGNED NULL,
  sent_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_follow_up_tasks_customer (customer_id, created_at)
);

CREATE TABLE IF NOT EXISTS supplier_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_type ENUM('PURCHASE_ORDER','RETURN') NOT NULL,
  status ENUM('PENDING_SUPPLIER','APPROVED','REJECTED','PARTIALLY_RECEIVED','RECEIVED','RETURN_CONFIRMED','CANCELED') NOT NULL DEFAULT 'PENDING_SUPPLIER',
  supplier_name VARCHAR(150) NULL,
  note TEXT NULL,
  requested_by_staff_id BIGINT UNSIGNED NOT NULL,
  supplier_response_note TEXT NULL,
  supplier_responded_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_supplier_requests_status (status, created_at)
);

CREATE TABLE IF NOT EXISTS supplier_request_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  supplier_request_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  quantity INT NOT NULL,
  received_quantity INT NOT NULL DEFAULT 0,
  reason VARCHAR(255) NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_supplier_request_items_request (supplier_request_id)
);

CREATE TABLE IF NOT EXISTS operational_checklists (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  staff_user_id BIGINT UNSIGNED NOT NULL,
  checklist_date DATE NOT NULL,
  item_key VARCHAR(80) NOT NULL,
  item_label VARCHAR(150) NOT NULL,
  is_done TINYINT(1) NOT NULL DEFAULT 0,
  completed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_operational_checklists_item (staff_user_id, checklist_date, item_key)
);

CREATE TABLE IF NOT EXISTS v2_workflow_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  ref_type VARCHAR(80) NULL,
  ref_id BIGINT UNSIGNED NULL,
  payload JSON NULL,
  created_by_staff_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_v2_workflow_events_ref (ref_type, ref_id, created_at)
);

CREATE TABLE IF NOT EXISTS line_chat_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  line_user_id VARCHAR(64) NOT NULL,
  flow_type VARCHAR(80) NOT NULL,
  step_key VARCHAR(80) NOT NULL,
  payload JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_line_chat_sessions_user_flow (line_user_id, flow_type),
  INDEX idx_line_chat_sessions_flow (flow_type, updated_at)
);
