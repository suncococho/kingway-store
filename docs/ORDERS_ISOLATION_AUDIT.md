# Orders SaaS Tenant Isolation Audit

Date: 2026-06-02
Branch: `beta/staging-architecture`

## Scope

Audited order-related tenant isolation for:

- `orders`
- `order_items`
- `purchase_confirmations`
- `payments`
- `order_logs`
- order-related routes, public LINE order routes, purchase confirmation flows, and helper services

This audit did not change application code, production config, production env files, LINE/Telegram flows, DB data, or docker volumes.

## Staging Data Check

Read-only staging DB check found:

- `orders`: only `store_id=1`, 85 rows
- `order_items`: only `store_id=1`, 206 rows
- `purchase_confirmations`: only `store_id=1`, 28 rows
- no `store_id=2` order data was available for live cross-tenant request verification
- `orders`, `order_items`, and `purchase_confirmations` all have a nullable `store_id` column
- no active backend/frontend code references were found for `payments` or `order_logs`

Because the requested `store_id=2` test order data does not exist, this audit is based on static route and SQL review plus read-only table distribution checks.

## Route Inventory

### `/api/orders`

Mounted from:

- `backend/src/routes/orderItemsEdit.js`
- `backend/src/routes/orders.js`

Audited routes:

- `GET /api/orders`
- `GET /api/orders/trash/list`
- `GET /api/orders/:id`
- `GET /api/orders/:id/invoice`
- `POST /api/orders`
- `PATCH /api/orders/:id`
- `DELETE /api/orders/:id`
- `POST /api/orders/:id/restore`
- `DELETE /api/orders/:id/permanent`
- `PUT /api/orders/:id/items`
- `POST /api/orders/:id/purchase-confirmation`
- `POST /api/orders/:id/collect-balance`
- `POST /api/orders/:id/confirm-handover`

### LINE Order Routes

Mounted from `backend/src/routes/lineOrder.js`:

- `GET /api/line-order/customer`
- `GET /api/line-order/ebikes`
- `POST /api/line-order/create`

### Purchase Confirmation Routes

Mounted from `backend/src/routes/purchaseConfirmations.js`:

Public routes:

- `GET /api/purchase-confirmations/public/:token`
- `GET /api/purchase-confirmations/public/:token/pdf`
- `GET /api/purchase-confirmations/manual/:id/pdf`
- `POST /api/purchase-confirmations/public/:token`
- `POST /api/purchase-confirmations/line/latest-order`
- `POST /api/purchase-confirmations/manual`

Authenticated staff routes:

- `GET /api/purchase-confirmations`
- `GET /api/purchase-confirmations/pending-links`
- `POST /api/purchase-confirmations/generate-link`

### Related Helpers And Views

- `backend/src/services/lineWorkflowService.js`
- `backend/src/app.js` customer status endpoints

## Isolation Status

### Mostly OK

`backend/src/routes/orders.js`:

- `GET /api/orders` applies `o.store_id = ?` and `o.deleted_at IS NULL`.
- `GET /api/orders/:id` applies `o.id = ? AND o.store_id = ?`; item loading also applies `order_id = ? AND store_id = ?`.
- order trash, soft delete, restore, PATCH update, balance collection, and most handover updates are store-scoped.
- POS order creation uses `req.storeId`, store-scoped customer lookup, store-scoped product lookup, and inserts `store_id` into `orders`, `order_items`, and `inventory_movements`.

`backend/src/routes/orderItemsEdit.js`:

- `PUT /api/orders/:id/items` locks the order by `id` and `store_id`.
- product lookup, item replacement, subtotal recalculation, and order update are store-scoped.

`backend/src/routes/lineOrder.js`:

- public store context is resolved before customer/order/product creation.
- customer lookup, order list, repair list, product lookup, order insert, and order item insert are store-scoped.
- LINE order creation appears tenant-scoped for the core `orders` and `order_items` writes.

Authenticated `backend/src/routes/purchaseConfirmations.js` staff routes:

- list, pending links, and generate-link queries apply `store_id` through `pc`, `orders`, or `customers`.
- `generate-link` calls `createPurchaseConfirmationForOrder(orderId, ..., { storeId })`.

## Findings

### High: Invoice Route Can Read Cross-Tenant Orders

File: `backend/src/routes/orders.js`

`GET /api/orders/:id/invoice` does not filter by `req.storeId`.

Risk:

- authenticated staff from one tenant can request another tenant's order invoice by numeric id or `order_no`
- item loading also uses only `order_id`, without `store_id`
- this is the clearest direct order-number/id isolation gap

Recommended fix:

- add `o.store_id = ?` to invoice order lookup
- add `oi.store_id = ?` to invoice item lookup
- join customer with matching `store_id` where possible

### High: Purchase Confirmation Manual Matching Is Global

File: `backend/src/routes/purchaseConfirmations.js`

`findManualPurchaseConfirmationMatch(phone)` searches customers and orders globally by phone. It does not accept or apply a store context.

Risk:

- same phone across tenants can match the wrong tenant order/customer
- the manual route derives `storeId` from `matchedOrder?.storeId || matchedCustomer?.storeId || 1`, but the match query does not select `storeId`, so it can silently fall back to `store_id=1`
- purchase confirmation rows may be created under the wrong store

Recommended fix:

- resolve public store context for manual confirmation
- filter customer and order matching by that `store_id`
- select and propagate `storeId`
- avoid defaulting to `1` after a cross-tenant search

### High: LINE Latest Order Purchase Confirmation Is Global

File: `backend/src/routes/purchaseConfirmations.js`

`POST /api/purchase-confirmations/line/latest-order`:

- finds customer by `line_user_id` without `store_id`
- finds latest paid EBIKE order without `store_id`
- calls `createPurchaseConfirmationForOrder(order.id)` without `{ storeId }`

Risk:

- a LINE user id or phone reused across store channels can select another tenant's latest order
- generated confirmation token may point to another tenant's order

Recommended fix:

- resolve public store context
- filter customer and latest order queries by `store_id`
- call `createPurchaseConfirmationForOrder(order.id, pool, { storeId })`

### High: LINE Workflow Purchase Confirmation Helper Is Global

File: `backend/src/services/lineWorkflowService.js`

The purchase confirmation creation flow in the LINE workflow searches eligible paid EBIKE orders, pending confirmations, and inserts `purchase_confirmations` without `store_id`.

Risk:

- LINE-triggered purchase confirmation can select or create confirmation data across tenants
- inserted confirmation can have `store_id` missing even though the table has a `store_id` column

Recommended fix:

- carry store context into LINE workflow helper calls
- filter customer/order/pending confirmation queries by `store_id`
- insert `store_id` into `purchase_confirmations`

### High: Customer Status Order Endpoints Are Not Store-Scoped

File: `backend/src/app.js`

Routes:

- `GET /api/customer-status`
- `POST /api/customer-status/orders/:id/payment`
- `POST /api/customer-status/orders/:id/deliver`

Risk:

- customer lookup, order lookup, pending purchase confirmation lookup, and coupon lookup do not filter by `store_id`
- payment and delivery endpoints update `orders` by id only
- if these routes are exposed to staff or tooling, they can read or mutate another tenant's orders

Recommended fix:

- put these endpoints behind the same staff/store middleware as order admin routes, or resolve explicit store context
- add `store_id` filters to customer/order/purchase confirmation/coupon queries and order updates

### Medium: Public Token Purchase Confirmation Should Carry Store Scope Defensively

File: `backend/src/routes/purchaseConfirmations.js`

Public token routes are bearer-token flows, so token possession is expected to grant access. However, several follow-up queries and updates use token/order id without carrying store scope.

Risk:

- lower than authenticated direct id routes because a valid token is required
- still fragile if token rows, order rows, or confirmation rows become inconsistent

Recommended fix:

- include `store_id` in `fetchPurchaseConfirmationToken`
- apply token row `store_id` to item queries and confirmation updates where possible
- keep public token behavior intact

### Medium: Public Purchase Confirmation Submit Has Placeholder Bugs

File: `backend/src/routes/purchaseConfirmations.js`

Observed issues:

- public token submit updates `pdf_path` with SQL placeholders for `id` and `store_id`, but only passes `pdf.publicPath` and `confirmation.id`
- manual submit passes an extra `storeId` parameter to a SQL statement with only `pdf_path` and `id` placeholders

Risk:

- purchase confirmation submission or PDF path persistence may fail
- not strictly a tenant leak by itself, but it blocks or corrupts the confirmation workflow

Recommended fix:

- correct parameter counts
- apply `store_id` predicates only when the corresponding parameter is passed

### Medium: Handover Auto Purchase Request Helper Lacks Store Scope

File: `backend/src/routes/orders.js`

`createKingwayAutoPurchaseOrderOnHandover(orderId, staffId)`:

- checks existing supplier requests without `store_id`
- reads order items without `store_id`
- inserts supplier request data without tenant context

Risk:

- supplier workflow data can be created without tenant ownership
- duplicate detection is global by order marker

Recommended fix:

- pass `storeId` into the helper
- filter order item reads by `store_id`
- insert `store_id` into supplier request tables if schema supports it

### Medium: Permanent Delete Dependent Cleanup Is Only Parent-Scoped

File: `backend/src/routes/orders.js`

Permanent delete first verifies the parent order by `id` and `store_id`, then deletes dependent rows by `order_id` only.

Risk:

- low if order ids are globally unique and referential integrity is clean
- not ideal for defense-in-depth

Recommended fix:

- add `store_id` conditions to dependent deletes/updates where the child table has `store_id`

### Medium: LINE Workflow Order Helpers And Staff Postbacks Are Global

File: `backend/src/services/lineWorkflowService.js`

Observed global order access/update patterns:

- customer order status messages query orders by customer/phone without store scope
- balance messages query orders without store scope
- progress keyword loads latest order by customer without store scope
- staff postbacks update `orders` and `purchase_confirmations` by id/order id without store scope

Risk:

- LINE customer/staff workflow can display or update the wrong tenant's order data if identifiers overlap

Recommended fix:

- carry store context through LINE workflow sessions and postback payloads
- derive and validate order `store_id` before updates

### Low: LINE Order Coupon Handling Is Not Store-Scoped

File: `backend/src/routes/lineOrder.js`

The core LINE order create flow is store-scoped, but new-friend coupon lookup/insert in that route does not apply `store_id`.

Risk:

- order creation isolation is mostly intact
- coupon eligibility or issuance can cross tenant boundaries

Recommended fix:

- apply `store_id` to coupon lookup/insert if the schema supports it

### Low: POS Coupon Update Needs Store Predicate

File: `backend/src/routes/orders.js`

POS order creation updates coupons by code/customer/status/category but not by `store_id`.

Risk:

- low because the customer was selected in store scope
- better to include `store_id` for defense-in-depth

Recommended fix:

- add `store_id = ?` to coupon update when using coupons during POS order creation

## Direct Questions Answered

1. Order list `GET /api/orders`: store-scoped; no immediate issue found.
2. Order detail `GET /api/orders/:id`: store-scoped; no immediate issue found.
3. Order search by phone/order number/customer name: backend list is store-scoped; invoice lookup by order number is not store-scoped and is high risk.
4. Order update `PATCH /api/orders/:id`: store-scoped; no immediate issue found.
5. Order delete: soft delete and restore are store-scoped; permanent dependent cleanup should add child `store_id` predicates.
6. Purchase confirmation PDF: public token PDF is bearer-token based; manual and LINE latest-order matching are higher risk than token PDF itself.
7. LINE order flow: `lineOrder.js` core order creation is store-scoped; LINE workflow purchase-confirmation helpers are not.
8. POS order creation: core order creation is store-scoped; coupon update should add `store_id` defensively.

## Recommended Fix Order

1. Fix `GET /api/orders/:id/invoice` store isolation first.
2. Fix `purchaseConfirmations.js` manual matching, LINE latest-order matching, and placeholder bugs.
3. Fix `lineWorkflowService.js` purchase confirmation creation and order-related postbacks with store context.
4. Scope `app.js` customer status order read/update endpoints or move them behind store middleware.
5. Add defense-in-depth `store_id` predicates to permanent delete child cleanup, POS coupon update, and handover auto supplier helper.
6. Add store 2 test data and API regression checks for direct id/order number access, purchase confirmation matching, LINE purchase confirmation, POS creation, and customer status updates.

## Files Likely Needing Code Changes

- `backend/src/routes/orders.js`
- `backend/src/routes/purchaseConfirmations.js`
- `backend/src/routes/lineOrder.js`
- `backend/src/services/lineWorkflowService.js`
- `backend/src/app.js`
- possibly supplier request helpers/schema if supplier request tenant ownership is required

