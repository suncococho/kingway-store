# AGENTS.md v2

## Source of Truth
Always use these files as the primary source of truth, in this order:

1. `docs/KINGWAY_STORE_MASTER_SPEC.md`
2. The user's newest explicit instruction
3. Existing code structure
4. Older temporary patches or assumptions

If there is any conflict, the master spec wins unless the user explicitly overrides it.

---

## Repository Scope
This repository is the independent **KINGWAY 台南 獨立門市管理系統**.

Work only inside this repository.

Do not create a second project for the same system.

Do not touch unless the user explicitly asks:
- `kw-bot`
- old Telegram-based workflows
- unrelated legacy projects
- unrelated repos or containers

---

## Operating Mode
When working in this repo:

- Implement only the requested change
- Do not change the core workflow unless the user explicitly asks
- Do not deploy unless the user explicitly asks
- Prefer minimal, targeted, reversible changes
- If a DB update is risky, do a dry run first
- If text looks corrupted, verify stored bytes before concluding the data is broken

---

## Mandatory Business Rules

### 1. LINE-first architecture
LINE is the center of the business workflow.

Use LINE for:
- customer onboarding
- CRM collection
- coupon issuance flow
- Google review confirmation flow
- repair reservation flow
- repair estimate confirmation
- repair completion notification
- survey flow
- purchase confirmation flow
- staff approval flow
- supplier approval flow

Do not replace these flows with unrelated channels unless the user explicitly asks.

### 2. Visible language must be Taiwan Traditional Chinese
All user-facing text must be zh-TW:
- menus
- buttons
- table headers
- labels
- statuses
- category names
- dashboard text
- customer-facing copy
- LINE messages and approval text

Internal enums or code constants may stay English if needed, but visible UI must be zh-TW.

### 3. Category display rules
If internal categories are:
- `EBIKE`
- `REPAIR`
- `ACCESSORY`
- `OTHER`

Visible labels must be:
- `電動自行車`
- `維修`
- `配件`
- `其他`

Never leave arbitrary English category labels in visible UI.

### 4. Repair order classification rule
If an order contains any repair-category product, treat that order as a repair order.

That means:
- it must appear in `維修管理`
- it must follow repair workflow rules
- it must not be treated as ordinary sales-only flow

### 5. New friend coupon rule
- Amount: `NT$500`
- Trigger: LINE friend add + phone binding
- Usage: EBIKE category only
- One per customer
- No duplicate issuance

### 6. Google review coupon rule
- Amount: `NT$1500`
- Never auto-issue
- Customer notifies completion inside LINE
- Staff verifies review manually
- Staff approval issues the coupon
- Usage: EBIKE category only
- One per customer

### 7. Purchase confirmation rule
For qualified EBIKE purchases:
- after payment completion, send purchase confirmation button by LINE
- customer submits purchase confirmation in LINE flow
- signature is required
- generate PDF
- save PDF under customer management
- staff confirms completion before handover

### 8. Deposit / balance order rule
Deposit orders must clearly track:
- whether it is a reservation order
- deposit amount
- unpaid balance
- final payment status

Purchase confirmation starts only after the order is fully paid.

### 9. Repair reservation / estimate / completion rule
Repair workflow must be:

1. Customer with LINE friend + phone binding submits repair reservation
2. Staff group receives approval/rejection prompt
3. Staff approves or rejects
4. Customer receives result
5. Staff creates repair estimate in repair menu
6. Estimate is sent to customer by LINE
7. Customer confirms/rejects
8. Staff receives result in LINE group
9. Repair starts
10. Staff marks repair complete
11. Customer gets pickup/payment notification
12. Customer gets repair survey button
13. Survey result must be visible inside repair management

### 10. Customer management is CRM-first
Customer view should accumulate:
- name
- phone
- LINE binding
- LINE userId
- CRM stage
- budget
- purchase timing
- usage purpose
- order history
- repair history
- coupon history
- survey history
- purchase confirmation PDF
- follow-up history

### 11. Supplier workflow rule
Purchase order and return requests must support:
- staff creation in web/mobile
- supplier notification through LINE
- supplier approve/reject
- receiving / return confirmation
- status tracking
- monthly supplier settlement

### 12. Staff management rule
System must support:
- attendance
- clock-in / clock-out
- daily checklist
- KPI
- operational completion
- monthly summary

### 13. Notification rule
Major state changes should be able to notify manager/admin LINE group:
- order status changes
- repair status changes
- purchase confirmation completion
- estimate events
- review verification events
- stock / PO / return events
- daily settlement report
- monthly settlement report

---

## UX/UI Rules

### 1. Mobile + desktop
All core workflows must work on both web desktop and mobile.

### 2. Staff-first action design
Staff screens should prioritize:
- `待確認`
- `待處理`
- `今日重點`

Critical actions should be button-first, not buried.

### 3. Customer minimal-input design
Customer pages should:
- reuse bound phone/name whenever possible
- avoid duplicate input
- focus on one clear action at a time
- be simple enough to complete inside LINE

### 4. History-centered customer UI
Each customer page should make it easy to review:
- CRM stage
- orders
- repairs
- coupons
- surveys
- PDFs
- notes

### 5. Product management UX
Product management must support:
- photo upload from computer and mobile
- easy editing
- category assignment
- SKU auto-generation
- stock visibility
- mobile usability

---

## Data Handling Rules

### 1. Conservative customer identity updates
Phone or LINE userId backfills must be conservative.

Never overwrite existing non-null identifiers unless the match is clearly safe.

### 2. Preserve auditability
Imported or migrated data should remain traceable.

### 3. Do not silently merge customers
Do not collapse customers without strong evidence.

### 4. Encoding verification rule
If Chinese text appears as `?`, `??`, or `???`, do not assume placeholder names.
Check actual stored bytes first.

### 5. Repair / order consistency
Repair-classified orders must stay consistent across:
- order list
- repair list
- customer history
- notifications

---

## Implementation Guidance

### 1. Preferred pattern
Prefer:
- mapping layer
- derived flags
- minimal schema extensions
- reversible data migrations
- dry-run reports before risky writes

### 2. Avoid
Avoid:
- arbitrary workflow changes
- English visible UI
- destructive bulk rewrites
- Telegram-based reintroductions
- silent data assumptions

### 3. Commit behavior
Prefer focused commits by topic:
- migration tooling
- auth fix
- UI translation
- repair classification
- customer backfill
- supplier workflow
- KPI / attendance
- settlement reporting

---

## Future Request Handling
The user may give only a short instruction such as:
- `客戶管理 follow-up 按鈕更明顯`
- `Google 評論確認流程簡化`
- `維修管理要更好用`
- `預約單尾款流程整理`
- `商品管理手機版優化`
- `把英文 UI 全部改成繁中`

Use the master spec to infer the full business context.

Ask a follow-up question only when the change is truly ambiguous or risky.

---

## Default Start Prompt
When beginning work in this repo, assume:

- Use `AGENTS.md` and `docs/KINGWAY_STORE_MASTER_SPEC.md` as source of truth
- Implement only the requested change
- Do not change core workflow unless explicitly asked
- Do not touch `kw-bot`
- Do not add Telegram code
- Keep visible UX in Taiwan Traditional Chinese
- Preserve LINE-first operations

---

## Core Feature Release Rules

- Treat `config/core-feature-contract.json`, `config/core-feature-production-baseline.json`, and `config/core-feature-role-snapshot.json` as reviewed release contracts.
- Start every new feature or fix branch from the newest KINGWAY Production release tag, or from its later baseline-only successor commit. Do not build or deploy from an old `main`, a dirty worktree, or a historical release worktree.
- Run `node scripts/check_core_feature_contract.js` before build or deploy. Missing production features, exact routes, menu paths, permission mappings, API mounts, or role entries are release blockers.
- Use a clean release worktree based on the verified current production commit. Never build from the dirty main worktree or copy whole shared files from an older worktree.
- Never copy an entire historical feature file into the current release. Integrate only the required reviewed hunks into the latest file.
- Keep each feature in an atomic commit with its tests. Commit, push, staging deploy, production deploy, and DB migration are separate approval scopes.
- Staging and Production promotion must use the same commit and immutable frontend/backend images. Production requires a timestamped release snapshot, deploy lock, rollback image IDs, and a separate approval.
- After every approved Production deployment, update the Production baseline and create the immutable Production release tag before starting later feature work.
- Never reduce an existing route, menu, API mount, or role permission without naming the exact removal and receiving separate approval.
- Preserve all 54 classified feature families. In particular, keep `/line-order`, `/orders`, and `/admin/line-order-options` separate, and preserve staff incentives and staff scheduling.


### Full production coverage contract

- Keep the version 3 contract bidirectional: manifest entries must exist in source/build, and every source route, menu, permission mapping, backend mount, direct endpoint, and protected workflow must be classified in the contract.
- Preserve alias, detail, print, public, helper/redirect, fallback, conditional, disabled, and legacy entries. Conditional or excluded entries require a documented reason and must not be promoted to completed status by inference.
- Treat new unclassified source entries, missing production baseline entries, missing required asset markers, and role snapshot expansion or reduction as release blockers.
- Review `config/core-feature-contract.json`, `config/core-feature-production-baseline.json`, and `config/core-feature-role-snapshot.json` together. Do not weaken or bypass `scripts/check_core_feature_contract.js` in either preflight.

- Treat role snapshot subjects as explicit identities: staff roles and `storeRole=owner` are different. Never create a virtual `STORE_OWNER` staff role.
- Keep store-menu visibility separate from backend self-service, management read, and management write authorization. Preserve reviewed `knownAuthorizationGaps` until a dedicated security change is approved.
- STAFF menu access is exactly the common eight paths plus employee self-service scheduling and incentives; those menus do not grant management operations.
