# AGENTS.md

## Source of truth
Always use `docs/KINGWAY_STORE_MASTER_SPEC.md` as the primary source of truth.

When there is any ambiguity, follow this priority:
1. `docs/KINGWAY_STORE_MASTER_SPEC.md`
2. The user's newest explicit instruction
3. Existing code structure
4. Older temporary patches or assumptions

---

## Project scope
This repository is the independent **KINGWAY 台南 門市管理系統**.

Work only inside this repository.

Do not create a separate project for the same system.

Do not touch:
- `kw-bot`
- old Telegram-based flows
- unrelated legacy projects unless the user explicitly asks

---

## Core business rules
1. **LINE is the center of the workflow**
   - customer flows
   - staff approvals
   - supplier approvals
   - coupon issuance
   - purchase confirmation
   - repair reservation / estimate / completion
   all should prioritize LINE-based flow.

2. **User-facing language must be Taiwan Traditional Chinese (zh-TW)**
   - menus
   - buttons
   - statuses
   - table headers
   - category labels
   - dashboard text
   - customer-facing copy

3. **Do not use arbitrary English labels in visible UI**
   Internal enum/code values may stay English if needed, but visible UI must be zh-TW.

4. **If an order contains any repair-category product, classify it as a repair order**
   - show it in repair management flow
   - do not treat it as ordinary sales-only flow

5. **New friend coupon**
   - NT$500
   - issued after LINE friend add + phone binding
   - usable only for EBIKE-category purchase
   - no duplicate issuance per customer

6. **Google review coupon**
   - NT$1500
   - never auto-issue
   - customer notifies through LINE
   - staff manually checks review
   - staff approval triggers issuance
   - usable only for EBIKE-category purchase

7. **Purchase confirmation**
   - after qualifying EBIKE purchase completion
   - customer receives LINE button
   - customer fills purchase confirmation in LINE flow
   - signature required
   - PDF must be saved and downloadable in customer management

8. **Deposit / balance orders**
   - must show deposit amount
   - must show unpaid balance
   - must support later final payment completion
   - purchase confirmation flow starts only after final completion

9. **Repair workflow**
   - LINE-bound customer can reserve repair
   - staff approves/rejects through LINE/group flow
   - estimate is sent to customer through LINE
   - customer confirms/rejects through LINE
   - repair completion sends pickup/payment notice
   - repair survey result must be viewable in repair management

10. **Customer management is CRM-first**
   Every customer view should accumulate:
   - LINE binding
   - phone
   - coupon history
   - order history
   - repair history
   - survey history
   - CRM stage
   - follow-up history

11. **Supplier workflow**
   - purchase order and return request go to supplier LINE group/chat
   - supplier can approve/reject
   - receiving/return state changes must be tracked in system

12. **Staff management**
   - attendance
   - shift checklist
   - KPI
   - sales guidance performance
   - daily operational completion
   - monthly summaries

13. **Settlement / reports**
   - daily summary
   - monthly summary
   - sales / expense / profit
   - supplier settlement
   - KPI overview
   - LINE notifications for major status changes

---

## UX/UI rules
1. Mobile and desktop must both work well.
2. Staff should see **what needs action now** first.
3. Keep clicks minimal.
4. Prefer button-based approval/rejection/completion flows.
5. Customer inputs should be minimized; reuse bound phone/name whenever possible.
6. Customer pages should feel simple and guided.
7. Staff pages should emphasize:
   - 待確認
   - 待處理
   - 今日重點
8. Do not bury critical approval tasks deep in menus.

---

## Data handling rules
1. Be conservative with customer phone / LINE backfills.
2. Never overwrite non-null customer identifiers unless the match is clearly proven safe.
3. Preserve auditability for imported/migrated data.
4. Do not silently collapse or merge customers without evidence.
5. If encoding looks broken, verify stored bytes before concluding the data is corrupted.

---

## Implementation rules
1. Prefer minimal, targeted changes.
2. Do not rewrite working flows unless the user asks.
3. Preserve existing business rules while improving UX/UI.
4. When changing user-visible text, make sure the full path is zh-TW consistent.
5. When adding new logic, document the rule clearly in code comments if it affects workflow.
6. Do not deploy unless the user explicitly asks.
7. Do not add Telegram code unless the user explicitly asks to restore it.
8. Before destructive DB updates, do a dry run first whenever practical.

---

## How to respond to future requests
Assume the user may only give a short instruction like:
- “客戶管理 follow-up 按鈕更明顯”
- “修正維修完成後問卷流程”
- “把預約單尾款流程整理好”
- “商品管理手機版更好用”
- “購買確認書按鈕流程簡化”

Use `docs/KINGWAY_STORE_MASTER_SPEC.md` to infer the full context.
Ask follow-up questions only if the requested change is truly ambiguous or risky.

---

## Default operating instruction
When working in this repo, follow this exact assumption:

- Use `docs/KINGWAY_STORE_MASTER_SPEC.md` as source of truth.
- Implement only the requested change.
- Do not change the core workflow unless the user explicitly asks.
- Do not touch `kw-bot`.
- Do not add Telegram code.
- Keep all visible UX in Taiwan Traditional Chinese.
