# app_settings Store ID Dry-Run SQL

## 1. Purpose

This document records the read-only `app_settings` dry-run analysis for converting current global settings into store-scoped settings.

This is a planning and SQL draft document only.

Do not use this document as approval to:

- run SQL against production
- execute `ALTER`, `UPDATE`, or rollback SQL
- modify application code
- modify database schema or data
- deploy
- stage, commit, or push git changes

## 2. 3310 Staging Target

The intended staging migration rehearsal target is:

| Item | Value |
| --- | --- |
| Host | `127.0.0.1` |
| Host port | `3310` |
| Database | `kingway_store` |
| MySQL user | `kingway` |
| Runtime role | staging restore / rehearsal DB |

Read-only target confirmation observed during analysis:

| Check | Observed value |
| --- | --- |
| `@@hostname` | `a9cbc99601a1` |
| `@@port` | `3306` |
| `DATABASE()` | `kingway_store` |

Important distinction:

- `127.0.0.1:3310` is the staging rehearsal target.
- `127.0.0.1:3306` is not the staging rehearsal target.
- DB name alone is not sufficient because both environments can use `kingway_store`.

## 3. Current `app_settings` State

Read-only checks on `127.0.0.1:3310` found:

| Check | Result |
| --- | ---: |
| total `app_settings` rows | `2` |
| `STORE` rows | `1` |
| `SYSTEM` rows | `1` |
| empty payload rows | `0` |
| duplicate `setting_scope` rows | `0` |
| `STORE` JSON valid | `1` |
| `SYSTEM` JSON valid | `1` |
| existing `store_id` column | not present |
| staging `stores.id=1` | present |
| rows expected for `store_id=1` backfill | `2` |

Current table shape:

```sql
CREATE TABLE app_settings (
  setting_scope ENUM('STORE', 'SYSTEM') NOT NULL PRIMARY KEY,
  payload_json LONGTEXT NOT NULL,
  updated_by_staff_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

Current index shape:

```text
PRIMARY KEY (setting_scope)
```

Existing rows observed:

| setting_scope | payload chars | JSON valid | updated_by_staff_id |
| --- | ---: | ---: | --- |
| `STORE` | `1192` | `1` | `NULL` |
| `SYSTEM` | `1048` | `1` | `NULL` |

Seed store observed:

| id | code | status | plan |
| ---: | --- | --- | --- |
| `1` | `KINGWAY_TAINAN` | `active` | `single_store` |

## 4. Risk Points

### 4-1. StoreRole Guard Exists But Storage Is Global

The settings write routes currently have `requireStoreScope()` and `requireStoreRole(["owner", "admin"])`, but `settingsService.saveSettingsScope()` writes only by `setting_scope`.

That means an authorized store owner/admin can still mutate the global `STORE` or `SYSTEM` settings row until the service and schema become store-aware.

### 4-2. Public Settings Are Not Resolved Per Store

`GET /api/settings/public` currently returns `getPublicStoreSettings()` without a public store resolver.

In a multi-store environment, this can expose the wrong store's public name, address, business hours, LINE add-friend URL, receipt copy, or customer-facing copy.

### 4-3. Primary Key Transition Is Sequencing-Sensitive

Current `PRIMARY KEY(setting_scope)` prevents more than one `STORE` and one `SYSTEM` row. Moving to `(store_id, setting_scope)` requires careful sequencing.

If the primary key is changed before code writes `store_id`, existing write paths may fail or create ambiguous rows.

### 4-4. Snapshot Summary Is Still Global

`getSettingsSnapshot()` currently includes summaries from `staff_users`, `v2_workflow_events`, and `line_group_registrations` without settings-service-level store scoping.

Even after `app_settings.store_id` is added, those summary queries need separate store-aware handling.

### 4-5. LINE And Notification Settings Need Separate Isolation

Current system settings mix LINE flags, notification settings, and env/config status. Real multi-store LINE credentials and group routing should not be stored as global generic settings.

Future stores must not reuse KINGWAY production LINE credentials.

## 5. Migration Blocker Status

Data blocker status: no immediate data blocker found on `3310` staging.

Reasons:

- Exactly two settings rows exist.
- `STORE` and `SYSTEM` each exist once.
- Payloads are valid JSON.
- `stores.id=1` exists.
- Expected `store_id=1` backfill target is exactly two rows.
- No duplicate target pair is possible in current state before adding new rows.

Implementation blocker status: code sequencing blocker exists.

Reason:

- `backend/src/services/settingsService.js` currently reads/writes global settings by `setting_scope` only.
- Key transition to `(store_id, setting_scope)` should not be finalized until the service layer passes and writes `storeId` consistently.

## 6. Safest Migration Strategy

Recommended staged strategy:

1. Keep this as staging-only until reviewed.
2. Add nullable `store_id` and a non-unique index first.
3. Backfill existing `STORE` and `SYSTEM` rows to `store_id=1`.
4. Verify row count, JSON validity, null `store_id` count, and duplicate target pairs.
5. Update `settingsService` later to accept and require `storeId` for reads/writes.
6. Wire protected routes to pass `req.storeId`.
7. Add or approve a public settings resolver before public multi-store exposure.
8. Only after staging write-path tests pass, transition to unique key `(store_id, setting_scope)`.
9. Do not make `store_id NOT NULL` until all settings creation paths are store-aware.
10. Do not run this against production without staging rehearsal and rollback approval.

## 7. Dry-Run ALTER / UPDATE SQL Draft

This SQL is a draft only. Do not execute until explicitly approved.

```sql
-- ============================================================
-- app_settings store_id dry-run draft
-- Target: staging only, 127.0.0.1:3310 / kingway_store
-- Do not run on production.
-- ============================================================

-- 1. Target guard / identity check
SELECT
  @@hostname AS mysql_hostname,
  @@port AS mysql_port,
  DATABASE() AS db_name;

-- Expected host connection: 127.0.0.1:3310
-- Expected DATABASE(): kingway_store
-- Expected staging container hostname previously observed: a9cbc99601a1
-- Expected internal @@port: 3306

-- 2. Confirm seed store exists
SELECT id, code, status, plan
FROM stores
WHERE id = 1;

-- 3. Preflight current settings state
SELECT COUNT(*) AS app_settings_rows
FROM app_settings;

SELECT
  setting_scope,
  COUNT(*) AS row_count,
  SUM(CASE WHEN payload_json IS NULL OR payload_json = '' THEN 1 ELSE 0 END) AS empty_payload_count,
  MIN(JSON_VALID(payload_json)) AS all_payloads_valid
FROM app_settings
GROUP BY setting_scope
ORDER BY setting_scope;

SELECT setting_scope, COUNT(*) AS duplicate_count
FROM app_settings
GROUP BY setting_scope
HAVING COUNT(*) > 1;

-- 4. Draft schema change: nullable first
ALTER TABLE app_settings
  ADD COLUMN store_id BIGINT UNSIGNED NULL AFTER setting_scope,
  ADD INDEX idx_app_settings_store_scope (store_id, setting_scope);

-- 5. Draft KINGWAY compatibility backfill
UPDATE app_settings
SET store_id = 1
WHERE store_id IS NULL
  AND setting_scope IN ('STORE', 'SYSTEM');

-- 6. Post-backfill duplicate-pair check
SELECT store_id, setting_scope, COUNT(*) AS row_count
FROM app_settings
GROUP BY store_id, setting_scope
HAVING COUNT(*) > 1;
```

## 8. Future Key Transition Draft

This SQL is for a later phase only, after code is store-aware and staging write tests pass.

```sql
-- ============================================================
-- Future key transition draft
-- Run only after settingsService reads/writes by store_id.
-- ============================================================

-- 1. Verify no NULL store_id remains for settings rows
SELECT COUNT(*) AS null_store_id_rows
FROM app_settings
WHERE store_id IS NULL;

-- 2. Verify no duplicate target pairs
SELECT store_id, setting_scope, COUNT(*) AS row_count
FROM app_settings
GROUP BY store_id, setting_scope
HAVING COUNT(*) > 1;

-- 3. Make store_id required only after all creation paths are store-aware
ALTER TABLE app_settings
  MODIFY store_id BIGINT UNSIGNED NOT NULL;

-- 4. Replace global primary key with store-scoped uniqueness
ALTER TABLE app_settings
  DROP PRIMARY KEY,
  ADD UNIQUE KEY uk_app_settings_store_scope (store_id, setting_scope);
```

Optional later foreign key direction, not part of the first dry-run:

```sql
ALTER TABLE app_settings
  ADD CONSTRAINT fk_app_settings_store
  FOREIGN KEY (store_id) REFERENCES stores(id);
```

Do not add this until store lifecycle and delete/disable behavior are approved.

## 9. Rollback SQL Draft

Rollback depends on how far the migration has progressed.

### 9-1. Rollback After Nullable Column / Non-Unique Index Only

Use only if no new per-store settings rows have been created.

```sql
-- Confirm rollback is structurally safe
SELECT setting_scope, COUNT(*) AS row_count
FROM app_settings
GROUP BY setting_scope
HAVING COUNT(*) > 1;

-- Expected: zero rows. If this returns rows, do not restore PRIMARY KEY(setting_scope).

ALTER TABLE app_settings
  DROP INDEX idx_app_settings_store_scope;

ALTER TABLE app_settings
  DROP COLUMN store_id;
```

### 9-2. Rollback After Unique Key Transition

Use only if duplicate `setting_scope` rows do not exist.

```sql
-- Confirm there are no multiple rows per setting_scope
SELECT setting_scope, COUNT(*) AS row_count
FROM app_settings
GROUP BY setting_scope
HAVING COUNT(*) > 1;

-- Expected: zero rows before returning to PRIMARY KEY(setting_scope).

ALTER TABLE app_settings
  DROP INDEX uk_app_settings_store_scope,
  ADD PRIMARY KEY (setting_scope);

-- Drop non-unique index only if it still exists separately.
-- ALTER TABLE app_settings DROP INDEX idx_app_settings_store_scope;

ALTER TABLE app_settings
  DROP COLUMN store_id;
```

Preferred production rollback remains full DB restore from a verified backup if this ever moves beyond staging rehearsal.

## 10. Verification SQL Draft

Use after each staged rehearsal step.

```sql
-- Target identity
SELECT
  @@hostname AS mysql_hostname,
  @@port AS mysql_port,
  DATABASE() AS db_name;

-- Store 1 exists
SELECT id, code, status, plan
FROM stores
WHERE id = 1;

-- Column exists after schema step
SHOW COLUMNS FROM app_settings LIKE 'store_id';

-- Index state
SHOW INDEX FROM app_settings;

-- Row count unchanged
SELECT COUNT(*) AS app_settings_rows
FROM app_settings;

-- Store-scoped distribution
SELECT store_id, setting_scope, COUNT(*) AS row_count
FROM app_settings
GROUP BY store_id, setting_scope
ORDER BY store_id, setting_scope;

-- No missing store_id after backfill
SELECT COUNT(*) AS null_store_id_rows
FROM app_settings
WHERE store_id IS NULL;

-- No duplicate target pairs
SELECT store_id, setting_scope, COUNT(*) AS row_count
FROM app_settings
GROUP BY store_id, setting_scope
HAVING COUNT(*) > 1;

-- Payloads remain valid
SELECT setting_scope, JSON_VALID(payload_json) AS payload_json_valid
FROM app_settings
ORDER BY setting_scope;

-- KINGWAY expected settings rows
SELECT setting_scope, CHAR_LENGTH(payload_json) AS payload_chars, updated_by_staff_id, created_at, updated_at
FROM app_settings
WHERE store_id = 1
  AND setting_scope IN ('STORE', 'SYSTEM')
ORDER BY setting_scope;
```

## 11. Next Safe Step

Recommended next safe step:

1. Review this dry-run SQL document without executing it.
2. If approved, run only the target guard and preflight `SELECT` queries again against `127.0.0.1:3310`.
3. Prepare a staging-only migration rehearsal window.
4. Execute nullable `store_id` + non-unique index + `store_id=1` backfill only on staging.
5. Run verification SQL and record results.
6. Only after staging proof, implement `settingsService` `storeId` parameters and route wiring.
7. Do not proceed to production, public signup, or public multi-store LINE resolver in this phase.
