# Telegram Supplier Legacy Migration Design

Date: 2026-06-25

## Scope

This document audits the current Telegram supplier workflows that still write to the legacy `supplier_requests` model and proposes a staged migration to the newer supplier purchase and supplier return models.

This is a read-only design step. It does not change code, database schema, production data, Telegram commands, or deployment state.

## Current Production State

The web supplier workflow has already moved to the newer structures:

- Supplier purchases: `supplier_purchase_orders`, `supplier_purchase_order_items`, `supplier_purchase_receipts`, `supplier_purchase_receipt_items`
- Supplier returns: `supplier_returns`, `supplier_return_items`
- Supplier integrated settlement report: `GET /api/supplier-purchases/settlement-report`

The Inventory page no longer exposes the legacy PO / RETURN tabs, but Telegram still uses the legacy tables:

- `supplier_requests`
- `supplier_request_items`

Legacy records must remain intact. New migration work must not delete or rewrite historical rows without a separately approved reconciliation plan.

## Legacy DB Audit

### `supplier_requests`

Production columns:

- `id`
- `request_type`: `PURCHASE_ORDER`, `RETURN`
- `status`: `PENDING_SUPPLIER`, `APPROVED`, `REJECTED`, `PARTIALLY_RECEIVED`, `RECEIVED`, `RETURN_CONFIRMED`, `CANCELED`
- `supplier_name`
- `note`
- `requested_by_staff_id`
- `supplier_response_note`
- `supplier_responded_at`
- `created_at`
- `updated_at`
- `store_id`

Important limitations:

- There is no `supplier_id`.
- There is no owner scope (`STORE`, `COMPANY`, `PLATFORM`).
- There is no settlement status, unit cost, line amount, receipt number, return number, or purchase order number.
- Some legacy write paths historically omit `store_id`; scope is often inferred by joining the item product to a store.

### `supplier_request_items`

Production columns:

- `id`
- `supplier_request_id`
- `product_id`
- `quantity`
- `received_quantity`
- `reason`
- `note`
- `created_at`

Important limitations:

- SKU and product name are not snapshotted; they are resolved through `products`.
- There is no `unit_cost`, `line_amount`, or settlement amount.
- There is no photo column.
- There is no inventory movement id reference.

### Production Status Counts

Production read-only count at audit time:

| request_type | status | count |
| --- | --- | ---: |
| PURCHASE_ORDER | PENDING_SUPPLIER | 87 |
| PURCHASE_ORDER | APPROVED | 5 |
| PURCHASE_ORDER | REJECTED | 2 |
| PURCHASE_ORDER | RECEIVED | 28 |
| RETURN | RETURN_CONFIRMED | 6 |

Recent production rows are primarily store 1 (`KINGWAY_TAINAN`) `PURCHASE_ORDER / PENDING_SUPPLIER` records with supplier name `KINGWAY`.

## Legacy Command Audit

Primary file:

- `backend/src/routes/telegramWebhook.js`

Legacy Inventory route still exists for compatibility:

- `backend/src/routes/inventory.js`

### `/po`

Current command format:

```text
/po [供應商] SKU 數量 備註
```

Examples shown in help:

```text
/po KINGWAY B-EB-001-S1 1 補貨
```

Current behavior:

1. Parses optional supplier name. If omitted, defaults to `kingway`.
2. Looks up `products` by `sku` and the Telegram store id.
3. Inserts `supplier_requests`:
   - `request_type = 'PURCHASE_ORDER'`
   - `status = 'PENDING_SUPPLIER'`
   - `supplier_name = parsed supplier name`
   - `note = command note`
   - `requested_by_staff_id = 1`
4. Inserts `supplier_request_items`:
   - `supplier_request_id`
   - `product_id`
   - `quantity`
   - `note`
5. Sends Telegram confirmation.

Stock change:

- No stock change on `/po`.

Legacy risks:

- Supplier is string based.
- There is no purchase order number.
- There is no `supplier_id`.
- There is no `unit_cost` snapshot.
- Some command examples and low stock suggestions omit supplier, but parser currently expects optional supplier only when the second token does not look like an SKU.

### `/return`

Current command format:

```text
/return [供應商] SKU 數量 原因
```

Examples shown in help:

```text
/return KINGWAY B-EB-001-S1 1 瑕疵換貨
```

Current behavior:

1. Parses optional supplier name. If omitted, defaults to `kingway`.
2. Looks up `products` by `sku` and the Telegram store id.
3. Inserts `supplier_requests`:
   - `request_type = 'RETURN'`
   - `status = 'PENDING_SUPPLIER'`
   - `supplier_name`
   - `note = reason`
   - `requested_by_staff_id = 1`
4. Inserts `supplier_request_items`:
   - `supplier_request_id`
   - `product_id`
   - `quantity`
   - `reason = reason`
5. Sends Telegram confirmation.

Stock change:

- No stock change on `/return` creation.

Legacy risks:

- Supplier is string based.
- There is no `supplier_id`.
- Photos are not persisted in `supplier_request_items`.
- There is no dedicated return number, settlement status, unit cost, or line amount.

### `/receive`

Current command format:

```text
/receive 發注單號 數量
```

Current behavior:

1. Loads a legacy `supplier_requests` row by id.
2. Requires `request_type = 'PURCHASE_ORDER'`.
3. Loads the first matching `supplier_request_items` row and product for the Telegram store.
4. Computes `actualReceive = min(requested remaining quantity, command quantity)`.
5. Updates `supplier_request_items.received_quantity`.
6. Updates `products.stock = stock + actualReceive`.
7. Updates `supplier_requests.status`:
   - `PARTIALLY_RECEIVED`
   - or `RECEIVED`
8. Sends Telegram confirmation.

Stock change:

- Stock increases at `/receive`.

Important gap versus new purchase model:

- It does not create `supplier_purchase_receipts`.
- It does not create `supplier_purchase_receipt_items`.
- In `telegramWebhook.js`, this receive path does not create `inventory_movements`; the legacy Inventory API receive path does create a `RESTOCK / SUPPLIER_REQUEST` movement.

### `/return-done`

Current command format:

```text
/return-done 單號
```

Current behavior:

1. Loads a legacy `supplier_requests` row by id.
2. Requires `request_type = 'RETURN'`.
3. If status is already `RETURN_CONFIRMED`, it is treated as idempotent and does not change stock again.
4. Loads product and item quantity.
5. Updates `products.stock = GREATEST(stock - quantity, 0)`.
6. Updates `supplier_requests.status = 'RETURN_CONFIRMED'`.
7. Sends Telegram confirmation.

Stock change:

- Stock decreases at `/return-done`.

Important gap versus new return model:

- It does not create a `supplier_returns` row.
- It does not create a `supplier_return_items` row.
- It does not link to `inventory_movements` from `/return-done`.
- It silently caps stock at zero with `GREATEST`, instead of failing on insufficient stock.

### Telegram approve / reject callback

Callback payload:

```text
supplier:approve:<requestId>:<storeId>
supplier:reject:<requestId>:<storeId>
```

Current behavior:

1. Loads `supplier_requests` with matching product in callback store.
2. Reject sets `REJECTED`.
3. Approve defaults to `APPROVED`.
4. Approve for `RETURN` sets `RETURN_CONFIRMED`.
5. For approved returns:
   - inserts an `inventory_movements` row:
     - `movement_type = 'OUT'`
     - `reference_type = 'SUPPLIER_REQUEST'`
     - `reference_id = request id`
   - updates `products.stock = stock - returnQty`
6. Updates `supplier_requests.status`, `supplier_responded_at`, and `supplier_response_note`.

Stock change:

- Purchase approve: no stock change.
- Return approve: stock decreases immediately.

Important gap versus new return model:

- Return stock can be decremented either by callback approve or `/return-done`, depending on which operational path is used.
- Callback uses a direct subtraction and does not check insufficient stock.
- `/return-done` uses `GREATEST(stock - quantity, 0)`.
- The new `supplier_returns` policy decrements stock at `ship` only, with stock validation and an explicit `SUPPLIER_RETURN` movement.

### `/po_list`, `/ret_list`, `/supplier`, reports

The active Telegram route does not expose a dedicated `po_list` or `ret_list` handler in the current inspected flow. Current list/report commands are:

- `/supplier`
- `/supplier pending`
- `/supplier <supplierName>`
- `/supplier_monthly`
- `/supplier_xlsx`
- `/supplier_csv`
- `/supplier_report`

These read from legacy `supplier_requests` and `supplier_request_items`.

## New Structure Mapping Proposal

### `/po` to `supplier_purchase_orders`

Target model:

- `supplier_purchase_orders`
- `supplier_purchase_order_items`

Recommended behavior:

1. Resolve Telegram store context.
2. Resolve supplier to a real `suppliers.id`.
3. Resolve product by SKU and store scope.
4. Create `supplier_purchase_orders` with:
   - `buyer_type = 'STORE'` for independent store suppliers
   - `buyer_type = 'COMPANY'` only for HQ / warehouse company suppliers
   - `status = 'DRAFT'` by default, or `ORDERED` if Telegram command is intended as a confirmed order
5. Create `supplier_purchase_order_items` with:
   - `product_id`
   - SKU/product snapshots
   - `quantity_ordered`
   - `unit_cost`
   - `line_order_amount`
   - note

Recommended initial policy:

- `/po` should create an `ORDERED` purchase order if Telegram is used as an operational shortcut.
- If the business wants human review before supplier ordering, create `DRAFT` and add `/po-submit` or an inline confirm button.
- Do not create legacy `supplier_requests` for new `/po` once migration is enabled.

### `/receive` to `supplier_purchase_receipts`

Target model:

- `supplier_purchase_receipts`
- `supplier_purchase_receipt_items`

Recommended behavior:

1. Receive by modern purchase order id or purchase order number.
2. Validate the order belongs to Telegram store scope.
3. Create receipt header and receipt item rows.
4. Increase stock using the same service logic as web supplier purchase receive.
5. Create `inventory_movements` with `reference_type = 'SUPPLIER_PURCHASE'`.
6. Update purchase order receive status.

Recommended command format:

```text
/receive PO號 數量
```

If the current numeric legacy id format must be preserved during transition, support both:

```text
/receive <legacySupplierRequestId> 數量
/receive <purchaseOrderNo|purchaseOrderId> 數量
```

The safer migration is to print the modern PO number in `/po` responses and ask users to use that number for `/receive`.

### `/return` to `supplier_returns`

Target model:

- `supplier_returns`
- `supplier_return_items`

Recommended behavior:

1. Resolve Telegram store context.
2. Resolve supplier to `suppliers.id`.
3. Resolve product by SKU and owner scope.
4. Create a `supplier_returns` row:
   - `owner_type = 'STORE'` for independent store suppliers
   - `owner_type = 'COMPANY'` for HQ / warehouse company suppliers
   - `status = 'SUBMITTED'` or `APPROVED`, depending on whether Telegram should require an approval step
5. Create `supplier_return_items` with:
   - `product_id`
   - SKU/product snapshots
   - `quantity`
   - `unit_cost`
   - `line_amount`
   - `reason`
   - optional `photo_url`

Recommended initial policy:

- `/return` creates `SUBMITTED`.
- Telegram inline approve should call the new approve action and should not decrement stock.
- A separate `/return-ship` or existing `/return-done` compatibility command should call the new `ship` action, which decrements stock.

### `/return-done` mapping

The existing command name suggests completion. In the new return lifecycle there are two possible meanings:

1. `ship`: store has shipped goods back to supplier, stock should be decremented.
2. `mark-received-by-supplier`: supplier confirms receipt, stock should not change.

Recommended policy:

- Preserve the current operational meaning as stock-decrementing return completion.
- Map `/return-done` to `POST /api/supplier-returns/:id/ship`.
- Add a new explicit command later if needed:

```text
/return-received 退貨單號
```

to map to `mark-received-by-supplier`.

## Supplier ID Resolution Policy

This is the main migration decision.

Recommended resolution order:

1. If the Telegram command includes supplier code or exact supplier name, resolve against active suppliers visible to the Telegram store context.
2. For independent stores:
   - allow only `owner_type = 'STORE'`
   - `owner_store_id` or `store_id` must match the Telegram store
3. For HQ / warehouse:
   - allow `owner_type = 'COMPANY'` for the relevant company
   - allow `owner_type = 'STORE'` only if explicitly required for HQ store-local suppliers
4. Reject `PLATFORM` suppliers in MVP.
5. If multiple suppliers match, do not guess. Send a Telegram message listing candidates and require a clearer supplier code/name.
6. If no supplier is provided:
   - do not default to `kingway` in the new flow unless a store-level default supplier mapping exists.
   - Recommended: require supplier name/code in `/po` and `/return`.

Open option for future UX:

- Add a `supplier_product_prices` based default:
  - product + store + active supplier price can infer supplier only if exactly one active mapping exists.
  - If multiple mappings exist, require explicit supplier.

## Photo Handling Policy

Current legacy return command stores reason text only. It does not persist photos.

Recommended MVP:

- Keep `/return` text-only first.
- If a Telegram photo is sent while a return conversation is active, upload through existing backend upload/storage flow and store URL in `supplier_return_items.photo_url`.
- If multiple photos are needed, add `supplier_return_photos` later:
  - `return_id`
  - `item_id`
  - `photo_url`
  - `photo_type`

Do not store raw Telegram file tokens in DB or logs.

## Status Mapping

### Purchase

| Legacy | New purchase meaning |
| --- | --- |
| `PENDING_SUPPLIER` | `ORDERED` or `DRAFT`, depending on final Telegram policy |
| `APPROVED` | `ORDERED` |
| `REJECTED` | `CANCELED` |
| `PARTIALLY_RECEIVED` | `PARTIALLY_RECEIVED` |
| `RECEIVED` | `RECEIVED` |
| `CANCELED` | `CANCELED` |

### Return

| Legacy | New return meaning |
| --- | --- |
| `PENDING_SUPPLIER` | `SUBMITTED` |
| `APPROVED` | `APPROVED` |
| `REJECTED` | `CANCELED` |
| `RETURN_CONFIRMED` | `SHIPPED` or `RECEIVED_BY_SUPPLIER`, depending on the path |
| `CANCELED` | `CANCELED` |

Recommended mapping for new commands:

- `/return` -> `SUBMITTED`
- supplier approve callback -> `APPROVED`, no stock change
- `/return-done` -> `SHIPPED`, stock change
- optional `/return-received` -> `RECEIVED_BY_SUPPLIER`, no stock change

## Staged Implementation Plan

### Step 4A: audit and design

- This document.
- No code changes.
- No DB changes.
- No production behavior changes.

### Step 4B: migrate Telegram `/po` and `/receive`

Implementation target:

- Add a shared backend service for supplier purchase creation and receive, so Telegram and web use the same validation and stock/movement behavior.
- Rewire `/po` to create `supplier_purchase_orders`.
- Rewire `/receive` to create `supplier_purchase_receipts`.
- Stop creating new `supplier_requests` for Telegram purchase orders.
- Keep legacy `supplier_requests` purchase rows readable.

Compatibility:

- For a transition window, `/receive <legacyId>` can still receive old legacy PO rows.
- New `/po` responses should display modern PO number.

### Step 4C: migrate Telegram `/return` and `/return-done`

Implementation target:

- Add or reuse a shared supplier return service.
- Rewire `/return` to create `supplier_returns`.
- Rewire approval callback to `approve`, no stock change.
- Rewire `/return-done` to `ship`, with stock validation and `SUPPLIER_RETURN` inventory movement.
- Stop creating new `supplier_requests` for Telegram returns.
- Keep legacy `supplier_requests` return rows readable.

Compatibility:

- Existing legacy return rows can still be completed through legacy path until they are closed.
- New return ids must be clearly labeled as modern return numbers to avoid confusion.

### Step 4D: deprecate legacy write APIs

After Telegram migration is stable:

- Block or return `410 Gone` from legacy web write endpoints:
  - `POST /api/inventory/supplier-requests`
  - `POST /api/inventory/supplier-requests/:id/respond`
  - `POST /api/inventory/supplier-requests/:id/receive`
- Keep read-only access for historical records if needed.
- Do not drop `supplier_requests` or `supplier_request_items` without a separately approved archival plan.

## Rollback Plan

Because Step 4B/4C would change runtime Telegram behavior, rollback must be simple:

1. Keep the legacy command implementation available behind a feature flag.
2. Add an env or app setting such as:
   - `TELEGRAM_SUPPLIER_FLOW=legacy|modern`
3. Default staging to `modern` during tests.
4. Production rollout can switch to `modern` only after verified.
5. If errors occur, switch back to `legacy` and redeploy backend only.

No rollback should delete modern rows created during a test. Instead:

- Cancel modern purchase/return documents if business-safe.
- Keep audit trail.
- Do not mutate historical legacy rows unless explicitly approved.

## Risks and Decisions Needed

1. Supplier identity:
   - Legacy only has `supplier_name`.
   - New flow requires `supplier_id`.
   - Decision: require explicit supplier code/name in Telegram commands, or allow unique product-supplier inference.

2. Store type:
   - Direct/franchise chain stores should not use supplier purchase/return.
   - Telegram store id must not point to a DIRECT_STORE if supplier commands remain enabled.

3. Default supplier:
   - Current legacy command defaults to `kingway`.
   - New flow should not default blindly unless a configured default supplier exists.

4. SKU with multiple suppliers:
   - Must not guess.
   - Telegram should ask the user to choose a supplier.

5. Stock timing:
   - Legacy return approve callback can decrement stock immediately.
   - Legacy `/return-done` also decrements stock.
   - New policy is only `supplier_returns.ship` decrements stock.

6. Insufficient stock:
   - Legacy `/return-done` caps at zero.
   - New policy should reject with a clear stock shortage message.

7. Inventory movement consistency:
   - Legacy Telegram `/receive` does not write movement in the inspected path.
   - New purchase receive must write the same movement as the web purchase receive flow.

8. Photo support:
   - Current schema does not store photos.
   - Decide whether Telegram return photos are MVP or Step 4C follow-up.

9. Legacy ids versus new document numbers:
   - Old commands use numeric `supplier_requests.id`.
   - New commands should display and accept modern document numbers where possible.

10. Historical reporting:
   - Legacy rows have no monetary snapshots.
   - Recommended: keep them in legacy history only; do not include them in modern monetary settlement reports unless a reconciliation method is approved.

## Production No-Go

This design step does not authorize:

- production deployment
- production DB write
- migration
- supplier_requests data deletion
- Telegram behavior changes
- MySQL restart
- `docker compose down`

## Recommended Next Step

Implement Step 4B in staging only:

- Create shared supplier purchase service if needed.
- Rewire Telegram `/po` and `/receive` to modern supplier purchase tables behind a feature flag.
- Keep legacy receive for existing `supplier_requests` rows during the transition.
- Validate with staging Telegram-safe mock or direct webhook payload tests.
