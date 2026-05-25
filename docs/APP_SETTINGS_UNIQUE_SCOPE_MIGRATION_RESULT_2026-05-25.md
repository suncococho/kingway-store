# app_settings UNIQUE(store_id, setting_scope) Migration Result - 2026-05-25

## 1. Purpose

This document records the staging result for transitioning `app_settings` from global `PRIMARY KEY(setting_scope)` to store-scoped uniqueness with `UNIQUE(store_id, setting_scope)`.

This is a staging result document only.

No production rollout was performed.

## 2. Runtime / DB Target

| Item | Value |
| --- | --- |
| DB host | `127.0.0.1` |
| DB port | `3310` |
| Database | `kingway_store` |
| Observed `@@hostname` | `a9cbc99601a1` |
| Observed `@@port` | `3306` |
| Backend smoke target | `http://127.0.0.1:3010` |

Important note:

- `127.0.0.1:3310` was the staging DB target.
- `127.0.0.1:3306` default DB was not used.
- `@@port=3306` is the MySQL internal container port for the staging DB container.

## 3. Migration Executed

The following staging-only migration was executed successfully:

```sql
ALTER TABLE app_settings
  DROP PRIMARY KEY,
  ADD UNIQUE KEY uk_app_settings_store_scope (store_id, setting_scope);
```

Result:

- `PRIMARY(setting_scope)` was removed.
- `uk_app_settings_store_scope(store_id, setting_scope)` was added.
- Existing non-unique `idx_app_settings_store_scope(store_id, setting_scope)` remained present.

## 4. Final Index State

Final `SHOW INDEX FROM app_settings` confirmed:

```text
uk_app_settings_store_scope  UNIQUE      (store_id, setting_scope)
idx_app_settings_store_scope NON-UNIQUE  (store_id, setting_scope)
```

No `PRIMARY(setting_scope)` remains.

## 5. Final DB Verification

Final read-only verification showed:

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

Result:

- `STORE` row remains scoped to `store_id=1`.
- `SYSTEM` row remains scoped to `store_id=1`.
- `JSON_VALID(payload_json)=1` for both rows.
- `null_store_id_rows=0`.
- No duplicate `(store_id, setting_scope)` pair remains.

## 6. Runtime Smoke Result

### 6-1. Read Smoke

Read smoke checks after migration:

```text
GET /api/settings/public      200
GET /api/settings             200
```

Result:

- Public KINGWAY compatibility read remained available.
- Authenticated store-aware settings read remained available for `store_id=1`.

### 6-2. `PATCH /api/settings/store` Smoke

Controlled same-value write smoke was attempted:

- Route: `PATCH /api/settings/store`
- Payload: `{"storeShortName":"KINGWAY"}`
- Auth context: owner/admin-style token with `storeId=1`, `storeRole=owner`
- HTTP result: `200 OK`

Important caveat:

- The running staging backend process on `3010` appeared not to have reloaded the latest store-aware code at the time of the PATCH smoke.
- The PATCH initially created a staging-only `STORE` row with `store_id=NULL` after `PRIMARY(setting_scope)` was removed.
- That smoke artifact was removed immediately.
- Final DB verification returned to the expected clean state: `STORE/SYSTEM` both `store_id=1`, `null_store_id_rows=0`, `JSON_VALID=1`.

Conclusion:

- The DB key migration is complete and final DB state is clean.
- Read runtime smoke is successful.
- Write route returned `200`, but full write verification should be repeated after staging backend reload/restart to prove the active process is using the current store-aware service code.

## 7. Rollback Need

Rollback is not required for the DB key migration at this time.

Reasons:

- Final `app_settings` row count is correct.
- `STORE/SYSTEM` both remain scoped to `store_id=1`.
- `null_store_id_rows=0`.
- Payload JSON remains valid.
- `uk_app_settings_store_scope` exists.
- `PRIMARY(setting_scope)` is removed as intended.

If rollback is ever required before additional store rows exist, the rollback shape remains:

```sql
ALTER TABLE app_settings
  DROP INDEX uk_app_settings_store_scope,
  ADD PRIMARY KEY (setting_scope);
```

Only run rollback after confirming no duplicate `setting_scope` rows exist.

## 8. Production Status

Production was not modified.

No production DB migration was executed.

No production deployment was performed.

No `git add`, commit, or push was performed.

## 9. Next Safe Step

Recommended next safe step:

1. Restart or reload the staging backend process on `3010` so it definitely uses the current store-aware `settingsService` code.
2. Re-run only the controlled `PATCH /api/settings/store` smoke with `storeShortName=KINGWAY`.
3. Verify immediately afterward:
   - `STORE/SYSTEM` both remain `store_id=1`
   - `null_store_id_rows=0`
   - `JSON_VALID(payload_json)=1`
   - no duplicate `(store_id, setting_scope)` pairs
4. Document the clean post-reload write verification result.
5. Keep production blocked until staging backend reload/write verification and bootstrap schema compatibility are documented.
