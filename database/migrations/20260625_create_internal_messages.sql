CREATE TABLE IF NOT EXISTS internal_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT NULL,
  from_store_id BIGINT NULL,
  to_store_id BIGINT NULL,
  to_all_stores TINYINT(1) NOT NULL DEFAULT 0,
  from_staff_user_id BIGINT NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  priority ENUM('NORMAL','IMPORTANT','URGENT') NOT NULL DEFAULT 'NORMAL',
  status ENUM('SENT','ARCHIVED') NOT NULL DEFAULT 'SENT',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_internal_messages_company_created (company_id, created_at),
  KEY idx_internal_messages_from_store_created (from_store_id, created_at),
  KEY idx_internal_messages_to_store_created (to_store_id, created_at),
  KEY idx_internal_messages_to_all_created (to_all_stores, created_at),
  KEY idx_internal_messages_priority_created (priority, created_at),
  KEY idx_internal_messages_status_created (status, created_at)
);

CREATE TABLE IF NOT EXISTS internal_message_reads (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  message_id BIGINT NOT NULL,
  staff_user_id BIGINT NOT NULL,
  store_id BIGINT NULL,
  read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_internal_message_reads_message_staff (message_id, staff_user_id),
  KEY idx_internal_message_reads_message (message_id),
  KEY idx_internal_message_reads_staff (staff_user_id),
  KEY idx_internal_message_reads_store (store_id)
);
