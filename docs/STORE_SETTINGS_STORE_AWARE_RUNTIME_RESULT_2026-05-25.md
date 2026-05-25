# Store Settings Store-Aware Runtime Result - 2026-05-25

## 1. Purpose

This document records the runtime verification result after the settings service was refactored to read and write store-aware `app_settings` rows when `app_settings.store_id` exists.

This document is a result record only.

No production rollout was performed.

## 2. Runtime Target

Runtime checks were performed against the staging runtime target:

| Item | Value |
| --- | --- |
| Backend | `http://127.0.0.1:3010` |
| DB | `127.0.0.1:3310` |
| Database | `kingway_store` |
| Store compatibility target | `store_id=1` |

The default DB target `127.0.0.1:3306` was not used for this verification.

## 3. `/api/settings` Result

Authenticated `GET /api/settings` was verified with a staging-style owner JWT containing:

```json
{
  "id": 1,
  "username": "admin",
  "role": "ADMIN",
  "storeId": 1,
  "storeRole": "owner"
}
```

Result:

- HTTP status: `200 OK`
- Response included `store`, `system`, and `summary` sections.
- Store settings resolved to KINGWAY 台南 store data.
- This confirms the protected settings route can read with `req.storeId=1`.

Note:

- This was a non-mutating `GET` check.
- No database write was performed by this check.

## 4. `/api/settings/public` Result

Unauthenticated `GET /api/settings/public` was verified.

Result:

- HTTP status: `200 OK`
- Existing KINGWAY public response was preserved.
- Response included expected public store fields such as:
  - `storeName`: `KINGWAY 台南門市`
  - `storeShortName`: `KINGWAY`
  - `address`: `台南市東區東門路二段245號`
  - `businessHours`: `每日 13:00 - 21:00`
  - customer-facing zh-TW copy

Current compatibility behavior:

- Public route remains temporarily pinned to `getPublicStoreSettings(1)`.
- A full public store resolver has not been implemented yet.

## 5. `PATCH /api/settings/store` Owner Token Verification

A real `PATCH /api/settings/store` with owner token was not executed in this documentation phase.

Reason:

- The phase explicitly forbids additional DB modification.
- `PATCH /api/settings/store` is a write route and would execute settings persistence logic.

What was verified instead:

- Owner-token authentication and `req.storeId=1` runtime path were verified through authenticated `GET /api/settings`.
- The route code now passes `req.storeId` to `saveSettingsScope()` for `PATCH /api/settings/store` and `PATCH /api/settings/system`.
- StoreRole guard remains present on both write routes.

Pending safe verification:

- Execute owner-token PATCH only in a later approved staging write-verification phase.
- Use a controlled payload and verify only `store_id=1` row changes.

## 6. `app_settings` DB Verification

Read-only DB verification on staging `3310` showed:

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

- Existing `STORE` row is scoped to `store_id=1`.
- Existing `SYSTEM` row is scoped to `store_id=1`.
- No `app_settings` row has `store_id IS NULL`.
- Both payloads remain valid JSON.

## 7. Production Status

Production was not modified.

No production DB migration was executed.

No production deployment was performed.

No `git add`, commit, or push was performed.

## 8. Open Notes

- The public settings route still uses KINGWAY compatibility behavior and does not yet resolve public store context by hostname, slug, LIFF, LINE channel, or signed token.
- The unique key transition to `(store_id, setting_scope)` has not been performed.
- `PATCH /api/settings/store` owner-token write verification is still pending because this phase prohibited additional DB writes.
- Snapshot summary internals still need deeper store-scope review for related tables such as `staff_users`, `v2_workflow_events`, and `line_group_registrations`.

## 9. Next Safe Step

Recommended next safe step:

1. Approve a staging-only write verification phase for `PATCH /api/settings/store` and `PATCH /api/settings/system`.
2. Before patching, capture current `app_settings` payload hashes for `store_id=1`.
3. Execute owner-token PATCH with a controlled no-risk payload.
4. Verify only `store_id=1` `STORE` or `SYSTEM` row changes.
5. Verify `store_id` remains non-null and JSON remains valid.
6. Only after write verification passes, plan the unique key transition to `(store_id, setting_scope)` as a separate phase.
