-- STAGING ONLY
-- DO NOT RUN ON PRODUCTION
-- Draft for store public identity mapping rehearsal.
-- Prepared for later execution against the verified 3310 staging target only.
--
-- Target:
-- - host-side MySQL: 127.0.0.1:3310
-- - database: kingway_store
-- - expected legacy store: stores.id = 1 / KINGWAY_TAINAN
--
-- This file is a migration draft. It has not been executed by Codex.
-- Do not run until staging target, backup/rollback, LINE values, and smoke-test plan are approved.
-- Do not change webhook URL or LINE credentials as part of this SQL draft.

-- ============================================================
-- Safety precheck - run and review before any DDL/DML
-- ============================================================
SELECT DATABASE() AS database_name, @@hostname AS mysql_hostname, @@port AS mysql_port;

SELECT COUNT(*) AS stores_table_exists
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'stores';

SELECT id, code, name, status, plan
FROM stores
ORDER BY id;

SELECT id, code, name, status, plan
FROM stores
WHERE id = 1;

SELECT COUNT(*) AS store_hostnames_table_exists
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'store_hostnames';

SELECT COUNT(*) AS store_liff_apps_table_exists
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'store_liff_apps';

SELECT COUNT(*) AS store_line_channels_table_exists
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'store_line_channels';

-- Expected before DDL:
-- - database_name = kingway_store
-- - mysql_port = 3310 when checked from the staging host
-- - stores_table_exists = 1
-- - stores.id = 1 exists and is active
-- - all three mapping table existence checks = 0
--
-- Stop if any expectation fails.

-- ============================================================
-- Draft operator variables - review before seed insert
-- ============================================================
-- These are staging placeholders. Replace only after values are reviewed.
-- Do not place raw LINE secrets or access tokens in this migration.

SET @legacy_store_id := 1;
SET @legacy_hostname := 'pos.kingway.tw';
SET @legacy_liff_id := 'REPLACE_WITH_KINGWAY_STAGING_LIFF_ID';
SET @legacy_line_channel_id := 'REPLACE_WITH_KINGWAY_STAGING_LINE_CHANNEL_ID';
SET @legacy_webhook_path_token := 'REPLACE_WITH_RANDOM_STAGING_WEBHOOK_PATH_TOKEN';
SET @legacy_webhook_path := CONCAT('/api/line/webhook/', @legacy_webhook_path_token);

-- Review placeholder status before any seed insert.
SELECT
  @legacy_store_id AS legacy_store_id,
  @legacy_hostname AS legacy_hostname,
  @legacy_liff_id AS legacy_liff_id,
  @legacy_line_channel_id AS legacy_line_channel_id,
  @legacy_webhook_path_token AS legacy_webhook_path_token,
  @legacy_webhook_path AS legacy_webhook_path;

-- ============================================================
-- CREATE TABLE store_hostnames
-- ============================================================
CREATE TABLE IF NOT EXISTS store_hostnames (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  hostname VARCHAR(255) NOT NULL,
  hostname_type ENUM('SUBDOMAIN', 'CUSTOM_DOMAIN', 'LEGACY') NOT NULL DEFAULT 'SUBDOMAIN',
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  verified_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_store_hostnames_hostname (hostname),
  KEY idx_store_hostnames_store_status (store_id, status),
  KEY idx_store_hostnames_store_primary (store_id, is_primary),
  CONSTRAINT fk_store_hostnames_store
    FOREIGN KEY (store_id) REFERENCES stores(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- CREATE TABLE store_liff_apps
-- ============================================================
CREATE TABLE IF NOT EXISTS store_liff_apps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  liff_id VARCHAR(80) NOT NULL,
  liff_name VARCHAR(150) NULL,
  route_scope ENUM(
    'GENERAL',
    'STORE_INFO',
    'LINE_ORDER',
    'REPAIR_RESERVATION',
    'COUPON_CENTER',
    'GOOGLE_REVIEW',
    'PURCHASE_CONFIRMATION',
    'SURVEY',
    'SUPPORT'
  ) NOT NULL DEFAULT 'GENERAL',
  status ENUM('ACTIVE', 'INACTIVE', 'RETIRED') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_store_liff_apps_liff_id (liff_id),
  KEY idx_store_liff_apps_store_status (store_id, status),
  KEY idx_store_liff_apps_scope_status (route_scope, status),
  CONSTRAINT fk_store_liff_apps_store
    FOREIGN KEY (store_id) REFERENCES stores(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- CREATE TABLE store_line_channels
-- ============================================================
CREATE TABLE IF NOT EXISTS store_line_channels (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  channel_id VARCHAR(120) NOT NULL,
  channel_name VARCHAR(150) NULL,
  channel_secret_ref VARCHAR(255) NOT NULL,
  channel_access_token_ref VARCHAR(255) NOT NULL,
  webhook_path_token VARCHAR(160) NOT NULL,
  webhook_path VARCHAR(255) NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('ACTIVE', 'INACTIVE', 'ROTATING') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_store_line_channels_channel_id (channel_id),
  UNIQUE KEY uk_store_line_channels_path_token (webhook_path_token),
  KEY idx_store_line_channels_store_status (store_id, status),
  KEY idx_store_line_channels_store_default (store_id, is_default),
  CONSTRAINT fk_store_line_channels_store
    FOREIGN KEY (store_id) REFERENCES stores(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Legacy KINGWAY seed draft - staging only
-- ============================================================
-- Replace placeholder values before running.
-- Do not insert placeholder LIFF/channel/path token values.
-- Do not store raw LINE channel secret or access token here.

SELECT
  CASE
    WHEN @legacy_liff_id LIKE 'REPLACE_WITH_%' THEN 'STOP_REPLACE_LEGACY_LIFF_ID'
    ELSE 'OK'
  END AS liff_id_ready,
  CASE
    WHEN @legacy_line_channel_id LIKE 'REPLACE_WITH_%' THEN 'STOP_REPLACE_LEGACY_LINE_CHANNEL_ID'
    ELSE 'OK'
  END AS line_channel_id_ready,
  CASE
    WHEN @legacy_webhook_path_token LIKE 'REPLACE_WITH_%' THEN 'STOP_REPLACE_WEBHOOK_PATH_TOKEN'
    ELSE 'OK'
  END AS webhook_path_token_ready;

INSERT INTO store_hostnames (
  store_id,
  hostname,
  hostname_type,
  is_primary,
  status,
  verified_at
) VALUES (
  @legacy_store_id,
  LOWER(@legacy_hostname),
  'LEGACY',
  1,
  'ACTIVE',
  CURRENT_TIMESTAMP
)
ON DUPLICATE KEY UPDATE
  store_id = VALUES(store_id),
  hostname_type = VALUES(hostname_type),
  is_primary = VALUES(is_primary),
  status = VALUES(status),
  verified_at = VALUES(verified_at);

INSERT INTO store_liff_apps (
  store_id,
  liff_id,
  liff_name,
  route_scope,
  status
) SELECT
  @legacy_store_id,
  @legacy_liff_id,
  'KINGWAY 台南 staging LIFF',
  'GENERAL',
  'ACTIVE'
WHERE @legacy_liff_id NOT LIKE 'REPLACE_WITH_%'
ON DUPLICATE KEY UPDATE
  store_id = VALUES(store_id),
  liff_name = VALUES(liff_name),
  route_scope = VALUES(route_scope),
  status = VALUES(status);

INSERT INTO store_line_channels (
  store_id,
  channel_id,
  channel_name,
  channel_secret_ref,
  channel_access_token_ref,
  webhook_path_token,
  webhook_path,
  is_default,
  status
) SELECT
  @legacy_store_id,
  @legacy_line_channel_id,
  'KINGWAY 台南 staging LINE OA',
  'env:LINE_CHANNEL_SECRET',
  'env:LINE_CHANNEL_ACCESS_TOKEN',
  @legacy_webhook_path_token,
  @legacy_webhook_path,
  1,
  'ACTIVE'
WHERE @legacy_line_channel_id NOT LIKE 'REPLACE_WITH_%'
  AND @legacy_webhook_path_token NOT LIKE 'REPLACE_WITH_%'
ON DUPLICATE KEY UPDATE
  store_id = VALUES(store_id),
  channel_name = VALUES(channel_name),
  channel_secret_ref = VALUES(channel_secret_ref),
  channel_access_token_ref = VALUES(channel_access_token_ref),
  webhook_path_token = VALUES(webhook_path_token),
  webhook_path = VALUES(webhook_path),
  is_default = VALUES(is_default),
  status = VALUES(status);

-- ============================================================
-- Verification SQL
-- ============================================================
SELECT COUNT(*) AS store_hostnames_count
FROM store_hostnames;

SELECT COUNT(*) AS store_liff_apps_count
FROM store_liff_apps;

SELECT COUNT(*) AS store_line_channels_count
FROM store_line_channels;

SELECT
  sh.id,
  sh.store_id,
  s.code AS store_code,
  sh.hostname,
  sh.hostname_type,
  sh.is_primary,
  sh.status,
  sh.verified_at
FROM store_hostnames sh
JOIN stores s ON s.id = sh.store_id
ORDER BY sh.store_id, sh.hostname;

SELECT
  sla.id,
  sla.store_id,
  s.code AS store_code,
  sla.liff_id,
  sla.liff_name,
  sla.route_scope,
  sla.status
FROM store_liff_apps sla
JOIN stores s ON s.id = sla.store_id
ORDER BY sla.store_id, sla.route_scope, sla.liff_id;

SELECT
  slc.id,
  slc.store_id,
  s.code AS store_code,
  slc.channel_id,
  slc.channel_name,
  slc.webhook_path_token,
  slc.webhook_path,
  slc.is_default,
  slc.status
FROM store_line_channels slc
JOIN stores s ON s.id = slc.store_id
ORDER BY slc.store_id, slc.channel_id;

-- Collision checks. All should return 0 rows.
SELECT hostname, COUNT(*) AS count
FROM store_hostnames
GROUP BY hostname
HAVING COUNT(*) > 1;

SELECT liff_id, COUNT(*) AS count
FROM store_liff_apps
GROUP BY liff_id
HAVING COUNT(*) > 1;

SELECT channel_id, COUNT(*) AS count
FROM store_line_channels
GROUP BY channel_id
HAVING COUNT(*) > 1;

SELECT webhook_path_token, COUNT(*) AS count
FROM store_line_channels
GROUP BY webhook_path_token
HAVING COUNT(*) > 1;

SELECT store_id, COUNT(*) AS primary_active_hostnames
FROM store_hostnames
WHERE status = 'ACTIVE'
  AND is_primary = 1
GROUP BY store_id
HAVING COUNT(*) > 1;

SELECT store_id, COUNT(*) AS default_active_line_channels
FROM store_line_channels
WHERE status = 'ACTIVE'
  AND is_default = 1
GROUP BY store_id
HAVING COUNT(*) > 1;

SELECT 'store_hostnames' AS table_name, sh.id, sh.store_id
FROM store_hostnames sh
LEFT JOIN stores s ON s.id = sh.store_id
WHERE s.id IS NULL
UNION ALL
SELECT 'store_liff_apps' AS table_name, sla.id, sla.store_id
FROM store_liff_apps sla
LEFT JOIN stores s ON s.id = sla.store_id
WHERE s.id IS NULL
UNION ALL
SELECT 'store_line_channels' AS table_name, slc.id, slc.store_id
FROM store_line_channels slc
LEFT JOIN stores s ON s.id = slc.store_id
WHERE s.id IS NULL;

-- Expected after reviewed legacy seed:
-- - one active LEGACY hostname for KINGWAY staging
-- - one active GENERAL LIFF app if a reviewed LIFF ID exists
-- - one active default LINE channel if a reviewed channel ID/path token exists
-- - all collision checks return 0 rows
-- - orphan check returns 0 rows

-- ============================================================
-- Rollback SQL - staging only
-- ============================================================
-- Preferred rollback for rehearsal failure is restoring the staging DB/volume from backup.
-- If only this draft has been applied and no dependent route wiring is deployed:

-- UPDATE store_line_channels
-- SET status = 'INACTIVE'
-- WHERE store_id = 1;

-- UPDATE store_liff_apps
-- SET status = 'INACTIVE'
-- WHERE store_id = 1;

-- UPDATE store_hostnames
-- SET status = 'INACTIVE'
-- WHERE store_id = 1;

-- Drop order if table removal is explicitly approved:
-- DROP TABLE IF EXISTS store_line_channels;
-- DROP TABLE IF EXISTS store_liff_apps;
-- DROP TABLE IF EXISTS store_hostnames;

-- ============================================================
-- Final warnings
-- ============================================================
-- Do NOT run this on production.
-- Do NOT change LINE webhook URL in this migration phase.
-- Do NOT change LINE channel secret or access token in this migration phase.
-- Do NOT wire LINE, LIFF, repair, order, coupon, or customer write routes in this migration phase.
-- Do NOT trust request body/query store_id in any public route.
