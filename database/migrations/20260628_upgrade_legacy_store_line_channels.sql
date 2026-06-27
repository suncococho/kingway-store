-- Upgrade an existing legacy store_line_channels table to the Phase B
-- store-level LINE Channel management schema.
--
-- This migration is intentionally additive:
-- - It does not drop or rename legacy columns.
-- - It does not store raw LINE tokens or channel secrets.
-- - It is safe to run on an already-upgraded table.

DROP PROCEDURE IF EXISTS upgrade_legacy_store_line_channels_20260628;
DELIMITER //
CREATE PROCEDURE upgrade_legacy_store_line_channels_20260628()
BEGIN
  DECLARE had_company_id_column TINYINT DEFAULT 0;
  DECLARE had_ownership_type_column TINYINT DEFAULT 0;
  DECLARE had_is_primary_column TINYINT DEFAULT 0;
  DECLARE had_enabled_column TINYINT DEFAULT 0;
  DECLARE had_connection_status_column TINYINT DEFAULT 0;

  SELECT COUNT(*) > 0 INTO had_company_id_column
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'store_line_channels'
    AND COLUMN_NAME = 'company_id';

  SELECT COUNT(*) > 0 INTO had_ownership_type_column
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'store_line_channels'
    AND COLUMN_NAME = 'ownership_type';

  SELECT COUNT(*) > 0 INTO had_is_primary_column
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'store_line_channels'
    AND COLUMN_NAME = 'is_primary';

  SELECT COUNT(*) > 0 INTO had_enabled_column
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'store_line_channels'
    AND COLUMN_NAME = 'enabled';

  SELECT COUNT(*) > 0 INTO had_connection_status_column
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'store_line_channels'
    AND COLUMN_NAME = 'connection_status';

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'store_line_channels table is missing; apply 20260627_create_store_line_channels.sql first';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME IN ('channel_access_token', 'access_token', 'token', 'channel_secret', 'line_channel_secret')
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'store_line_channels contains raw token/secret columns; aborting';
  END IF;

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
    ALTER TABLE store_line_channels
      ADD COLUMN ownership_type ENUM('HQ_MANAGED','FRANCHISE_OWNED','INDEPENDENT_OWNED') NOT NULL DEFAULT 'HQ_MANAGED';
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
    ALTER TABLE store_line_channels
      ADD COLUMN connection_status ENUM('NOT_TESTED','DRY_RUN_OK','DRY_RUN_FAILED','DISABLED') NOT NULL DEFAULT 'NOT_TESTED';
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
    ALTER TABLE store_line_channels
      ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'channel_id'
  ) THEN
    UPDATE store_line_channels
    SET line_channel_id = channel_id
    WHERE (line_channel_id IS NULL OR line_channel_id = '')
      AND channel_id IS NOT NULL
      AND channel_id <> '';
  END IF;

  UPDATE store_line_channels
  SET line_channel_id = CONCAT('legacy-', id)
  WHERE line_channel_id IS NULL OR line_channel_id = '';

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'channel_name'
  ) THEN
    UPDATE store_line_channels
    SET line_official_account_name = channel_name
    WHERE (line_official_account_name IS NULL OR line_official_account_name = '')
      AND channel_name IS NOT NULL
      AND channel_name <> '';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'channel_secret_ref'
  ) THEN
    UPDATE store_line_channels
    SET line_channel_secret_ref = channel_secret_ref
    WHERE (line_channel_secret_ref IS NULL OR line_channel_secret_ref = '')
      AND channel_secret_ref IS NOT NULL
      AND channel_secret_ref <> '';
  END IF;

  IF had_is_primary_column = 0 AND EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'is_default'
  ) THEN
    UPDATE store_line_channels
    SET is_primary = is_default
    WHERE is_default IS NOT NULL;
  END IF;

  IF had_enabled_column = 0 AND EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'status'
  ) THEN
    UPDATE store_line_channels
    SET enabled = CASE
          WHEN UPPER(CAST(status AS CHAR)) IN ('ACTIVE','ENABLED','1') THEN 1
          ELSE 0
        END;
  END IF;

  IF had_connection_status_column = 0 THEN
    UPDATE store_line_channels
    SET connection_status = CASE
          WHEN enabled = 1 THEN 'NOT_TESTED'
          ELSE 'DISABLED'
        END;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'webhook_path_token'
  ) THEN
    UPDATE store_line_channels
    SET webhook_path = webhook_path_token
    WHERE (webhook_path IS NULL OR webhook_path = '')
      AND webhook_path_token IS NOT NULL
      AND webhook_path_token <> '';
  END IF;

  UPDATE store_line_channels
  SET webhook_path = CONCAT('legacy-line-channel-', id)
  WHERE webhook_path IS NULL OR webhook_path = '';

  UPDATE store_line_channels
  SET webhook_url = CONCAT('https://pos.kingway.tw', webhook_path)
  WHERE (webhook_url IS NULL OR webhook_url = '')
    AND webhook_path LIKE '/%';

  UPDATE store_line_channels
  SET webhook_url = CONCAT('https://pos.kingway.tw/api/line/webhook/channel/', webhook_path)
  WHERE (webhook_url IS NULL OR webhook_url = '')
    AND webhook_path NOT LIKE '/%';

  IF EXISTS (
    SELECT 1
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'company_stores'
  ) THEN
    UPDATE store_line_channels slc
    LEFT JOIN company_stores cs
      ON cs.store_id = slc.store_id
     AND cs.status = 'ACTIVE'
    SET slc.company_id = COALESCE(slc.company_id, cs.company_id),
        slc.ownership_type = CASE
          WHEN had_ownership_type_column = 1 THEN slc.ownership_type
          WHEN cs.relationship_type = 'FRANCHISE_STORE' THEN 'FRANCHISE_OWNED'
          WHEN cs.relationship_type IS NULL THEN 'INDEPENDENT_OWNED'
          ELSE 'HQ_MANAGED'
        END;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT line_channel_id
      FROM store_line_channels
      GROUP BY line_channel_id
      HAVING COUNT(*) > 1
    ) duplicate_line_channels
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Duplicate line_channel_id values found; aborting index creation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT webhook_path
      FROM store_line_channels
      GROUP BY webhook_path
      HAVING COUNT(*) > 1
    ) duplicate_webhook_paths
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Duplicate webhook_path values found; aborting index creation';
  END IF;

  ALTER TABLE store_line_channels MODIFY line_channel_id VARCHAR(255) NOT NULL;
  ALTER TABLE store_line_channels MODIFY webhook_path VARCHAR(255) NOT NULL;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND COLUMN_NAME = 'channel_id'
  ) THEN
    ALTER TABLE store_line_channels MODIFY channel_id VARCHAR(255) NULL;
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
    ALTER TABLE store_line_channels MODIFY webhook_path_token VARCHAR(255) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'uk_store_line_channels_channel'
  ) THEN
    ALTER TABLE store_line_channels ADD UNIQUE KEY uk_store_line_channels_channel (line_channel_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'uk_store_line_channels_webhook_path'
  ) THEN
    ALTER TABLE store_line_channels ADD UNIQUE KEY uk_store_line_channels_webhook_path (webhook_path);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'idx_store_line_channels_store'
  ) THEN
    ALTER TABLE store_line_channels ADD KEY idx_store_line_channels_store (store_id, enabled, is_primary);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'idx_store_line_channels_company'
  ) THEN
    ALTER TABLE store_line_channels ADD KEY idx_store_line_channels_company (company_id, enabled);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'idx_store_line_channels_status'
  ) THEN
    ALTER TABLE store_line_channels ADD KEY idx_store_line_channels_status (connection_status, updated_at);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'idx_store_line_channels_created_by'
  ) THEN
    ALTER TABLE store_line_channels ADD KEY idx_store_line_channels_created_by (created_by_staff_user_id, created_at);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'idx_store_line_channels_updated_by'
  ) THEN
    ALTER TABLE store_line_channels ADD KEY idx_store_line_channels_updated_by (updated_by_staff_user_id, updated_at);
  END IF;
END//
DELIMITER ;

CALL upgrade_legacy_store_line_channels_20260628();
DROP PROCEDURE IF EXISTS upgrade_legacy_store_line_channels_20260628;
