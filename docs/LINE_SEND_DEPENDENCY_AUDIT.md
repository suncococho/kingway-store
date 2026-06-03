# LINE Send Dependency Audit

Date: 2026-06-03
Branch: `beta/staging-architecture`

## 1. Purpose

This document audits the current LINE send / reply dependency graph before Phase 4 store-scoped reply / push implementation.

This phase is documentation only.

Do not use this document as approval to:

- modify production config
- modify production `.env`
- change legacy `/api/line/webhook`
- send real LINE messages
- rotate LINE credentials

## 2. Current LINE Send Functions

### 2-1. Direct push helper

Primary push helper:

- `backend/src/utils/line.js`
  - `resolveLineAccessToken(config, options = {})`
  - `sendLineMessage(config, to, messages, options = {})`

Current behavior:

- Push target endpoint: `https://api.line.me/v2/bot/message/push`
- Default token source: `config.line.channelAccessToken`
- Optional override source:
  - `options.channelAccessToken`
  - `options.accessToken`

### 2-2. Direct reply helper

Primary reply helper:

- `backend/src/services/lineWorkflowService.js`
  - `replyToLine(replyToken, messages, options = {})`

Current behavior:

- Reply endpoint: `https://api.line.me/v2/bot/message/reply`
- Token source:
  - `resolveLineAccessToken(config, getScopedLineAccessTokenOptions(options))`
- Effective token priority:
  1. scoped options from `runWithLineAccessTokenOptions(...)`
  2. `options.channelAccessToken`
  3. `options.accessToken`
  4. `config.line.channelAccessToken`

### 2-3. Wrapped push helper inside workflow service

- `backend/src/services/lineWorkflowService.js`
  - local `sendLineMessage(configArg, to, messages, options = {})`

Current behavior:

- This is a thin wrapper over `utils/line.sendLineMessage`
- It exists so workflow code can inject scoped token options via async local storage

### 2-4. Staff LINE group push helper

- `backend/src/services/staffLineNotify.js`
  - `pushTextToLineGroup(lineGroupId, text)`
  - `notifyRepairReservationCreated(payload = {})`

Current behavior:

- Push target endpoint: `https://api.line.me/v2/bot/message/push`
- Token source: hard-coded `config.line.channelAccessToken`
- Does not currently accept store-scoped token injection

### 2-5. Telegram bridge that can push LINE

- `backend/src/services/telegramService.js`
  - `sendLineOrderStatusUpdate(order, message)`

Current behavior:

- Uses `utils/line.sendLineMessage`
- Token source: `config.line.channelAccessToken`

## 3. Current Token Sources

### 3-1. Global legacy source

Global runtime source today:

- `backend/src/config.js`
  - `config.line.channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || ""`
  - `config.line.channelSecret = process.env.LINE_CHANNEL_SECRET || ""`

This is the dominant active source for:

- customer push messages
- staff group LINE push
- webhook reply messages

### 3-2. Existing store-scoped metadata source

Store-scoped metadata already exists in:

- `store_line_settings.channel_access_token_ref`
- `store_line_settings.channel_secret_ref`

Current limitation:

- metadata is stored and masked
- runtime send paths do not yet resolve active push token from `store_line_settings`
- Phase 2 webhook signature verification resolves secret ref only for tokenized webhook route, not for send paths

### 3-3. Existing token override capability

Only one active code path is already structurally ready for scoped injection:

- `backend/src/utils/line.js`
  - `resolveLineAccessToken(config, options)`
- `backend/src/services/lineWorkflowService.js`
  - `runWithLineAccessTokenOptions(...)`
  - `getScopedLineAccessTokenOptions(...)`
  - `replyToLine(...)`
  - wrapped `sendLineMessage(...)`

This means:

- workflow service can accept store-scoped token injection with no behavior change if context wiring is added carefully
- most route files still call `utils/line.sendLineMessage(config, ...)` directly and therefore still use the legacy global token unless explicitly refactored

## 4. Legacy Customer LINE / OA Dependency Structure

Current legacy dependency structure:

1. `POST /api/line/webhook`
2. verify with `config.line.channelSecret`
3. reply with `replyToLine(...)`
4. customer / staff workflow handlers in `lineWorkflowService.js`
5. follow-up pushes to customer OA mostly use `utils/line.sendLineMessage(...)`

Critical legacy characteristics:

- customer-facing LINE behavior is still globally bound to `LINE_CHANNEL_ACCESS_TOKEN`
- webhook reply and customer push are not consistently separated at token resolution level
- many routes guard on `config.line.channelAccessToken` before sending
- this is still a single-OA compatibility architecture for `KINGWAY_TAINAN`

## 5. Staff LINE Group and Customer LINE OA Separation

Current separation is partial, not complete.

### 5-1. Separated at target identity level

- Customer sends use `customer.lineUserId`
- Staff group sends use:
  - `line_group_registrations.line_group_id`
  - `sendToGroups(...)` / `sendToGroupsWithResult(...)`
  - `staffLineNotify.pushTextToLineGroup(...)`

### 5-2. Not separated at token level

Active code still uses the same global token source for both:

- customer OA push
- staff group LINE push
- webhook reply

Implication:

- target routing is separated
- credential routing is still global legacy

## 6. Reply / Push Call Sites

### 6-1. Reply call sites

Legacy webhook entry:

- `backend/src/routes/line.js`
  - imports `replyToLine` from `lineWorkflowService`
  - handles:
    - follow welcome reply
    - staff launcher reply
    - webhook conversational replies

Main reply engine:

- `backend/src/services/lineWorkflowService.js`
  - slash command replies
  - repair reservation wizard replies
  - staff repair estimate wizard replies
  - customer menu / coupon / review / purchase confirm / survey / progress / support replies
  - postback handling replies

### 6-2. Push call sites to customers

Direct route-level pushes:

- `backend/src/routes/lineOrder.js`
  - order received confirmation
- `backend/src/routes/orders.js`
  - `pushPurchaseConfirmationLineMessage(...)`
  - collect-balance / purchase confirmation related sends
- `backend/src/routes/purchaseConfirmations.js`
  - manual purchase confirmation send
- `backend/src/routes/repairs.js`
  - reservation approval / rejection result
  - repair completion + survey link
- `backend/src/routes/coupons.js`
  - new friend coupon issued
  - google review discount applied
  - google review approve / reject
- `backend/src/routes/customers.js`
  - follow-up message send
- `backend/src/routes/surveys.js`
  - survey link send

Service-level pushes:

- `backend/src/services/repairReminderService.js`
  - reminder pushes
- `backend/src/services/repairReservationService.js`
  - customer reservation-related send
- `backend/src/services/telegramService.js`
  - `sendLineOrderStatusUpdate(...)`
- `backend/src/services/lineWorkflowService.js`
  - repair estimate send
  - other customer status pushes from workflow service

### 6-3. Push call sites to staff LINE groups

- `backend/src/services/staffLineNotify.js`
  - repair reservation group push

### 6-4. Additional risk call site

- `backend/src/app.js`
  - `/api/line/push-test-welcome`
  - references `./services/lineClient`

Risk:

- `backend/src/services/lineClient.js` is not present in current tree
- this endpoint is either stale, broken, or depends on a missing file

## 7. Store-scoped Token Injection Needed

### HIGH priority

- `backend/src/services/lineWorkflowService.js`
  - `replyToLine(...)`
  - wrapped `sendLineMessage(...)`
  - any webhook / wizard / postback flows that currently reply or push customers
- `backend/src/routes/line.js`
  - legacy webhook must not change yet
  - new tokenized webhook route will need scoped reply context first

### HIGH priority direct push callers

- `backend/src/routes/orders.js`
- `backend/src/routes/repairs.js`
- `backend/src/routes/purchaseConfirmations.js`
- `backend/src/routes/coupons.js`
- `backend/src/routes/lineOrder.js`

Reason:

- these affect core customer LINE flows
- these currently guard on `config.line.channelAccessToken`

### MEDIUM priority direct push callers

- `backend/src/routes/customers.js`
- `backend/src/routes/surveys.js`
- `backend/src/services/repairReminderService.js`
- `backend/src/services/repairReservationService.js`
- `backend/src/services/telegramService.js`

### MEDIUM priority staff group path

- `backend/src/services/staffLineNotify.js`

Reason:

- this is already logically store-scoped at notification meaning
- but token source is still global legacy

### LOW priority / cleanup

- `backend/src/app.js` `push-test-welcome`
- any stale or broken `lineClient` reference

## 8. Functions and Their Token Source

| Function | File | Current token source | Target kind |
| --- | --- | --- | --- |
| `utils.sendLineMessage` | `backend/src/utils/line.js` | `options.channelAccessToken` or `config.line.channelAccessToken` | Customer / generic push |
| `replyToLine` | `backend/src/services/lineWorkflowService.js` | scoped options or `config.line.channelAccessToken` | Webhook reply |
| `lineWorkflowService.sendLineMessage` | `backend/src/services/lineWorkflowService.js` | wrapper over `utils.sendLineMessage` | Customer push |
| `pushTextToLineGroup` | `backend/src/services/staffLineNotify.js` | `config.line.channelAccessToken` | Staff group push |
| `sendLineOrderStatusUpdate` | `backend/src/services/telegramService.js` | `config.line.channelAccessToken` via `utils.sendLineMessage` | Customer push |
| `pushPurchaseConfirmationLineMessage` | `backend/src/routes/orders.js` | `config.line.channelAccessToken` via `utils.sendLineMessage` | Customer push |

## 9. Legacy Routes That Must Not Be Changed

Do not change behavior in this migration stage:

- `POST /api/line/webhook`

Do not repoint or silently switch its runtime token behavior until the final migration phase.

Also treat these as legacy-sensitive:

- webhook-driven reply flow in `backend/src/routes/line.js`
- customer conversational handlers in `backend/src/services/lineWorkflowService.js`

## 10. Safe Migration Plan

### Phase 4A: no-behavior-change context object

Add a send-context object only.

Rules:

- no token switching yet
- no legacy behavior change
- context should carry:
  - `storeId`
  - `storeCode`
  - `lineChannelId`
  - `channelAccessTokenRef`
  - `channelSecretRef`
  - `source`

Apply first to:

- `lineWorkflowService.replyToLine(...)`
- `lineWorkflowService.sendLineMessage(...)`
- `utils/line.resolveLineAccessToken(...)`

### Phase 4B: store token resolver

Add a runtime resolver:

- resolve store-scoped access token from:
  1. explicit injected context
  2. `store_line_settings.channel_access_token_ref`
  3. `env:SECRET_NAME`

Rules:

- no raw token logs
- no raw token response fields
- fallback to global token only where explicitly allowed

### Phase 4C: new tokenized webhook route only

Enable store-scoped token usage only for:

- `POST /api/line/webhook/:webhookPathToken`

Rules:

- reply path may use store-scoped token only when request store has been resolved and signature-verified
- keep legacy `/api/line/webhook` on global token
- do not switch route-level customer push callers yet

### Phase 4D: legacy `KINGWAY_TAINAN` final switch

Last migration step:

- migrate direct push callers one by one to store-scoped resolver
- switch `KINGWAY_TAINAN` customer push and reply behavior only after:
  - tokenized webhook route is proven
  - reply and push parity is verified
  - fallback behavior is tested

## 11. Test Plan

### 11-1. Static audit checks

- confirm all active `sendLineMessage` callers
- confirm all active `replyToLine` callers
- confirm all direct `fetch("https://api.line.me/...")` sites
- confirm no hidden raw token logs

### 11-2. Resolver tests

- store-scoped token resolves from `env:` ref
- missing store token fails closed on new tokenized route
- legacy route still uses global token

### 11-3. Reply tests

- tokenized webhook route:
  - invalid signature -> `401`
  - valid signature + scoped token -> reply path ready
- legacy route:
  - existing follow / menu / wizard replies unchanged

### 11-4. Push tests

- purchase confirmation push
- repair approval / completion push
- google review push
- coupon push
- survey push
- follow-up push

For each:

- verify target customer still receives message in staging-safe / mock mode
- verify correct store context is chosen
- verify no cross-store token bleed

### 11-5. Staff group tests

- staff group notification uses correct store-scoped token after migration
- customer OA and staff group token selection do not interfere

## 12. Risk Assessment

### HIGH

- `backend/src/services/lineWorkflowService.js`
  - central reply engine for legacy customer and staff LINE flows
  - many hidden reply branches behind webhook commands and postbacks
- `backend/src/routes/line.js`
  - legacy webhook route must remain behavior-stable
- `backend/src/utils/line.js`
  - shared push primitive used by many routes and services

### MEDIUM

- `backend/src/routes/orders.js`
- `backend/src/routes/repairs.js`
- `backend/src/routes/coupons.js`
- `backend/src/routes/purchaseConfirmations.js`
- `backend/src/services/staffLineNotify.js`

Reason:

- these are important but easier to migrate incrementally once resolver/context injection exists

### LOW

- `backend/src/routes/customers.js`
- `backend/src/routes/surveys.js`
- `backend/src/services/repairReminderService.js`
- `backend/src/app.js` test push endpoint

Additional low-level risk:

- `backend/src/app.js` references missing `./services/lineClient`
- this should be audited before any Phase 4 production-like rollout

## 13. Recommended Next Implementation Priority

1. Add no-behavior-change send context plumbing in `lineWorkflowService.js` and `utils/line.js`
2. Add store access token resolver from `store_line_settings.channel_access_token_ref`
3. Use scoped token only on `POST /api/line/webhook/:webhookPathToken`
4. After reply path is stable, migrate direct customer push callers
5. Migrate staff group push last before legacy `KINGWAY_TAINAN` final transition
