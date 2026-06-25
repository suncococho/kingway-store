CREATE TABLE IF NOT EXISTS store_notification_settings (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT NOT NULL,
  channel_type ENUM('LINE','TELEGRAM') NOT NULL DEFAULT 'LINE',
  purpose ENUM('STAFF_GROUP','DAILY_TASK','SYSTEM_ALERT') NOT NULL DEFAULT 'STAFF_GROUP',
  target_id VARCHAR(255) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  notify_order_reservation TINYINT(1) NOT NULL DEFAULT 1,
  notify_repair_reservation TINYINT(1) NOT NULL DEFAULT 1,
  notify_purchase_confirmation TINYINT(1) NOT NULL DEFAULT 1,
  notify_repair_confirmation TINYINT(1) NOT NULL DEFAULT 1,
  notify_replenishment TINYINT(1) NOT NULL DEFAULT 1,
  notify_transfer TINYINT(1) NOT NULL DEFAULT 1,
  notify_inbound TINYINT(1) NOT NULL DEFAULT 1,
  notify_daily_tasks TINYINT(1) NOT NULL DEFAULT 0,
  notify_internal_messages TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_notification_settings_target (store_id, channel_type, purpose),
  KEY idx_store_notification_settings_store_enabled (store_id, enabled),
  KEY idx_store_notification_settings_channel (channel_type, purpose, enabled)
);

CREATE TABLE IF NOT EXISTS supplier_notification_settings (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  supplier_id BIGINT NOT NULL,
  store_id BIGINT NOT NULL,
  line_group_id VARCHAR(255) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  notify_purchase_order TINYINT(1) NOT NULL DEFAULT 1,
  notify_return TINYINT(1) NOT NULL DEFAULT 1,
  notify_settlement TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_supplier_notification_settings_store_supplier (store_id, supplier_id),
  KEY idx_supplier_notification_settings_store_enabled (store_id, enabled),
  KEY idx_supplier_notification_settings_supplier_enabled (supplier_id, enabled)
);
