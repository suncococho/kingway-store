# Store LINE Channels Seed Values Audit - 2026-05-26

## 1. Purpose

This document records the read-only audit for candidate `store_line_channels` seed values before any staging-only tokenized LINE webhook implementation.

This audit does not approve:

- database inserts or updates
- environment file changes
- code changes
- LINE credential changes
- webhook URL changes
- git staging, commits, or pushes

Primary source of truth remains:

1. `docs/KINGWAY_STORE_MASTER_SPEC.md`
2. The user's newest explicit instruction
3. Existing code structure
4. Older temporary patches or assumptions

## 2. Read-only Scope

Reviewed targets:

- `backend/src/config.js`
- `.env.staging-restore`
- `.env.staging-restore.example`
- `docker-compose.staging-restore.yml`
- staging `store_line_channels` table
- `docs/LINE_TOKENIZED_WEBHOOK_STAGING_DESIGN.md`

No DB writes, env edits, code edits, credential changes, webhook URL changes, or git operations were performed.

## 3. Current `store_line_channels` State

Staging DB read-only check result:

```text
database_name: kingway_store
store_line_channels_table_exists: 1
store_line_channels row_count: 0
active_line_channel_rows: 0
duplicate_channel_ids: 0
duplicate_path_tokens: 0
```

The table exists and is empty.

Implication:

- No active LINE channel mapping currently exists in staging.
- No collision is present because there are no rows.
- A seed can be planned, but cannot be executed until missing values and blockers are resolved.

## 4. Store Row Confirmation

Staging `stores` read-only check confirmed:

```text
id: 1
code: KINGWAY_TAINAN
status: active
```

The displayed store name appeared mojibake in terminal output, but the key identity needed for this audit is clear:

- `stores.id = 1`
- `stores.code = KINGWAY_TAINAN`
- `stores.status = active`

## 5. `LINE_CHANNEL_ID` Status

Current status:

- `LINE_CHANNEL_ID` is not present in `backend/src/config.js`.
- `LINE_CHANNEL_ID` was not found in `.env.staging-restore`.
- `LINE_CHANNEL_ID` was not found in `.env.staging-restore.example`.
- The staging migration draft still contains placeholder `REPLACE_WITH_KINGWAY_STAGING_LINE_CHANNEL_ID`.

Conclusion:

- `LINE_CHANNEL_ID` is missing.
- A real seed row should not be inserted without an approved staging channel id.

## 6. Staging Env Credential State

`.env.staging-restore` redacted read-only check:

```text
LINE_WEBHOOK_ENABLED=false
LINE_MESSAGING_ENABLED=false
LINE_MOCK_MODE=true
WEBHOOKS_ENABLED=false
LINE_CHANNEL_SECRET=<CHANGE_ME_DISABLED>
LINE_CHANNEL_ACCESS_TOKEN=<CHANGE_ME_DISABLED>
```

`.env.staging-restore.example` uses the same disabled placeholder pattern.

`docker-compose.staging-restore.yml` also sets staging backend notification safety flags:

```text
WEBHOOKS_ENABLED=false
LINE_WEBHOOK_ENABLED=false
LINE_MESSAGING_ENABLED=false
LINE_MOCK_MODE=true
TELEGRAM_NOTIFICATIONS_ENABLED=false
TELEGRAM_MOCK_MODE=true
NOTIFICATIONS_ENABLED=false
NOTIFICATION_DRY_RUN=true
```

Conclusion:

- Staging is intentionally disabled/mock for LINE messaging.
- Current values are suitable for resolver-only planning, not real LINE signature/reply smoke tests.

## 7. Secret Storage Policy

Actual LINE secrets and access tokens must not be stored in `store_line_channels`.

Allowed values:

- `channel_secret_ref`
- `channel_access_token_ref`

Recommended current reference names for legacy KINGWAY staging candidate:

```text
channel_secret_ref: env:LINE_CHANNEL_SECRET
channel_access_token_ref: env:LINE_CHANNEL_ACCESS_TOKEN
```

Policy:

- The DB stores references only.
- Secret/token values remain in approved secret/env management.
- Reports and logs must not print raw secret/token values.
- Tokenized webhook logs should redact or hash `webhook_path_token`.

## 8. Recommended Seed Draft

This is a draft only. Do not run until values are approved.

```sql
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
) VALUES (
  1,
  'REPLACE_WITH_APPROVED_STAGING_LINE_CHANNEL_ID',
  'KINGWAY 台南 staging LINE OA',
  'env:LINE_CHANNEL_SECRET',
  'env:LINE_CHANNEL_ACCESS_TOKEN',
  'REPLACE_WITH_RANDOM_STAGING_WEBHOOK_PATH_TOKEN',
  '/api/line/webhook/REPLACE_WITH_RANDOM_STAGING_WEBHOOK_PATH_TOKEN',
  1,
  'ACTIVE'
);
```

Safer staging planning variant while credentials remain disabled:

```sql
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
) VALUES (
  1,
  'REPLACE_WITH_APPROVED_STAGING_LINE_CHANNEL_ID',
  'KINGWAY 台南 staging LINE OA',
  'env:LINE_CHANNEL_SECRET',
  'env:LINE_CHANNEL_ACCESS_TOKEN',
  'REPLACE_WITH_RANDOM_STAGING_WEBHOOK_PATH_TOKEN',
  '/api/line/webhook/REPLACE_WITH_RANDOM_STAGING_WEBHOOK_PATH_TOKEN',
  1,
  'INACTIVE'
);
```

Recommendation:

- Use `INACTIVE` until approved staging LINE channel id, path token, and credential policy are confirmed.
- Use `ACTIVE` only for an approved staging smoke test.

## 9. Rollback / Cleanup SQL Candidate

Do not run without approval.

Preferred reversible cleanup:

```sql
UPDATE store_line_channels
SET status = 'INACTIVE'
WHERE store_id = 1
  AND channel_id = 'REPLACE_WITH_APPROVED_STAGING_LINE_CHANNEL_ID';
```

Optional targeted cleanup only if audit retention policy approves deletion:

```sql
DELETE FROM store_line_channels
WHERE store_id = 1
  AND channel_id = 'REPLACE_WITH_APPROVED_STAGING_LINE_CHANNEL_ID'
  AND status = 'INACTIVE';
```

Recommendation:

- Prefer `INACTIVE` over `DELETE`.
- Keep mapping history unless deletion is explicitly approved.

## 10. Blockers

Current blockers before any real seed:

- Approved staging `LINE_CHANNEL_ID` is missing.
- Approved random `webhook_path_token` is missing.
- `.env.staging-restore` uses disabled placeholders for `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN`.
- Staging LINE messaging is disabled:
  - `LINE_WEBHOOK_ENABLED=false`
  - `LINE_MESSAGING_ENABLED=false`
  - `LINE_MOCK_MODE=true`
- Secret reference resolution is not yet implemented for tokenized webhook runtime.
- Production credential reuse is not approved and should be treated as prohibited.
- No staging smoke test has been run for tokenized webhook route.

Blocker status:

```text
BLOCKED for real ACTIVE seed.
OK for documentation-only seed planning.
```

## 11. Next Safe Step

Recommended next safe step:

1. Keep DB unchanged.
2. Keep env unchanged.
3. Generate or approve a staging-only random `webhook_path_token` without committing it to docs in raw form.
4. Obtain approved staging `LINE_CHANNEL_ID`.
5. Decide whether first seed should be `INACTIVE` for resolver dry-run or `ACTIVE` for an approved smoke test.
6. Prepare a separate reviewed dry-run SQL file that prints planned values redacted before any insert.
7. Do not use production credentials for staging tokenized webhook tests.

