# KINGWAY Store Operation Flow

Date: 2026-06-25
Audience: store staff, headquarters staff, and operation managers
Scope: production operation guide. This document does not change code, database schema, or data.

## 1. 全體營運原則

KINGWAY 現在依照門市類型分成三種營運流程。

### Chain stores: `DIRECT_STORE` / `FRANCHISE_STORE`

Examples:

- 台南直營店
- Future franchise stores

Principle:

- 門市向本部請貨。
- 本部確認後出貨。
- 門市收到商品後做入庫確認。
- 門市不直接向供應商發注、入庫、退貨或月結。

Main flow:

`門市請貨 -> 本部出貨 -> 門市入庫 -> 本部月結`

### Headquarters / warehouse: `HEADQUARTERS` / `WAREHOUSE`

Examples:

- 高雄本部
- Future company warehouse

Principle:

- 本部向供應商採購。
- 本部入庫後管理本部庫存。
- 本部依門市請貨建立出貨單。
- 門市入庫完成後，本部建立月結。

Main flow:

`供應商發注 -> 本部入庫 -> 本部出貨 -> 門市入庫 -> 本部月結`

### Independent stores: `INDEPENDENT`

Definition:

- No active company/headquarters relationship.
- Store operates its own supplier workflow.

Principle:

- 獨立店自行管理供應商。
- 自行發注、入庫、退貨、月結。
- 不使用本部請貨、本部出貨、本部月結。

Main flow:

`供應商發注 -> 入庫 -> 供應商退貨 -> 供應商月結`

## 2. 門市類型與使用選單

### A. 高雄本部 / `HEADQUARTERS`

Use:

- `供應商管理`
- `本部出貨`
- `本部請貨管理`
- `本部月結`
- `本部出貨明細`
- `供應商月結報表`
- Orders, repairs, customers, products, inventory

Do not use:

- `門市請貨`

Notes:

- 本部負責供應商採購與公司供應商入庫。
- 本部負責處理門市請貨。
- 本部出貨確認後，本部庫存會扣除。

### B. 台南直營店 / `DIRECT_STORE`

Use:

- `門市請貨`
- `門市入庫`
- Orders
- Repairs
- Customers
- Products
- Inventory

Do not use:

- `供應商管理`
- `本部出貨`
- `本部請貨管理`
- `本部月結` generation / confirmation / payment actions
- `本部出貨明細`

Notes:

- 台南需要商品時，使用 `門市請貨`。
- 台南收到本部商品時，使用 `門市入庫`。
- 台南不直接向公司供應商發注。

### C. 加盟店 / `FRANCHISE_STORE`

Use:

- `門市請貨`
- `門市入庫`
- Own store orders
- Own store repairs
- Own store customers
- Own store products
- Own store inventory

Do not use:

- `供應商管理`
- Supplier purchase / receiving / return / settlement
- Headquarters processing menus
- `本部出貨`
- `本部請貨管理`
- `本部月結`
- `本部出貨明細`

Notes:

- Franchise stores follow the same headquarters request and inbound receiving flow as direct stores.
- Supplier workflows are handled by headquarters, not by the franchise store.

### D. 獨立店 / `INDEPENDENT`

Use:

- `供應商管理`
- `發注`
- `入庫`
- `退貨管理`
- `供應商月結報表`
- Excel download
- Own store orders, repairs, customers, products, inventory

Do not use:

- `門市請貨`
- `門市入庫`
- `本部出貨`
- `本部月結`
- `本部出貨明細`

Notes:

- Independent stores do not have a headquarters replenishment flow.
- Independent stores manage supplier purchase, receiving, return, and settlement directly.

## 3. 本部到門市出貨流程

Flow:

`門市請貨 -> 本部請貨管理 -> 本部出貨 -> 門市入庫 -> 本部月結 -> 本部出貨明細 Excel`

### Step 1: 門市請貨

Who:

- 台南直營店 staff
- Franchise store staff

Menu:

- `門市請貨`

Purpose:

- Ask headquarters for products.

Stock impact:

- No stock change.

Notes:

- This is a request only.
- Headquarters still needs to create or ship the transfer.

### Step 2: 本部請貨管理

Who:

- 高雄本部 staff
- Warehouse staff if enabled

Menu:

- `本部請貨管理`

Purpose:

- Review store replenishment requests.
- Create `本部出貨`.
- Optionally create and ship immediately.

Stock impact:

- Creating a transfer only: no stock change.
- Create and ship: headquarters stock decreases.

Notes:

- Store stock does not increase here.
- Store stock increases only after `門市入庫`.

### Step 3: 本部出貨

Who:

- Headquarters / warehouse staff

Menu:

- `本部出貨`

Purpose:

- Ship headquarters stock to a direct store or franchise store.

Stock impact:

- `確認出貨`: headquarters stock decreases immediately.
- Store stock does not increase yet.

Required data:

- From store
- To store
- SKU
- Product name
- Shipping quantity
- Settlement unit cost
- Line amount

### Step 4: 門市入庫

Who:

- Receiving store staff

Menu:

- `門市入庫`

Purpose:

- Confirm actual received quantity.

Stock impact:

- Store stock increases at receive confirmation.

Notes:

- Received quantity cannot exceed shipped quantity.
- If actual received quantity is different, confirm only the real received quantity.

### Step 5: 本部月結

Who:

- Headquarters staff

Menu:

- `本部月結`

Purpose:

- Create receivable settlement based on completed inbound receiving.

Stock impact:

- No stock change.

Policy:

- Monthly settlement follows completed `門市入庫`.
- It is for receivable/payable amount management, not stock movement.

### Step 6: 本部出貨明細 / Excel

Who:

- Headquarters staff

Menu:

- `本部出貨明細`

Purpose:

- Review shipped product details by date, store, SKU, and wholesale price.
- Download Excel for checking and reconciliation.

Stock impact:

- No stock change.

Notes:

- `本部出貨明細` is a report.
- `本部月結` is the settlement workflow.
- Do not confuse report export with monthly settlement confirmation.

## 4. 供應商發注流程

### Independent store

Flow:

`供應商管理 -> 發注 -> 入庫 -> 供應商月結報表`

Who:

- Independent store staff

Menu:

- `供應商管理`

Stock impact:

- Creating purchase order: no stock change.
- Receiving purchase order: store stock increases.

Notes:

- Independent stores use their own store suppliers.
- Supplier purchase, receiving, return, and settlement all happen inside `供應商管理`.

### Headquarters

Flow:

`供應商管理 -> 公司供應商發注 -> 本部入庫 -> 本部出貨`

Who:

- Headquarters / warehouse staff

Menu:

- `供應商管理`

Stock impact:

- Creating purchase order: no stock change.
- Receiving supplier purchase: headquarters stock increases.
- Shipping to store: headquarters stock decreases.

Notes:

- Company suppliers are for headquarters or warehouse receiving.
- Direct stores and franchise stores should not use supplier purchase.

### Chain stores

Policy:

- Direct stores and franchise stores do not use `供應商管理`.
- If a chain store needs products, use `門市請貨`.

Correct flow:

`門市請貨 -> 本部出貨 -> 門市入庫 -> 本部月結`

## 5. 供應商退貨流程

Flow:

`供應商管理 -> 退貨管理 -> 新增退貨單 -> 送出 -> 核准 -> 確認退貨出貨 -> 供應商已收 -> 標記結算`

### Status meaning

- `DRAFT` / `草稿`: return draft created.
- `SUBMITTED` / `已送出`: return request submitted.
- `APPROVED` / `已核准`: return approved, stock still unchanged.
- `SHIPPED` / `已出貨`: returned goods shipped out to supplier, stock decreased.
- `RECEIVED_BY_SUPPLIER` / `供應商已收`: supplier confirmed receipt, no stock change.
- `SETTLED` / `已結算`: return is settled financially, no stock change.
- `CANCELED` / `已取消`: return canceled before stock movement.

### Stock policy

- `新增退貨單`: no stock change.
- `送出`: no stock change.
- `核准`: no stock change.
- `確認退貨出貨`: stock decreases and an `OUT` inventory movement is created.
- `供應商已收`: no stock change.
- `標記結算`: no stock change.

Important:

- A return does not reduce inventory when it is created.
- Inventory is reduced only when `確認退貨出貨` is executed.

## 6. 供應商月結與 Excel

Official formula:

`入庫金額 - 退貨金額 = 淨應付金額`

Meaning:

- `入庫金額`: amount payable to supplier for received purchases.
- `退貨金額`: amount deducted because goods were returned to supplier.
- `淨應付金額`: actual net payable amount.

Included return statuses:

- `SHIPPED`
- `RECEIVED_BY_SUPPLIER`
- `SETTLED`

Excluded return statuses:

- `DRAFT`
- `SUBMITTED`
- `APPROVED`
- `CANCELED`

Excel sheets:

- `供應商月結明細`
- `供應商彙總`

Excel includes:

- Date
- Type: purchase receiving or supplier return
- Document number
- Supplier
- SKU
- Product name
- Quantity
- Unit cost
- Amount
- Signed amount
- Status
- Settlement status
- Note

## 7. Telegram Commands

Telegram supplier commands now use the same modern supplier purchase and supplier return structures as the web system.

### Purchase order

Command:

```text
/po 供應商 SKU 數量 備註
```

Example:

```text
/po KINGWAY ABC-001 3 急用
```

Effect:

- Creates a supplier purchase order.
- Does not change stock.

Important:

- Supplier must be included.
- Old format without supplier does not create an order and only returns an instruction message.

### Purchase receiving

Command:

```text
/receive PO單號 SKU 數量
```

Alternative when there is only one unreceived matching PO:

```text
/receive SKU 數量
```

Effect:

- Creates supplier purchase receipt.
- Increases stock.
- Creates `IN` inventory movement with supplier purchase reference.

### Supplier return

Command:

```text
/return 供應商 SKU 數量 原因
```

Example:

```text
/return KINGWAY ABC-001 1 瑕疵退貨
```

Effect:

- Creates supplier return.
- Does not change stock.

Important:

- Supplier must be included.
- Old format without supplier does not create a return and only returns an instruction message.

### Supplier return shipping

Command:

```text
/return-done 退貨單號 SKU 數量
```

Alternative when there is only one matching pending return:

```text
/return-done SKU 數量
```

Effect:

- Confirms return shipment to supplier.
- Decreases stock.
- Creates `OUT` inventory movement with `SUPPLIER_RETURN` reference.

Important:

- Stock must be sufficient.
- Duplicate return shipment is blocked.

## 8. 常見錯誤

### Mistake: 台南 uses `供應商管理` to purchase

Correct behavior:

- 台南 should use `門市請貨`.
- Headquarters handles supplier purchase and headquarters shipment.

### Mistake: Independent store looks for `門市請貨`

Correct behavior:

- Independent store should use `供應商管理`.
- Independent store has no headquarters replenishment workflow.

### Mistake: Confusing `本部出貨` and `門市入庫`

Correct behavior:

- `本部出貨`: headquarters ships, headquarters stock decreases.
- `門市入庫`: store receives, store stock increases.

### Mistake: Confusing `本部月結` and `本部出貨明細`

Correct behavior:

- `本部月結`: creates and manages receivable/payable settlement.
- `本部出貨明細`: report and Excel export for shipped product details.

### Mistake: Thinking supplier return creation immediately reduces stock

Correct behavior:

- Supplier return creation, submit, and approval do not change stock.
- Stock decreases only at `確認退貨出貨`.

### Mistake: Using old Telegram `/po SKU 數量` or `/return SKU 數量`

Correct behavior:

- Use `/po 供應商 SKU 數量 備註`.
- Use `/return 供應商 SKU 數量 原因`.
- Supplier is required.

## 9. Staff Quick Reference

| Situation | Who | Menu / Command | Action | Stock impact |
| --- | --- | --- | --- | --- |
| 台南向本部請商品 | 台南 staff | `門市請貨` | Create and submit replenishment request | No stock change |
| 本部查看門市請貨 | 高雄本部 staff | `本部請貨管理` | Review request and create transfer | No stock change if only created |
| 本部出貨給台南 | 高雄本部 staff | `本部出貨` or `本部請貨管理` | Confirm shipment | Headquarters stock decreases |
| 台南收到本部商品 | 台南 staff | `門市入庫` | Confirm received quantity | 台南 stock increases |
| 本部做月結 | 高雄本部 staff | `本部月結` | Generate, confirm, mark paid | No stock change |
| 查本部出貨與批發價 | 高雄本部 staff | `本部出貨明細` | Filter and export Excel | No stock change |
| 獨立店向供應商發注 | Independent store staff | `供應商管理` | Create supplier purchase order | No stock change |
| 獨立店供應商入庫 | Independent store staff | `供應商管理` | Receive supplier purchase | Store stock increases |
| 本部向供應商發注 | 高雄本部 staff | `供應商管理` | Create company supplier purchase | No stock change |
| 本部供應商入庫 | 高雄本部 staff | `供應商管理` | Receive supplier purchase | Headquarters stock increases |
| 建立供應商退貨單 | Independent or HQ staff | `供應商管理 -> 退貨管理` | Create return | No stock change |
| 送出/核准供應商退貨 | Independent or HQ staff | `退貨管理` | Submit or approve return | No stock change |
| 確認退貨出貨 | Independent or HQ staff | `退貨管理` | Ship goods back to supplier | Stock decreases |
| 供應商已收 | Independent or HQ staff | `退貨管理` | Mark supplier received | No stock change |
| 標記退貨結算 | Independent or HQ staff | `退貨管理` | Mark return settled | No stock change |
| Telegram supplier PO | Authorized staff | `/po 供應商 SKU 數量 備註` | Create supplier purchase order | No stock change |
| Telegram supplier receiving | Authorized staff | `/receive PO單號 SKU 數量` | Receive purchase | Stock increases |
| Telegram supplier return | Authorized staff | `/return 供應商 SKU 數量 原因` | Create supplier return | No stock change |
| Telegram return shipment | Authorized staff | `/return-done 退貨單號 SKU 數量` | Ship return to supplier | Stock decreases |

## 10. Production Status Summary

The operation flow in this guide is based on these production commits:

- `74614af` - store operation type menu and permission alignment
- `fb6487f` - headquarters transfer detail report
- `bc56d29` - headquarters-only access restrictions
- `cfe7e41` - supplier return backend APIs
- `1017378` - supplier return management UI
- `857cd71` - supplier purchase and return settlement report / Excel
- `583d782` - Telegram `/po` and `/receive` supplier purchase migration
- `66cdc51` - Telegram `/return` and `/return-done` supplier return migration

## 11. Production No-Go Notes

This document is an operation guide only.

- No code change.
- No database schema change.
- No database data change.
- No deployment.
- No MySQL restart.

