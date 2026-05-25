# Auth Dual-Read Store Membership Plan

## 1. Purpose

This document defines the planned auth transition from legacy `staff_users.store_id` login scope to a `store_memberships`-first store context.

This is a planning document only.

Do not use this document as approval to:

- modify auth code
- run DB migration
- implement signup
- implement store switching
- modify production data
- stage, commit, or push git changes

## 2. Current Auth Flow

Current login flow in `backend/src/routes/auth.js`:

1. Read `username` and `password` from request body.
2. Query `staff_users` by username.
3. Verify `is_active`.
4. Verify password hash.
5. Optionally rehash password.
6. Build permissions from existing staff role behavior.
7. Sign JWT with:
   - `id`
   - `username`
   - `role`
   - `displayName`
   - `storeId: user.store_id`
   - `permissions`
8. Return token and user payload.

Current auth middleware in `backend/src/middleware/auth.js`:

1. Verify bearer JWT.
2. Assign decoded payload to `req.user`.
3. Normalize `req.user.role` to uppercase.
4. Set `req.storeId = req.user.storeId ?? null`.
5. Set `req.store_id = req.storeId`.

Current implication:

- `staff_users.store_id` is the only login-time store context.
- Existing KINGWAY 台南 users rely on `storeId=1`.
- This behavior must remain backward compatible.

## 3. Membership-First Lookup Direction

After password verification and before JWT signing, auth should attempt to load active memberships for the staff user.

Conceptual query:

```sql
SELECT
  sm.store_id,
  sm.role AS store_role,
  sm.is_default,
  sm.status,
  s.status AS store_status
FROM store_memberships sm
JOIN stores s ON s.id = sm.store_id
WHERE sm.staff_user_id = ?
  AND sm.status = 'active'
  AND s.status = 'active'
ORDER BY sm.is_default DESC, sm.store_id ASC;
```

Selection direction:

1. If exactly one active membership exists, select it.
2. If one active membership has `is_default=1`, select it.
3. If multiple active memberships exist and one matches `staff_users.store_id`, select that membership.
4. If no active membership exists, fallback to `staff_users.store_id`.
5. If membership selection is ambiguous, do not silently grant unintended store access. Require a later explicit store-selection design.

## 4. `staff_users.store_id` Fallback Conditions

Fallback must preserve existing login behavior before and after membership rollout.

Fallback to `staff_users.store_id` when:

- `store_memberships` table does not exist yet
- no active membership rows exist for the staff user
- membership table was rolled back in staging
- memberships are not yet backfilled but `staff_users.store_id` is present

Do not fallback silently for unrelated DB errors, such as:

- MySQL connection failure
- SQL syntax error
- permission error
- unexpected schema mismatch beyond missing `store_memberships`

Fallback payload direction:

- `storeId = staff_users.store_id`
- `storeRole = null`

Do not derive runtime `storeRole` from `staff_users.role` during fallback. Role mapping should come from explicit backfilled membership rows after migration.

## 5. JWT Payload Change Proposal

Keep all current JWT fields that existing code depends on.

Current-compatible future payload:

```json
{
  "id": 1,
  "username": "admin",
  "role": "ADMIN",
  "displayName": "System Admin",
  "storeId": 1,
  "storeRole": "owner",
  "permissions": []
}
```

Field meanings:

- `role`: existing operational role from `staff_users.role`
- `storeId`: selected current store id
- `storeRole`: selected membership role, one of `owner`, `admin`, `staff`, or `null` during legacy fallback
- `permissions`: existing frontend/backend permission helper output

Optional later fields:

- `accessibleStoreIds`
- `currentStoreCode`
- `currentStoreName`

These optional fields should not be added until frontend and store switching requirements are clear.

## 6. `/api/auth/me` Impact

Current `/api/auth/me` returns `req.user` directly.

Adding `storeRole` to JWT means `/api/auth/me` will naturally include it:

```json
{
  "user": {
    "id": 1,
    "username": "admin",
    "role": "ADMIN",
    "displayName": "System Admin",
    "storeId": 1,
    "storeRole": "owner",
    "permissions": []
  }
}
```

Compatibility requirements:

- `storeId` must remain present for existing frontend/API behavior.
- `role` must remain the existing operational role.
- Existing clients must tolerate `storeRole` being absent or `null` before membership migration.

Optional middleware enhancement:

- set `req.storeRole = req.user.storeRole ?? null`
- set `req.store_role = req.storeRole`

This should be additive only.

## 7. Multi-Store Owner Direction

A future owner can have multiple active memberships.

Initial selection policy:

- prefer exactly one default membership
- otherwise prefer membership matching legacy `staff_users.store_id`
- otherwise require explicit store selection in a later phase

Do not silently choose a random or lowest `store_id` for a multi-store owner unless that behavior is explicitly approved.

Future store switching should:

1. Receive requested `storeId`.
2. Validate active membership for the authenticated user.
3. Issue refreshed JWT or update session context.
4. Keep backend as the final authority.

## 8. Store Switch Endpoint Excluded

This phase explicitly excludes:

- `/api/auth/switch-store`
- frontend store selector
- multi-store UI
- owner signup flow
- billing/payment flow
- store invitation flow
- production multi-store enablement

The goal is only to make login compatible with `store_memberships` while preserving legacy `staff_users.store_id` behavior.

## 9. Migration Before / After / Rollback Compatibility

### Before migration

State:

- `store_memberships` table may not exist.
- Existing users have `staff_users.store_id=1`.

Expected behavior:

- login succeeds through fallback
- JWT keeps `storeId=1`
- `storeRole` is `null` or absent
- existing protected routes behave as before

### After staging migration and backfill

State:

- `store_memberships` exists.
- `admin / ADMIN` has `storeRole=owner` for `store_id=1`.
- `staff / CASHIER` has `storeRole=staff` for `store_id=1`.
- `staff_users.store_id` remains unchanged.

Expected behavior:

- login selects membership first
- JWT keeps `storeId=1`
- JWT includes `storeRole=owner` or `storeRole=staff`
- existing protected routes continue using `req.storeId`

### Rollback

State:

- `store_memberships` table may be dropped in staging rollback.
- auth code may still include dual-read logic.

Expected behavior:

- login catches only missing table condition
- fallback to `staff_users.store_id`
- JWT keeps `storeId=1`
- `storeRole=null`
- existing routes remain functional

## 10. Expected Diff

Expected `backend/src/routes/auth.js` changes:

- Add helper to detect missing `store_memberships` table errors.
- Add helper to load active memberships.
- Add helper to select current store context.
- After password verification, load membership context.
- Build JWT with existing fields plus `storeRole`.
- Return `storeRole` in login user response.
- Preserve `storeId` field exactly.

Expected `backend/src/middleware/auth.js` changes:

- No breaking changes required.
- Optionally add:

```js
req.storeRole = req.user.storeRole ?? null;
req.store_role = req.storeRole;
```

Expected no changes in this phase:

- route store scoping logic
- signup routes
- billing routes
- store switch endpoint
- frontend store selector

## 11. Test Plan

### Static checks

- `node --check backend/src/routes/auth.js`
- `node --check backend/src/middleware/auth.js`

### Pre-migration compatibility tests

Run before `store_memberships` exists:

- login existing `admin` with known staging credentials
- login existing `staff` with known staging credentials
- verify JWT includes `storeId=1`
- verify `storeRole` is absent or `null`
- verify `/api/auth/me` returns existing fields
- verify protected route smoke tests still pass

### Post-migration staging tests

Run after approved staging migration and backfill:

- login `admin`
  - expect `storeId=1`
  - expect `storeRole=owner`
- login `staff`
  - expect `storeId=1`
  - expect `storeRole=staff`
- `/api/auth/me` includes `storeRole`
- protected route smoke tests:
  - dashboard
  - customers
  - orders
  - repairs
  - products
  - coupons
  - inventory
  - suppliers
  - purchase confirmations

### Negative tests

- wrong password returns 401
- inactive user cannot login
- disabled membership is ignored
- missing membership plus missing `staff_users.store_id` cannot access store-scoped routes
- unrelated DB errors are not swallowed as fallback
- multiple active memberships without default does not silently grant unintended store context

### Rollback compatibility test

After dropping `store_memberships` in staging rollback only:

- login still succeeds through `staff_users.store_id`
- JWT keeps `storeId=1`
- `/api/auth/me` remains functional

## 12. Next Safe Implementation Step

Recommended next safe step after this document is approved:

1. Confirm staging backend `3010` health.
2. Confirm known staging login credentials.
3. Implement dual-read auth code in a small patch.
4. Run static `node --check`.
5. Test login before running membership migration.
6. Only after login fallback is proven, run the approved staging membership migration.
7. Re-test login and route smoke after migration.

Do not implement store switching, signup, billing, or production rollout in the same change.
