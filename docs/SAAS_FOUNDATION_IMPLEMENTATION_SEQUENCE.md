# SaaS Foundation Implementation Sequence

## 1. Purpose

This document consolidates the current multi-store, migration, onboarding, feature gate, and LINE resolver work into one execution roadmap.

This is a planning document only.

Do not use this document as approval to:

- modify code
- modify DB schema
- run migration
- implement signup
- implement billing/payment
- change LINE production behavior
- stage, commit, or push git changes

Primary related documents:

- `docs/STAGING_DB_ENVIRONMENT_VERIFICATION_2026-05-24.md`
- `docs/STAGING_3310_SMOKE_TEST_RESULT_2026-05-24.md`
- `docs/STAGING_STORE_ID_MIGRATION_DRY_RUN_PLAN.md`
- `docs/LINE_MULTI_STORE_RESOLVER_PLAN.md`
- `docs/SELF_SERVICE_STORE_ONBOARDING_MVP_PLAN.md`
- `docs/FEATURE_GATE_MVP_PLAN.md`
- `docs/STORE_ID_API_SCOPE_STRATEGY.md`
- `docs/STORE_PERMISSION_MODEL_DESIGN.md`
- `docs/TENANT_STORE_SCHEMA_DRAFT.md`

## 2. Completed Work

Completed documentation / audit work:

- LINE public route multi-store resolver plan created.
- Store ID migration dry-run plan created.
- DB environment verification completed and documented.
- Confirmed `3306` is not the staging rehearsal target.
- Confirmed `3310` is the intended staging target.
- Confirmed `3310` staging DB has `stores` and required `store_id` backfill.
- Confirmed `3010` backend and `5180` frontend are the staging runtime targets.
- 3310 staging smoke test completed and documented.
- Self-service store onboarding MVP plan created.
- Feature gate MVP plan created.

Important verified state:

- `3310` staging has seed store `id=1`.
- required active-code tables on `3310` have `store_id`.
- missing `store_id` count is `0` for required active-code tables.
- smoke-tested protected routes did not show `store_id` SQL errors.
- actual login success still needs known staging credentials.
- seed store display name has an encoding/mojibake warning that must be verified.

## 3. Do Not Implement Yet

Do not implement these until their prerequisite phases are complete:

- public self-service signup
- production DB migration
- production `store_id` backfill
- payment/billing
- open public plan upgrade UI
- LINE multi-store resolver in production
- new LINE credentials for real stores
- feature gate backend enforcement in production
- destructive data cleanup
- `store_id NOT NULL` conversion
- unique key redesign
- hardcoded `store_id=1` fallback in app code

## 4. Phase 1: 3310 Staging Schema Verification

Goal: prove current staging schema/runtime is stable enough to become the reference for implementation.

### Entrance Criteria

- Use only:
  - backend `3010`
  - MySQL `3310`
  - frontend `5180`
- Confirm not using:
  - backend `3000`
  - MySQL `3306`
  - frontend `5173`
- Read-only checks only unless explicitly approved later.
- No production credentials.

### Work Items

- Verify seed store row.
- Verify seed store encoding at byte/charset level.
- Verify scoped indexes for required active-code tables.
- Verify actual login with known staging credentials.
- Confirm JWT user payload includes `storeId: 1`.
- Repeat route smoke test if schema/index changes are later made.

### Exit Criteria

- `stores.id=1` is verified.
- seed store display name is confirmed as valid or corrected in staging through an approved migration later.
- actual login returns `storeId: 1`.
- required scoped indexes are documented.
- smoke routes remain healthy.
- no `store_id` SQL runtime errors.

## 5. Phase 2: Production-Safe Store ID Migration Rehearsal

Goal: prepare a production-safe migration path without touching production yet.

### Entrance Criteria

- Phase 1 exit criteria met.
- Backup and rollback plan written.
- Target guard included in every SQL/runbook.
- Staging DB target is explicit.
- Production endpoint is explicitly excluded.

### Work Items

- Generate final staging SQL bundle:
  - target guard
  - row-count preflight
  - schema verification
  - nullable `store_id` checks
  - seed store verification
  - backfill verification
  - rollback draft
- Rehearse restore from backup in staging.
- Rehearse migration on a fresh staging copy if needed.
- Confirm existing KINGWAY data remains scoped to store `1`.
- Confirm route smoke tests after rehearsal.

### Exit Criteria

- Full staging rehearsal is repeatable.
- Rollback/restore is tested.
- All row counts are documented before/after.
- Existing KINGWAY operations remain functional.
- No production command has been run.

## 6. Phase 3: Self-Service Onboarding Minimal Backend

Goal: implement the smallest backend foundation for owner/store creation in staging only.

### Entrance Criteria

- Phase 2 exit criteria met.
- Store membership schema design approved.
- Auth context strategy approved.
- Feature flag or internal-only guard is available.
- No public signup exposure.

### Work Items

- Add membership schema in staging:
  - `store_memberships` or approved equivalent
- Backfill existing `admin` and `staff` membership for store `1`.
- Implement backend helper for accessible stores.
- Preserve existing `staff_users.store_id` compatibility.
- Draft owner signup transaction:
  - owner staff user
  - store
  - owner membership
  - default settings
- Keep route internal/staging-only.

### Exit Criteria

- Existing admin/staff still work.
- Existing KINGWAY store `1` remains unchanged in behavior.
- New test owner/store can be created in staging only.
- No cross-store data leakage in basic checks.
- No billing/payment implementation exists.

## 7. Phase 4: Frontend Signup / Store Setup

Goal: add the minimum UI for staging-only owner signup and store setup.

### Entrance Criteria

- Phase 3 backend is stable in staging.
- Signup route is guarded or internal-only.
- Validation rules are agreed.
- Abuse/rate-limit design exists.

### Work Items

- Create staging-only signup page.
- Collect:
  - owner name
  - email/username
  - password
  - phone
  - store name
  - slug
- Add basic store setup screen.
- Show zh-TW validation errors.
- Do not expose billing/payment.
- Do not configure real LINE credentials.

### Exit Criteria

- Owner can create a test store in staging.
- Owner can log in and access only that store.
- Store setup creates default settings.
- Existing KINGWAY UI remains unchanged.
- Frontend does not imply paid billing.

## 8. Phase 5: Feature Gate MVP

Goal: separate store plan/features from staff role permissions.

### Entrance Criteria

- Store membership and store context are stable.
- Feature key catalog approved.
- KINGWAY compatibility feature grant set approved.
- No billing/payment dependency.

### Work Items

- Add staging schema draft:
  - `feature_definitions`
  - `plan_templates`
  - `store_features`
- Seed store `1` with migration/single-store grants.
- Add read-only feature resolver.
- Add frontend display-only locks in staging.
- Later, add backend `requireFeature(featureKey)` for low-risk routes only.

### Exit Criteria

- Store `1` retains existing capabilities.
- Free/basic/premium fixture stores behave as expected in staging.
- Backend feature gate enforcement tested on non-core routes.
- No production lockout risk.
- Billing remains separate.

## 9. Phase 6: LINE Multi-Store Resolver

Goal: make LINE-first workflows store-aware without breaking KINGWAY 台南.

### Entrance Criteria

- Store context and membership are stable.
- Public route store resolver strategy approved.
- LINE credential storage strategy approved.
- Existing KINGWAY LINE flow smoke test baseline exists.

### Work Items

- Add store-aware LINE mapping schema in staging:
  - `store_line_channels`
  - `store_liff_apps`
- Add nullable `store_id` to LINE state tables:
  - `line_chat_sessions`
  - `line_webhook_events`
  - `line_group_registrations`
- Implement resolver:
  - webhook path/token
  - LIFF ID
  - slug/hostname
  - signed store context token
  - controlled legacy fallback
- Use store-specific LINE credentials in staging/test only.
- Verify LINE public routes do not cross stores.

### Exit Criteria

- Existing KINGWAY LINE flows still work in compatibility mode.
- New test store LINE routes resolve to the correct store in staging.
- No public route trusts raw body/query `storeId`.
- No hardcoded `store_id=1` fallback exists.
- Production rollout remains blocked until real credential isolation is approved.

## 10. Rollback / Backup Principles

General rules:

- Backup before any schema change.
- Restore rehearsal before production migration.
- Nullable columns before `NOT NULL`.
- No unique key redesign until data is scoped and verified.
- No destructive cleanup during MVP phases.
- Keep rollback SQL and full restore plan together.
- Preserve auditability of backfill.
- Document row counts before and after every migration rehearsal.

Preferred rollback:

- full DB restore from verified backup

Fallback rollback:

- column/table rollback only in staging and only before dependent writes matter

## 11. KINGWAY Operating Store Protection Principles

KINGWAY 台南 is the production business baseline.

Protection rules:

- Store `id=1` remains existing KINGWAY 台南.
- Do not change core workflow without explicit request.
- Do not replace LINE-first architecture.
- Do not remove existing staff access.
- Do not disable current KINGWAY features through feature gates.
- Do not reuse KINGWAY LINE credentials for test stores.
- Do not silently merge customers.
- Do not use 3306/3000/5173 for staging migration decisions.
- Keep visible UI in Taiwan Traditional Chinese.

Any phase that risks current KINGWAY operations is blocked until staging proof and rollback exist.

## 12. First Implementation Candidates

The next safest implementation candidates are not public signup.

Recommended first candidates:

1. Staging seed store encoding verification on `3310`.
2. Staging scoped index verification on `3310`.
3. Staging login verification using known credentials on backend `3010`.
4. Membership schema SQL draft document.
5. Auth context update design document:
   - membership lookup
   - current store selection
   - legacy `staff_users.store_id` compatibility
6. Feature key catalog document.
7. LINE resolver schema draft for staging only.

Do not proceed to implementation until the selected candidate has a precise staging-only plan and rollback path.
