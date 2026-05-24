# Self-Service Store Onboarding MVP Plan

## 1. Onboarding Goal

The goal is to extend the existing KINGWAY single-store management system into a future multi-store SaaS template without breaking the current KINGWAY 台南 operation.

MVP onboarding should allow a new store owner to:

1. sign up as an owner
2. create one store
3. become connected to that store
4. receive default store/system settings
5. log in and operate only that store

This document is design only.

Do not use this document as approval to:

- implement signup routes
- run DB migration
- modify production data
- implement billing/payment
- change LINE production behavior
- add git commits

## 2. Backward Compatibility Strategy

Existing KINGWAY 台南 must remain stable.

Compatibility rules:

- Existing KINGWAY 台南 remains seed store `id=1`.
- Existing data remains scoped to `store_id=1`.
- Existing staff accounts remain linked to `store_id=1`.
- Existing LINE-first workflows remain unchanged until a LINE store resolver is implemented.
- Existing route behavior must not be replaced by self-service signup.
- Existing admin/staff login must continue to work.
- Visible UI remains Taiwan Traditional Chinese.

The current staging target `3310` already has the Phase 1A shape:

- `stores` exists
- required active-code tables have `store_id`
- existing `admin` and `staff` have `store_id=1`

The default `3306` DB does not match that shape and must not be treated as the onboarding rehearsal target.

## 3. Minimum Onboarding Flow

### 3-1. Owner Signup

Owner signup captures the minimum identity needed to create a store owner account.

Suggested fields:

- owner name
- email or username
- password
- phone
- store name
- store slug candidate
- optional region/city

MVP does not include billing/payment.

Signup must create a disabled/pending state if verification is required before activation.

### 3-2. Store Creation

After owner identity is accepted, create a new `stores` row.

MVP store fields:

- `name`
- `slug`
- `status`
- `plan`
- `locale`
- `timezone`
- `currency`
- basic contact fields

Default values:

- `locale = zh-TW`
- `timezone = Asia/Taipei`
- `currency = TWD`
- `status = active` or `pending_verification`
- `plan = free` or `basic`

### 3-3. Owner / Store Connection

The signup owner must be connected to the created store as owner.

MVP options:

- short-term: `staff_users.store_id` plus role value
- safer long-term: `store_memberships` / `staff_store_access`

Recommendation:

- keep `staff_users.store_id` as the current single-store default scope
- add `store_memberships` or `staff_store_access` for owner/admin/staff relation
- derive login store access from membership

### 3-4. Default Settings Seed

After store creation, seed default settings for that store.

Use existing `settingsService` defaults as the base:

- STORE defaults
- SYSTEM defaults
- LINE flags disabled or unconfigured by default
- notifications defaulted to safe inactive/no external delivery until credentials are configured

Do not copy KINGWAY 台南 custom settings blindly into every new store.

## 4. Required Minimum Schema

This section is a draft only.

### 4-1. `stores`

`stores` is the store boundary for business data.

Minimum schema direction:

```sql
CREATE TABLE stores (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  name VARCHAR(150) NOT NULL,
  region VARCHAR(100) NULL,
  address VARCHAR(255) NULL,
  phone VARCHAR(40) NULL,
  timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Taipei',
  locale VARCHAR(20) NOT NULL DEFAULT 'zh-TW',
  currency VARCHAR(10) NOT NULL DEFAULT 'TWD',
  status ENUM('pending_verification', 'active', 'inactive', 'suspended') NOT NULL DEFAULT 'pending_verification',
  plan ENUM('free', 'basic', 'premium', 'single_store') NOT NULL DEFAULT 'free',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_stores_code (code),
  UNIQUE KEY uk_stores_slug (slug),
  INDEX idx_stores_status (status),
  INDEX idx_stores_plan (plan)
);
```

Notes:

- Existing KINGWAY 台南 keeps `id=1`.
- New code must not hardcode `store_id=1`.
- Public URLs should use `slug`, not numeric id.

### 4-2. `store_memberships` / `staff_store_access`

Recommended MVP table:

```sql
CREATE TABLE store_memberships (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  staff_user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('owner', 'admin', 'staff') NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('active', 'invited', 'disabled') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_memberships_store_user (store_id, staff_user_id),
  INDEX idx_store_memberships_user (staff_user_id),
  INDEX idx_store_memberships_store_role (store_id, role, status)
);
```

Alternative naming:

- `staff_store_access`

Use one naming convention. `store_memberships` is clearer for self-service SaaS onboarding.

### 4-3. `staff_users`

Current `staff_users` can remain the login identity table.

Minimum additions or expectations:

- `store_id` remains for default store compatibility
- global `username` uniqueness must be revisited
- email may be needed for self-service signup
- owner/admin mapping should not rely only on a global role enum

Longer term:

- separate identity role from store membership role
- allow one user to belong to multiple stores

## 5. Role Structure

MVP roles should be store-scoped.

### owner

- created by signup
- controls store settings
- manages admins/staff for own store
- can configure LINE settings for own store when resolver exists
- can upgrade plan in future

### admin

- invited or created by owner
- manages store operations
- can manage staff depending on permission settings
- cannot claim ownership or change billing owner by default

### staff

- works inside one store
- operational access only
- cannot manage store membership, billing, or global settings

Existing roles such as `ADMIN`, `MANAGER`, `CASHIER`, `REPAIR`, `INVENTORY` are operational roles. They should be mapped under store membership instead of used as global SaaS ownership roles.

## 6. JWT / `storeId` Direction

Current direction:

- login reads `staff_users.store_id`
- JWT includes `storeId`
- middleware sets `req.storeId`
- scoped routes use `req.storeId`

MVP direction:

1. owner logs in
2. backend loads accessible stores from membership table
3. backend selects current store
4. JWT/session includes:
   - user id
   - identity username/email
   - current `storeId`
   - current store role
   - accessible store ids or a short reference to reload them
5. middleware validates user can access requested/current store

Do not trust `storeId` from public request body or frontend storage alone.

For single-store compatibility:

- if a legacy staff user has `staff_users.store_id=1`, login can continue using it as default
- membership table should still be backfilled later for consistency

## 7. Signup Validation / Security

Signup validation:

- required owner name
- required email or username
- required password with minimum complexity
- required store name
- slug format validation
- unique slug
- unique email/username policy
- phone normalization if collected
- reject reserved slugs such as `admin`, `api`, `login`, `dashboard`, `line`, `support`

Security requirements:

- password hashing with existing secure hash utility
- never store plaintext password
- transaction around owner/store/membership/settings creation
- audit log for signup/create store
- email or phone verification before full activation if exposed publicly
- no automatic admin privilege outside the created store
- no direct `storeId` trust from client
- backend validates membership on every scoped request

## 8. Abuse / Rate Limit Considerations

Public signup requires abuse controls before production exposure.

MVP controls:

- IP rate limit
- email/phone rate limit
- duplicate slug throttling
- CAPTCHA or equivalent challenge if exposed publicly
- block disposable/invalid email domains if needed
- account verification before enabling LINE/customer-facing workflows
- prevent repeated failed signup attempts from creating partial stores
- cleanup job for expired pending signups

Do not enable open public signup in production before these controls exist.

## 9. Future Feature Gate Direction

Billing/payment is out of scope for MVP, but the schema should not block future plan gates.

Possible plan tiers:

- `free`
- `basic`
- `premium`

Feature gate candidates:

- product count limit
- staff count limit
- customer CRM features
- LINE integration
- purchase confirmation PDF
- repair workflow
- supplier workflow
- advanced reporting
- multi-store switching
- custom domain / custom LIFF

Minimum schema candidate:

```sql
CREATE TABLE store_feature_flags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  feature_key VARCHAR(100) NOT NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,
  source ENUM('plan', 'manual', 'trial') NOT NULL DEFAULT 'plan',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_feature_flags (store_id, feature_key)
);
```

Do not implement billing/payment in this MVP phase.

## 10. Automatic Creation After Onboarding

After successful onboarding, create:

- owner `staff_users` row
- `stores` row
- `store_memberships` owner row
- default STORE settings for the store
- default SYSTEM settings for the store
- default operational role permissions
- default dashboard/task settings
- default product category visibility using zh-TW labels
- default repair settings
- default purchase confirmation settings

Do not automatically create:

- LINE channel credentials
- LINE group registrations
- supplier integrations
- real billing/subscription charge
- production notifications

## 11. Future LINE Store Resolver Connection

LINE remains central to the business workflow.

Future store onboarding should connect to LINE in a staged way:

1. store owner creates store
2. store can operate without LINE credentials in limited mode
3. owner configures LINE Official Account / LIFF values
4. backend maps those values through:
   - `store_line_channels`
   - `store_liff_apps`
5. webhook resolver identifies store by channel/path/token
6. customer LIFF flows resolve store by LIFF ID, slug, hostname, or signed store context token

Do not reuse KINGWAY 台南 LINE credentials for new stores.

## 12. Migration / Incremental Rollout Strategy

Recommended rollout:

### Phase 0: Current staging hardening

- keep using verified staging target `3010/3310/5180`
- finish smoke tests
- verify seed store encoding
- verify scoped indexes

### Phase 1: Backward-compatible membership schema

- add membership table in staging
- backfill existing `admin` and `staff` into store `1`
- do not remove `staff_users.store_id`
- no production rollout until tested

### Phase 2: Auth context expansion

- login loads memberships
- JWT includes current store and current store role
- preserve old `storeId` behavior for existing KINGWAY 台南

### Phase 3: Owner signup internal/staging only

- implement signup behind feature flag or internal-only route
- create store + owner + membership + default settings in transaction
- no public exposure yet

### Phase 4: Multi-store fixture test

- create second test store in staging only
- verify no cross-store leakage
- verify dashboard/customers/orders/products/repairs isolation

### Phase 5: Public signup readiness review

- rate limit
- verification
- abuse controls
- logging
- rollback plan
- LINE resolver readiness status

## 13. Production Apply Conditions

Do not apply production self-service onboarding until all are true:

- staging target guard is documented and repeatable
- existing KINGWAY 台南 store `id=1` works with scoped routes
- actual login returns `storeId=1` for existing admin/staff
- membership schema is rehearsed in staging
- owner signup transaction is tested in staging
- default settings seed works per store
- cross-store leakage tests pass
- seed store encoding issue is resolved or explained by client charset
- abuse/rate-limit controls exist
- rollback plan exists
- production LINE credentials are not reused for test stores
- LINE resolver plan is ready for customer-facing LINE flows

## 14. Next Implementation Candidates

Recommended next implementation candidates, in order:

1. Verify seed store encoding on staging `3310`.
2. Verify scoped indexes for active-code tables on staging `3310`.
3. Create a membership schema draft document or SQL draft.
4. Backfill membership design for existing `admin` and `staff` as owner/admin candidates.
5. Draft auth context update plan:
   - `staff_users.store_id` compatibility
   - membership lookup
   - current store selection
   - JWT payload shape
6. Draft owner signup transaction pseudocode.
7. Draft default settings seed per store.
8. Only after review, implement staging-only internal signup prototype behind a feature flag.
