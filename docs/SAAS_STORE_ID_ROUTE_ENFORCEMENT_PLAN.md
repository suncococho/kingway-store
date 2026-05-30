# SaaS Store ID Route Enforcement Plan

## Current Status

- stores table exists.
- Default store exists: id=1, code=KINGWAY_TAINAN, name=KINGWAY 台南.
- Required store_id columns exist on major business tables.
- Existing data has been backfilled.
- store_id IS NULL count is 0 for staff_users, customers, orders, order_items, products, repair_orders, coupons, inventory_movements, supplier_requests, purchase_confirmations.
- REQUIRE_STORE_ID_SCHEMA=true passed on staging.
- Backend starts normally with SchemaGuard strict mode.
- Sales API health check returns HTTP 200.

## Store Resolution Policy

- Prefer req.user.store_id when authenticated user has a store.
- If missing, fallback to default store id 1.
- Do not block existing single-store workflows yet.
- Do not change visible behavior during this phase.
- Do not introduce cross-store UI yet.

Pseudo policy:

const storeId = req.user?.store_id || req.user?.storeId || 1;

## Route Enforcement Order

### Phase 1: Read-only / low-risk routes

1. backend/src/routes/sales.js
   - Add store_id filters to sales summary queries.
   - Use default store id 1 fallback.
   - Verify monthly sales totals remain same for KINGWAY_TAINAN.

2. backend/src/routes/products.js
   - Filter product list by store_id.
   - On product creation, set store_id.
   - Verify product count and POS product list.

3. backend/src/routes/customers.js
   - Filter customer list by store_id.
   - On customer creation, set store_id.
   - Verify CRM/customer lookup.

### Phase 2: Transaction routes

4. backend/src/routes/orders.js
   - Filter orders by store_id.
   - Insert orders with store_id.
   - Insert order_items with same store_id.
   - Ensure order edit/detail does not cross stores.

5. backend/src/routes/lineOrder.js
   - Ensure LINE orders are assigned to resolved store.
   - For current staging, default store id 1.
   - Do not change customer-facing flow.

6. backend/src/routes/repairs.js
   - Filter repair_orders by store_id.
   - Insert repair orders with store_id.
   - Preserve customer/repair/order linkage.

### Phase 3: Operational routes

7. backend/src/routes/inventory.js
   - Filter inventory movements by store_id.
   - Set store_id on movements and supplier requests.
   - Confirm stock movement behavior.

8. backend/src/routes/suppliers.js
   - Filter supplier requests by store_id.
   - Set store_id on new requests.
   - Preserve Telegram PO notification behavior.

9. backend/src/routes/coupons.js
   - Filter coupon queries by store_id.
   - Set store_id on coupon issuance.
   - Preserve paused campaign behavior.

10. backend/src/routes/purchaseConfirmations.js
    - Filter purchase confirmations by store_id.
    - Set store_id on new records.
    - Preserve PDF/download behavior.

## High-Risk Areas

- Orders and order_items must always share the same store_id.
- Products and stock movement must not accidentally hide existing inventory.
- LINE flows may not have authenticated staff context.
- Telegram flows may arrive without store context.
- Purchase confirmations must remain accessible by token where customer-facing.
- Coupons are currently paused; do not reactivate campaign logic.
- Sales totals must match previous values for store id 1 after filtering.

## Testing Checklist

- Run syntax checks on changed backend route files.
- Build frontend if any frontend files changed.
- Rebuild and restart staging backend.
- Check SchemaGuard strict mode.
- Run API health checks.

API checks:
- /api/sales/summary
- /api/products
- /api/customers
- /api/orders
- /api/repairs
- /api/inventory
- /api/suppliers/requests
- /api/purchase-confirmations

## Rollback Plan

1. Revert only the changed route file.
2. Keep schema and backfilled store_id data.
3. Keep REQUIRE_STORE_ID_SCHEMA=true if backend still starts.
4. If backend fails to start, temporarily set REQUIRE_STORE_ID_SCHEMA=false.
5. Rebuild backend and retest.

## Next Implementation Step

Create a small helper for route-level store resolution, then apply it first to sales.js.

Do not apply to all routes at once.
