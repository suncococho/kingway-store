# Staging LINE Staff Group Registration SQL Draft 2026-07-17

FUTURE DESIGN ONLY.
NOT APPLIED.
DO NOT RUN.
Backup and explicit approval are required before execution in any environment.
Current application code does not depend on this schema.

Status: unapplied future design note only. Do not execute in this phase. Do not treat this file as an approved migration.

Purpose:
- Document a possible future schema direction only.
- Preserve the existing daily group registration.
- Allow future store-scoped LINE group registration records after a reviewed migration.
- Avoid global `line_group_id` uniqueness blocking a test group from being safely scoped by store/type.

Current staging finding:
- `line_group_registrations.line_group_id` is globally UNIQUE.
- The table currently has no `store_id` column.
- Current application code must determine `storeId` from the resolved LINE channel and validate the registering staff member against that same store.
- Because the row itself has no `store_id`, DB-level tenant separation is not available yet, and an existing identical `line_group_id` from another store cannot be distinguished at the table level.

Unapplied future migration sketch:

```sql
-- FUTURE DESIGN SKETCH ONLY.
-- NOT APPROVED, NOT APPLIED, AND NOT SAFE TO RUN AS-IS.
-- BACKUP AND EXPLICIT APPROVAL REQUIRED BEFORE ANY ENVIRONMENT USE.

ALTER TABLE line_group_registrations
  ADD COLUMN store_id BIGINT UNSIGNED NULL AFTER id,
  ADD INDEX idx_line_group_registrations_store_type (store_id, registration_type);

-- Backfill must be reviewed manually per environment.
-- Do not silently assign existing daily groups to a store without verification.

ALTER TABLE line_group_registrations
  DROP INDEX line_group_id,
  ADD UNIQUE KEY uk_line_group_registrations_group_type_store (line_group_id, registration_type, store_id);
```

Operational note:
- Until a reviewed schema migration is approved and applied, the staging channel route protects existing daily registrations by refusing to overwrite a non-staff registration for the same `line_group_id`.
- Current code must not use this sketch for writes; it is retained only to explain the future `store_id` migration idea.
