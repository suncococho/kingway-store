# Staging 3310 Smoke Test Result - 2026-05-24

## 1. Test Target

Smoke test target was the verified staging environment only.

| Component | Target |
|---|---|
| Backend | `http://127.0.0.1:3010` |
| MySQL | `127.0.0.1:3310` |
| Frontend | `http://127.0.0.1:5180` |

Explicitly not used as migration/smoke target:

- MySQL `127.0.0.1:3306`
- Backend `http://127.0.0.1:3000`
- Frontend `http://127.0.0.1:5173`

No DB changes, code changes, migrations, git staging, commits, or pushes were performed.

## 2. Preflight Verification

Staging DB identity:

- DB endpoint checked: `127.0.0.1:3310`
- DB name: `kingway_store`
- MySQL hostname observed: `a9cbc99601a1`
- Existing staff accounts:
  - `admin`, role `ADMIN`, `store_id=1`
  - `staff`, role `CASHIER`, `store_id=1`
- Seed store:
  - `id=1`
  - `code=KINGWAY_TAINAN`
  - `status=active`
  - `plan=single_store`

Runtime health:

- Backend `3010 /health`: PASS, returned `{"ok":true}`
- Frontend `5180`: PASS, returned HTTP `200`

## 3. Pass / Fail Checklist

| Check | Result | Notes |
|---|---|---|
| Target guard `3010/3310/5180` | PASS | Verified before route tests |
| Auth login route reachable | PARTIAL | Route responded without SQL error, but default credentials failed |
| JWT `storeId` context | PASS | Short-lived staging-only JWT with `storeId: 1` accepted by protected routes |
| `/api/auth/me` | PASS | Returned user object |
| Dashboard summary | PASS | `/api/dashboard/summary` returned totals/pending tasks |
| Customers list | PASS | `/api/customers` returned array |
| Customers detail | PASS | `/api/customers/139/detail` returned customer detail object |
| Orders list | PASS | `/api/orders` returned array |
| Orders detail | PASS | `/api/orders/184` returned order detail object |
| Order item edit safe negative | PASS | `PUT /api/orders/184/items` with nonexistent product returned expected `404`; no intended data change |
| Repairs list | PASS | `/api/repairs` returned array |
| Repairs detail | PASS | `/api/repairs/73` returned repair detail object |
| Coupons list | PASS | `/api/coupons` returned array |
| Inventory movement list | PASS | `/api/inventory/movements` returned array |
| Suppliers request list | PASS | `/api/suppliers/requests` returned array |
| Purchase confirmation admin route | PASS | `/api/purchase-confirmations` returned array |
| LINE public route basic health | PASS | Basic public route checks passed |
| Backend health after tests | PASS | `/health` still returned `{"ok":true}` |
| Node/backend crash observed | PASS | No crash observed during tested routes |
| `store_id` SQL runtime error | PASS | No `Unknown column 'store_id'` or equivalent SQL error observed in tested routes |

## 4. Auth Login Partial Reason

The auth login route was tested against staging backend `3010`.

Attempts:

- `admin / admin`: returned `Invalid credentials`
- `staff / staff`: returned `Invalid credentials`

Read-only DB check showed both accounts use bcrypt hashes:

| username | password hash type | store_id |
|---|---|---:|
| `admin` | `bcrypt` | `1` |
| `staff` | `bcrypt` | `1` |

Conclusion:

- Login route itself is reachable.
- Login route did not fail with `store_id` schema errors.
- Full login success could not be verified because the actual staging passwords were not available.
- Protected route smoke tests used a short-lived staging-only JWT generated from staging config with `storeId: 1`.

## 5. Tested Routes

Protected/admin routes tested with staging-only JWT:

- `GET /api/auth/me`
- `GET /api/dashboard/summary`
- `GET /api/customers`
- `GET /api/customers/139/detail`
- `GET /api/orders`
- `GET /api/orders/184`
- `PUT /api/orders/184/items` with nonexistent product id for safe negative test
- `GET /api/repairs`
- `GET /api/repairs/73`
- `GET /api/coupons`
- `GET /api/inventory/movements`
- `GET /api/suppliers/requests`
- `GET /api/purchase-confirmations`

Public routes tested without auth:

- `GET /health`
- `GET /api/settings/public`
- `GET /api/line-order/ebikes`
- `GET /api/line-repair/customer?lineUserId=SMOKE_NO_USER`
- `GET /api/line-google-review/customer?lineUserId=SMOKE_NO_USER`
- `POST /api/purchase-confirmations/line/latest-order` with empty body, expected `400`

## 6. LINE Public Route Basic-Health Result

LINE public route checks were limited to safe read/negative paths.

Results:

- `GET /api/line-order/ebikes`: PASS
- `GET /api/line-repair/customer?lineUserId=SMOKE_NO_USER`: PASS
- `GET /api/line-google-review/customer?lineUserId=SMOKE_NO_USER`: PASS
- `POST /api/purchase-confirmations/line/latest-order` with missing `lineUserId`: PASS, returned expected `400` message `缺少 LINE 使用者資料`

This confirms that basic public route runtime health was not broken by current staging `store_id` state.

This does not prove full multi-store LINE resolver readiness. LINE public route store resolution remains a separate future implementation area.

## 7. Runtime Issues Found

No `store_id` SQL runtime errors were observed in tested routes.

No backend crash was observed. Backend health returned `{"ok":true}` after tests.

Known issue still present:

- Seed store display name returned mojibake-like text: `KINGWAY å°å—`
- Expected display value: `KINGWAY 台南`
- Stored bytes / connection character set must be verified before concluding whether data is corrupted.

## 8. Remaining Blockers

Before production consideration:

- Verify full login success with actual staging credentials and confirm returned user payload includes `storeId: 1`.
- Verify seed store encoding at byte/charset level.
- Verify indexes for scoped tables.
- Expand smoke tests for any route not covered by this pass, especially mutation routes in a controlled staging transaction/revert plan.
- Keep LINE public multi-store resolver as a separate blocker for true multi-store production rollout.
- Do not apply production migration until backup/restore, target guard, and staging smoke results are documented.

## 9. Next Safe Steps

Recommended next steps:

1. Run login verification with known staging credentials against backend `3010`.
2. Verify `stores.name` encoding using byte-level SQL and client character set checks.
3. Document scoped index verification for required active-code tables.
4. Prepare a controlled staging-only mutation test plan for order item edit and other write routes.
5. Keep all future staging tests pinned to:
   - backend `3010`
   - MySQL `3310`
   - frontend `5180`
