# Store Membership / Owner-Admin Minimal Plan

## 1. Purpose

This document defines the minimum safe plan for introducing store-scoped owner/admin/staff relationships before self-service onboarding.

This is a planning document only.

Do not use this document as approval to:

- modify auth code
- run DB migration
- implement signup
- implement billing/payment
- change production data
- stage, commit, or push git changes

## 2. Current `staff_users.store_id` Limitation

Current auth flow is single-store oriented:

- login reads `staff_users.store_id`
- JWT includes `storeId`
- auth middleware copies JWT `storeId` to `req.storeId`
- scoped routes use `req.storeId`

This works for existing KINGWAY 台南 operations, but it is not enough for self-service SaaS onboarding.

Limitations:

- one staff user can represent only one default store
- one user cannot safely belong to multiple stores
- one user cannot be `owner` in one store and `staff` in another
- store ownership is mixed with operational staff identity
- `staff_users.role` is global-looking, while real permissions must be store-scoped
- relying only on JWT `storeId` makes future store switching and DB revalidation harder

## 3. Separate `staff_users.role` And `store_memberships.role`

`staff_users` should remain the login identity and operational staff profile table.

`staff_users.role` currently represents operational role, for example:

- `ADMIN`
- `MANAGER`
- `CASHIER`
- `REPAIR`
- `INVENTORY`

These roles answer: what operational duties can this staff user perform?

`store_memberships.role` should represent store-scoped SaaS relationship:

- `owner`
- `admin`
- `staff`

These roles answer: what is this user's relationship to this specific store?

Keeping the two concepts separate prevents privilege confusion. For example, a repair technician can be operationally `REPAIR` while still being membership `staff`; a store owner can be membership `owner` while still using an operational role compatible with existing route permissions.

## 4. Recommended Minimal Schema

Use `store_memberships` rather than `staff_store_access` for the MVP. The name matches self-service onboarding language and clearly represents the user-store relationship.

Draft schema:

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
  INDEX idx_store_memberships_user_status (staff_user_id, status),
  INDEX idx_store_memberships_store_role_status (store_id, role, status),
  CONSTRAINT fk_store_memberships_store
    FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT fk_store_memberships_staff_user
    FOREIGN KEY (staff_user_id) REFERENCES staff_users(id)
);
```

Notes:

- `store_id` is the business tenant scope.
- `staff_user_id` points to the login identity.
- `role` is store-scoped membership role.
- `is_default` helps login choose a current store.
- `status` allows invitations and temporary disabling without deleting audit history.
- Keep `staff_users.store_id` for compatibility during the transition.

## 5. KINGWAY 台南 Backward Compatibility

Existing KINGWAY 台南 must remain stable.

Compatibility rules:

- existing KINGWAY 台南 remains `stores.id=1`
- existing business data remains scoped to `store_id=1`
- existing `staff_users.store_id=1` remains valid
- existing admin/staff login must continue to work
- existing LINE-first workflows remain unchanged
- no self-service signup behavior is exposed in this phase
- no billing/payment behavior is introduced

The membership table should be additive. It must not remove or reinterpret existing data during the first implementation phase.

## 6. Dual-Read Strategy

Login and store context should use a conservative dual-read strategy.

Preferred order:

1. Load active `store_memberships` for the staff user.
2. If memberships exist, select current store from membership.
3. If no membership exists, fallback to `staff_users.store_id`.
4. If neither exists, reject store-scoped access with a clear store scope error.

Selection rules:

- one active membership: choose it automatically
- active membership with `is_default=1`: choose that store
- multiple active memberships and one matches `staff_users.store_id`: choose that one initially
- multiple active memberships with no clear default: require explicit store selection later

The first implementation should preserve existing behavior for single-store staff. New multi-store behavior can be added after staging tests pass.

## 7. JWT `storeId` / `storeRole` Direction

JWT should continue to include `storeId` for compatibility, but should add store membership context when membership exists.

Future payload direction:

```json
{
  "id": 1,
  "username": "admin",
  "role": "ADMIN",
  "displayName": "Admin",
  "storeId": 1,
  "storeRole": "owner",
  "permissions": []
}
```

Guidelines:

- `role` remains the existing operational role from `staff_users.role`.
- `storeRole` comes from `store_memberships.role`.
- `storeId` is the current selected store.
- Sensitive routes should revalidate membership in DB where needed.
- Do not trust `storeId` from request body, query string, or frontend storage alone.

Optional later direction:

- include `accessibleStoreIds` for UI display
- or keep JWT small and reload accessible stores from DB through `/api/auth/me`

## 8. Multi-Store Owner Store Switching Direction

Multi-store owner support should be staged after membership exists.

Minimum direction:

1. Owner logs in.
2. Backend loads active memberships.
3. Backend selects default current store.
4. Frontend displays current store when more than one store is available.
5. Store switch request sends requested `storeId`.
6. Backend verifies active membership for that `storeId`.
7. Backend issues a refreshed token or updates server-side session context.

Store switching must never rely on frontend-only checks.

Do not introduce production store switching until cross-store leakage tests pass in staging.

## 9. Migration / Backfill Dry-Run SQL

Run these only as dry-run reads until migration is explicitly approved.

### 9-1. Verify target DB identity

```sql
SELECT DATABASE() AS database_name, @@hostname AS mysql_hostname, @@port AS mysql_port;
```

Expected staging rehearsal target:

- backend: `3010`
- host-side MySQL: `3310`
- database: `kingway_store`

### 9-2. Verify seed store

```sql
SELECT id, code, slug, name, status, plan
FROM stores
WHERE id = 1;
```

### 9-3. Inspect existing staff users

```sql
SELECT id, username, role, display_name, is_active, store_id
FROM staff_users
ORDER BY id;
```

### 9-4. Count staff without store scope

```sql
SELECT COUNT(*) AS staff_without_store_id
FROM staff_users
WHERE store_id IS NULL;
```

### 9-5. Preview membership mapping

```sql
SELECT
  su.id AS staff_user_id,
  su.username,
  su.role AS staff_role,
  su.store_id,
  CASE
    WHEN su.role = 'ADMIN' AND su.username = 'admin' THEN 'owner'
    WHEN su.role IN ('ADMIN', 'MANAGER') THEN 'admin'
    ELSE 'staff'
  END AS proposed_membership_role,
  CASE
    WHEN su.store_id IS NOT NULL THEN 1
    ELSE 0
  END AS proposed_is_default
FROM staff_users su
ORDER BY su.id;
```

### 9-6. Preview rows that would be inserted

```sql
SELECT
  su.store_id,
  su.id AS staff_user_id,
  CASE
    WHEN su.role = 'ADMIN' AND su.username = 'admin' THEN 'owner'
    WHEN su.role IN ('ADMIN', 'MANAGER') THEN 'admin'
    ELSE 'staff'
  END AS role,
  1 AS is_default,
  'active' AS status
FROM staff_users su
JOIN stores s ON s.id = su.store_id
WHERE su.store_id IS NOT NULL;
```

### 9-7. Draft insert for later approved migration only

Do not run until approved.

```sql
INSERT INTO store_memberships (store_id, staff_user_id, role, is_default, status)
SELECT
  su.store_id,
  su.id AS staff_user_id,
  CASE
    WHEN su.role = 'ADMIN' AND su.username = 'admin' THEN 'owner'
    WHEN su.role IN ('ADMIN', 'MANAGER') THEN 'admin'
    ELSE 'staff'
  END AS role,
  1 AS is_default,
  'active' AS status
FROM staff_users su
JOIN stores s ON s.id = su.store_id
WHERE su.store_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  role = VALUES(role),
  is_default = VALUES(is_default),
  status = VALUES(status);
```

### 9-8. Post-backfill verification for later approved migration only

```sql
SELECT store_id, role, status, COUNT(*) AS count
FROM store_memberships
GROUP BY store_id, role, status
ORDER BY store_id, role, status;
```

```sql
SELECT staff_user_id, COUNT(*) AS default_memberships
FROM store_memberships
WHERE is_default = 1 AND status = 'active'
GROUP BY staff_user_id
HAVING COUNT(*) > 1;
```

## 10. Existing Staff Role To Membership Role Mapping

Initial backfill mapping:

| `staff_users.role` | Condition | `store_memberships.role` |
| --- | --- | --- |
| `ADMIN` | username is existing seed `admin` | `owner` |
| `ADMIN` | other admin accounts | `admin` |
| `MANAGER` | any | `admin` |
| `CASHIER` | any | `staff` |
| `REPAIR` | any | `staff` |
| `INVENTORY` | any | `staff` |

This is intentionally conservative. It preserves current operational power while avoiding accidental ownership grants to every admin-like account.

If actual production staff names differ, owner assignment must be explicitly reviewed before production use.

## 11. Required Staging Checks Before Auth Code Changes

Before changing auth code, complete these checks on staging only:

- verify staging target is backend `3010`, MySQL `3310`, frontend `5180`
- verify schema guard startup logs are clean
- verify `stores.id=1` exists
- verify seed store encoding at byte/client charset level
- verify all active `staff_users` have expected `store_id`
- verify existing admin/staff login with known staging credentials
- verify current JWT includes `storeId=1`
- verify `/api/auth/me` returns expected user payload
- verify required active-code tables have `store_id`
- verify route smoke tests remain clean for customers, orders, repairs, products, coupons, inventory, suppliers, dashboard
- verify no cross-store fixture exists unless intentionally created for a later test phase
- prepare rollback plan before any schema migration

## 12. Production No-Go Conditions

Do not apply to production if any of the following are true:

- staging smoke test has not passed after membership backfill
- production DB backup and rollback plan are missing
- target DB identity is not explicitly verified
- owner mapping is guessed rather than reviewed
- any existing KINGWAY 台南 login behavior is uncertain
- any route can run without clear `req.storeId`
- any critical query lacks `store_id` scoping
- LINE resolver impact is unclear
- external notifications could be triggered during testing
- signup or billing is being bundled into the same change
- migration SQL has not been dry-run reviewed

## 13. Next Implementation Candidates

Recommended order:

1. Add a staging-only migration draft for `store_memberships`.
2. Add a dry-run backfill script/report for existing staff users.
3. Run staging read-only checks for `staff_users`, `stores`, and current JWT login behavior.
4. Apply membership schema in staging only after approval.
5. Backfill KINGWAY 台南 memberships in staging only after approval.
6. Update auth login to prefer membership and fallback to `staff_users.store_id`.
7. Add `storeRole` to JWT and `/api/auth/me` response.
8. Add membership revalidation helper for sensitive routes.
9. Create a second staging test store only for cross-store leakage tests.
10. Design store switching endpoint after single-store compatibility is proven.

