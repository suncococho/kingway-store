-- KINGWAY staff sales/service incentive system
-- File creation only. Apply to staging only after backup and explicit review.
-- Production execution is prohibited without separate approval.

CREATE TABLE IF NOT EXISTS staff_incentive_plan_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  version VARCHAR(50) NOT NULL,
  status ENUM('DRAFT','ACTIVE','INACTIVE') NOT NULL DEFAULT 'DRAFT',

  bike_sale_amount DECIMAL(12,2) NOT NULL DEFAULT 420.00,
  bike_handover_amount DECIMAL(12,2) NOT NULL DEFAULT 120.00,
  bike_followup_amount DECIMAL(12,2) NOT NULL DEFAULT 60.00,

  accessory_rate DECIMAL(8,6) NOT NULL DEFAULT 0.100000,
  repair_inspection_amount DECIMAL(12,2) NOT NULL DEFAULT 100.00,

  effective_from DATETIME NOT NULL,
  effective_to DATETIME NULL,
  agreement_text LONGTEXT NULL,

  created_by_staff_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uk_staff_incentive_plan_store_version (
    store_id,
    version
  ),
  KEY idx_staff_incentive_plan_active (
    store_id,
    status,
    effective_from,
    effective_to
  )
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS staff_incentive_agreements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  staff_user_id BIGINT UNSIGNED NOT NULL,
  plan_version_id BIGINT UNSIGNED NOT NULL,

  agreement_number VARCHAR(80) NOT NULL,
  status ENUM('SIGNED','REVOKED','EXPIRED')
    NOT NULL DEFAULT 'SIGNED',

  required_checks_json LONGTEXT NULL,
  signature_path VARCHAR(500) NULL,
  pdf_path VARCHAR(500) NULL,
  document_hash CHAR(64) NULL,

  authentication_method VARCHAR(50) NULL,
  signer_ip VARCHAR(100) NULL,
  signer_user_agent VARCHAR(500) NULL,
  signed_at DATETIME NOT NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uk_staff_incentive_agreement_number (
    agreement_number
  ),
  UNIQUE KEY uk_staff_incentive_agreement_version (
    store_id,
    staff_user_id,
    plan_version_id
  ),
  KEY idx_staff_incentive_agreement_staff (
    store_id,
    staff_user_id,
    signed_at
  )
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS staff_incentive_payouts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  staff_user_id BIGINT UNSIGNED NOT NULL,
  payroll_month CHAR(7) NOT NULL,

  earned_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  adjustment_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  final_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,

  status ENUM('DRAFT','APPROVED','PAID','CANCELED')
    NOT NULL DEFAULT 'DRAFT',

  approved_by_staff_id BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  paid_at DATETIME NULL,
  note TEXT NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uk_staff_incentive_payout_month (
    store_id,
    staff_user_id,
    payroll_month
  ),
  KEY idx_staff_incentive_payout_status (
    store_id,
    status,
    payroll_month
  )
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS staff_incentive_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  staff_user_id BIGINT UNSIGNED NOT NULL,
  plan_version_id BIGINT UNSIGNED NULL,
  payout_id BIGINT UNSIGNED NULL,

  incentive_type ENUM(
    'BIKE',
    'ACCESSORY',
    'REPAIR_INSPECTION'
  ) NOT NULL,

  earning_stage ENUM(
    'SALE',
    'HANDOVER',
    'FOLLOWUP',
    'ITEM',
    'INSPECTION'
  ) NOT NULL,

  source_type ENUM(
    'ORDER',
    'ORDER_ITEM',
    'REPAIR'
  ) NOT NULL,

  source_id BIGINT UNSIGNED NOT NULL,
  source_line_id BIGINT UNSIGNED NOT NULL DEFAULT 0,

  product_id BIGINT UNSIGNED NULL,
  product_name_snapshot VARCHAR(200) NULL,
  quantity INT NOT NULL DEFAULT 1,

  actual_sale_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  rate DECIMAL(8,6) NOT NULL DEFAULT 0.000000,
  calculated_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,

  assigned_ratio DECIMAL(8,6) NOT NULL DEFAULT 1.000000,
  final_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,

  status ENUM(
    'PENDING',
    'EARNED',
    'APPROVED',
    'PAID',
    'VOID',
    'DISPUTED'
  ) NOT NULL DEFAULT 'PENDING',

  pending_reason VARCHAR(255) NULL,
  void_reason VARCHAR(255) NULL,
  metadata_json LONGTEXT NULL,

  earned_at DATETIME NULL,
  approved_by_staff_id BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  payroll_month CHAR(7) NULL,
  paid_at DATETIME NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  UNIQUE KEY uk_staff_incentive_event_source (
    store_id,
    staff_user_id,
    incentive_type,
    earning_stage,
    source_type,
    source_id,
    source_line_id
  ),

  KEY idx_staff_incentive_event_staff_status (
    store_id,
    staff_user_id,
    status,
    earned_at
  ),

  KEY idx_staff_incentive_event_source_lookup (
    store_id,
    source_type,
    source_id,
    source_line_id
  ),

  KEY idx_staff_incentive_event_payroll (
    store_id,
    payroll_month,
    status
  ),

  KEY idx_staff_incentive_event_payout (
    payout_id
  )
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS staff_incentive_adjustments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  incentive_event_id BIGINT UNSIGNED NOT NULL,

  previous_amount DECIMAL(12,2) NOT NULL,
  adjustment_amount DECIMAL(12,2) NOT NULL,
  final_amount DECIMAL(12,2) NOT NULL,

  reason TEXT NOT NULL,
  requested_by_staff_id BIGINT UNSIGNED NULL,
  approved_by_staff_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_staff_incentive_adjustment_event (
    store_id,
    incentive_event_id,
    created_at
  )
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS staff_incentive_disputes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  staff_user_id BIGINT UNSIGNED NOT NULL,
  incentive_event_id BIGINT UNSIGNED NOT NULL,

  reason TEXT NOT NULL,
  status ENUM(
    'OPEN',
    'REVIEWING',
    'RESOLVED',
    'REJECTED'
  ) NOT NULL DEFAULT 'OPEN',

  admin_response TEXT NULL,
  resolved_by_staff_id BIGINT UNSIGNED NULL,
  resolved_at DATETIME NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_staff_incentive_dispute_status (
    store_id,
    status,
    created_at
  ),
  KEY idx_staff_incentive_dispute_staff (
    store_id,
    staff_user_id,
    created_at
  )
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;
