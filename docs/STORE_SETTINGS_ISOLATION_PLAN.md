# Store Settings Isolation Plan

## 1. Purpose

This document defines the plan for isolating store settings so that each store manages only its own configuration in a future 100-store structure.

This is a planning document only.

Do not use this document as approval to:

- modify application code
- modify database schema or data
- run migration
- deploy
- stage, commit, or push git changes
- implement public signup
- implement store switching

Primary source of truth remains:

1. `docs/KINGWAY_STORE_MASTER_SPEC.md`
2. The user's newest explicit instruction
3. Existing code structure
4. Older temporary patches or assumptions

## 2. Current `app_settings` Structure

Current schema in `database/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  setting_scope ENUM('STORE', 'SYSTEM') NOT NULL PRIMARY KEY,
  payload_json LONGTEXT NOT NULL,
  updated_by_staff_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

Current behavior:

- `setting_scope` is the primary key.
- Only one global `STORE` settings row can exist.
- Only one global `SYSTEM` settings row can exist.
- There is no `store_id` column.
- Settings are not isolated by store.
- Existing defaults are defined in `backend/src/services/settingsService.js` as `STORE_DEFAULTS` and `SYSTEM_DEFAULTS`.

In a 100-store structure, this means every store would read and write the same global settings unless the schema and service layer are changed.

## 3. Current Settings Route Structure

Current route file: `backend/src/routes/settings.js`.

Routes:

| Route | Auth | Current behavior |
| --- | --- | --- |
| `GET /api/settings/public` | Public | Returns `getPublicStoreSettings()` without store resolver |
| `GET /api/settings` | `authenticate`, `authorize(["ADMIN", "MANAGER"])` | Returns `getSettingsSnapshot()` global snapshot |
| `PATCH /api/settings/store` | `authenticate`, `authorize`, `requireStoreScope()`, `requireStoreRole(["owner", "admin"])` | Saves global `STORE` settings |
| `PATCH /api/settings/system` | `authenticate`, `authorize`, `requireStoreScope()`, `requireStoreRole(["owner", "admin"])` | Saves global `SYSTEM` settings |

Current route-level store authority is partly present for write routes, but the service layer still writes by `setting_scope` only.

## 4. Current Service Structure

Current service file: `backend/src/services/settingsService.js`.

Important functions:

- `loadSettingsRows()`
- `saveSettingsScope(scope, payload, updatedByStaffId)`
- `seedDefaultSettings()`
- `getSettingsSnapshot()`
- `getPublicStoreSettings()`
- `normalizeStorePayload(input)`
- `normalizeSystemPayload(input)`

Current issue:

- `loadSettingsRows()` does not accept `storeId`.
- `saveSettingsScope()` does not accept `storeId`.
- `getSettingsSnapshot()` does not accept `storeId`.
- `getPublicStoreSettings()` does not accept `storeId`.
- SQL reads all settings rows where `setting_scope IN ('STORE', 'SYSTEM')`.
- SQL writes with `INSERT INTO app_settings (setting_scope, payload_json, updated_by_staff_id)`.
- `ON DUPLICATE KEY UPDATE` updates by global `setting_scope` primary key.

## 5. Risk Points

### 5-1. StoreRole Guard Exists But Storage Is Global

`PATCH /api/settings/store` and `PATCH /api/settings/system` currently require:

- authenticated user
- existing operational route auth
- store scope
- `storeRole` of `owner` or `admin`

However, because `saveSettingsScope()` writes only by `setting_scope`, an allowed owner/admin can still update the global settings rows shared by every store.

This is the most important isolation gap.

### 5-2. Public Settings Route Has No Store Resolver

`GET /api/settings/public` currently calls `getPublicStoreSettings()` without authentication and without a store resolver.

In a multi-store environment, this can expose the wrong store's public store name, address, business hours, LINE add-friend URL, receipt copy, or customer-facing text.

### 5-3. Snapshot Summary Uses Global Aggregates

`getSettingsSnapshot()` currently includes summaries from:

- `staff_users`
- `v2_workflow_events`
- `line_group_registrations`

These queries are not scoped by `store_id` in the settings service. In a multi-store environment, they could leak aggregate operational status across stores.

### 5-4. LINE Configuration Is Not Store-Isolated Yet

Some LINE status values come from backend config/env, while some flags come from `SYSTEM` settings.

Future stores must not share KINGWAY LINE credentials, LINE group registrations, LIFF apps, or notification routing.

### 5-5. KINGWAY Compatibility Must Be Preserved

Existing KINGWAY 台南 production behavior depends on the current global settings behaving as the store settings.

The migration must preserve KINGWAY as store `id=1` and must not change visible Taiwan Traditional Chinese copy, LINE-first workflows, purchase confirmation flows, repair flows, coupon rules, or existing staff operations.

## 6. Schema Direction

### 6-1. Add `app_settings.store_id`

Proposed first schema direction:

```sql
ALTER TABLE app_settings
  ADD COLUMN store_id BIGINT UNSIGNED NULL AFTER setting_scope,
  ADD INDEX idx_app_settings_store_scope (store_id, setting_scope);
```

Initial migration should keep `store_id` nullable until staging rehearsal confirms behavior.

### 6-2. Backfill Existing KINGWAY Rows

Existing global rows should be treated as KINGWAY store settings:

```sql
UPDATE app_settings
SET store_id = 1
WHERE store_id IS NULL
  AND setting_scope IN ('STORE', 'SYSTEM');
```

This must be rehearsed in staging only before production use.

### 6-3. Unique Key Direction

Current primary key is `setting_scope`, which blocks per-store rows.

Target direction:

```sql
UNIQUE KEY uk_app_settings_store_scope (store_id, setting_scope)
```

Final schema should allow:

- store `1` + `STORE`
- store `1` + `SYSTEM`
- store `2` + `STORE`
- store `2` + `SYSTEM`
- and so on

The transition from `PRIMARY KEY(setting_scope)` to a unique key on `(store_id, setting_scope)` is risky and must be staged carefully.

Recommended staged order:

1. Add nullable `store_id` and non-unique index.
2. Backfill existing rows to `store_id=1` in staging.
3. Verify no duplicate `(store_id, setting_scope)` pairs.
4. Add unique key `(store_id, setting_scope)` in staging.
5. Change service SQL to include `store_id`.
6. Only after successful runtime tests, plan primary key cleanup if needed.

Do not make `store_id NOT NULL` until all settings creation paths are store-aware.

## 7. Service Layer Direction

Settings service should become explicitly store-aware.

Recommended function direction:

```js
loadSettingsRows(storeId)
saveSettingsScope(storeId, scope, payload, updatedByStaffId)
seedDefaultSettings(storeId)
getSettingsSnapshot(storeId)
getPublicStoreSettings(storeId)
```

Required behavior:

- Protected settings routes must pass `req.storeId`.
- Service methods must not infer store from request body.
- Request body `store_id` should be ignored or rejected.
- `saveSettingsScope()` must write using `(store_id, setting_scope)`.
- `loadSettingsRows()` must read only rows for the current `storeId`.
- New store onboarding should seed default `STORE` and `SYSTEM` settings for the created store.
- KINGWAY compatibility can use store `1` only through the resolved store context, not through broad global reads.

Example target write shape:

```sql
INSERT INTO app_settings (store_id, setting_scope, payload_json, updated_by_staff_id)
VALUES (?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  payload_json = VALUES(payload_json),
  updated_by_staff_id = VALUES(updated_by_staff_id)
```

## 8. Public Settings Resolver Direction

Public settings cannot rely on authenticated `req.storeId`.

A future public resolver must determine store context from approved public signals, such as:

- hostname or subdomain
- store slug
- signed store context token
- LIFF app mapping
- LINE channel mapping
- explicitly approved legacy KINGWAY fallback

Rules:

- Public routes must not trust raw body/query `store_id` as authority.
- Public routes must not expose another store's settings when resolver input is missing or ambiguous.
- Existing KINGWAY public behavior may use an explicit compatibility fallback to store `1` during transition.
- Any public resolver must align with `docs/LINE_MULTI_STORE_RESOLVER_PLAN.md` before customer-facing LINE flows are multi-store enabled.

## 9. KINGWAY Store `id=1` Backward Compatibility

Compatibility rule:

- Existing KINGWAY 台南 data and settings map to store `id=1`.

During migration:

- Existing global `STORE` and `SYSTEM` settings become store `1` settings.
- Existing staff auth should continue to return `storeId=1` where applicable.
- Existing KINGWAY public settings route should keep returning the same customer-facing data.
- Existing LINE-first workflows must continue to function.
- Existing zh-TW visible text must be preserved.
- New test stores must not copy KINGWAY custom LINE credentials or production-specific routing.

Avoid:

- hardcoded `store_id=1` scattered through application code
- silent global fallback for authenticated non-KINGWAY stores
- copying KINGWAY custom settings into new stores without review

Acceptable transition pattern:

- resolver/helper returns store `1` for explicit KINGWAY compatibility contexts only
- all protected routes use authenticated `req.storeId`
- all new stores receive defaults, not copied KINGWAY custom settings

## 10. LINE And Notification Settings Separation Direction

Store settings should be split by responsibility over time.

### 10-1. Brand / Store Public Settings

Keep in `app_settings` `STORE` scope or a future store profile structure:

- store name
- short name
- logo
- address
- phone
- business hours
- public map URL
- public customer service copy
- receipt display copy
- purchase confirmation copy
- repair reservation copy
- survey follow-up copy

### 10-2. Operational System Settings

Keep in `app_settings` `SYSTEM` scope initially:

- POS behavior flags
- dashboard display text
- operational permission summaries
- general notification enable flags
- daily report schedule
- pending summary schedule

### 10-3. LINE Credentials And Routing

Do not store real multi-store LINE credentials only as generic JSON in global `SYSTEM` settings.

Future direction should use dedicated store-aware tables, for example:

- `store_line_channels`
- `store_liff_apps`
- `line_group_registrations.store_id`
- `line_chat_sessions.store_id`
- `line_webhook_events.store_id`

Each store must have isolated:

- LINE OA/channel credentials
- LIFF app ID
- staff/admin/repair/inventory/daily group mappings
- webhook resolver mapping
- notification routing

New stores should default to LINE disabled/unconfigured until credentials and resolver mapping are explicitly configured.

## 11. Staging Dry-Run SQL Necessity

A staging dry-run is required before implementation because the migration changes a primary key pattern and affects public/customer-facing settings.

Dry-run SQL should include:

- target environment guard
- current `app_settings` schema inspection
- current row count
- current `setting_scope` values
- duplicate check for target `(store_id, setting_scope)`
- add nullable `store_id`
- backfill existing rows to `store_id=1`
- verify backfill count
- add non-unique index first
- add unique key only after duplicate verification
- rollback draft
- post-migration route smoke test checklist

Do not run dry-run SQL against production until staging rehearsal and rollback are approved.

## 12. Test Plan

### 12-1. KINGWAY Compatibility Tests

- `GET /api/settings/public` returns the same KINGWAY public store data after store `1` resolver is applied.
- `GET /api/settings` as KINGWAY owner/admin returns store `1` settings.
- `PATCH /api/settings/store` as KINGWAY owner/admin updates only store `1` settings.
- `PATCH /api/settings/system` as KINGWAY owner/admin updates only store `1` settings.

### 12-2. Store Role Tests

- `storeRole=owner` can update own store settings.
- `storeRole=admin` can update own store settings if current policy remains owner/admin.
- `storeRole=staff` receives 403 on settings writes.
- `storeRole=null` receives 403 on settings writes.

### 12-3. Cross-Store Isolation Tests

- Store `2` owner cannot read store `1` settings through protected routes.
- Store `2` owner cannot update store `1` settings by sending `store_id=1` in body or query.
- Store `1` and store `2` can have different `STORE` payloads.
- Store `1` and store `2` can have different `SYSTEM` payloads.

### 12-4. Public Resolver Tests

- Known KINGWAY public context resolves to store `1`.
- Known test-store public context resolves to the test store.
- Missing or ambiguous public context does not expose another store's settings.
- Raw query/body `store_id` does not grant access to arbitrary settings.

### 12-5. Snapshot Summary Tests

- Staff link summary is scoped by store.
- LINE group summary is scoped by store.
- Workflow event summary is scoped by store.
- Latest error summary does not leak another store's events.

### 12-6. LINE / Notification Tests

- Store `1` keeps existing KINGWAY LINE behavior in compatibility mode.
- Test store does not use KINGWAY LINE credentials.
- Notification flags and send schedules are store-specific.
- Group routing is store-specific when line group registrations become scoped.

## 13. Next Safe Implementation Step

Recommended next step:

1. Create a staging-only dry-run SQL document for `app_settings.store_id` migration.
2. Include target guard, row-count preflight, duplicate checks, backfill to store `1`, index/key transition, and rollback notes.
3. Review the dry-run SQL without executing it.
4. After approval, rehearse only on the staging target.
5. Only after staging proof, implement service-level `storeId` parameters and route wiring.

Do not start with production migration or public signup.
