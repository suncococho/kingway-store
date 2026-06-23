# KINGWAY 門市請貨 / 補貨申請 Design Audit

Date: 2026-06-23
Scope: read-only audit and implementation design only. No code implementation, DB migration, deploy, restart, or production data write.

## 1. Current State

- Current branch: `beta/staging-architecture`
- Current HEAD during audit: `c9e07be`
- Existing company/store flow is already implemented as:
  - `本部出貨`: `store_transfers`, `store_transfer_items`
  - `門市入庫`: `/api/store-transfers/:transferId/receive`
  - `本部月結`: `company_store_settlements`, `company_store_settlement_items`
- This feature must not use supplier purchase. The intended operation is:
  - `門市請貨 -> 本部出貨 -> 門市入庫 -> 本部月結`

## 2. Existing Store Transfer Flow

Relevant files:

- `backend/src/routes/storeTransfers.js`
- `backend/src/routes/companyStoreSettlements.js`
- `frontend/src/pages/HeadquartersPage.jsx`
- `frontend/src/pages/InboundTransfersPage.jsx`
- `frontend/src/pages/CompanyStoreSettlementsPage.jsx`
- `backend/src/app.js`

Existing API behavior:

- `GET /api/store-transfers/company/:companyId`
  - Lists company transfers for HQ roles.
- `GET /api/store-transfers/company/:companyId/products/transfer-candidates`
  - Requires `fromStoreId`, `toStoreId`, optional `q`.
  - Reads products from HQ/warehouse store and left joins target store product by the same SKU.
  - Returns `mapped: Boolean(toProductId)`.
- `POST /api/store-transfers/company/:companyId`
  - Creates a `DRAFT` transfer.
  - Requires HQ write role.
  - Validates `fromStoreId` is `HEADQUARTERS` or `WAREHOUSE`.
  - Validates `toStoreId` is `DIRECT_STORE` or `FRANCHISE_STORE`.
  - Calls `insertItems`.
- `POST /api/store-transfers/company/:companyId/:transferId/ship`
  - Ships only `DRAFT` transfers.
  - Decrements HQ product stock.
  - Inserts `inventory_movements` OUT with `reference_type = STORE_TRANSFER`.
- `GET /api/store-transfers/inbound`
  - Lists open transfers for the receiving store.
- `POST /api/store-transfers/:transferId/receive`
  - Increments target store stock only when the receiving store confirms inbound quantity.
  - Inserts `inventory_movements` IN.
  - Moves transfer to `PARTIALLY_RECEIVED`, `DISCREPANCY`, or `RECEIVED`.
- `POST /api/company-store-settlements/generate`
  - Finds received transfer items not already in final settlements.
  - Uses `quantity_received * unit_cost`.
  - Does not change stock.

Important implementation details:

- `insertItems` currently requires target store product with the same SKU:
  - If target product is missing, API throws: `門市商品未建立，請先於收貨門市建立相同 SKU 商品`.
- `unitCost` defaults to HQ product `cost_price` if omitted.
  - The replenishment flow should pass an explicit unit cost when needed.
- The current transfer route logic is embedded in the route file, not extracted as a service.
  - For replenishment implementation, extracting reusable service functions is recommended before adding "create transfer from request" actions.

## 3. Company, Store, and Role Structure

Tables checked:

- `company_stores`
- `company_memberships`
- `store_memberships`
- `staff_users`

Current company structure:

- Company `KINGWAY`
- Store `1`, `KINGWAY_TAINAN`: `DIRECT_STORE`
- Store `3`, `KINGWAY_KAOHSIUNG`: `HEADQUARTERS`

Current company roles:

- `company_memberships.role` enum:
  - `company_owner`
  - `hq_admin`
  - `finance`
  - `inventory_manager`
  - `viewer`
- Current active company role assignments:
  - staff `1`: `company_owner`
  - staff `5`: `hq_admin`

Current store roles:

- `store_memberships.role` enum:
  - `owner`
  - `admin`
  - `staff`
- Current active memberships include:
  - 台南 store 1: owner/admin/staff style users
  - 高雄 store 3: owner

Recommended permissions:

- 門市請貨 create/submit/cancel:
  - Store scoped users with `store_memberships.role IN ('owner','admin','staff')`
  - Existing app role should probably allow `ADMIN`, `MANAGER`, `INVENTORY`; `CASHIER` can be decided by business policy.
  - MVP recommendation: allow `owner`, `admin`, and `staff` store memberships, but only for the user's current store.
- 本部請貨 manage/fulfill:
  - Company roles in existing HQ write set:
    - `company_owner`
    - `hq_admin`
    - `inventory_manager`
  - Read-only list can include:
    - `finance`
    - `viewer`

## 4. Product Selection and SKU Matching

Products table has store-scoped product records:

- `id`
- `store_id`
- `sku`
- `name`
- `category`
- `price`
- `stock`
- `cost_price`
- `description`
- `source`
- `deleted_at`

Existing SKU matching:

- HQ product is selected by `from_product_id`.
- Target product is resolved by matching `products.sku` in target store.
- The transfer candidate API already exposes target mapping:
  - `fromProductId`
  - `toProductId`
  - `sku`
  - `name`
  - `fromStock`
  - `toStock`
  - `unitCost`
  - `mapped`

Recommended MVP policy:

- Do not auto-create target store products in MVP.
- If target store product with same SKU is missing:
  - Request item can still be saved as requested data.
  - HQ fulfillment action should block with a clear status/message:
    - `門市尚未建立此 SKU 商品，請先建立門市商品後再出貨。`
- Add a later phase for "auto-create target store product from HQ product".

## 5. LINE Notification Audit

Relevant files:

- `backend/src/utils/line.js`
- `backend/src/services/staffLineNotify.js`
- `backend/src/services/storeLineSettingsService.js`
- `backend/src/config.js`

Existing capability:

- `staff_users` has `line_user_id`.
- Existing customer push helper:
  - `sendLineMessage(config, to, messages, options)`
- Existing staff group notification service:
  - `staffLineNotify.js`
  - Uses `line_group_registrations`.
  - Resolves store LINE credentials through `storeLineSettingsService`.
  - Suppresses sending in staging/mock environments.
  - Masks group IDs in logs.

Current production staff LINE readiness:

- Active staff count: 8
- Active staff with `line_user_id`: 0
- Company `company_owner` / `hq_admin` members with `line_user_id`: 0

Recommended notification design:

- Primary recipient query:
  - Company members for the request company where role is in:
    - `company_owner`
    - `hq_admin`
    - `inventory_manager`
  - Join `staff_users`.
  - Send only to staff with non-empty `staff_users.line_user_id`.
- If no staff LINE user IDs are available:
  - Fall back to existing staff LINE group notification if configured.
  - If no group is configured either, keep request submission successful and return notification status as skipped.
- Notification failure policy:
  - Request submit must still succeed.
  - Log safe metadata only:
    - request id
    - request no
    - company id
    - store id
    - delivered/skipped/error class
  - Never log raw channel token, secret, or raw LINE user IDs.
- Before production enablement, staff LINE binding or active LINE group registration must be configured.

Suggested message:

```text
門市請貨通知
門市：KINGWAY_TAINAN
申請單：REQ-20260623-xxxx
品項：3
備註：...
請至 POS 本部請貨管理查看。
```

## 6. Proposed Schema

Migration candidates:

- `database/migrations/20260623_create_store_replenishment_requests.sql`
- `database/migrations/20260623_create_store_replenishment_requests_rollback.sql`

Table: `store_replenishment_requests`

Recommended columns:

- `id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY`
- `request_no VARCHAR(80) NOT NULL`
- `company_id BIGINT UNSIGNED NOT NULL`
- `requesting_store_id BIGINT UNSIGNED NOT NULL`
- `status ENUM('DRAFT','SUBMITTED','PARTIALLY_FULFILLED','FULFILLED','CANCELED') NOT NULL DEFAULT 'DRAFT'`
- `requested_by_staff_user_id BIGINT UNSIGNED NULL`
- `submitted_at DATETIME NULL`
- `approved_at DATETIME NULL`
- `fulfilled_at DATETIME NULL`
- `canceled_at DATETIME NULL`
- `note TEXT NULL`
- `created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`

Recommended indexes:

- `UNIQUE KEY uk_store_replenishment_requests_no (request_no)`
- `KEY idx_store_replenishment_requests_company_status (company_id, status)`
- `KEY idx_store_replenishment_requests_store_status (requesting_store_id, status)`
- `KEY idx_store_replenishment_requests_submitted_at (submitted_at)`

Recommended foreign keys:

- `company_id -> companies(id)`
- `requesting_store_id -> stores(id)`
- `requested_by_staff_user_id -> staff_users(id)`

Table: `store_replenishment_request_items`

Recommended columns:

- `id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY`
- `request_id BIGINT UNSIGNED NOT NULL`
- `hq_product_id BIGINT UNSIGNED NOT NULL`
- `requested_sku VARCHAR(120) NOT NULL`
- `requested_product_name VARCHAR(255) NOT NULL`
- `target_store_product_id BIGINT UNSIGNED NULL`
- `quantity_requested INT UNSIGNED NOT NULL`
- `quantity_fulfilled INT UNSIGNED NOT NULL DEFAULT 0`
- `unit_cost DECIMAL(12,2) NULL`
- `status ENUM('REQUESTED','FULFILLED','CANCELED') NOT NULL DEFAULT 'REQUESTED'`
- `transfer_id BIGINT UNSIGNED NULL`
- `transfer_item_id BIGINT UNSIGNED NULL`
- `note TEXT NULL`
- `created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`

Recommended indexes:

- `KEY idx_store_replenishment_items_request (request_id)`
- `KEY idx_store_replenishment_items_hq_product (hq_product_id)`
- `KEY idx_store_replenishment_items_target_product (target_store_product_id)`
- `KEY idx_store_replenishment_items_status (status)`
- `KEY idx_store_replenishment_items_transfer (transfer_id)`
- `KEY idx_store_replenishment_items_transfer_item (transfer_item_id)`

Recommended foreign keys:

- `request_id -> store_replenishment_requests(id)`
- `hq_product_id -> products(id)`
- `target_store_product_id -> products(id)`
- `transfer_id -> store_transfers(id)`
- `transfer_item_id -> store_transfer_items(id)`

Rollback SQL:

```sql
DROP TABLE IF EXISTS store_replenishment_request_items;
DROP TABLE IF EXISTS store_replenishment_requests;
```

## 7. Proposed Backend API

Route file:

- `backend/src/routes/storeReplenishmentRequests.js`

Mount:

- `app.use('/api/store-replenishment-requests', storeReplenishmentRequestsRouter)`

Store APIs:

- `GET /api/store-replenishment-requests`
  - Store scoped list for current store.
- `POST /api/store-replenishment-requests`
  - Create `DRAFT` request for current store.
  - Validate current store is `DIRECT_STORE` or `FRANCHISE_STORE`.
  - Validate selected HQ product belongs to same company HQ/warehouse store.
  - Snapshot SKU/name/unit cost.
- `POST /api/store-replenishment-requests/:id/submit`
  - Move `DRAFT` to `SUBMITTED`.
  - Send HQ LINE notification after transaction.
  - Notification failure must not rollback submit.
- `POST /api/store-replenishment-requests/:id/cancel`
  - Allow cancel for `DRAFT`/`SUBMITTED` if no item fulfilled.

HQ APIs:

- `GET /api/store-replenishment-requests/company`
  - Company scoped list for HQ roles.
  - Filters: status, requestingStoreId, month/date range.
- `GET /api/store-replenishment-requests/company/pending`
  - Convenience list for `SUBMITTED` and `PARTIALLY_FULFILLED`.
- `POST /api/store-replenishment-requests/:id/items/:itemId/create-transfer`
  - Create one DRAFT transfer for that item or group compatible items by request/store.
  - Link item to `transfer_id` and `transfer_item_id`.
  - Do not ship.
- `POST /api/store-replenishment-requests/:id/items/:itemId/create-and-ship-transfer`
  - Create DRAFT transfer and immediately call shared ship logic in one transaction or controlled two-step service.
  - HQ stock decreases only at ship.
  - Target store stock does not increase until existing inbound receive.

Implementation recommendation:

- Extract service functions from `storeTransfers.js` before implementing:
  - `createTransferDraftFromItems`
  - `shipTransferById`
  - `loadTransfer`
  - `loadTransferItems`
- Avoid duplicating stock movement logic in replenishment route.
- Use `withTransaction` and row locks for fulfill operations.
- Prevent duplicate fulfillment:
  - Lock request item row.
  - If `transfer_item_id` exists or item status is `FULFILLED`, reject idempotently or return existing transfer.

## 8. Proposed Frontend UI

New pages:

- `frontend/src/pages/StoreReplenishmentRequestsPage.jsx`
- `frontend/src/pages/HqReplenishmentRequestsPage.jsx`

Route/menu files:

- `frontend/src/App.jsx`
- `frontend/src/components/Sidebar.jsx`
- `frontend/src/lib/mobileNavigation.js`
- Existing permissions/menu config may need a new menu key.

Menu labels:

- Store side: `門市請貨`
- HQ side: `本部請貨管理`

Store page:

- `新增請貨單`
- Product picker based on HQ products and same company.
- Columns:
  - `SKU`
  - `商品名稱`
  - `本部庫存`
  - `建議結算單價`
  - `申請數量`
  - `狀態`
- Actions:
  - `送出請貨`
  - `取消請貨`

Store page guide text:

```text
門市請貨用於向本部申請補貨。送出後，本部會確認庫存並建立出貨單；門市收到商品後，請至「門市入庫」確認實收數量。
```

HQ page:

- Request list grouped by store and status.
- Item list with fulfillment state.
- Columns:
  - `門市`
  - `申請單`
  - `SKU`
  - `商品名稱`
  - `申請數量`
  - `本部庫存`
  - `結算單價`
  - `處理狀態`
- Actions:
  - `建立本部出貨`
  - `建立並確認出貨`
  - `查看出貨單`
- Warnings:
  - `本部庫存不足`
  - `門市尚未建立此 SKU 商品`

Risk confirm:

```text
確認出貨後，本部庫存將立即扣除，門市需於收到商品後執行門市入庫。
```

## 9. Operational Policies

Recommended MVP decisions:

- Target store product missing:
  - Do not auto-create.
  - Block fulfillment with clear message.
- HQ stock insufficient:
  - Allow request submission.
  - Block `create-and-ship` if current HQ stock is insufficient.
  - Allow DRAFT transfer creation only if business wants reservation; safer MVP is to block transfer creation when insufficient.
- Transfer creation options:
  - Provide both:
    - `建立本部出貨`
    - `建立並確認出貨`
  - `建立並確認出貨` must show stock deduction confirm.
- Store stock:
  - Never increase on request submit or HQ approval.
  - Increase only through existing `門市入庫` receive API.
- Settlement:
  - Do not create settlement at request or ship.
  - Existing monthly settlement generation picks up received transfer items.

## 10. Open Decisions

1. HQ LINE recipients:
   - Recommended: `company_owner`, `hq_admin`, `inventory_manager` with `staff_users.line_user_id`.
   - Current production has 0 linked staff LINE IDs, so staff binding or group fallback is required before relying on push.
2. Target store product missing:
   - Recommended MVP: no auto-create. Add a later "auto-create target product" feature.
3. Fulfillment buttons:
   - Recommended: include both `建立本部出貨` and `建立並確認出貨`.
4. HQ stock shortage:
   - Recommended: request allowed, fulfillment blocked until stock exists.
5. Franchise pricing:
   - MVP: use `unit_cost` snapshot from HQ product `cost_price`, but allow HQ override before transfer creation.
   - If `cost_price = 0`, show warning and require explicit unit cost.
6. Notification channel:
   - Direct staff LINE requires staff LINE binding.
   - Existing group notification requires active group registration and store LINE credentials.

## 11. Staging Implementation Plan

Phase 1: migration only on staging

- Add two new tables and rollback migration.
- Verify `SHOW CREATE TABLE`, indexes, and row counts.

Phase 2: backend API on staging

- Add route and mount.
- Extract store transfer service logic or add a minimal internal service wrapper.
- Add request creation, submit, cancel, HQ list, and fulfillment APIs.
- Add notification helper with safe failure behavior.

Phase 3: frontend on staging

- Add store and HQ pages.
- Add menu entries behind store transfer/company feature.
- Verify store user can submit; HQ user can create transfer; inbound receive still handles stock increase.

Phase 4: staging workflow test

1. Store submits request.
2. HQ sees request.
3. HQ creates DRAFT transfer.
4. HQ ships transfer.
5. Store receives transfer.
6. Settlement generation includes received transfer item.
7. No supplier purchase records are created.

## 12. Production No-Go Until Approved

Do not run production migration or deploy until:

- Staging migration is verified.
- Staging request/fulfillment/inbound/monthly settlement flow is verified.
- Rollback SQL is tested on staging.
- Production DB backup command and rollback plan are prepared.
- LINE staff/group recipient policy is finalized.

## 13. Rollback Plan

Migration rollback:

```sql
DROP TABLE IF EXISTS store_replenishment_request_items;
DROP TABLE IF EXISTS store_replenishment_requests;
```

Application rollback:

- Revert route mount and frontend menu/page commit.
- Recreate backend/frontend only if that implementation was deployed.
- Do not touch `store_transfers`, `inventory_movements`, or settlement tables during rollback unless a specific bad fulfillment was executed and separately approved.

Data rollback policy after fulfillment:

- If a replenishment request only exists but no transfer was created, cancel request.
- If a transfer was created but not shipped, cancel transfer via existing transfer cancel API.
- If a transfer was shipped, use existing operational return/adjustment policy; do not directly edit stock without an approved rollback runbook.
