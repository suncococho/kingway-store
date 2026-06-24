# KINGWAY Supplier / Headquarters / Franchise Operation Rules

Date: 2026-06-24
Scope: read-only audit and implementation design. No production deploy, no DB write, no migration.

## 1. Current Audit Summary

### Store type source of truth

Production currently has:

- `stores.id = 1`, `KINGWAY_TAINAN`, plan `single_store`, active, linked to company `KINGWAY` as `DIRECT_STORE`.
- `stores.id = 3`, `KINGWAY_KAOHSIUNG`, plan `premium`, active, linked to company `KINGWAY` as `HEADQUARTERS`.
- `stores.id = 4`, `PROD_DEMO_INDEPENDENT_001`, trial, active, not linked in `company_stores`; this behaves as an independent SaaS store.

Recommended classification:

- `HEADQUARTERS` / `WAREHOUSE`: `company_stores.relationship_type IN ('HEADQUARTERS','WAREHOUSE')`.
- `DIRECT_STORE` / `FRANCHISE_STORE`: `company_stores.relationship_type IN ('DIRECT_STORE','FRANCHISE_STORE')`.
- `INDEPENDENT`: active store with no active `company_stores` row. Use store plan/status only as secondary metadata, not as the primary relationship rule.

### Supplier ownership model

`suppliers` already supports scoped ownership:

- `owner_type = STORE`: store-local supplier, with `owner_store_id`.
- `owner_type = COMPANY`: company supplier, with `owner_company_id`.
- `owner_type = PLATFORM`: reserved / platform-visible supplier.
- `visibility`: `PRIVATE`, `COMPANY_VISIBLE`, `PLATFORM_VISIBLE`.

`supplier_purchase_orders` also supports:

- `buyer_type = STORE` for independent/store-local purchases.
- `buyer_type = COMPANY` for company/HQ purchases.
- `store_id` as the receiving store.
- `company_id` for company purchases.

Current backend already blocks company supplier receiving unless the receiving store is `HEADQUARTERS` or `WAREHOUSE`:

- `backend/src/routes/supplierPurchases.js`
- error: `公司供應商只能由本部或倉庫門市入庫`

### Current supplier/return structures

Production tables include:

- `suppliers`
- `supplier_product_prices`
- `supplier_purchase_orders`
- `supplier_purchase_order_items`
- `supplier_purchase_receipts`
- `supplier_purchase_receipt_items`
- `supplier_requests`
- `supplier_request_items`

There is no dedicated `supplier_returns` table at this audit point. Return-like behavior currently exists in legacy `supplier_requests.request_type = 'RETURN'`.

### Current duplicate UI/API areas

Newer supplier flow:

- UI: `frontend/src/pages/SuppliersPage.jsx`
- APIs: `/api/suppliers`, `/api/supplier-purchases`, `/api/supplier-purchases/monthly-summary`
- Supports supplier list, product supplier prices, supplier purchase orders, receiving, paid status, monthly summary, and demo exclusion.

Legacy inventory supplier flow:

- UI: `frontend/src/pages/InventoryPage.jsx`
- Sections: `PO`, `RETURN`
- APIs:
  - `GET /api/inventory/supplier-requests`
  - `POST /api/inventory/supplier-requests`
  - `POST /api/inventory/supplier-requests/:id/respond`
  - `POST /api/inventory/supplier-requests/:id/receive`
- Tables: `supplier_requests`, `supplier_request_items`

This is the main source of duplicated `發注` / `退貨` behavior. The operating direction should be to keep inventory focused on stock overview, movement, and adjustment, and move supplier purchase/return/payment/reporting under `供應商管理`.

## 2. Target Operating Definition

### A. Company headquarters / warehouse

Types:

- `HEADQUARTERS`
- `WAREHOUSE`

Operating flow:

`供應商發注 -> 本部入庫 -> 本部出貨 -> 門市入庫 -> 本部月結`

Visible menus:

- `供應商管理`
- `供應商發注`
- `供應商退貨`
- `供應商月結`
- `供應商明細報表`
- `本部出貨`
- `本部請貨管理`
- `本部月結`
- `本部出貨明細`
- Products, inventory, orders, repairs, customers

Hidden / blocked:

- Store-side replenishment request entry should generally be hidden unless HQ needs a special internal request mode.

Supplier policy:

- Can manage `COMPANY` suppliers.
- Can create company supplier purchases into HQ/warehouse stores only.
- Can use store-local suppliers for HQ store-local operations if needed.

### B. Direct store / franchise store

Types:

- `DIRECT_STORE`
- `FRANCHISE_STORE`

Operating flow:

`門市請貨 -> 本部出貨 -> 門市入庫 -> 本部月結`

Visible menus:

- `門市請貨`
- `門市入庫`
- Own store orders
- Own store repairs
- Own store customers
- Own store products and inventory read/operational views

Hidden / blocked:

- `供應商管理`
- Supplier purchase / receiving / return / supplier monthly settlement
- `本部出貨`
- `本部請貨管理`
- `本部月結` generation / confirmation / mark-paid
- `本部出貨明細`
- Platform Admin

Supplier policy:

- Should not directly transact with suppliers in the main company operating model.
- If an exceptional store-local supplier is needed later, that should be a separately enabled feature flag, not default behavior.

### C. Independent SaaS store

Definition:

- No active `company_stores` relationship.

Operating flow:

`供應商發注 -> 門市入庫/收貨 -> 供應商退貨 -> 供應商月結`

Visible menus:

- `供應商管理`
- Supplier purchase / receiving
- Supplier return
- Supplier settlement/payment
- Supplier report / Excel download
- Own store products, inventory, orders, repairs, customers

Hidden / blocked:

- `門市請貨`
- `門市入庫`
- `本部出貨`
- `本部請貨管理`
- `本部月結`
- `本部出貨明細`

Supplier policy:

- Can manage `STORE` suppliers only by default.
- Should not see or select `COMPANY` suppliers unless platform-level sharing is explicitly introduced.

## 3. Menu Policy

### HEADQUARTERS / WAREHOUSE

Show:

- `供應商管理`
- `本部出貨`
- `本部請貨管理`
- `本部月結`
- `本部出貨明細`
- `商品管理`
- `庫存管理`
- `訂單管理`
- `維修管理`
- `客戶管理`

### DIRECT_STORE / FRANCHISE_STORE

Show:

- `門市請貨`
- `門市入庫`
- `商品管理`
- `庫存管理`
- `訂單管理`
- `維修管理`
- `客戶管理`

Hide:

- `供應商管理`
- `本部出貨`
- `本部請貨管理`
- `本部月結`
- `本部出貨明細`

### INDEPENDENT

Show:

- `供應商管理`
- `商品管理`
- `庫存管理`
- `訂單管理`
- `維修管理`
- `客戶管理`

Hide:

- `門市請貨`
- `門市入庫`
- `本部出貨`
- `本部請貨管理`
- `本部月結`
- `本部出貨明細`

### Current frontend gap

Current frontend menu permissions are role/menu-key based. Owners/admins get broad fallback permissions, and relationship checks are currently applied only to HQ-specific routes after the recent HQ report fix. The next implementation should introduce a first-class store relationship context helper and use it consistently in:

- `frontend/src/lib/mobileNavigation.js`
- `frontend/src/components/Sidebar.jsx`
- `frontend/src/components/ProtectedLayout.jsx`
- `frontend/src/lib/menuPermissions.js` or a new relationship-based menu helper

## 4. API Permission Policy

### Headquarters-only APIs

Require current store context `HEADQUARTERS` or `WAREHOUSE` and company role where relevant:

- `POST /api/store-transfers`
- `POST /api/store-transfers/:id/ship`
- `GET /api/store-replenishment-requests/company`
- `GET /api/store-replenishment-requests/company/pending`
- `POST /api/store-replenishment-requests/:id/items/:itemId/create-transfer`
- `POST /api/store-replenishment-requests/:id/items/:itemId/create-and-ship-transfer`
- `GET /api/company-store-settlements/transfer-report`
- `POST /api/company-store-settlements/generate`
- `POST /api/company-store-settlements/:id/confirm`
- `POST /api/company-store-settlements/:id/mark-paid`
- Company supplier purchase write APIs when `supplier.owner_type = COMPANY`

### Chain store APIs

Require current store context `DIRECT_STORE` or `FRANCHISE_STORE`:

- `GET /api/store-replenishment-requests`
- `POST /api/store-replenishment-requests`
- `POST /api/store-replenishment-requests/:id/submit`
- `POST /api/store-replenishment-requests/:id/cancel`
- `GET /api/store-transfers/inbound`
- inbound receive for transfers where `to_store_id = current store`

Block:

- Supplier purchase / supplier return writes by default.
- Supplier management menu/API access by default.

### Independent store APIs

Require no active `company_stores` relationship:

- Supplier create/update/delete for `owner_type = STORE`
- Supplier product prices
- Supplier purchase create/order/receive/mark-paid/cancel
- Supplier return create/receive/settle once implemented
- Supplier monthly summary/report/export

Block:

- Store replenishment request APIs.
- Inbound transfer APIs.
- Headquarters transfer/monthly/report APIs.

### Current backend gap

Already guarded:

- Company supplier receiving requires HQ/warehouse context in `supplierPurchases.js`.
- HQ report and HQ replenishment APIs were recently tightened to current HQ/warehouse context.

Needs tightening:

- `supplierPurchases.js` currently permits `STORE` supplier purchases for any current store, including chain stores. This should be blocked for `DIRECT_STORE` / `FRANCHISE_STORE` unless an explicit feature exception is introduced.
- `suppliers.js` currently exposes supplier management under `requireFeature("suppliers")`; it should also check relationship policy.
- Legacy `/api/inventory/supplier-requests` should be hidden/disabled or redirected out of inventory.

## 5. Supplier Management Restructure

### Independent store tab model

`供應商管理` should contain:

- `供應商列表`
- `發注管理`
- `入庫/收貨`
- `退貨管理`
- `月結/付款`
- `明細報表`
- `Excel 下載`

### Headquarters tab model

`供應商管理` should contain:

- `公司供應商`
- `本部發注`
- `本部入庫`
- `本部退貨`
- `供應商月結`
- `供應商明細報表`
- `Excel 下載`

### Chain store model

`供應商管理` should be hidden entirely. Chain stores should use:

- `門市請貨`
- `門市入庫`

## 6. Inventory Duplicate Flow Cleanup

Current inventory page has supplier workflow tabs:

- `PO` / `發注`
- `RETURN` / `退貨`
- `POST /api/inventory/supplier-requests`
- `supplier_requests`, `supplier_request_items`

Target:

- Inventory should remain for:
  - stock overview
  - stock movement history
  - manual IN/OUT/ADJUST where permitted
  - inventory import/export
- Supplier purchase/return/payment/reporting should move to `供應商管理`.

Recommended migration path:

1. Hide `PO` and `RETURN` tabs from `InventoryPage`.
2. Keep legacy routes read-only for historical data during transition.
3. Add redirects or notices from old inventory supplier sections to `供應商管理`.
4. Later decide whether to migrate legacy `supplier_requests` data into the new supplier purchase/return model.

## 7. Independent Supplier Settlement / Excel Design

Need a supplier report comparable to HQ transfer report, but supplier-centric.

API candidates:

- `GET /api/supplier-purchases/report`
- `GET /api/supplier-returns/report`
- or combined `GET /api/suppliers/settlement-report`

Recommended MVP:

- Add `GET /api/suppliers/settlement-report`
- Query params:
  - `fromDate`
  - `toDate`
  - `supplierId`
  - `type = ALL | PURCHASE | RECEIPT | RETURN`
  - `status`
  - `paymentStatus`
  - `export = xlsx`

Rows:

- Date
- Supplier
- Type: `發注`, `入庫`, `退貨`
- Document no
- SKU
- Product name
- Quantity
- Unit cost
- Amount
- Status
- Payment status
- Note

Excel columns:

- `日期`
- `供應商`
- `類型`
- `單號`
- `SKU`
- `商品名稱`
- `數量`
- `單價`
- `金額`
- `狀態`
- `付款狀態`
- `備註`

Data source:

- Purchases and receipts from `supplier_purchase_orders`, `supplier_purchase_order_items`, `supplier_purchase_receipts`, `supplier_purchase_receipt_items`.
- Returns need a formal table before complete reporting. Current legacy `supplier_requests.request_type = 'RETURN'` can be included as historical/legacy return rows, but a dedicated `supplier_returns` model is preferred for settlement accuracy.

## 8. Recommended Implementation Steps

### Step 1: Relationship-based menu and API access

- Create a shared frontend helper for current store relationship classification.
- Hide supplier management from `DIRECT_STORE` / `FRANCHISE_STORE`.
- Hide replenishment/inbound/HQ menus from `INDEPENDENT`.
- Keep HQ menus only for `HEADQUARTERS` / `WAREHOUSE`.
- Add backend guards:
  - chain stores cannot write supplier purchases/returns by default.
  - independent stores cannot call replenishment/inbound/HQ APIs.
  - HQ/warehouse can use company supplier purchase APIs.

### Step 2: Move supplier PO/return out of inventory

- Hide `InventoryPage` `PO` and `RETURN` tabs.
- Keep old inventory supplier APIs read-only or admin-only during transition.
- Add UI copy or redirect to `供應商管理`.

### Step 3: Independent supplier report / monthly settlement / Excel

- Implement supplier settlement/report API.
- Add Excel export.
- Add `供應商明細報表` tab in `SuppliersPage`.
- Support independent store first.

### Step 4: Headquarters supplier report hardening

- Apply the same report to HQ company suppliers.
- Keep company supplier operations restricted to `HEADQUARTERS` / `WAREHOUSE`.
- Add company-level supplier monthly summary/export if current `supplier-purchases/monthly-summary` is not enough.

## 9. Production No-Go for This Audit

This document is design-only.

No production DB writes, migrations, backend/frontend deploy, MySQL restart, docker compose down, or git push should be performed for this audit step.

## 10. Rollback Plan

Because this step adds documentation only:

- No DB rollback required.
- No service rollback required.
- If the document is wrong or superseded, revert only this docs commit or amend with a follow-up design correction.

