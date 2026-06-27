CREATE TABLE IF NOT EXISTS order_payment_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT NULL,
  store_id BIGINT NOT NULL,
  order_id BIGINT NOT NULL,
  payment_stage ENUM('DEPOSIT','BALANCE','FULL_PAYMENT','ADJUSTMENT') NOT NULL DEFAULT 'BALANCE',
  payment_method VARCHAR(50) NOT NULL,
  received_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  note TEXT NULL,
  received_by_staff_user_id BIGINT NOT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_order_payment_records_order (order_id, received_at),
  INDEX idx_order_payment_records_store_date (store_id, received_at),
  INDEX idx_order_payment_records_staff (received_by_staff_user_id, received_at),
  INDEX idx_order_payment_records_method (payment_method, received_at)
);

ALTER TABLE orders
  ADD COLUMN final_payment_method VARCHAR(50) NULL,
  ADD COLUMN final_payment_received_amount DECIMAL(12,2) NULL,
  ADD COLUMN final_payment_note TEXT NULL,
  ADD COLUMN final_payment_completed_by_staff_user_id BIGINT NULL,
  ADD COLUMN final_payment_completed_at DATETIME NULL;
