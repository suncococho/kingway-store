CREATE TABLE IF NOT EXISTS store_line_channels (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT NULL,
  store_id BIGINT NOT NULL,
  ownership_type ENUM('HQ_MANAGED','FRANCHISE_OWNED','INDEPENDENT_OWNED') NOT NULL DEFAULT 'HQ_MANAGED',
  line_official_account_name VARCHAR(255) NULL,
  line_official_account_id VARCHAR(255) NULL,
  line_basic_id VARCHAR(255) NULL,
  line_channel_id VARCHAR(255) NOT NULL,
  line_channel_secret_ref VARCHAR(255) NULL,
  channel_access_token_ref VARCHAR(255) NULL,
  liff_id VARCHAR(255) NULL,
  webhook_path VARCHAR(255) NOT NULL,
  webhook_url VARCHAR(500) NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 1,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  connection_status ENUM('NOT_TESTED','DRY_RUN_OK','DRY_RUN_FAILED','DISABLED') NOT NULL DEFAULT 'NOT_TESTED',
  last_dry_run_test_at DATETIME NULL,
  last_webhook_at DATETIME NULL,
  last_error_at DATETIME NULL,
  last_error_message VARCHAR(1000) NULL,
  created_by_staff_user_id BIGINT NULL,
  updated_by_staff_user_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_line_channels_channel (line_channel_id),
  UNIQUE KEY uk_store_line_channels_webhook_path (webhook_path),
  KEY idx_store_line_channels_store (store_id, enabled, is_primary),
  KEY idx_store_line_channels_company (company_id, enabled),
  KEY idx_store_line_channels_status (connection_status, updated_at),
  KEY idx_store_line_channels_created_by (created_by_staff_user_id, created_at),
  KEY idx_store_line_channels_updated_by (updated_by_staff_user_id, updated_at)
);

DROP PROCEDURE IF EXISTS add_store_line_channels_columns_20260627;
DELIMITER //
CREATE PROCEDURE add_store_line_channels_columns_20260627()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'company_id'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN company_id BIGINT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'ownership_type'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN ownership_type ENUM('HQ_MANAGED','FRANCHISE_OWNED','INDEPENDENT_OWNED') NOT NULL DEFAULT 'HQ_MANAGED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'line_official_account_name'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN line_official_account_name VARCHAR(255) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'line_official_account_id'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN line_official_account_id VARCHAR(255) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'line_basic_id'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN line_basic_id VARCHAR(255) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'line_channel_id'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN line_channel_id VARCHAR(255) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'line_channel_secret_ref'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN line_channel_secret_ref VARCHAR(255) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'channel_access_token_ref'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN channel_access_token_ref VARCHAR(255) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'liff_id'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN liff_id VARCHAR(255) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'webhook_path'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN webhook_path VARCHAR(255) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'webhook_url'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN webhook_url VARCHAR(500) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'is_primary'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN is_primary TINYINT(1) NOT NULL DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'enabled'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN enabled TINYINT(1) NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'connection_status'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN connection_status ENUM('NOT_TESTED','DRY_RUN_OK','DRY_RUN_FAILED','DISABLED') NOT NULL DEFAULT 'NOT_TESTED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'last_dry_run_test_at'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN last_dry_run_test_at DATETIME NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'last_webhook_at'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN last_webhook_at DATETIME NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'last_error_at'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN last_error_at DATETIME NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'last_error_message'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN last_error_message VARCHAR(1000) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'created_by_staff_user_id'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN created_by_staff_user_id BIGINT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'updated_by_staff_user_id'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN updated_by_staff_user_id BIGINT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'created_at'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'updated_at'
  ) THEN
    ALTER TABLE store_line_channels ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
  END IF;
END//
DELIMITER ;

CALL add_store_line_channels_columns_20260627();
DROP PROCEDURE IF EXISTS add_store_line_channels_columns_20260627;

DROP PROCEDURE IF EXISTS relax_store_line_channels_legacy_columns_20260627;
DELIMITER //
CREATE PROCEDURE relax_store_line_channels_legacy_columns_20260627()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'channel_id'
  ) THEN
    ALTER TABLE store_line_channels MODIFY channel_id VARCHAR(120) NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'channel_secret_ref'
  ) THEN
    ALTER TABLE store_line_channels MODIFY channel_secret_ref VARCHAR(255) NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'channel_access_token_ref'
  ) THEN
    ALTER TABLE store_line_channels MODIFY channel_access_token_ref VARCHAR(255) NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'webhook_path_token'
  ) THEN
    ALTER TABLE store_line_channels MODIFY webhook_path_token VARCHAR(160) NULL;
  END IF;
END//
DELIMITER ;

CALL relax_store_line_channels_legacy_columns_20260627();
DROP PROCEDURE IF EXISTS relax_store_line_channels_legacy_columns_20260627;

DROP PROCEDURE IF EXISTS migrate_store_line_channels_20260627;
DELIMITER //
CREATE PROCEDURE migrate_store_line_channels_20260627()
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'channel_id'
  ) THEN
    UPDATE store_line_channels
    SET line_channel_id = COALESCE(NULLIF(line_channel_id, ''), channel_id)
    WHERE channel_id IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'channel_secret_ref'
  ) THEN
    UPDATE store_line_channels
    SET line_channel_secret_ref = COALESCE(NULLIF(line_channel_secret_ref, ''), channel_secret_ref)
    WHERE channel_secret_ref IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'is_default'
  ) THEN
    UPDATE store_line_channels
    SET is_primary = is_default
    WHERE is_default IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'status'
  ) THEN
    UPDATE store_line_channels
    SET enabled = CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END,
        connection_status = CASE WHEN status = 'ACTIVE' THEN connection_status ELSE 'DISABLED' END;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'webhook_path_token'
  ) THEN
    UPDATE store_line_channels
    SET webhook_path = COALESCE(NULLIF(webhook_path, ''), webhook_path_token)
    WHERE webhook_path_token IS NOT NULL;
  END IF;

  UPDATE store_line_channels
  SET webhook_url = CONCAT('https://pos.kingway.tw', webhook_path)
  WHERE (webhook_url IS NULL OR webhook_url = '')
    AND webhook_path LIKE '/%';

  UPDATE store_line_channels
  SET webhook_url = CONCAT('https://pos.kingway.tw/api/line/webhook/channel/', webhook_path)
  WHERE (webhook_url IS NULL OR webhook_url = '')
    AND webhook_path IS NOT NULL
    AND webhook_path <> ''
    AND webhook_path NOT LIKE '/%';

  UPDATE store_line_channels slc
  LEFT JOIN company_stores cs
    ON cs.store_id = slc.store_id
   AND cs.status = 'ACTIVE'
  SET slc.company_id = COALESCE(slc.company_id, cs.company_id),
      slc.ownership_type = CASE
        WHEN cs.relationship_type = 'FRANCHISE_STORE' THEN 'FRANCHISE_OWNED'
        WHEN cs.relationship_type IS NULL THEN 'INDEPENDENT_OWNED'
        ELSE COALESCE(slc.ownership_type, 'HQ_MANAGED')
      END;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'uk_store_line_channels_channel'
  ) THEN
    ALTER TABLE store_line_channels ADD UNIQUE KEY uk_store_line_channels_channel (line_channel_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'uk_store_line_channels_webhook_path'
  ) THEN
    ALTER TABLE store_line_channels ADD UNIQUE KEY uk_store_line_channels_webhook_path (webhook_path);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'idx_store_line_channels_store'
  ) THEN
    ALTER TABLE store_line_channels ADD KEY idx_store_line_channels_store (store_id, enabled, is_primary);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'idx_store_line_channels_company'
  ) THEN
    ALTER TABLE store_line_channels ADD KEY idx_store_line_channels_company (company_id, enabled);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'idx_store_line_channels_status'
  ) THEN
    ALTER TABLE store_line_channels ADD KEY idx_store_line_channels_status (connection_status, updated_at);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'idx_store_line_channels_created_by'
  ) THEN
    ALTER TABLE store_line_channels ADD KEY idx_store_line_channels_created_by (created_by_staff_user_id, created_at);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'idx_store_line_channels_updated_by'
  ) THEN
    ALTER TABLE store_line_channels ADD KEY idx_store_line_channels_updated_by (updated_by_staff_user_id, updated_at);
  END IF;
END//
DELIMITER ;

CALL migrate_store_line_channels_20260627();
DROP PROCEDURE IF EXISTS migrate_store_line_channels_20260627;
