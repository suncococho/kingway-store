# KINGWAY 供應商退貨整合設計

Date: 2026-06-25

## Scope

This document records the read-only audit and design for moving supplier return workflows into `供應商管理`.

No code, schema, production deployment, or production data changes were made during this audit.

## Current State

Completed prerequisites:

- Step 1: store-type menu and API permission policy is in production.
- Step 2: legacy PO / RETURN tabs were removed from `InventoryPage`.
- Production HEAD at audit start: `60e81ff ui: hide legacy inventory supplier request tabs`.
- Legacy backend routes remain because Telegram still depends on `supplier_requests`.

Current operating split:

- `DIRECT_STORE` / `FRANCHISE_STORE`: use `門市請貨 -> 本部出貨 -> 門市入庫 -> 本部月結`; supplier management remains blocked.
- `HEADQUARTERS` / `WAREHOUSE`: use company suppliers, supplier purchases, HQ outbound transfer, HQ settlement.
- `INDEPENDENT`: use local suppliers, supplier purchase, receiving, return, settlement/reporting.

## Legacy Supplier Request Audit

### Tables

Production has these supplier/request related tables:

- `suppliers`
- `supplier_product_prices`
- `supplier_purchase_orders`
- `supplier_purchase_order_items`
- `supplier_purchase_receipts`
- `supplier_purchase_receipt_items`
- `supplier_requests`
- `supplier_request_items`

No dedicated `supplier_returns` table exists today.

### `supplier_requests`

Relevant columns:

- `id`
- `request_type` enum: `PURCHASE_ORDER`, `RETURN`
- `status` enum: `PENDING_SUPPLIER`, `APPROVED`, `REJECTED`, `PARTIALLY_RECEIVED`, `RECEIVED`, `RETURN_CONFIRMED`, `CANCELED`
- `supplier_name`
- `note`
- `requested_by_staff_id`
- `supplier_response_note`
- `supplier_responded_at`
- `store_id`
- timestamps

Important limitation: `supplier_requests` stores only a supplier name string. It does not reference `suppliers.id`, owner scope, company scope, settlement fields, return number, return amount, or payment/settlement state.

### `supplier_request_items`

Relevant columns:

- `id`
- `supplier_request_id`
- `product_id`
- `quantity`
- `received_quantity`
- `reason`
- `note`
- `created_at`

Important limitation: item rows do not snapshot SKU/product name/unit cost/line amount and have no photo fields.

### Existing Data Counts

Grouped production counts at audit time:

- `PURCHASE_ORDER / PENDING_SUPPLIER`: 87
- `PURCHASE_ORDER / APPROVED`: 5
- `PURCHASE_ORDER / REJECTED`: 2
- `PURCHASE_ORDER / RECEIVED`: 28
- `RETURN / RETURN_CONFIRMED`: 6

The six legacy return rows are already `RETURN_CONFIRMED`. They are historical records and should remain untouched.

## Legacy Runtime Dependencies

### `backend/src/routes/inventory.js`

The legacy inventory API still contains:

- `GET /api/inventory/supplier-requests`
- `POST /api/inventory/supplier-requests`
- `POST /api/inventory/supplier-requests/:id/respond`
- `POST /api/inventory/supplier-requests/:id/receive`

Step 2 removed frontend Inventory calls, but these endpoints still exist for compatibility.

### `backend/src/routes/suppliers.js`

`供應商管理` still partially uses legacy supplier request APIs:

- `GET /api/suppliers/requests`
- `POST /api/suppliers/requests`
- `POST /api/suppliers/:id/receive`
- `POST /api/suppliers/:id/return-done`
- `GET /api/suppliers/monthly`

The current `SuppliersPage` has a modern `supplier-purchases` flow for purchase orders, but the lower transaction/report section still reads and writes legacy `supplier_requests` for `發注 / 退貨` summary and actions.

### `backend/src/routes/telegramWebhook.js`

Telegram actively depends on `supplier_requests`.

Observed flows:

- `/po 供應商 SKU 數量 備註`
- `/return 供應商 SKU 數量 原因`
- `/receive 發注單號 數量`
- `/return-done 單號`
- `/supplier`, `/supplier pending`, `/supplier_monthly`, `/supplier_xlsx`
- Inline callback `supplier:approve:*` / `supplier:reject:*`

Return handling in active Telegram code can update inventory:

- `/return-done` loads a `RETURN` request and subtracts product stock with `UPDATE products SET stock = GREATEST(stock - ?, 0)`.
- Supplier callback approval for `RETURN` sets `RETURN_CONFIRMED`, inserts an `inventory_movements` `OUT` row, and subtracts stock.

This means legacy `supplier_requests` cannot be dropped or blocked until Telegram is migrated.

## Current Suppliers Page Audit

`frontend/src/pages/SuppliersPage.jsx` currently has tabs:

- `供應商資料`
- `商品供應價`
- `發注 / 入庫 / 月結`

Inside `發注 / 入庫 / 月結`:

- Modern supplier purchase creation uses `/api/supplier-purchases`.
- Modern purchase list and monthly summary use `/api/supplier-purchases` and `/api/supplier-purchases/monthly-summary`.
- Legacy transaction creation still posts to `/api/suppliers/requests` with `type: PURCHASE_ORDER | RETURN`.
- Legacy return completion calls `/api/suppliers/:id/return-done`.
- Legacy summary/monthly section reads `/api/suppliers/requests` and `/api/suppliers/monthly`.

Design implication: Step 3 should add a dedicated return system, then remove the legacy return creation/actions from `SuppliersPage` in a later implementation step. Do not remove Telegram legacy first.

## Recommended Direction

Use new tables for supplier returns:

- `supplier_returns`
- `supplier_return_items`
- optional `supplier_return_photos`

Keep `supplier_requests` as a legacy compatibility path for Telegram until Telegram is migrated.

Reasons:

- `supplier_requests` is mixed-purpose and string-based.
- It has no supplier FK, owner scope, amount, settlement, photo, or clear return lifecycle.
- The modern supplier purchase flow already has normalized tables; returns should match that direction.
- Monthly settlement and Excel export become straightforward when returns have monetary fields and settlement status.

## Proposed Schema

### `supplier_returns`

Suggested columns:

- `id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY`
- `return_no VARCHAR(80) NOT NULL UNIQUE`
- `owner_type ENUM('STORE','COMPANY') NOT NULL`
- `owner_store_id BIGINT UNSIGNED NULL`
- `owner_company_id BIGINT UNSIGNED NULL`
- `store_id BIGINT UNSIGNED NOT NULL`
- `company_id BIGINT UNSIGNED NULL`
- `supplier_id BIGINT UNSIGNED NOT NULL`
- `status ENUM('DRAFT','SUBMITTED','APPROVED','SHIPPED','RECEIVED_BY_SUPPLIER','SETTLED','CANCELED') NOT NULL DEFAULT 'DRAFT'`
- `settlement_status ENUM('UNSETTLED','SETTLED') NOT NULL DEFAULT 'UNSETTLED'`
- `settlement_month CHAR(7) NULL`
- `total_return_amount DECIMAL(12,2) NOT NULL DEFAULT 0`
- `return_date DATETIME NULL`
- `submitted_at DATETIME NULL`
- `approved_at DATETIME NULL`
- `shipped_at DATETIME NULL`
- `received_by_supplier_at DATETIME NULL`
- `settled_at DATETIME NULL`
- `created_by_staff_user_id BIGINT UNSIGNED NULL`
- `updated_by_staff_user_id BIGINT UNSIGNED NULL`
- `note TEXT NULL`
- `created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`

Suggested indexes:

- `UNIQUE KEY uk_supplier_returns_return_no (return_no)`
- `KEY idx_supplier_returns_store_status_created (store_id, status, created_at)`
- `KEY idx_supplier_returns_company_status_created (company_id, status, created_at)`
- `KEY idx_supplier_returns_supplier_month (supplier_id, settlement_month)`
- `KEY idx_supplier_returns_settlement_status (settlement_status, settlement_month)`

Suggested foreign keys:

- `supplier_id -> suppliers(id)`
- `store_id -> stores(id)`
- `company_id -> companies(id)`
- `owner_store_id -> stores(id)`
- `owner_company_id -> companies(id)`

### `supplier_return_items`

Suggested columns:

- `id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY`
- `return_id BIGINT UNSIGNED NOT NULL`
- `supplier_id BIGINT UNSIGNED NOT NULL`
- `product_id BIGINT UNSIGNED NOT NULL`
- `store_id BIGINT UNSIGNED NOT NULL`
- `sku_snapshot VARCHAR(120) NULL`
- `product_name_snapshot VARCHAR(255) NOT NULL`
- `quantity INT UNSIGNED NOT NULL`
- `unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0`
- `line_amount DECIMAL(12,2) NOT NULL DEFAULT 0`
- `reason VARCHAR(255) NULL`
- `status ENUM('DRAFT','SUBMITTED','APPROVED','SHIPPED','RECEIVED_BY_SUPPLIER','SETTLED','CANCELED') NOT NULL DEFAULT 'DRAFT'`
- `note TEXT NULL`
- `created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`

Suggested indexes:

- `KEY idx_supplier_return_items_return (return_id)`
- `KEY idx_supplier_return_items_supplier (supplier_id)`
- `KEY idx_supplier_return_items_product (product_id)`
- `KEY idx_supplier_return_items_status (status)`

### Optional `supplier_return_photos`

Suggested columns:

- `id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY`
- `return_id BIGINT UNSIGNED NOT NULL`
- `item_id BIGINT UNSIGNED NULL`
- `photo_url VARCHAR(255) NOT NULL`
- `photo_type ENUM('DAMAGE','PACKING','COMPLETION','OTHER') NOT NULL DEFAULT 'OTHER'`
- `created_by_staff_user_id BIGINT UNSIGNED NULL`
- `created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`

Photo storage should reuse existing upload/storage conventions where possible.

## Proposed API

New route file:

- `backend/src/routes/supplierReturns.js`

Mount:

- `/api/supplier-returns`

APIs:

- `GET /api/supplier-returns`
- `GET /api/supplier-returns/:id`
- `POST /api/supplier-returns`
- `POST /api/supplier-returns/:id/submit`
- `POST /api/supplier-returns/:id/approve`
- `POST /api/supplier-returns/:id/ship`
- `POST /api/supplier-returns/:id/mark-received-by-supplier`
- `POST /api/supplier-returns/:id/settle`
- `POST /api/supplier-returns/:id/cancel`
- `GET /api/supplier-returns/monthly-summary`
- `GET /api/supplier-returns/report?fromDate=&toDate=&supplierId=&status=&settlementStatus=&export=xlsx`

Validation:

- quantity must be positive integer
- product must belong to the return store
- supplier must be accessible by owner scope
- chain stores (`DIRECT_STORE`, `FRANCHISE_STORE`) are always 403
- `INDEPENDENT` can use only its own store suppliers
- `HEADQUARTERS` / `WAREHOUSE` can use company suppliers or allowed HQ store suppliers
- no duplicate ship
- no stock below zero on ship

## Permission Policy

### `INDEPENDENT`

Allowed:

- create/read/update own store supplier returns
- ship own supplier returns
- settle own supplier returns
- report/export own supplier returns

Blocked:

- company supplier returns outside its store scope
- HQ/chain flows

### `HEADQUARTERS` / `WAREHOUSE`

Allowed:

- company supplier returns
- HQ/warehouse store supplier returns
- report/export company supplier returns
- include returns in company supplier settlement

### `DIRECT_STORE` / `FRANCHISE_STORE`

Blocked:

- all supplier return APIs
- all supplier management UI

Reason:

- chain stores should use `門市請貨`, `門市入庫`, and internal company settlement instead of direct supplier workflows.

## Inventory Policy

Recommended stock change point:

- Creating return: no stock change.
- Submitting/approving return: no stock change.
- Shipping return to supplier: subtract stock and create an `inventory_movements` row.
- Supplier received confirmation: no stock change.
- Settlement: no stock change.

Recommended movement:

- `movement_type = 'OUT'`
- `quantity = -returnQuantity` if existing convention stores OUT as negative, or follow current inventory movement convention exactly when implementing.
- `reference_type = 'SUPPLIER_RETURN'`
- `reference_id = supplier_returns.id`
- note includes return number and SKU.

This should replace the legacy behavior where Telegram sometimes subtracts stock at callback approve and sometimes at `/return-done`.

## UI Design

Add `退貨管理` as a dedicated tab in `SuppliersPage`.

Recommended tab structure:

- `供應商列表`
- `商品供應價`
- `發注管理`
- `入庫/收貨`
- `退貨管理`
- `月結/付款`
- `明細報表`

`退貨管理` functions:

- `新增退貨單`
- supplier selection
- product/SKU search
- quantity
- reason
- optional photo upload
- `送出退貨`
- `確認出貨`
- `供應商已收`
- `標記結算`
- `取消`

Table/card columns:

- `退貨單號`
- `供應商`
- `日期`
- `SKU`
- `商品名稱`
- `數量`
- `單價`
- `金額`
- `狀態`
- `原因`
- `照片`
- `結算狀態`

Important UI cleanup:

- Stop creating legacy return records from the current `建立發注 / 退貨` block after new return APIs exist.
- Keep legacy records visible as historical data only until migration policy is decided.

## Monthly Settlement And Excel

Supplier settlement should combine purchases and returns.

Recommended formula:

- `purchaseReceivedAmount`: received purchase amount from `supplier_purchase_receipts`
- `returnAmount`: shipped/confirmed supplier return amount from `supplier_returns`
- `netAmount = purchaseReceivedAmount - returnAmount`

Return rows should appear as negative or deduction lines in the report.

Suggested Excel columns:

- `日期`
- `類型`: `入庫` / `退貨`
- `單號`
- `供應商`
- `SKU`
- `商品名稱`
- `數量`
- `單價`
- `金額`
- `狀態`
- `結算狀態`
- `備註`

Suggested APIs:

- `GET /api/suppliers/settlement-report`
- or extend `GET /api/supplier-purchases/monthly-summary` carefully with return deductions
- prefer a new report endpoint to avoid changing existing default purchase behavior unexpectedly

## Telegram Migration Plan

### Step 3A: Web Supplier Returns

- Add new `supplier_returns` tables.
- Add backend APIs and `SuppliersPage` return tab.
- Keep Telegram legacy `/return` and `/return-done` unchanged.
- Keep `supplier_requests` untouched.

### Step 3B: Telegram Rewire

- Move Telegram `/return` to call the same supplier return service used by web API.
- Move `/return-done` to `ship` or `mark-received-by-supplier`, depending on final business wording.
- Ensure stock is subtracted exactly once.
- Keep old `supplier_requests RETURN` read-only for history.

### Step 3C: Legacy Deprecation

- Remove legacy return creation from web.
- Keep `supplier_requests` read-only in reports or archive view if needed.
- Decide whether to migrate historical `RETURN` rows into `supplier_returns`.

## Risks

- Current Telegram return approve path can subtract stock immediately; migration must avoid double subtraction.
- Legacy `supplier_requests` has no monetary fields, so historical returns cannot be accurately included in monetary settlement unless reconstructed from product cost at that time.
- Some existing `supplier_requests` have `store_id` null or older legacy assumptions; scope handling must be explicit.
- Encoding in old rows appears inconsistent for some product names/notes; reports should use product snapshots in the new tables going forward.
- Product stock must be locked with `FOR UPDATE` when shipping a return.

## Decisions Needed

1. Should stock be subtracted at `ship` only? Recommended: yes.
2. Should return amount deduct from supplier monthly settlement? Recommended: yes, as negative/deduction rows.
3. How should replacement goods be handled? Recommended: separate supplier purchase/receipt or exchange note, not automatic stock add from return.
4. Where should return photos be stored? Recommended: reuse existing upload storage and serve through the existing file route.
5. When should Telegram `/return` move to new APIs? Recommended: after web return API is stable in staging.
6. Should historical `supplier_requests RETURN` rows be included in new reports? Recommended: show in legacy history only unless a manual migration/reconciliation is approved.
7. Should `supplier_requests` be migrated? Recommended: not in MVP; do not migrate production historical records until reporting requirements are agreed.

## Implementation Plan

### Step 3A

- Add migration for `supplier_returns`, `supplier_return_items`, optional `supplier_return_photos`.
- Add `supplierReturns` backend route and service.
- Add stock-safe `ship` transaction.
- Add return report/export API.
- Add `退貨管理` tab in `SuppliersPage`.
- Keep production no-go until staging E2E is complete.

### Step 3B

- Rewire Telegram `/return`, `/return-done`, and callbacks to the new return service.
- Verify no double stock subtraction.
- Keep old `supplier_requests` read-only.

### Step 3C

- Remove remaining web legacy supplier request writes.
- Add legacy history page or report section if needed.
- Decide historical migration policy.

## Rollback Plan

For implementation phases:

- If only backend/frontend code fails, redeploy previous backend/frontend commit.
- If new migration has run but no rows exist, apply rollback SQL to drop new tables.
- If return rows exist, do not drop tables; disable routes/UI and keep data for manual review.
- Never delete historical `supplier_requests` or existing supplier purchase data.

## Production No-Go

This audit did not:

- modify code
- modify DB
- run migrations
- deploy staging or production
- restart MySQL
- change Telegram behavior

Production implementation must require a separate explicit approval, backup, migration plan, staging E2E results, and rollback decision.
