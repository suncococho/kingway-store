# Store Membership Staging Migration Rehearsal Result - 2026-05-25

## 1. Scope

This document records the `store_memberships` migration rehearsal result for staging.

| Item | Result |
| --- | --- |
| Execution target | `3310` staging |
| Production applied | No |
| Code changes included | No |
| Additional DB changes from this document step | No |

Production was not modified.

## 2. Table Creation

| Table | Created during staging rehearsal |
| --- | --- |
| `store_memberships` | Yes |

The table creation result applies only to the `3310` staging target.

## 3. Membership Backfill Result

| Metric | Result |
| --- | ---: |
| `membership_count` | `2` |

Observed role mapping:

| Staff role | Membership role |
| --- | --- |
| `ADMIN` | `owner` |
| `CASHIER` | `staff` |

Specific expected mapping:

| Staff user | Staff role | Membership role |
| --- | --- | --- |
| `admin` | `ADMIN` | `owner` |
| `staff` | `CASHIER` | `staff` |

## 4. Default Membership Check

| Check | Result |
| --- | --- |
| Duplicate default memberships | None |

No duplicate default membership was observed in the staging rehearsal result.

## 5. Auth Verification

`/api/auth/me` returned the expected store context for the owner account:

| Field | Result |
| --- | --- |
| `storeId` | `1` |
| `storeRole` | `owner` |

This confirms the staged auth context can read the backfilled owner membership.

## 6. Production Status

Production has not been changed.

Do not treat this staging rehearsal as production migration approval.

## 7. Next Safe Step

Recommended next safe step:

1. Keep production unchanged.
2. Review this staging rehearsal result.
3. Run one more staging-only smoke check covering login, `/api/auth/me`, and one store-scoped API path.
4. Prepare an explicit production migration checklist with backup, dry-run verification, rollback notes, and approval gate before any production execution.

