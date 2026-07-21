CREATE TABLE IF NOT EXISTS order_sales_followups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,

  status ENUM(
    'PENDING',
    'COMPLETED',
    'CANCELED'
  ) NOT NULL DEFAULT 'PENDING',

  contact_method ENUM(
    'LINE',
    'PHONE',
    'IN_PERSON',
    'OTHER'
  ) NULL,

  customer_result ENUM(
    'NO_ISSUE',
    'ISSUE_RESOLVED',
    'ISSUE_UNRESOLVED',
    'NO_RESPONSE',
    'OTHER'
  ) NULL,

  employee_caused_issue TINYINT(1)
    NOT NULL DEFAULT 0,

  unresolved_employee_issue TINYINT(1)
    NOT NULL DEFAULT 0,

  note TEXT NULL,

  completed_by_staff_id BIGINT UNSIGNED NULL,
  completed_by_staff_name VARCHAR(100) NULL,
  completed_at DATETIME NULL,

  created_by_staff_id BIGINT UNSIGNED NULL,
  updated_by_staff_id BIGINT UNSIGNED NULL,

  created_at TIMESTAMP
    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  updated_at TIMESTAMP
    NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  UNIQUE KEY uq_order_sales_followups_order (
    store_id,
    order_id
  ),

  KEY idx_order_sales_followups_status (
    store_id,
    status,
    completed_at
  ),

  KEY idx_order_sales_followups_staff (
    store_id,
    completed_by_staff_id,
    completed_at
  )
);
