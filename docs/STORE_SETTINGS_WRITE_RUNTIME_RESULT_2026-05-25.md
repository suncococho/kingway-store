# Store Settings Write Runtime Result - 2026-05-25

## 1. Purpose

This document records the staging runtime result for store-aware settings write behavior after `settingsService` was updated to use `req.storeId` when `app_settings.store_id` exists.

This is a result document only.

No production rollout was performed.

## 2. Runtime Target

| Item | Value |
| --- | --- |
| Backend | `http://127.0.0.1:3010` |
| DB | `127.0.0.1:3310` |
| Database | `kingway_store` |
| Store context | `store_id=1` |

The default DB target `127.0.0.1:3306` was not used for this verification.

## 3. `PATCH /api/settings/store` Result

`PATCH /api/settings/store` was verified successfully in staging with an owner/admin-authorized token context.

Expected authorization context:

```json
{
  "role": "ADMIN",
  "storeId": 1,
  "storeRole": "owner"
}
```

Result:

- Route: `PATCH /api/settings/store`
- Auth: owner/admin token context
- Test field: `storeShortName`
- Test value: `KINGWAY`
- Result: success
- Store scope used by backend: `req.storeId=1`
- Request body/query `store_id`: not used as authority

No additional PATCH was executed while creating this document.

## 4. Persisted DB Verification

Read-only verification against staging `3310` showed:

```text
store_id  setting_scope  storeShortName  payload_json_valid  updated_at
1         STORE          "KINGWAY"       1                   2026-05-26 03:25:56
1         SYSTEM         NULL            1                   2026-05-26 02:20:52
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

Result:

- `STORE` row remains scoped to `store_id=1`.
- `SYSTEM` row remains scoped to `store_id=1`.
- `storeShortName=KINGWAY` is persisted in the `STORE` payload.
- `JSON_VALID(payload_json)=1` for both `STORE` and `SYSTEM`.
- No `app_settings` rows have `store_id IS NULL`.

## 5. Production Status

Production was not modified.

No production DB migration was executed.

No production deployment was performed.

No `git add`, commit, or push was performed.

## 6. Result Summary

The staging write path is ready for the next review stage:

- Store-aware settings read path works for `store_id=1`.
- Store-aware settings write path successfully preserved `store_id=1` scope.
- Existing KINGWAY settings compatibility remains intact.
- `app_settings` payloads remain valid JSON.
- Nullable `store_id` migration remains clean with zero null rows.

## 7. Next Safe Step

Next safe step:

1. Review readiness for the unique key transition.
2. Run a staging preflight duplicate check for `(store_id, setting_scope)`.
3. If clean, plan a separate phase for `UNIQUE(store_id, setting_scope)`.
4. Do not combine the unique key transition with production rollout.
5. Keep production blocked until staging rollback and smoke-test results are documented.
