# Repairs Tenant Isolation Audit

Date: 2026-06-02
Branch: `beta/staging-architecture`

## Scope

Audited repair-related tenant isolation for:

- `repair_orders`
- requested `repair_items`, `repair_photos`, `repair_estimates`
- repair detail child records (`repair_logs`, `surveys`)
- repair estimate flow
- repair attachments / uploads / files exposure
- repair LINE flow

This step was audit-only. No application logic, LINE/Telegram code, production config, `.env`, or DB data was modified.

## Method

Static review only:

- `backend/src/routes/repairs.js`
- `backend/src/routes/lineRepair.js`
- `backend/src/services/lineWorkflowService.js`
- `backend/src/services/repairReservationService.js`
- `backend/src/app.js`
- related grep results in `backend/src/routes` and `frontend/src`

No live destructive DB action was performed.

## Table / Feature Inventory

### Active

- `repair_orders` is actively used by repair routes and LINE workflow services.
- Repair estimate data is currently stored on `repair_orders` columns such as:
  - `estimate_amount`
  - `estimate_details`
  - `quote_status`
  - `quote_items_json`
  - `inspection_fee`
  - `parts_fee`
  - `labor_fee`

### Not Found In Active Code Paths

- `repair_items`
- `repair_photos`
- `repair_estimates`

No active backend route/service references were found for those tables in current code paths. If the tables still exist in DB, they appear dormant or bypassed by the current implementation.

### Files / Uploads

- No dedicated repair upload route was found.
- No dedicated repair photo route was found.
- Backend exposes a global static file mount:
  - `backend/src/app.js:422` -> `app.use("/files", express.static(.../storage))`

This means any stored file under `storage/` is URL-addressable if the exact path is known.

## Requested Checks

### 1. `GET /api/repairs`

Result: `MEDIUM`

- The route is authenticated and requires store scope.
- Order-derived repair rows are filtered by `o.store_id = ?` and `oi.store_id = ?`.
- Real `repair_orders` rows are not filtered by `ro.store_id = ?`.
- Instead, the route relies on `INNER JOIN customers c ON c.id = ro.customer_id AND c.store_id = ?`.

Impact:

- Normal same-store data is likely filtered correctly.
- If `repair_orders.store_id` ever diverges from the linked customer store, the route can show or hide the wrong tenant's repair row.
- This is not a clean store-owned query and should be tightened.

References:

- `backend/src/routes/repairs.js:129-175`
- `backend/src/routes/repairs.js:181-221`

### 2. `GET /api/repairs/:id`

Result: `MEDIUM`

- The parent repair row is looked up with customer-store scope, so a direct foreign tenant repair id should return `404` under normal consistent data.
- However the query still does not assert `ro.store_id = ?`.
- After the parent lookup, child records are fetched only by `repair_order_id = ?`:
  - `repair_logs`
  - `surveys`

Impact:

- Direct id lookup is not an immediate clean bypass in normal data.
- The route still relies on customer linkage instead of row ownership.
- If child rows are corrupted or cross-linked, detail responses can include cross-tenant child data.

References:

- `backend/src/routes/repairs.js:442-483`

### 3. Cross-tenant repair update / status change

Result: `HIGH`

There are two different risk levels:

- Web staff routes usually call `assertRepairBelongsToStore(...)` first.
- But many later reads / writes still execute with only `WHERE id = ?`.
- LINE postback paths do not enforce store scope before mutating repairs.

High-risk examples:

- `applyRepairReservationDecision(...)` reads and updates `repair_orders` globally by `id`
- LINE postback `repair_reservation_approve` / `repair_reservation_reject` calls that global service directly
- LINE postback `repair_estimate_approve` / `repair_estimate_reject` calls global estimate response logic directly

Impact:

- A LINE staff/customer postback carrying another tenant's repair id can mutate that repair if the id is known and the action reaches the global service.
- `postbackStoreId` is parsed but not enforced.

References:

- `backend/src/services/repairReservationService.js:39-153`
- `backend/src/services/lineWorkflowService.js:4382-4467`

Additional medium-risk web route gaps after store precheck:

- reject route update is missing store predicate
- complete route read/update chain is missing store predicates
- pickup route update chain is missing store predicates
- survey link backfill update is missing store predicate
- linked order completion update is missing store predicate

References:

- `backend/src/routes/repairs.js:926-936`
- `backend/src/routes/repairs.js:956-1013`
- `backend/src/routes/repairs.js:1116-1143`

### 4. Repair estimate store scope

Result: `HIGH`

The estimate flow is implemented in shared LINE workflow services and is not store-scoped end-to-end.

Observed gaps:

- `getRepairOrderForQuotation(repairId)` reads by repair id only
- `sendRepairEstimateQuotation(repairId, ...)` updates by repair id only
- `applyRepairEstimateCustomerResponse(repairId, ...)` reads and updates by repair id only
- `findPendingRepairEstimateByLineUserId(lineUserId)` finds the latest pending estimate globally for that LINE user

Impact:

- Web admin route has an outer store precheck, but the underlying service remains global.
- Customer LINE approval / rejection can act on a globally resolved pending repair, not a store-scoped pending repair.
- If a LINE user exists in multiple stores, the wrong repair estimate can be responded to.

References:

- `backend/src/services/lineWorkflowService.js:948-981`
- `backend/src/services/lineWorkflowService.js:3529-3545`
- `backend/src/services/lineWorkflowService.js:3757-3837`
- `backend/src/services/lineWorkflowService.js:3893-4045`

### 5. Repair photo direct URL access

Result: `MEDIUM`

- No active repair photo table/route implementation was found.
- There is no repair-specific signed URL or store validation layer.
- Global static files are served directly from `/files/*`.

Impact:

- There is no current repair-photo route to audit positively.
- If repair photos or attachments are stored under `/storage` and their URLs are exposed, any tenant with the raw URL can fetch them.

References:

- `backend/src/app.js:422`

### 6. Repair upload store validation

Result: `MEDIUM`

- No dedicated repair upload endpoint was found.
- No repair-specific validation of store ownership exists because the upload feature does not appear implemented in active code.
- The backend currently has only a global file-serving surface.

Impact:

- Current risk is latent rather than route-exercisable.
- If repair uploads are added later and reuse `/files` without an auth-gated download route, cross-tenant file access will be immediate.

References:

- `backend/src/app.js:422`

### 7. LINE repair flow store scope

Result: `HIGH`

This is the highest-risk area.

Observed gaps:

- `GET /api/line-repair/customer` looks up by `line_user_id` only
- `POST /api/line-repair/create` does not pass explicit `storeId`
- `createRepairReservationFromSession(lineUserId)` calls `findOrCreateLineCustomer(lineUserId)` without explicit store input
- `resolveLineWorkflowStoreContext(...)` falls back to `store_id=1` when store context is missing or ambiguous
- LINE postback parses `storeId` but does not enforce it for repair actions

Impact:

- Same LINE user across multiple stores can resolve to the wrong customer/store.
- New repair reservations can be created under fallback store `1`.
- Ambiguous LINE identity is treated as legacy fallback instead of hard failure.
- Repair approval and estimate response through LINE can cross tenant boundaries.

References:

- `backend/src/routes/lineRepair.js:31-52`
- `backend/src/routes/lineRepair.js:58-160`
- `backend/src/services/lineWorkflowService.js:293-341`
- `backend/src/services/lineWorkflowService.js:1462-1493`
- `backend/src/services/lineWorkflowService.js:2794-2885`
- `backend/src/services/lineWorkflowService.js:4382-4467`

## Findings

### HIGH: Repair creation does not explicitly persist `store_id` - Fixed 2026-06-02

Files:

- `backend/src/routes/repairs.js:537-556`
- `backend/src/services/lineWorkflowService.js:2850-2865`

Previous state:

- both repair creation paths inserted into `repair_orders` without an explicit `store_id` column.

Fix completed:

- `backend/src/routes/repairs.js` now inserts `repair_orders.store_id = req.storeId` for admin/web repair creation.
- `backend/src/routes/lineRepair.js` now resolves store context before page-based LINE creation and passes it into the wizard creation path.
- `backend/src/services/lineWorkflowService.js` now resolves store context from explicit input, session payload, and LINE customer context, then inserts new `repair_orders` rows with explicit `store_id`.
- legacy-compatible fallback to `store_id=1` remains possible through the existing store-context resolver, and fallback events continue to be logged.

Residual risk:

Risk:

- The previous tenant assignment relied on hidden DB defaults, triggers, or implicit schema behavior.
- In a multi-store setup this can silently place repairs into the wrong tenant, commonly default store `1`.

### HIGH: LINE customer lookup and repair creation are globally resolved / legacy-fallback based - Fixed 2026-06-02

Files:

- `backend/src/routes/lineRepair.js:39-50`
- `backend/src/services/lineWorkflowService.js:293-341`
- `backend/src/services/lineWorkflowService.js:1462-1493`
- `backend/src/services/lineWorkflowService.js:2794-2885`

Previous state:

- `GET /api/line-repair/customer` allowed global customer lookup by `line_user_id`.
- pending repair estimate lookup in LINE text flow allowed global repair lookup by `line_user_id`.
- LINE repair progress lookup relied on `customer_id` without defensively carrying `repair_orders.store_id`.

Fix completed:

- `backend/src/routes/lineRepair.js` now resolves store context and applies `customers.store_id = resolvedStoreId` for `GET /api/line-repair/customer`.
- `backend/src/services/lineWorkflowService.js` now resolves store context before pending repair estimate lookup and applies both `customers.store_id` and `repair_orders.store_id`.
- LINE repair progress lookup now carries the scoped customer store into the `repair_orders` query.
- legacy-compatible fallback to `store_id=1` remains possible through the existing resolver, and existing fallback workflow logging remains in place.

Residual risk:

- LINE repair reservation can still fall back to store `1` when context is ambiguous, by design.
- Other HIGH findings in postback approve/reject and estimate approval flows are still open in this audit.

### HIGH: LINE repair approval / estimate actions ignore store scope

Files:

- `backend/src/services/repairReservationService.js:47-95`
- `backend/src/services/lineWorkflowService.js:3757-3812`
- `backend/src/services/lineWorkflowService.js:4382-4467`

Risk:

- Another tenant's repair id can be mutated by LINE postback if known.
- `postbackStoreId` is currently unused for repair actions.

### HIGH: Estimate approval can create linked orders without explicit `store_id`

File:

- `backend/src/services/lineWorkflowService.js:3586-3705`

`ensureRepairJobOrder(...)` inserts into `orders` without explicitly setting `store_id`.

Risk:

- Repair-to-order linkage can create or relink a job order into the wrong tenant.
- This can propagate repair isolation problems into `orders`.

### MEDIUM: Repair list / detail routes rely on customer-store join instead of row-store ownership

Files:

- `backend/src/routes/repairs.js:112-126`
- `backend/src/routes/repairs.js:169-175`
- `backend/src/routes/repairs.js:454-459`

Risk:

- Queries are not keyed by `repair_orders.store_id`.
- Data inconsistencies can surface or hide the wrong rows.

### MEDIUM: Several post-check updates are still global by id

Files:

- `backend/src/routes/repairs.js:926-936`
- `backend/src/routes/repairs.js:986-1013`
- `backend/src/routes/repairs.js:1116-1143`
- `backend/src/services/lineWorkflowService.js:3590`
- `backend/src/services/lineWorkflowService.js:3705`
- `backend/src/services/lineWorkflowService.js:3810`
- `backend/src/services/lineWorkflowService.js:3988`

Risk:

- Outer route checks reduce direct exploitation on web admin routes.
- The SQL itself is still non-tenant-safe and can misbehave if reused elsewhere or if data becomes inconsistent.

### MEDIUM: Child cleanup / child reads are not defensively scoped

Files:

- `backend/src/routes/repairs.js:431-433`
- `backend/src/routes/repairs.js:465-483`

Risk:

- `repair_logs` and `surveys` are selected/deleted by `repair_order_id` only.
- This is weaker than joining through a store-owned parent row.

### MEDIUM: Static file serving is global

File:

- `backend/src/app.js:422`

Risk:

- There is no tenant gate for `/files/*`.
- If repair attachments/photos are ever stored there, raw URL possession bypasses tenant boundaries.

### LOW: Requested repair side tables are currently inactive in code

Tables:

- `repair_items`
- `repair_photos`
- `repair_estimates`

Risk:

- No active route was found to exploit today.
- If these tables are reintroduced later without store predicates, they will need a separate audit.

## Risk Routes

Highest priority routes / flows to fix:

- `GET /api/repairs`
- `GET /api/repairs/:id`
- `POST /api/repairs`
- `POST /api/repairs/:id/estimate`
- `POST /api/repairs/:id/customer-response`
- `POST /api/repairs/:id/reject`
- `POST /api/repairs/:id/complete`
- `POST /api/repairs/:id/pickup`
- `GET /api/line-repair/customer`
- `POST /api/line-repair/create`
- LINE postbacks:
  - `repair_reservation_approve`
  - `repair_reservation_reject`
  - `repair_estimate_approve`
  - `repair_estimate_reject`

## Risk Upload / Photo Paths

- Global static file path: `/files/*`
- Product-image normalization used by repair product picker:
  - `/files/products/*`
  - `/files/<path>`

No active repair-specific photo/upload path was found beyond the global static files surface.

## Files That Need Fixes

- `backend/src/routes/repairs.js`
- `backend/src/routes/lineRepair.js`
- `backend/src/services/lineWorkflowService.js`
- `backend/src/services/repairReservationService.js`
- `backend/src/app.js`

## Recommended Fix Priority

1. Enforce explicit `store_id` on all repair creation paths.
2. Remove legacy fallback-to-store-1 behavior from repair LINE flows; require explicit or unambiguous store context.
3. Apply `store_id` predicates inside repair service functions, not only at outer route level.
4. Enforce store scope for all LINE postback repair actions using validated store context.
5. Add explicit `repair_orders.store_id = ?` filters to repair list/detail queries and child joins.
6. Replace global `/files` exposure for repair attachments/photos with an auth-gated download route before enabling repair uploads.
7. Audit dormant `repair_items` / `repair_photos` / `repair_estimates` tables separately if they are revived.

## Conclusion

Overall status: `HIGH RISK`

Main reason:

- Repair web routes are only partially store-scoped.
- Repair LINE flow is not safely store-scoped.
- Several write paths do not explicitly persist or enforce `store_id`.
- Repair file access has no tenant guard if attachment storage is introduced through the current `/files` surface.
