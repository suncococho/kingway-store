# app_settings UNIQUE(store_id, setting_scope) Readiness - 2026-05-25

## 1. Purpose

This document records the readiness audit before transitioning `app_settings` from global `PRIMARY KEY(setting_scope)` to store-scoped uniqueness with `UNIQUE(store_id, setting_scope)`.

This is a readiness document only.

Do not use this document as approval to:

- run `ALTER TABLE`
- modify database schema or data
- modify application code
- deploy
- stage, commit, or push git changes

## 2. 3310 Staging Readiness Result

Read-only checks were performed against the staging rehearsal target:

| Item | Value |
| --- | --- |
| Host | `127.0.0.1` |
| Port | `3310` |
| Database | `kingway_store` |
| Observed `@@hostname` | `a9cbc99601a1` |
| Observed `@@port` | `3306` |

Important note:

- `127.0.0.1:3310` is the intended staging target.
- `@@port=3306` is the MySQL internal container port.
- The default DB target `127.0.0.1:3306` is not the staging rehearsal target.

Readiness summary:

- Staging data is ready for a controlled unique-key transition.
- No duplicate `(store_id, setting_scope)` pairs were found.
- No `NULL store_id` rows were found.
- Both settings payloads remain valid JSON.
- Application write path is already store-aware when `app_settings.store_id` exists.

## 3. Current `app_settings` Row State

Current staging row state:

```text
app_settings_rows
2
```

Store/scope distribution:

```text
store_id  setting_scope  row_count
1         STORE          1
1         SYSTEM         1
```

NULL `store_id` count:

```text
null_store_id_rows
0
```

JSON validity:

```text
setting_scope  payload_json_valid
STORE          1
SYSTEM         1
```

Duplicate target-pair result:

```text
No rows returned for:
GROUP BY store_id, setting_scope HAVING COUNT(*) > 1
```

## 4. Current Index State

Current staging index shape:

```text
PRIMARY KEY (setting_scope)
idx_app_settings_store_scope (store_id, setting_scope) -- non-unique
```

Current column shape includes:

```text
setting_scope enum('STORE','SYSTEM') NOT NULL PRIMARY KEY
store_id bigint unsigned NULL indexed
payload_json longtext NOT NULL
updated_by_staff_id bigint unsigned NULL
created_at timestamp NOT NULL
updated_at timestamp NOT NULL
```

The target transition is to remove global uniqueness on `setting_scope` and add store-scoped uniqueness on `(store_id, setting_scope)`.

## 5. Write Path Store-Aware Confirmation

Current active write path is store-aware when `app_settings.store_id` exists.

Confirmed code direction:

- `backend/src/services/settingsService.js`
  - detects whether `app_settings.store_id` exists
  - reads with `WHERE store_id = ? AND setting_scope IN ('STORE', 'SYSTEM')`
  - writes with `UPDATE app_settings SET ... WHERE store_id = ? AND setting_scope = ?`
  - inserts with `(store_id, setting_scope, payload_json, updated_by_staff_id)` only when no row exists
  - falls back to legacy global `setting_scope` mode when `store_id` column does not exist

- `backend/src/routes/settings.js`
  - `GET /api/settings` uses `requireStoreScope()` and passes `req.storeId`
  - `PATCH /api/settings/store` passes `req.storeId` to `saveSettingsScope()`
  - `PATCH /api/settings/system` passes `req.storeId` to `saveSettingsScope()`
  - `GET /api/settings/public` remains temporarily pinned to `getPublicStoreSettings(1)` for KINGWAY compatibility

Runtime write result already documented:

- `PATCH /api/settings/store` with owner/admin context succeeded in staging.
- Test field `storeShortName=KINGWAY` persisted under `store_id=1`.
- `STORE` and `SYSTEM` rows remained scoped to `store_id=1`.

## 6. Blocker Status

### 6-1. Staging Blocker

No staging data blocker found for unique-key transition.

Reasons:

- There are only two rows.
- Both rows are scoped to `store_id=1`.
- No `NULL store_id` rows exist.
- No duplicate `(store_id, setting_scope)` pairs exist.
- JSON payloads are valid.
- Store-aware runtime read/write has been verified.

### 6-2. Remaining Implementation Risk

There is still a compatibility risk around fresh DB/bootstrap behavior:

- `backend/src/bootstrap.js` still creates `app_settings` with legacy `PRIMARY KEY(setting_scope)` when bootstrapping a fresh DB.
- `seedDefaultSettings()` defaults to store `1`, but bootstrap schema creation itself is not store-aware yet.

This does not block the current staging table transition, but it is a production no-go item until handled or explicitly accepted.

## 7. Production No-Go Reasons

Do not apply this transition to production yet.

Reasons:

- Production has not gone through the same documented `store_id` nullable migration and backfill rehearsal in this phase.
- Production `app_settings` row/index state has not been verified immediately before transition.
- Production runtime write path has not been separately smoke-tested with production-safe controls.
- Bootstrap/fresh-schema behavior is still legacy.
- Public settings resolver is still KINGWAY compatibility only and not true multi-store resolution.
- Rollback from `UNIQUE(store_id, setting_scope)` to `PRIMARY KEY(setting_scope)` becomes unsafe if additional store rows exist.
- Staging rollback and post-transition smoke-test results still need to be documented.

## 8. Expected Migration SQL

Draft only. Do not execute until explicitly approved in a separate staging execution phase.

```sql
-- ============================================================
-- app_settings unique store scope transition
-- Target: staging only, 127.0.0.1:3310 / kingway_store
-- Do not run on production.
-- ============================================================

-- 1. Target guard
SELECT
  DATABASE() AS db_name,
  @@hostname AS mysql_hostname,
  @@port AS mysql_port;

-- 2. Verify store_id is fully backfilled
SELECT COUNT(*) AS null_store_id_rows
FROM app_settings
WHERE store_id IS NULL;

-- 3. Verify no duplicate target pairs
SELECT store_id, setting_scope, COUNT(*) AS row_count
FROM app_settings
GROUP BY store_id, setting_scope
HAVING COUNT(*) > 1;

-- 4. Verify payload health
SELECT setting_scope, JSON_VALID(payload_json) AS payload_json_valid
FROM app_settings
ORDER BY setting_scope;

-- 5. Transition from global primary key to store-scoped uniqueness
ALTER TABLE app_settings
  DROP PRIMARY KEY,
  ADD UNIQUE KEY uk_app_settings_store_scope (store_id, setting_scope);
```

`store_id NOT NULL` is intentionally not included in this transition. That should remain a later phase after all settings creation paths and bootstrap schema are store-aware.

## 9. Verification SQL

Run after the unique-key transition in staging.

```sql
-- Target identity
SELECT
  DATABASE() AS db_name,
  @@hostname AS mysql_hostname,
  @@port AS mysql_port;

-- Index state
SHOW INDEX FROM app_settings;

-- Row count should remain unchanged
SELECT COUNT(*) AS app_settings_rows
FROM app_settings;

-- Distribution should remain store_id=1 / STORE+SYSTEM
SELECT store_id, setting_scope, COUNT(*) AS row_count
FROM app_settings
GROUP BY store_id, setting_scope
ORDER BY store_id, setting_scope;

-- No NULL store_id rows
SELECT COUNT(*) AS null_store_id_rows
FROM app_settings
WHERE store_id IS NULL;

-- No duplicate store-scoped settings pairs
SELECT store_id, setting_scope, COUNT(*) AS row_count
FROM app_settings
GROUP BY store_id, setting_scope
HAVING COUNT(*) > 1;

-- Payloads remain valid
SELECT setting_scope, JSON_VALID(payload_json) AS payload_json_valid
FROM app_settings
ORDER BY setting_scope;
```

Recommended runtime smoke tests after SQL verification:

- `GET /api/settings/public` returns existing KINGWAY public response.
- Authenticated `GET /api/settings` returns store `1` settings.
- Controlled owner/admin `PATCH /api/settings/store` updates only `store_id=1`.
- Confirm `STORE` and `SYSTEM` remain valid JSON and scoped to store `1`.

## 10. Rollback SQL

Rollback is safe only if no multiple rows per `setting_scope` exist.

```sql
-- 1. Confirm rollback can restore PRIMARY KEY(setting_scope)
SELECT setting_scope, COUNT(*) AS row_count
FROM app_settings
GROUP BY setting_scope
HAVING COUNT(*) > 1;

-- Expected: zero rows.
-- If this returns rows, do not restore PRIMARY KEY(setting_scope).

-- 2. Roll back key shape
ALTER TABLE app_settings
  DROP INDEX uk_app_settings_store_scope,
  ADD PRIMARY KEY (setting_scope);
```

Do not drop `store_id` as part of this rollback unless the phase explicitly calls for full reversal of the store-scoping rehearsal.

Preferred rollback for production, if this ever reaches production, remains a verified full DB restore because key rollback can become unsafe after multi-store settings rows exist.

## 11. Safest Rollout Order

Recommended staging-only rollout order:

1. Re-run preflight target guard against `127.0.0.1:3310`.
2. Re-run NULL `store_id` and duplicate `(store_id, setting_scope)` checks.
3. Confirm `JSON_VALID(payload_json)=1` for all rows.
4. Run transition SQL in a controlled staging window.
5. Verify index state and row distribution.
6. Smoke test public settings read.
7. Smoke test authenticated settings read.
8. Smoke test controlled owner/admin settings write.
9. Document runtime result.
10. Only after that, consider a separate bootstrap/schema compatibility update.

Do not combine this unique-key transition with:

- production rollout
- public signup
- public store resolver
- LINE multi-store resolver
- `store_id NOT NULL` conversion
- bootstrap schema rewrite

## 12. Next Safe Step

Next safe step:

1. Create a separate staging execution phase for `uk_app_settings_store_scope`.
2. Execute only after approval.
3. Keep the phase limited to `app_settings` key transition and verification.
4. Do not touch production.
5. After successful staging verification, create a result document before any further schema or code work.
