# Platform Admin Audit Log Production Plan 2026-06-10

## Current Production State

- Read-only production check confirmed `platform_admin_audit_logs` does not exist.
- No production DB write, migration, deploy, or restart was performed during this preparation step.
- Staging already has the table and audit smoke test passed.

## Migration SQL

File:

- `sql/production_platform_audit_logs_2026_06_10.sql`

Creates one table:

- `platform_admin_audit_logs`

Columns:

- `id`
- `admin_user_id`
- `admin_email`
- `action`
- `target_type`
- `target_id`
- `before_json`
- `after_json`
- `ip`
- `user_agent`
- `created_at`

Indexes:

- `idx_platform_audit_admin_time (admin_user_id, created_at)`
- `idx_platform_audit_target_time (target_type, target_id, created_at)`
- `idx_platform_audit_action_time (action, created_at)`

The migration is additive only. It does not modify existing KINGWAY data or existing tables.

## Rollback SQL

File:

- `sql/production_platform_audit_logs_rollback_2026_06_10.sql`

Rollback action:

- `DROP TABLE IF EXISTS platform_admin_audit_logs;`

Risk:

- Drops audit rows written after migration.
- For production incidents, backup restore remains the preferred rollback path.

## Production Apply Sequence

1. Confirm latest production backup exists and integrity checks are complete.
2. Confirm git status and target commit.
3. Run `sql/production_platform_audit_logs_2026_06_10.sql` on production MySQL.
4. Verify table exists with `SHOW CREATE TABLE platform_admin_audit_logs`.
5. Deploy/restart production backend only after migration succeeds.
6. Run audit smoke test:
   - platform admin auth works
   - `GET /api/saas-admin/audit-logs` works
   - one platform admin store change writes an audit row
   - `before_json` / `after_json` contain expected snapshots
7. If smoke test fails:
   - stop further rollout
   - inspect backend logs
   - rollback backend to previous commit if needed
   - drop audit table only if explicitly approved and no audit rows need preservation

## Risk Assessment

Risk level: low.

Reasons:

- Migration is create-only.
- No existing table or row is modified.
- Backend audit insert is designed to warn and not fail the original SaaS admin API if audit recording fails.

Remaining operational risk:

- Backend code expects the table once deployed. Deploying backend before migration would produce warning logs and missing audit rows.
- Rollback SQL is destructive for audit rows, so use backup restore as the default production rollback strategy.
