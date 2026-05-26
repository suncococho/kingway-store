# Store Public Identity Mapping Dry Audit - 2026-05-26

## 1. Scope

This document records the read-only dry audit for:

- `backend/migrations/staging/2026-05-25_create_store_public_identity_mapping.sql`
- 3310 staging database only
- `store_hostnames`
- `store_liff_apps`
- `store_line_channels`

No database writes, code changes, webhook changes, LINE credential changes, git staging, commits, or pushes were performed.

## 2. 3310 Staging Target Confirmation

Read-only connection target used:

```text
mysql -h127.0.0.1 -P3310 -ukingway -pkingway kingway_store
```

Observed DB identity:

```text
database_name: kingway_store
mysql_hostname: a9cbc99601a1
mysql_server_port: 3306
```

Interpretation:

- Host-side target is `127.0.0.1:3310`.
- MySQL reports internal container port `3306`, which is expected for the staging restore compose mapping.
- This matches `docker-compose.staging-restore.yml`, where host `3310` maps to MySQL container `3306`.

## 3. `stores.id = 1` Confirmation

Read-only query confirmed:

```text
id: 1
code: KINGWAY_TAINAN
status: active
plan: single_store
```

Notes:

- `stores.id` type is `bigint unsigned`, compatible with the migration draft foreign keys.
- The displayed `stores.name` appeared mojibake in one CLI result, but `app_settings` JSON showed proper zh-TW store text. Do not conclude the business data is broken without byte-level review.

## 4. Mapping Tables Existence

Read-only `information_schema.TABLES` checks confirmed:

```text
store_hostnames: 0
store_liff_apps: 0
store_line_channels: 0
```

Result:

- None of the three mapping tables currently exists in 3310 staging.
- There are no existing mapping-table unique constraints or rows to collide with because the tables are absent.

## 5. Hostname Seed Feasibility

Planned legacy hostname seed:

```text
pos.kingway.tw
```

Dry audit result:

- `store_hostnames` does not exist yet.
- No existing hostname mapping collision was found.
- `pos.kingway.tw` legacy hostname seed is feasible after DDL, assuming `stores.id=1` remains the reviewed staging legacy store.

Risk note:

- This is a public production hostname. In staging it must remain a mapping rehearsal value only unless staging routing/DNS is explicitly designed to use it.

## 6. Legacy LIFF ID Confirmation

Observed LIFF source:

```text
frontend/.env: VITE_LIFF_ID=2010080463-s7I6a2BG
```

Also observed in frontend source fallbacks:

```text
2010080463-s7I6a2BG
```

Dry audit result:

- `store_liff_apps` does not exist yet, so no LIFF mapping collision exists in the target DB.
- The value is available as the current legacy LIFF ID candidate.

Blocker:

- Confirm whether `2010080463-s7I6a2BG` is approved for staging seed usage before inserting it.
- Do not assume a frontend fallback value is sufficient approval for a DB identity mapping.

## 7. LINE Channel / Credential Findings

Backend config currently reads:

```text
LINE_CHANNEL_SECRET
LINE_CHANNEL_ACCESS_TOKEN
LINE_QA_GROUP_ID
```

Backend config does not currently read:

```text
LINE_CHANNEL_ID
```

Staging restore env shows:

```text
LINE_WEBHOOK_ENABLED=false
LINE_MESSAGING_ENABLED=false
LINE_MOCK_MODE=true
LINE_CHANNEL_SECRET=CHANGE_ME_DISABLED
LINE_CHANNEL_ACCESS_TOKEN=CHANGE_ME_DISABLED
```

Findings:

- `LINE_CHANNEL_ID` is absent from `.env.staging-restore`.
- Staging LINE credential values are placeholders/disabled by design.
- The migration draft correctly stores credential references such as `env:LINE_CHANNEL_SECRET` and `env:LINE_CHANNEL_ACCESS_TOKEN`, not raw secrets.

Blocker:

- `store_line_channels` seed must remain on hold until a reviewed staging `LINE_CHANNEL_ID` and webhook path token are provided.
- Do not copy production/local LINE credentials into the staging migration without explicit approval.

## 8. Current LINE State Tables

Read-only staging DB checks found:

```text
line_group_registrations active rows: 1
line_webhook_events top route_path: /api/line/webhook
line_webhook_events /api/line/webhook count: 548
```

Interpretation:

- Existing LINE operational state is still tied to the legacy global `/api/line/webhook` path.
- This dry audit does not change webhook routing.
- Future channel mapping must account for existing webhook event history and group registration behavior before any webhook route wiring.

## 9. Blocker Summary

No blocker for:

- DDL creation of the three mapping tables in staging.
- Legacy hostname seed for `pos.kingway.tw`, assuming staging use is reviewed.

Blockers for full LIFF/LINE seed:

- `LINE_CHANNEL_ID` is absent in staging env/config.
- Staging LINE credentials are disabled placeholders.
- Approved staging webhook path token has not been provided.
- LIFF ID candidate exists, but approval for DB seed has not been explicitly confirmed.

## 10. Execution Feasibility

### 10-1. DDL Only

Feasible after normal staging approval:

- `CREATE TABLE store_hostnames`
- `CREATE TABLE store_liff_apps`
- `CREATE TABLE store_line_channels`

Expected risk:

- Low, because no existing tables with those names are present.
- Foreign keys target existing `stores(id)` with compatible type.

### 10-2. DDL + Hostname Seed

Feasible with review:

- Insert `store_hostnames` row:
  - `store_id = 1`
  - `hostname = 'pos.kingway.tw'`
  - `hostname_type = 'LEGACY'`
  - `is_primary = 1`
  - `status = 'ACTIVE'`

Risk:

- `pos.kingway.tw` is production-like. Keep staging route wiring disabled unless explicitly approved.

### 10-3. LIFF / LINE Seed

Hold.

Reasons:

- Staging `LINE_CHANNEL_ID` is missing.
- LINE secret/token are disabled placeholders.
- Webhook path token has not been reviewed.
- LIFF ID requires explicit confirmation before DB seed.

The current migration draft protects LIFF/LINE seed inserts from placeholder values by skipping those inserts while placeholder variables remain unchanged.

## 11. Staging Execution Checklist

Before execution:

- Confirm target is `127.0.0.1:3310`, database `kingway_store`.
- Confirm staging backup/restore point exists.
- Confirm `stores.id = 1` is the intended KINGWAY staging legacy store.
- Confirm no production DB connection is active in the shell/session.
- Confirm `store_hostnames`, `store_liff_apps`, and `store_line_channels` are still absent.
- Decide whether this run is `DDL only` or `DDL + hostname seed`.
- Do not include LIFF/LINE seed unless all approved values are present.

For `DDL only`:

- Run only table creation sections.
- Run verification table count and `information_schema` checks.
- Do not insert hostname, LIFF, or LINE rows.

For `DDL + hostname seed`:

- Run table creation sections.
- Run only the `store_hostnames` legacy seed with reviewed `@legacy_hostname`.
- Skip LIFF and LINE seed.
- Verify hostname row count and collision checks.

After execution:

- Verify all three tables exist.
- Verify unique indexes exist.
- Verify FK references are valid.
- Verify collision checks return zero rows.
- Verify no webhook route or LINE credential changed.
- Smoke only currently approved low-risk route wiring.

## 12. Rollback Checklist

Preferred rollback:

- Restore the staging DB/volume from the approved backup/restore point.

If only DDL was applied and no code depends on the new tables:

- Drop in dependency-safe order:
  - `store_line_channels`
  - `store_liff_apps`
  - `store_hostnames`

If seed rows were inserted and table removal is not approved:

- Mark rows inactive:
  - `store_line_channels.status = 'INACTIVE'`
  - `store_liff_apps.status = 'INACTIVE'`
  - `store_hostnames.status = 'INACTIVE'`

Rollback must not:

- Change LINE credentials.
- Change webhook URL.
- Reintroduce route-level hardcoded `store_id = 1`.
- Delete audit-relevant rows unless explicitly approved.

## 13. Production No-Go Conditions

Do not use this migration or related route wiring in production if any are true:

- Staging execution has not been completed and reviewed.
- Backup/rollback has not been rehearsed.
- `LINE_CHANNEL_ID` is missing or unverified.
- LINE secret/token references are placeholders.
- Webhook path token is missing, predictable, or shared.
- LIFF ID ownership has not been confirmed.
- Hostname ownership/verification is unclear.
- Public write routes still trust body/query `store_id`.
- LINE, LIFF, repair, order, coupon, or customer write routes are not store-scoped.
- `publicStoreResolver` relies on automatic fallback outside explicit legacy mode.

## 14. Next Safe Step

Next safe step:

Prepare a staging execution checklist/runbook split into two explicit modes:

1. `DDL only`
2. `DDL + hostname seed only`

Keep LIFF and LINE channel seed on hold until staging-approved values are available.
