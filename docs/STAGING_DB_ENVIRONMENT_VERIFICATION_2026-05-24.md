# Staging DB Environment Verification - 2026-05-24

## 1. Purpose

This document records the read-only verification performed before any `store_id` migration rehearsal.

Reason for verification:

- Previous staging documentation said `stores` and `store_id` backfill already existed.
- A check against `127.0.0.1:3306` showed no `stores` table and no `store_id` columns.
- Therefore the DB/container target had to be verified before any migration rehearsal.

No DB changes, migrations, code changes, git staging, commits, or pushes were performed.

## 2. Environment Summary

There are two relevant MySQL endpoints with the same DB name, `kingway_store`.

| Endpoint | Role | DB name | Verification result |
|---|---|---|---|
| `127.0.0.1:3306` | default/current compose DB | `kingway_store` | not migration rehearsal target |
| `127.0.0.1:3310` | staging restore/rehearsal DB | `kingway_store` | intended staging target |

Because both endpoints use the same database name, port/container identity is mandatory before running any read or migration command.

## 3. 3306 Default DB

Observed characteristics:

- Endpoint: `127.0.0.1:3306`
- MySQL hostname observed: `e7c611430306`
- DB name: `kingway_store`
- Table count: `27`
- `stores` table: missing
- `store_id` columns: missing from all checked tables
- Backend health check on `3000`: returned `{"ok":true}`

Conclusion:

- `3306` is not the intended staging migration rehearsal target.
- It appears to be the default/current compose DB behind `kingway-mysql`.
- Running the staging `store_id` migration rehearsal against this endpoint would target the wrong environment.

## 4. 3310 Staging DB

Observed characteristics:

- Endpoint: `127.0.0.1:3310`
- MySQL hostname observed: `a9cbc99601a1`
- DB name: `kingway_store`
- Table count: `28`
- `stores` table: exists
- Backend health check on `3010`: returned `{"ok":true}`
- Frontend check on `5180`: returned HTTP `200`

Seed store observed:

| id | code | status | plan |
|---:|---|---|---|
| `1` | `KINGWAY_TAINAN` | `active` | `single_store` |

Required active-code tables with completed `store_id` backfill:

- `staff_users`
- `customers`
- `orders`
- `order_items`
- `products`
- `repair_orders`
- `coupons`
- `inventory_movements`
- `supplier_requests`
- `purchase_confirmations`

For the required active-code tables above, missing `store_id` count was verified as `0`.

Conclusion:

- `3310` is the intended staging target.
- It matches the prior staging Phase 1A direction: `stores` exists and required `store_id` backfill is present.

## 5. Runtime Test Target

All future staging runtime tests for this phase must use:

- Backend: `http://127.0.0.1:3010`
- DB: `127.0.0.1:3310`
- Frontend: `http://127.0.0.1:5180`

Do not use:

- Backend `3000`
- DB `3306`
- Frontend `5173`

for staging migration rehearsal verification.

## 6. Target Guard Requirement

All future migration or rehearsal documents/scripts must include a target guard.

Minimum guard requirements:

- Print expected DB host/port before execution.
- Print `SELECT DATABASE()`.
- Print `@@hostname` and `@@port`.
- Verify `stores` table state before migration.
- Refuse to proceed unless the operator confirms `127.0.0.1:3310` or `kingway-staging-mysql`.
- Refuse to proceed if connected to `127.0.0.1:3306` for staging migration rehearsal.

The DB name alone is not enough because both environments use `kingway_store`.

## 7. Encoding Warning

The seed store name returned as mojibake-like text:

```text
KINGWAY å°å—
```

Expected visible value:

```text
KINGWAY 台南
```

Before production consideration:

- Verify stored bytes and connection/client character set.
- Do not assume the data is permanently corrupted until byte-level encoding is checked.
- Confirm whether the issue is client display, connection charset, import charset, or stored payload corruption.

This follows the repository rule: if Chinese text appears as `?`, `??`, `???`, or corrupted text, verify stored bytes before concluding data is broken.

## 8. Why Prior Docs and Current 3306 Check Differed

Most likely explanation:

- Prior staging docs refer to `kingway-staging-mysql` / host port `3310`.
- The mismatch check was initially run against `127.0.0.1:3306`.
- Both environments use `kingway_store`, so the DB name looked identical while the actual container/port was different.

Other possible contributors:

- staging restore compose and default compose are both running
- default DB is older schema
- active branch code is ahead of the default DB schema

## 9. Next Safe Step

Proceed with a `3310` staging smoke test checklist, not a migration execution.

Recommended checklist:

1. Confirm target guard:
   - DB endpoint `127.0.0.1:3310`
   - backend `http://127.0.0.1:3010`
   - frontend `http://127.0.0.1:5180`
2. Verify seed store row and encoding.
3. Verify required active-code tables have `store_id`.
4. Verify indexes for scoped tables.
5. Verify existing `admin` and `staff` accounts have `store_id=1`.
6. Login against staging backend and confirm returned user payload includes `storeId: 1`.
7. Smoke test staging backend routes:
   - dashboard summary
   - customers list
   - orders list/detail
   - products list behavior
   - repairs list/detail
   - inventory summary
8. Confirm no production notification is sent.
9. Record findings before any next migration or self-service onboarding work.
