-- Rollback for 20260628_upgrade_legacy_store_line_channels.sql.
--
-- WARNING:
-- This drops the new Phase B store LINE Channel management columns and indexes.
-- Do not run this rollback after real channel settings have been entered unless
-- that data loss has been explicitly approved and backed up.
--
-- Legacy columns are intentionally preserved:
-- channel_id, channel_name, channel_secret_ref, channel_access_token_ref,
-- webhook_path_token, webhook_path, is_default, status.

DROP PROCEDURE IF EXISTS rollback_legacy_store_line_channels_20260628;
DELIMITER //
CREATE PROCEDURE rollback_legacy_store_line_channels_20260628()
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'store_line_channels table is missing; rollback skipped';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'uk_store_line_channels_channel'
  ) THEN
    ALTER TABLE store_line_channels DROP INDEX uk_store_line_channels_channel;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'uk_store_line_channels_webhook_path'
  ) THEN
    ALTER TABLE store_line_channels DROP INDEX uk_store_line_channels_webhook_path;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'idx_store_line_channels_store'
  ) THEN
    ALTER TABLE store_line_channels DROP INDEX idx_store_line_channels_store;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'idx_store_line_channels_company'
  ) THEN
    ALTER TABLE store_line_channels DROP INDEX idx_store_line_channels_company;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'idx_store_line_channels_status'
  ) THEN
    ALTER TABLE store_line_channels DROP INDEX idx_store_line_channels_status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'idx_store_line_channels_created_by'
  ) THEN
    ALTER TABLE store_line_channels DROP INDEX idx_store_line_channels_created_by;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_line_channels'
      AND INDEX_NAME = 'idx_store_line_channels_updated_by'
  ) THEN
    ALTER TABLE store_line_channels DROP INDEX idx_store_line_channels_updated_by;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_line_channels' AND COLUMN_NAME = 'updated_by_staff_user_id') THEN
    ALTER TABLE store_line_channels DROP COLUMN updated_by_staff_user_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_line_channels' AND COLUMN_NAME = 'created_by_staff_user_id') THEN
    ALTER TABLE store_line_channels DROP COLUMN created_by_staff_user_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_line_channels' AND COLUMN_NAME = 'last_error_message') THEN
    ALTER TABLE store_line_channels DROP COLUMN last_error_message;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_line_channels' AND COLUMN_NAME = 'last_error_at') THEN
    ALTER TABLE store_line_channels DROP COLUMN last_error_at;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_line_channels' AND COLUMN_NAME = 'last_webhook_at') THEN
    ALTER TABLE store_line_channels DROP COLUMN last_webhook_at;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_line_channels' AND COLUMN_NAME = 'last_dry_run_test_at') THEN
    ALTER TABLE store_line_channels DROP COLUMN last_dry_run_test_at;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_line_channels' AND COLUMN_NAME = 'connection_status') THEN
    ALTER TABLE store_line_channels DROP COLUMN connection_status;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_line_channels' AND COLUMN_NAME = 'enabled') THEN
    ALTER TABLE store_line_channels DROP COLUMN enabled;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_line_channels' AND COLUMN_NAME = 'is_primary') THEN
    ALTER TABLE store_line_channels DROP COLUMN is_primary;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_line_channels' AND COLUMN_NAME = 'webhook_url') THEN
    ALTER TABLE store_line_channels DROP COLUMN webhook_url;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_line_channels' AND COLUMN_NAME = 'liff_id') THEN
    ALTER TABLE store_line_channels DROP COLUMN liff_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_line_channels' AND COLUMN_NAME = 'line_channel_secret_ref') THEN
    ALTER TABLE store_line_channels DROP COLUMN line_channel_secret_ref;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_line_channels' AND COLUMN_NAME = 'line_channel_id') THEN
    ALTER TABLE store_line_channels DROP COLUMN line_channel_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_line_channels' AND COLUMN_NAME = 'line_basic_id') THEN
    ALTER TABLE store_line_channels DROP COLUMN line_basic_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_line_channels' AND COLUMN_NAME = 'line_official_account_id') THEN
    ALTER TABLE store_line_channels DROP COLUMN line_official_account_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_line_channels' AND COLUMN_NAME = 'line_official_account_name') THEN
    ALTER TABLE store_line_channels DROP COLUMN line_official_account_name;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_line_channels' AND COLUMN_NAME = 'ownership_type') THEN
    ALTER TABLE store_line_channels DROP COLUMN ownership_type;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_line_channels' AND COLUMN_NAME = 'company_id') THEN
    ALTER TABLE store_line_channels DROP COLUMN company_id;
  END IF;
END//
DELIMITER ;

CALL rollback_legacy_store_line_channels_20260628();
DROP PROCEDURE IF EXISTS rollback_legacy_store_line_channels_20260628;
