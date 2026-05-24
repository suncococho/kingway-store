# Feature Gate MVP Plan

## 1. Goal

This document defines the MVP direction for separating free and premium features in the future multi-store SaaS version of KINGWAY.

This is design only.

Do not use this document as approval to:

- modify code
- run DB migration
- implement billing/payment
- change production access
- stage, commit, or push git changes

The goal is to create a feature gate foundation that can later connect to billing without making billing part of the MVP.

## 2. Current Permission / Role Structure Summary

Current backend auth structure:

- `staff_users` is the login identity table.
- Current roles include:
  - `ADMIN`
  - `MANAGER`
  - `CASHIER`
  - `REPAIR`
  - `INVENTORY`
- `auth.js` signs JWT with user identity, role, and `storeId`.
- `auth.js` has a small permission helper for the `staff` cashier account.
- `middleware/auth.js` sets `req.storeId` from JWT.
- Route-level `authorize(...)` controls operational access.

Important distinction:

- role/permission answers: "What can this staff member do inside this store?"
- feature gate answers: "Is this feature enabled for this store at all?"

These must stay separate.

## 3. Why Feature Flags Are Needed

Feature flags are needed because future stores may use different plans or rollout stages.

Reasons:

- support free/basic/premium plan separation
- avoid hardcoding plan behavior in route handlers
- allow staging-only rollout of new features
- allow KINGWAY 台南 to keep existing features during migration
- disable unfinished integrations such as LINE resolver or advanced reports for new stores
- provide clean upgrade path before billing is implemented
- avoid exposing locked premium UI actions that backend still accepts

Backend feature gates must be the final authority. Frontend locks are UX only.

## 4. Recommended Minimum Schema

This section is a schema draft only.

### 4-1. `feature_definitions`

Defines feature keys and metadata.

```sql
CREATE TABLE feature_definitions (
  feature_key VARCHAR(100) NOT NULL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  description TEXT NULL,
  category VARCHAR(80) NULL,
  default_enabled TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

Example feature keys:

- `pos`
- `customers`
- `products`
- `orders`
- `repairs`
- `coupons`
- `purchase_confirmations`
- `line_public_flows`
- `supplier_workflow`
- `staff_attendance`
- `kpi`
- `payroll`
- `advanced_reports`
- `multi_store_switching`

### 4-2. `plan_templates`

Defines default feature bundles per plan.

```sql
CREATE TABLE plan_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  plan_key VARCHAR(80) NOT NULL,
  feature_key VARCHAR(100) NOT NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,
  limit_value INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_plan_templates_plan_feature (plan_key, feature_key),
  INDEX idx_plan_templates_feature (feature_key)
);
```

Notes:

- `plan_key` can be `free`, `basic`, `premium`, or `single_store`.
- `limit_value` supports simple limits such as staff count or product count.
- This table does not represent payment status.

### 4-3. `store_features`

Defines actual effective feature gates for a store.

```sql
CREATE TABLE store_features (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  feature_key VARCHAR(100) NOT NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,
  limit_value INT NULL,
  source ENUM('plan', 'manual', 'trial', 'migration') NOT NULL DEFAULT 'plan',
  expires_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_features_store_feature (store_id, feature_key),
  INDEX idx_store_features_store_enabled (store_id, is_enabled),
  INDEX idx_store_features_feature (feature_key)
);
```

Rules:

- backend checks `store_features` by `req.storeId`
- `source='migration'` can preserve KINGWAY 台南 compatibility
- `expires_at` supports trials without billing
- missing feature rows should default to disabled unless a deliberate default is defined

## 5. Free Default Feature Examples

Free plan candidate:

- basic POS
- basic products
- basic customers
- basic orders
- basic inventory visibility
- limited staff accounts
- limited product count
- limited customer count
- store settings

Free limits should be enforced by backend, not just displayed on frontend.

Example free features:

| Feature | Default |
|---|---|
| `pos` | enabled |
| `products` | enabled with limit |
| `customers` | enabled with limit |
| `orders` | enabled |
| `repairs` | disabled or limited |
| `line_public_flows` | disabled |
| `advanced_reports` | disabled |
| `supplier_workflow` | disabled |
| `payroll` | disabled |

## 6. Premium Feature Examples

Premium candidates:

- full LINE public flows
- LINE group approval workflows
- repair reservation / estimate / completion workflow
- Google review coupon approval workflow
- purchase confirmation PDF/signature workflow
- survey flow
- supplier workflow
- staff attendance
- KPI
- payroll
- advanced dashboard/reporting
- monthly supplier settlement
- multi-store switching
- custom LIFF / custom LINE channel

Example premium features:

| Feature | Premium |
|---|---|
| `line_public_flows` | enabled |
| `repairs` | enabled |
| `purchase_confirmations` | enabled |
| `supplier_workflow` | enabled |
| `staff_attendance` | enabled |
| `kpi` | enabled |
| `payroll` | enabled |
| `advanced_reports` | enabled |

## 7. Route Middleware Design Direction

Feature middleware should run after auth and store scope are resolved.

Recommended order:

1. `authenticate`
2. `requireStoreScope`
3. `authorize`
4. `requireFeature(featureKey)`

Concept:

```js
router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER"]));
router.get("/advanced-report", requireFeature("advanced_reports"), handler);
```

Middleware behavior:

- read `req.storeId`
- load effective feature gate for that store
- reject disabled feature with `403`
- use zh-TW error message for visible response
- optionally include upgrade metadata for frontend

Do not let frontend-only checks decide access.

## 8. Frontend Display / Lock UX

Frontend should use feature gates to improve clarity, but backend remains final authority.

UX direction:

- hide irrelevant navigation for disabled features where appropriate
- show locked cards/buttons for useful upgrade discovery
- use zh-TW labels
- avoid confusing users by showing enabled-looking actions that backend rejects
- display concise upgrade/availability note
- keep core workflows usable on mobile

Example visible text:

- `此功能尚未啟用`
- `升級方案後可使用`
- `請聯絡店主或管理員`

Do not expose billing/payment UI until billing is actually implemented.

## 9. Existing KINGWAY Backward Compatibility

Existing KINGWAY 台南 must not lose access during feature gate rollout.

Compatibility strategy:

- seed store `id=1` should receive `single_store` or `migration` feature grants
- all currently used KINGWAY features remain enabled unless explicitly disabled later
- feature gate rollout should first be read/report-only in staging
- do not block existing routes in production until feature gates are fully seeded
- if a feature row is missing for store `1`, production must not accidentally disable critical KINGWAY operations

For migration, use explicit rows for store `1` rather than code-level `store_id=1` fallback.

## 10. Why Billing / Payment Is Separate

Feature gate MVP is not billing.

Reasons to separate:

- billing introduces financial, legal, tax, refund, and subscription state requirements
- feature control is needed before billing exists
- manual/trial/migration grants are needed for staging and existing KINGWAY
- payment failures and grace periods require separate state machine
- billing provider integration should not block store isolation work

Future billing can update:

- `stores.plan`
- `store_features`
- subscription status tables

But MVP feature gate should work without payment provider integration.

## 11. Incremental Rollout Plan

### Phase 0: Documentation

- define feature keys
- define free/basic/premium draft
- define KINGWAY compatibility grants

### Phase 1: Staging schema draft

- create SQL draft only
- no production migration
- verify with `3310` staging target guard

### Phase 2: Read-only feature resolver

- implement internal helper in staging
- return effective feature map for current store
- do not enforce yet

### Phase 3: Frontend display only

- show feature locks in staging
- no backend enforcement yet
- verify UX does not break existing KINGWAY workflows

### Phase 4: Backend enforcement for low-risk features

- start with non-core premium routes such as advanced reports
- do not gate login, dashboard basics, customers, orders, or settings initially

### Phase 5: Full staging test

- seed free/basic/premium test stores
- verify route-level enforcement
- verify missing feature rows behavior
- verify KINGWAY store `1` remains fully operational

### Phase 6: Production readiness review

- backup/rollback plan
- feature seed verification
- no production route lockout
- monitoring for `403 feature disabled`

## 12. Production Apply Conditions

Do not apply feature gate enforcement to production until:

- store `1` feature grants are explicitly seeded and verified
- staging `3310` tests pass
- login and core operational routes are not gated accidentally
- backend returns zh-TW feature-disabled messages
- frontend handles locked/disabled features cleanly
- rollback plan exists
- missing feature behavior is documented
- billing/payment is not implied in UI unless actually implemented
- LINE-first workflows are not broken for existing KINGWAY

## 13. Next Implementation Candidates

Recommended next candidates:

1. Create feature key catalog document.
2. Draft staging-only SQL for `feature_definitions`, `plan_templates`, and `store_features`.
3. Define KINGWAY `store_id=1` compatibility feature grant set.
4. Design `getStoreFeatures(storeId)` helper.
5. Design `requireFeature(featureKey)` middleware.
6. Add read-only `/api/features/current` design for frontend.
7. Create staging fixture plan:
   - free test store
   - premium test store
   - existing KINGWAY store
8. Only after review, implement staging-only feature resolver without production enforcement.
