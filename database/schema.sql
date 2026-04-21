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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(50) NOT NULL UNIQUE,
  customer_id BIGINT UNSIGNED NULL,
  customer_name VARCHAR(120) NULL,
  customer_phone VARCHAR(30) NULL,
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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id)
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
  order_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,
  signature_data LONGTEXT NOT NULL,
  pdf_path VARCHAR(255) NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

ALTER TABLE products ADD COLUMN IF NOT EXISTS category ENUM('EBIKE', 'REPAIR', 'ACCESSORY', 'OTHER') NOT NULL DEFAULT 'OTHER';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name VARCHAR(120) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(30) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method ENUM('CASH', 'CARD', 'LINE_PAY', 'TRANSFER', 'OTHER') NOT NULL DEFAULT 'CASH';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status ENUM('PENDING', 'COMPLETED', 'CANCELED') NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_category_snapshot ENUM('EBIKE', 'REPAIR', 'ACCESSORY', 'OTHER') NOT NULL DEFAULT 'OTHER';
ALTER TABLE line_group_registrations ADD COLUMN IF NOT EXISTS registration_type ENUM('admin', 'staff', 'repair', 'inventory', 'daily') NOT NULL DEFAULT 'daily';

CREATE INDEX idx_orders_business_date ON orders (business_date);
CREATE INDEX idx_inventory_movements_product ON inventory_movements (product_id, created_at);
CREATE INDEX idx_purchase_confirmations_order ON purchase_confirmations (order_id);
CREATE INDEX idx_repair_orders_status ON repair_orders (status, reservation_date);
CREATE INDEX idx_coupons_customer_type ON coupons (customer_id, coupon_type);
CREATE INDEX idx_staff_attendance_staff ON staff_attendance (staff_user_id, check_in_at);
CREATE INDEX idx_staff_kpi_logs_staff ON staff_kpi_logs (staff_user_id, created_at);
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS line_user_id VARCHAR(100) NULL UNIQUE;
