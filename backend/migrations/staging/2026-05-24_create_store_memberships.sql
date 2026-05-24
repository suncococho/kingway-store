-- STAGING ONLY
-- DO NOT RUN ON PRODUCTION
-- Draft for store_memberships owner/admin/staff rehearsal
-- Prepared for later execution against the verified staging target only.
--
-- Target:
-- - host-side MySQL: 127.0.0.1:3310
-- - database: kingway_store
-- - existing store: stores.id = 1 / KINGWAY_TAINAN
--
-- This file is a migration draft. It has not been executed by Codex.
-- Do not run until staging target, backup/rollback, and smoke-test plan are approved.

-- ============================================================
-- Safety precheck - run and review before any DDL/DML
-- ============================================================
SELECT DATABASE() AS database_name, @@hostname AS mysql_hostname, @@port AS mysql_port;

SELECT id, code, name, status, plan
FROM stores
WHERE id = 1;

SELECT COUNT(*) AS staff_users_count
FROM staff_users;

SELECT COALESCE(CAST(store_id AS CHAR), '(NULL)') AS store_id, COUNT(*) AS count
FROM staff_users
GROUP BY store_id
ORDER BY store_id IS NULL, store_id;

SELECT role, COUNT(*) AS count
FROM staff_users
GROUP BY role
ORDER BY role;

SELECT id, username, display_name, role, is_active, store_id
FROM staff_users
ORDER BY id;

SELECT COUNT(*) AS null_store_id_count
FROM staff_users
WHERE store_id IS NULL;

SELECT COUNT(*) AS missing_store_reference_count
FROM staff_users su
LEFT JOIN stores s ON s.id = su.store_id
WHERE su.store_id IS NOT NULL
  AND s.id IS NULL;

-- Expected current staging preview from 2026-05-24 dry-run:
-- - staff_users_count = 2
-- - store_id=1 count = 2
-- - ADMIN count = 1
-- - CASHIER count = 1
-- - null_store_id_count = 0
-- - missing_store_reference_count = 0
-- - expected membership rows = 2

-- ============================================================
-- Dry-run backfill preview - run before actual INSERT
-- ============================================================
SELECT
  su.store_id,
  su.id AS staff_user_id,
  su.username,
  su.display_name,
  su.role AS staff_role,
  su.is_active,
  CASE
    WHEN su.role = 'ADMIN' AND su.username = 'admin' THEN 'owner'
    WHEN su.role IN ('ADMIN', 'MANAGER') THEN 'admin'
    ELSE 'staff'
  END AS proposed_membership_role,
  1 AS proposed_is_default,
  'active' AS proposed_status
FROM staff_users su
JOIN stores s ON s.id = su.store_id
WHERE su.store_id IS NOT NULL
ORDER BY su.id;

SELECT
  su.store_id,
  CASE
    WHEN su.role = 'ADMIN' AND su.username = 'admin' THEN 'owner'
    WHEN su.role IN ('ADMIN', 'MANAGER') THEN 'admin'
    ELSE 'staff'
  END AS proposed_membership_role,
  COUNT(*) AS count
FROM staff_users su
JOIN stores s ON s.id = su.store_id
WHERE su.store_id IS NOT NULL
GROUP BY su.store_id, proposed_membership_role
ORDER BY su.store_id, proposed_membership_role;

-- ============================================================
-- Create store_memberships
-- ============================================================
-- Execute only after confirming this table does not already exist:
-- SELECT COUNT(*) AS table_exists
-- FROM INFORMATION_SCHEMA.TABLES
-- WHERE TABLE_SCHEMA = DATABASE()
--   AND TABLE_NAME = 'store_memberships';

CREATE TABLE IF NOT EXISTS store_memberships (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  staff_user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('owner', 'admin', 'staff') NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('active', 'invited', 'disabled') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_store_memberships_store_user (store_id, staff_user_id),
  KEY idx_store_memberships_user_status (staff_user_id, status),
  KEY idx_store_memberships_store_role_status (store_id, role, status),
  CONSTRAINT fk_store_memberships_store
    FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT fk_store_memberships_staff_user
    FOREIGN KEY (staff_user_id) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Backfill existing KINGWAY staff memberships
-- ============================================================
-- Keep staff_users.store_id unchanged for backward compatibility.
-- Current auth code still uses staff_users.store_id as fallback/default scope.
--
-- Mapping:
-- - admin / ADMIN -> owner
-- - other ADMIN/MANAGER -> admin
-- - CASHIER/REPAIR/INVENTORY/etc -> staff

INSERT INTO store_memberships (store_id, staff_user_id, role, is_default, status)
SELECT
  su.store_id,
  su.id AS staff_user_id,
  CASE
    WHEN su.role = 'ADMIN' AND su.username = 'admin' THEN 'owner'
    WHEN su.role IN ('ADMIN', 'MANAGER') THEN 'admin'
    ELSE 'staff'
  END AS role,
  1 AS is_default,
  'active' AS status
FROM staff_users su
JOIN stores s ON s.id = su.store_id
WHERE su.store_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  role = VALUES(role),
  is_default = VALUES(is_default),
  status = VALUES(status);

-- ============================================================
-- Verification queries
-- ============================================================
SELECT COUNT(*) AS membership_count
FROM store_memberships;

SELECT store_id, role, status, COUNT(*) AS count
FROM store_memberships
GROUP BY store_id, role, status
ORDER BY store_id, role, status;

SELECT
  sm.id,
  sm.store_id,
  s.code AS store_code,
  sm.staff_user_id,
  su.username,
  su.role AS staff_role,
  sm.role AS membership_role,
  sm.is_default,
  sm.status
FROM store_memberships sm
JOIN stores s ON s.id = sm.store_id
JOIN staff_users su ON su.id = sm.staff_user_id
ORDER BY sm.store_id, sm.staff_user_id;

SELECT staff_user_id, COUNT(*) AS default_memberships
FROM store_memberships
WHERE is_default = 1
  AND status = 'active'
GROUP BY staff_user_id
HAVING COUNT(*) > 1;

SELECT su.id, su.username, su.store_id, sm.store_id AS membership_store_id, sm.role AS membership_role
FROM staff_users su
LEFT JOIN store_memberships sm
  ON sm.staff_user_id = su.id
 AND sm.store_id = su.store_id
WHERE su.store_id IS NOT NULL
  AND sm.id IS NULL;

SELECT sm.store_id, sm.staff_user_id, sm.role, sm.status
FROM store_memberships sm
LEFT JOIN stores s ON s.id = sm.store_id
LEFT JOIN staff_users su ON su.id = sm.staff_user_id
WHERE s.id IS NULL
   OR su.id IS NULL;

-- Expected after current staging backfill:
-- - membership_count = 2
-- - store_id=1 owner active count = 1
-- - store_id=1 staff active count = 1
-- - duplicate default membership query returns 0 rows
-- - missing backfill query returns 0 rows
-- - orphan membership query returns 0 rows

-- ============================================================
-- Rollback SQL - staging only
-- ============================================================
-- Preferred rollback for rehearsal failure is restoring the staging DB/volume from backup.
-- If only this draft has been applied and no dependent auth code is deployed, the table can be dropped.
-- Do NOT run on production.

-- DROP TABLE IF EXISTS store_memberships;

-- ============================================================
-- Final warnings
-- ============================================================
-- Do NOT remove staff_users.store_id in this phase.
-- Do NOT modify auth.js or middleware/auth.js in this migration phase.
-- Do NOT implement signup in this migration phase.
-- Do NOT implement billing/payment in this migration phase.
-- Do NOT run this on production.
