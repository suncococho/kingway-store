# Store Role Authorization Plan

## 1. Purpose

This document defines how `storeRole` should be used for authorization after the `store_memberships` rollout.

This is a planning document only.

Do not use this document as approval to:

- modify code
- modify database schema or data
- run migration
- deploy
- stage, commit, or push git changes

## 2. Core Principle

`storeRole` does not replace the existing `staff_users.role`.

The two role systems have different responsibilities:

| Role source | Example values | Responsibility |
| --- | --- | --- |
| `staff_users.role` | `ADMIN`, `MANAGER`, `CASHIER` | Existing operational/business permissions |
| `store_memberships.role` / `storeRole` | `owner`, `admin`, `staff` | Current store ownership and store-level authority |

Authorization should use both dimensions:

1. Confirm the authenticated staff user.
2. Confirm the current `storeId` / store scope.
3. Confirm the user's active membership for that store when required.
4. Apply `storeRole` for store-level actions.
5. Apply existing `staff_users.role` and existing permission helpers for operational actions.

Backend authorization remains the final authority.

## 3. Store Role Definitions

### `owner`

`owner` represents store ownership authority for the current store.

Expected authority:

- manage store-level settings
- manage staff membership for the store
- grant or remove store-level admin/staff access
- approve sensitive store-level configuration changes
- access owner-only future SaaS features, such as billing or subscription management

`owner` should not automatically bypass every operational rule. For example, business workflows that currently require manager/admin approval should still use the operational permission model unless an explicit exception is approved.

### `admin`

`admin` represents store administration authority for the current store.

Expected authority:

- manage daily store operations
- perform manager-level store actions
- handle store-level approvals where owner-only authority is not required
- manage selected staff/store settings if explicitly allowed

`admin` is below `owner` for ownership, billing, membership ownership transfer, and highest-risk store settings.

### `staff`

`staff` represents normal store staff membership.

Expected authority:

- access assigned store data according to existing operational permissions
- create and process daily business records where allowed by `staff_users.role`
- use normal staff workflows on web/mobile

`staff` should not manage store settings, staff memberships, or owner/admin-level configuration.

## 4. Existing Staff Role Compatibility

Existing `staff_users.role` values stay valid and must not be rewritten as part of this plan.

Examples:

| Existing role | Meaning |
| --- | --- |
| `ADMIN` | Existing system/admin operational role |
| `MANAGER` | Existing manager operational role |
| `CASHIER` | Existing cashier/frontline operational role |

Compatibility rules:

- Do not treat `staff_users.role = ADMIN` as automatic `storeRole = owner`.
- Do not treat `storeRole = owner` as automatic replacement for `staff_users.role = ADMIN`.
- Do not remove existing permission helpers until route-by-route behavior is audited.
- Keep `role` in JWT as the existing staff role.
- Keep `storeRole` in JWT as the selected membership role.

Example JWT direction:

```json
{
  "id": 1,
  "username": "admin",
  "role": "ADMIN",
  "storeId": 1,
  "storeRole": "owner"
}
```

## 5. Authorization Decision Order

For protected store routes, authorization should follow this order:

1. `requireAuth`
   - Verify the user is authenticated.
   - Populate staff identity and existing staff role.

2. `requireStoreScope`
   - Resolve current `storeId`.
   - Confirm the user can access that store.
   - Reject cross-store access.

3. `requireStoreRole` when the action is store-level
   - Example: `owner` or `admin` required for staff membership management.

4. Existing operational permission check
   - Apply `staff_users.role`, existing permissions, or route-specific business rules.

5. Business state validation
   - Confirm workflow state allows the action.
   - Example: purchase confirmation starts only after full payment.

This keeps store ownership separate from operational workflow rules.

## 6. Fallback Behavior

During transition, `storeRole` may be `null` when auth falls back to legacy `staff_users.store_id`.

Fallback rules:

- Existing single-store operational behavior should continue.
- New store-level owner/admin features should not be granted when `storeRole` is `null`.
- Existing route behavior should not break solely because `storeRole` is absent.
- Sensitive new multi-store functionality should require a non-null active membership role.

Recommended fallback interpretation:

| Context | `storeRole = null` behavior |
| --- | --- |
| Existing customers/orders/repairs/products route | Preserve current behavior through `staff_users.role` and `storeId` |
| Store settings route | Deny unless explicitly legacy-approved |
| Staff membership management | Deny |
| Store switching | Deny until explicit store-switch design |
| Billing/subscription | Deny |

## 7. Permission Matrix Direction

Initial authorization direction:

| Action area | Store scope required | `storeRole` requirement | Existing staff role requirement |
| --- | --- | --- | --- |
| Customer read/write | Yes | Any active membership | Existing route rules |
| Order create/update | Yes | Any active membership | Existing route rules |
| Repair workflow | Yes | Any active membership | Existing repair approval rules |
| Product/inventory management | Yes | Any active membership | Existing inventory/admin rules |
| Google review coupon approval | Yes | Any active membership | Manager/admin-level operational permission |
| Purchase confirmation handover approval | Yes | Any active membership | Manager/admin-level operational permission |
| Supplier PO/return approval | Yes | `owner` or `admin` preferred | Existing manager/admin-level operational permission |
| Monthly settlement | Yes | `owner` or `admin` preferred | Existing manager/admin-level operational permission |
| Staff membership management | Yes | `owner`; limited `admin` only if approved | Existing admin-level operational permission |
| Store settings | Yes | `owner`; limited `admin` only if approved | Existing admin-level operational permission |
| Store switching | Yes | Active membership for target store | Existing auth/session rules |
| Billing/subscription | Yes | `owner` | Not controlled by cashier/manager role |

Route-specific enforcement should be introduced gradually after auditing current behavior.

## 8. Middleware Direction

No code is implemented by this document.

Recommended middleware concepts:

### `requireAuth`

Confirms authenticated staff identity.

### `requireStoreScope`

Confirms the request is scoped to an accessible store and sets `req.storeId`.

### `requireStoreRole(allowedRoles)`

Checks selected store membership role.

Examples:

- `requireStoreRole(['owner'])`
- `requireStoreRole(['owner', 'admin'])`
- `requireStoreRole(['owner', 'admin', 'staff'])`

### `requireOperationalRole(allowedRoles)`

Checks existing `staff_users.role`.

Examples:

- `requireOperationalRole(['ADMIN'])`
- `requireOperationalRole(['ADMIN', 'MANAGER'])`

### `requireStorePermission(action)`

Possible later abstraction after route-by-route audit.

This should not be introduced until the real route permission matrix is stable enough to avoid hiding business rules behind a vague helper.

## 9. Conflict Handling

Potential conflicts and expected decisions:

| Case | Expected decision |
| --- | --- |
| `staff_users.role = ADMIN`, `storeRole = staff` | Allow operational admin actions only where store-level ownership is not required |
| `staff_users.role = CASHIER`, `storeRole = owner` | Allow owner/store-level actions, but do not automatically grant all operational admin actions |
| `storeRole = null`, `staff_users.role = ADMIN` | Preserve existing legacy routes, deny new membership/store-owner features |
| JWT says `storeRole = owner`, DB membership is inactive | Sensitive actions should fail if DB recheck is required |
| Request body includes another `store_id` | Ignore or reject unless confirmed through membership scope |

The key rule is that `storeRole` answers "what authority does this user have over this store", while `staff_users.role` answers "what operational role does this staff user have in the business workflow".

## 10. Route Rollout Priority

Recommended rollout order:

1. Auth context and `/api/auth/me`
   - Confirm `storeId` and `storeRole` are present after membership login.

2. Staff/store settings routes
   - Highest need for `owner/admin` separation.

3. Customers, orders, repairs, products, and inventory
   - Ensure store scope is enforced without changing existing workflow behavior.

4. Coupons, purchase confirmations, supplier workflows, and settlement
   - Combine store scope with existing approval rules.

5. Dashboard aggregates
   - Prevent cross-store aggregate leakage.

6. LINE webhook and supplier callback paths
   - Ensure store resolution is explicit and cannot leak or mutate another store.

## 11. Staging Verification Plan

Staging verification should happen before any production authorization rollout.

Minimum checks:

1. Login as `owner`
   - `/api/auth/me` returns `storeId=1`, `storeRole=owner`.
   - Owner-only candidate route allows access after implementation.

2. Login as `staff`
   - `/api/auth/me` returns `storeId=1`, `storeRole=staff`.
   - Staff can still use existing allowed daily workflows.
   - Staff cannot access owner/admin store-level actions.

3. Legacy fallback
   - Simulate or verify `storeRole=null` behavior where applicable.
   - Existing single-store routes continue to work.
   - New owner/admin store-level features are denied.

4. Cross-store negative test
   - Changing request `store_id` or URL store id must not grant access to another store.

5. Operational conflict test
   - Same `staff_users.role` with different `storeRole` should produce different store-level authorization results.
   - Same `storeRole` with different `staff_users.role` should preserve operational permission differences.

## 12. Non-Goals

This plan does not implement:

- code changes
- DB changes
- production migration
- store switching UI
- billing/subscription logic
- invitation flow
- full route permission matrix
- removal of existing role/permission checks

## 13. Next Safe Step

Recommended next safe step:

1. Review this plan against current routes and existing permission helpers.
2. Produce a route-by-route authorization audit for staging only.
3. Identify the smallest first implementation slice, preferably auth context plus one owner/admin-only store-level route.
4. Keep production unchanged until staging authorization behavior is verified.

