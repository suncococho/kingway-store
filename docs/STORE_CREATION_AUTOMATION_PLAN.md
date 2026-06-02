# Store Creation Automation Plan

Date: 2026-06-03
Branch: `beta/staging-architecture`

## Scope

Original draft was documentation-only. Phase 1 API provisioning is now implemented.

Goal:

- define how Platform Admin should create a new tenant store without manual SQL/script work
- keep the current platform/store auth boundary intact
- implement the first transactional provisioning API without touching frontend UI
- avoid changing production config, `.env`, or LINE/Telegram logic in this step

## Phase 1 Implemented

Implemented on `2026-06-03`:

- `POST /api/saas-admin/stores` is now available for `PLATFORM_OWNER` and `PLATFORM_ADMIN` tokens
- the API creates `stores`, `store_features`, and owner `staff_users` inside one transaction
- duplicate `code`, effective `slug`, and owner `username` are rejected before insert
- if `ownerPassword` is omitted, the API generates a temporary password and returns it once in the response
- if provisioning fails, all inserts are rolled back

Current schema note:

- staging `stores` still does not have a physical `slug` column
- therefore Phase 1 validates and returns `slug`, and defends uniqueness against the current effective slug derived from `code`
- when `stores.slug` is added later, the same service already supports persisting it directly

## 1. Current `stores` Creation Structure

Current platform admin capability:

- `GET /api/saas-admin/stores`
- `GET /api/saas-admin/stores/:id/features`
- `PATCH /api/saas-admin/stores/:id/features`

Current implementation:

- `backend/src/routes/saasAdmin.js`
- protected by `backend/src/middleware/platformAuth.js`
- authenticated through `POST /api/platform-auth/login`

What exists today:

- platform admin can list stores
- platform admin can view/store `store_features`
- `store_features` rows are auto-created on demand through `ensureStoreFeatureRow(storeId)`

What does not exist today:

- no `POST /api/saas-admin/stores`
- no owner/admin account bootstrap endpoint per store
- no transactional “create store + feature flags + owner account” flow
- no platform-side password issuance/reset flow for a newly created store owner

Observed implementation detail:

- `getStore(storeId)` in `backend/src/routes/saasAdmin.js` currently returns `name` from `code`, not from the real `stores.name` column.
- this is harmless for the current list/features screen but should be corrected before building a full store-creation UI.

## 2. Current `KINGWAY_KAOHSIUNG` Seed Method

Current second-store creation is script-driven, not platform-admin-driven.

Primary reference:

- `backend/scripts/seedKaohsiungTenant.js`

What the script currently does:

1. ensures `stores.id=2`, `code=KINGWAY_KAOHSIUNG`, `name=KINGWAY 高雄`, `status=active`, `plan=single_store`
2. ensures `store_features.store_id=2` exists and sets all `*_enabled` flags to `1`
3. ensures a store owner-style staff user:
   - username default `kaohsiung_owner`
   - display name default `KINGWAY 高雄 店長`
   - role default `ADMIN` or `MANAGER`
   - `is_active=1`
   - `store_id=2`
4. ensures a sample product under `store_id=2`
5. ensures a sample customer under `store_id=2`
6. generates a random initial plaintext password and bcrypt-hashes it through `backend/src/utils/passwords.js`

Important characteristics of the current script:

- it is staging/test seeding, not a reusable Platform Admin API
- it hardcodes the second store around `id=2`
- it also creates sample tenant data, which should not be part of normal production store onboarding
- it prints or returns an initial password operationally, but there is no dedicated secure delivery flow in the web app

## 3. Required Work When Creating a New Store

### Required DB Rows

At minimum, a new store onboarding flow must create:

- one `stores` row
- one `store_features` row
- at least one `staff_users` owner/admin row

### `stores` Row

Required fields inferred from current code:

- `code`
- `name`
- `status`
- `plan`

Recommended initial defaults:

- `status='active'` for a ready-to-use store
- `plan='trial'` or `plan='single_store'` depending on onboarding mode

Design recommendation:

- do not hardcode numeric ids in the API path
- let DB allocate `stores.id`
- enforce unique `code`

### `store_features` Row

Current system expectation:

- `store_features.store_id` should exist for every active store
- missing rows are currently auto-created lazily by `ensureStoreFeatureRow(storeId)`

Automation recommendation:

- create `store_features` eagerly during store creation
- set every feature explicitly
- avoid relying on lazy creation for a newly provisioned tenant

Recommended feature policy options:

- `trial preset`
- `full preset`
- `minimal preset`

### Owner / Admin Staff Account

Current store login comes from:

- `backend/src/routes/auth.js`
- source table: `staff_users`

Required new-store owner fields:

- `username`
- `password_hash`
- `display_name`
- `role`
- `is_active=1`
- `store_id=<new store id>`

Recommended initial role:

- `ADMIN`

Important current limitation:

- existing `backend/src/routes/staff.js` inserts `staff_users` without `store_id`
- therefore the current staff route is not safe to reuse for platform-driven store owner creation
- platform-side owner creation needs a dedicated implementation that explicitly sets `store_id`

### Default Permissions

Current staff JWT payload contains:

- `role`
- `storeId`
- `storeRole`
- limited `permissions` only for a special cashier case

Practical implication:

- owner bootstrap should rely primarily on `role=ADMIN` and `store_id`
- do not depend on ad hoc `permissions` JSON for initial store onboarding

Optional future enhancement:

- if `store_memberships` becomes the primary multi-store membership model, also create:
  - one `store_memberships` row
  - `status='active'`
  - `is_default=1`
  - `role='owner'` or `role='admin'`

### Default Product / Category Data

Current `KINGWAY_KAOHSIUNG` script creates sample product/customer data only for testing.

Recommendation for real store creation:

- do not auto-create sample customer data
- do not auto-create sample product data by default
- keep product/category bootstrap as an optional follow-up action

Possible onboarding choices:

- empty catalog
- copy from template catalog
- import from source store later

### Initial Password Issuance

Current password utilities:

- `backend/src/utils/passwords.js`

Current seed behavior:

- random plaintext generated outside the web app
- bcrypt hash persisted into `staff_users.password_hash`

Recommended API behavior:

- generate a one-time initial password server-side
- hash before saving
- return plaintext exactly once in the Platform Admin response
- require Platform Admin operator to copy/store it securely

Better future option:

- issue a password-setup token instead of a plaintext temporary password

### Trial / Plan Status

Current `stores.plan` is already surfaced in platform admin list APIs.

Recommended first-class plan values:

- `trial`
- `single_store`
- `paid`
- `suspended`

Recommended `stores.status` values:

- `draft`
- `active`
- `suspended`
- `archived`

Immediate compatibility recommendation:

- use only currently supported values already present in DB/app
- add richer lifecycle values only after schema/consumer review

## 4. Platform Admin API Design

### `POST /api/saas-admin/stores`

Purpose:

- create the store shell and feature row

Suggested request body:

```json
{
  "code": "KINGWAY_TAICHUNG",
  "name": "KINGWAY 台中",
  "status": "active",
  "plan": "trial",
  "featurePreset": "trial",
  "owner": {
    "createNow": true,
    "username": "taichung_owner",
    "displayName": "KINGWAY 台中 店長",
    "role": "ADMIN"
  }
}
```

Suggested behavior:

- validate unique `code`
- insert `stores`
- insert `store_features`
- optionally create owner in the same transaction
- return created store summary plus one-time initial password if owner was created

Suggested response shape:

```json
{
  "ok": true,
  "store": {
    "id": 3,
    "code": "KINGWAY_TAICHUNG",
    "name": "KINGWAY 台中",
    "status": "active",
    "plan": "trial"
  },
  "owner": {
    "id": 41,
    "username": "taichung_owner",
    "temporaryPassword": "generated-once"
  }
}
```

### `POST /api/saas-admin/stores/:id/owner`

Purpose:

- create or rotate the primary owner/admin account after the store already exists

Suggested request body:

```json
{
  "username": "taichung_owner",
  "displayName": "KINGWAY 台中 店長",
  "role": "ADMIN",
  "resetExistingPassword": false
}
```

Suggested behavior:

- verify store exists
- create a new owner/admin under `staff_users.store_id = :id`
- or optionally rotate/reset the existing owner password
- return one-time temporary password or setup token

### `PATCH /api/saas-admin/stores/:id/features`

Current endpoint already exists.

Expected role in automation flow:

- used after creation for fine-grained enable/disable
- should remain a separate step from core store provisioning unless a preset is supplied at create time

## 5. Store Admin Initial Login Flow

Current login path:

- `POST /api/login`
- implemented in `backend/src/routes/auth.js`

Current JWT output includes:

- `id`
- `username`
- `role`
- `displayName`
- `storeId`
- `storeRole`
- `permissions`

Recommended first-login flow:

1. Platform Admin creates store and owner/admin account.
2. Platform Admin receives one-time temporary password.
3. Owner logs in through existing `/login`.
4. JWT resolves `storeId` to the new store.
5. Owner immediately changes password through a future password-change flow.

Gap to note:

- there is no dedicated “must change password on first login” flow in the current implementation
- if this is required, add a dedicated field such as `must_reset_password` or a one-time setup token design later

## 6. Rollback Plan

Store creation automation should be transaction-first.

Recommended rollback approach:

1. wrap `stores`, `store_features`, and owner creation in one DB transaction
2. if any insert fails, rollback the full transaction
3. do not create sample products/customers inside the core store-create transaction
4. if password delivery fails after commit, allow a separate “reset owner password” action rather than deleting the store

Manual rollback policy for early implementation:

- if a store was created but owner failed after commit, keep the store and retry owner creation
- avoid deleting store rows automatically unless there is a fully designed archive/delete lifecycle

## 7. Test Plan

### API Tests

- platform admin login succeeds with `platform_admin_users`
- staff token cannot call `POST /api/saas-admin/stores`
- platform token can create a store
- duplicate store code returns `409`
- feature row is created for the new store
- owner/admin row is created with correct `store_id`
- returned temporary password works with `/api/login`

### Isolation Tests

- new owner sees only the new store's products/customers/orders/repairs
- existing `store_id=1` staff does not see the new store's records
- `GET /api/saas-admin/stores` count increases without corrupting existing stores

### Failure Tests

- owner creation failure rolls back store creation if done in one transaction
- invalid feature preset fails cleanly
- duplicate username under `staff_users` is handled explicitly

### UI Tests

- Platform Admin store list updates after creation
- Platform Admin can open new store feature screen
- new owner can log in and reach normal ERP pages

## 8. Next Implementation Order

1. Fix platform admin store summary correctness:
   - `saasAdmin.js` should return real `stores.name`
2. Add service-layer provisioning helper:
   - one transaction for `stores` + `store_features` + optional owner
3. Add `POST /api/saas-admin/stores`
4. Add `POST /api/saas-admin/stores/:id/owner`
5. Keep `PATCH /api/saas-admin/stores/:id/features` as-is, but support feature presets during creation
6. Add Platform Admin UI for:
   - create store
   - create/reset owner
   - show one-time temporary password
7. Add tests for duplicate code, duplicate username, and transaction rollback
8. After stable provisioning, decide whether to add:
   - `store_memberships`
   - first-login password reset
   - template catalog import

## Current Structure Summary

Today’s architecture is enough to support:

- platform-only authentication
- store listing
- per-store feature toggles

Today’s architecture is not yet enough to support:

- self-contained tenant provisioning from Platform Admin
- owner/admin bootstrap with secure initial credentials
- repeatable non-script store onboarding

## Files Likely Needed For Implementation

Backend:

- `backend/src/routes/saasAdmin.js`
- `backend/src/middleware/platformAuth.js`
- `backend/src/routes/platformAuth.js`
- `backend/src/routes/auth.js`
- `backend/src/utils/passwords.js`
- `backend/src/bootstrap.js`
- likely a new provisioning service such as:
  - `backend/src/services/storeProvisioningService.js`

Frontend:

- `frontend/src/pages/PlatformLoginPage.jsx`
- `frontend/src/pages/SaasAdminPage.jsx`
- `frontend/src/pages/SaasStoreFeaturesPage.jsx`
- `frontend/src/lib/platformAuth.js`

Reference-only current manual flow:

- `backend/scripts/seedKaohsiungTenant.js`
