# LINE Access Token Dependency Audit - 2026-05-26

## 1. Scope

Read-only audit target requested:

- `backend/src/services`
- `backend/src/routes`
- `backend/src/utils`
- `backend/src/lib`
- `backend/src/jobs`
- `backend/src/workflows`

Observed filesystem note:

- `backend/src/lib` does not exist.
- `backend/src/jobs` does not exist.
- `backend/src/workflows` does not exist.
- There are many `.bak` files under `backend/src/services` and `backend/src/routes`. They were searched, but risk conclusions below focus on current runtime `.js` files unless explicitly stated.

No code, DB, env, webhook, credential, or git changes were made for this audit. This document is the only created artifact.

## 2. Executive Summary

Current runtime LINE messaging still depends on the global process env token:

- `backend/src/config.js:67-72` loads `LINE_CHANNEL_ACCESS_TOKEN` into `config.line.channelAccessToken`.
- `backend/src/utils/line.js:18-41` uses that value for LINE push API.
- `backend/src/services/lineWorkflowService.js:3302-3358` uses that value directly for LINE reply API.
- All route/service callers either pass the imported singleton `config` into `sendLineMessage(config, ...)` or call `replyToLine(...)`, which imports singleton `config` internally.

There is already a store/channel resolver skeleton:

- `backend/src/routes/line.js:30-92` resolves `/api/line/webhook/:webhookPathToken`, verifies a store/channel-specific secret, then returns `signature_verified_noop`.
- `backend/src/utils/publicStoreResolver.js:442-516` reads `store_line_channels.channel_access_token_ref`.
- `backend/src/utils/lineSecretResolver.js:44-115` can resolve `env:*` credential refs.

However, the tokenized webhook route does not process events or send replies. The active event processing route remains the legacy `/api/line/webhook`, which verifies against global `config.line.channelSecret` and replies with global `config.line.channelAccessToken`.

Net result: multi-store inbound resolution is partially present, but outbound LINE messaging is not store-scoped.

## 3. Token Dependency Map

| Area | File / function | LINE send type | Token dependency | Multi-store collision risk | Store-scoped injection candidate |
|---|---|---:|---|---|---|
| Config singleton | `backend/src/config.js:67-72` | N/A | Reads `LINE_CHANNEL_ACCESS_TOKEN` once into singleton config | High, one process-wide token | Replace direct global usage with per-channel credential ref resolution |
| Push helper | `backend/src/utils/line.js:18-41` `sendLineMessage(config, to, messages)` | Push | Uses `config.line.channelAccessToken` for Bearer header | High, all callers usually pass singleton config | Change helper to accept `{ accessToken, to, messages, storeId, lineChannelId }` or an explicit LINE context |
| Reply helper | `backend/src/services/lineWorkflowService.js:3302-3358` `replyToLine(replyToken, messages)` | Reply | Imports singleton `config` internally and uses global token | Critical for tokenized webhook, because reply token must be answered by the same LINE channel | Add optional `lineContext` / `accessToken` parameter and require it for tokenized webhook processing |
| Group notify facade | `lineWorkflowService.js:196-203` `sendToGroups*` | Currently Telegram | Calls `sendInternalTelegram`, not LINE; `resolveGroupTargets` at `164-194` checks global token but is not used by send path | Medium confusion risk, low current LINE token risk | Split naming: internal group notification vs LINE group push, then add explicit channel context if LINE group push returns |
| Webhook legacy route | `backend/src/routes/line.js:94-355` | Reply via workflows | Verifies global secret, then workflow calls use global token | High, all inbound events map to one channel | Legacy route should remain single-store only; tokenized route should pass context through every handler |
| Webhook tokenized route | `backend/src/routes/line.js:30-92` | None currently | Resolves `channelSecretRef`; exposes `channelAccessTokenRef`; no send | Low current send risk; high production gap if enabled for processing without token injection | Use resolved `channelAccessTokenRef` to build `lineContext` before processing events |
| Customer workflow | `lineWorkflowService.js` `handleCustomerMessageEvent`, `handleLinePostback`, `handleLineSlashCommand` | Reply + push | All reply calls use global `replyToLine`; customer pushes use `sendLineMessage(config, ...)` | Critical after tokenized webhook processing | Add context param to top-level handlers and propagate to `replyToLine` / push helper |
| Repair estimate | `lineWorkflowService.js:3829-3835` `sendRepairEstimateQuotation` | Push | Checks global token and sends via `sendLineMessage(config, ...)` | High, customer could receive estimate from wrong OA | Resolve token from repair/order/customer store before sending |
| Google review postback | `lineWorkflowService.js:4374-4383` | Push | Checks global token and sends via `sendLineMessage(config, ...)` | High | Resolve from coupon/customer/store or webhook context |
| Repair reservation service | `backend/src/services/repairReservationService.js:155-170` | Push | Checks global token and sends via singleton config | High | Accept `lineContext` from caller or derive from repair/customer store |
| Telegram to LINE bridge | `backend/src/services/telegramService.js:1691-1695`, `2520-2524`, `2727-2744` | Push | `sendLineOrderStatusUpdate` uses global token | High, cross-channel callback can push to wrong OA | Resolve by order/customer store before bridging Telegram callback to LINE |
| Repair reminders | `backend/src/services/repairReminderService.js:6-63` | Scheduled push | Directly imports singleton config; no token guard before helper call | High for multi-store cron; one store's reminders can go through another store's OA | Query store id and line channel ref with each customer/repair; group sends by access token |
| Daily report | `backend/src/services/reportService.js:114-146` | Telegram only | No LINE access token use | Low | None for LINE token; keep separate from LINE group push |
| Settings status | `backend/src/services/settingsService.js:469-505` | Status display | Reports global token status as LINE connected | Medium, misleading in multi-store mode | Report per-store/channel credential ref status instead |
| Orders route | `backend/src/routes/orders.js:192-223`, `974-991`, `1276-1342` | Push | Purchase confirmation and balance notifications use global token | High | Pass store id from authenticated route to token resolver before sending |
| Repairs route | `backend/src/routes/repairs.js:640-647`, `670-688`, `973-995` | Push | Reservation response, estimate, completion/survey use global token | High | Use repair/customer store id to resolve token; pass into service helpers |
| Coupons route | `backend/src/routes/coupons.js:133-140`, `252-259`, `299-306`, `351-358` | Push | New friend and Google review messages use global token | High | Resolve from customer/store and inject into push helper |
| Purchase confirmations route | `backend/src/routes/purchaseConfirmations.js:963-983` | Push | Manual generated link uses global token | High | Resolve from order/customer store before push |
| Surveys route | `backend/src/routes/surveys.js:123-131` | Push | Survey link push uses global token | High | Resolve from customer/store before push |
| Customers route | `backend/src/routes/customers.js:543-548` | Push | Follow-up LINE message uses global token | High | Resolve from customer/store before push |
| LINE self-order route | `backend/src/routes/lineOrder.js:294-320` | Push | Dynamic require of `../utils/line` and singleton config inside `setImmediate`; no explicit token guard | High | Resolve public store context / LIFF channel context before order create and capture explicit token for async send |
| LINE repair page | `backend/src/routes/lineRepair.js:110-133` | Internal group notify only | Uses `sendToGroupsWithResult`, currently Telegram bridge | Low current LINE token risk | If converted to LINE group push, pass line context explicitly |
| LINE Google review page | `backend/src/routes/lineGoogleReview.js:121-143` | Internal group notify only | Uses `sendToGroupsWithResult`, currently Telegram bridge | Low current LINE token risk | Same as above |
| LINE bind phone page | `backend/src/routes/lineBindPhone.js:21` | No immediate push | Calls coupon issuance workflow only | Medium indirect; later replies still global when webhook flow calls it | Context not needed for this HTTP route unless it sends confirmation |

## 4. Direct LINE API / Bearer Usage

Found direct LINE Messaging API calls:

- `backend/src/utils/line.js:23-28`
  - `POST https://api.line.me/v2/bot/message/push`
  - `Authorization: Bearer ${config.line.channelAccessToken}`
- `backend/src/services/lineWorkflowService.js:3323-3328`
  - `POST https://api.line.me/v2/bot/message/reply`
  - `Authorization: Bearer ${config.line.channelAccessToken}`

No current direct `axios` LINE calls were found in the audited runtime files.

No `@line/bot-sdk`, `messagingApi`, `MessagingApiClient`, `replyMessage`, or `pushMessage` singleton client usage was found in current runtime files. The implementation is custom `fetch` based.

## 5. replyMessage / pushMessage Helper Structure

### Push

`sendLineMessage(config, to, messages)` is a thin helper around LINE push. The token is not internally discovered by recipient or store; it is read from the provided config object. Since all observed runtime callers pass the imported singleton `config`, this behaves as a global token dependency.

Failure behavior:

- If token is blank, helper throws `LINE channel access token is not configured`.
- Some callers pre-check `config.line.channelAccessToken`; some do not.
- `lineOrder.js` and `repairReminderService.js` call the helper without a local token pre-check, relying on helper throw/catch behavior.

### Reply

`replyToLine(replyToken, messages)` is defined inside `lineWorkflowService.js` and imports `config` directly. It has no token parameter and cannot be safely reused for store-specific webhooks without modification.

This is the highest-risk structure for tokenized webhook processing because LINE reply tokens are channel-bound. A reply token received on Store B's channel must not be answered with Store A's global token.

## 6. Telegram to LINE Bridge

The codebase still contains Telegram-centered operational paths. For this audit, the relevant Telegram-to-LINE bridge points are:

- `backend/src/services/telegramService.js:418-441`
  - Telegram repair approval callback calls `notifyRepairCustomer(...)`.
  - `notifyRepairCustomer` uses global LINE token.
- `backend/src/services/telegramService.js:1691-1695`
  - `sendLineOrderStatusUpdate(order, message)` uses global LINE token.
- `backend/src/services/telegramService.js:2520-2524`
  - Support completion callback pushes a customer LINE message through `sendLineOrderStatusUpdate`.
- `backend/src/services/telegramService.js:2727-2744`
  - Telegram CRM status / handover callbacks push LINE order status updates.
- `backend/src/services/telegramService.js:1143-1227`
  - Telegram repair quote flow calls `sendRepairEstimateQuotation(...)`, which pushes LINE estimate messages using global token.

This is a high-risk collision area because the inbound action comes from Telegram, not LINE, so there is no LINE webhook context to infer the right channel. The token must be derived from order/customer/repair store ownership.

## 7. Workflow-Specific Findings

### Repair

Customer-facing LINE sends:

- Reservation approval/rejection:
  - `repairReservationService.notifyRepairCustomer`
  - `repairs.js` web admin reservation respond
  - `lineWorkflowService.handleLinePostback`
  - `telegramService.handleRepairApprovalCallback`
- Estimate sent to customer:
  - `lineWorkflowService.sendRepairEstimateQuotation`
  - reachable from `repairs.js`, `lineWorkflowService` staff wizard, and `telegramService` quote flow.
- Completion / pickup / survey:
  - `repairs.js` complete route pushes pickup + survey link.
  - `repairReminderService` scheduled reminders push day 1 / day 3 reminders.

Risk: high. Repair orders are store-owned operational records, but outbound LINE token currently ignores store.

### Orders / Purchase Confirmation

Customer-facing LINE sends:

- `orders.js` purchase confirmation link after paid EBIKE order.
- `orders.js` collect-balance notification and purchase confirmation trigger.
- `purchaseConfirmations.js` manual link generation.
- `lineWorkflowService.createPurchaseConfirmationForOrder` creates tokens but does not itself send; send happens in route helpers.

Risk: high. A paid order can trigger a customer-facing LINE message through global token.

### Google Review

Customer-facing LINE sends:

- `coupons.js` approve/reject routes.
- `lineWorkflowService.handleLinePostback` approve/reject from internal group.

Internal group notifications currently route through `sendInternalTelegram`, not LINE group push.

Risk: high for customer result notification, medium for internal notification naming confusion.

### Customer Follow-up / CRM

Customer-facing LINE sends:

- `customers.js` follow-up route.

Risk: high. Follow-up is directly customer-facing and should use customer/store channel ownership.

### Scheduler / Cron / Pending Reminders

Cron entrypoints are in `backend/src/app.js`:

- `0 21 * * *` calls `sendDailyReport(config)`; Telegram only.
- `30 13 * * *` calls `sendRepairPickupReminders()`; LINE push to customers.
- `0 1 * * *` updates repair storage fees; no LINE send.
- `0 9 1 * *` sends monthly supplier reports; Telegram/document path.

The LINE-risk cron is `repairReminderService.js`. It queries all completed waiting pickup repairs with line users, with no store/channel token grouping, then pushes with global token.

## 8. Webhook Reply Token Flow

Legacy active webhook:

1. `POST /api/line/webhook`
2. Verifies signature using `config.line.channelSecret`.
3. Iterates events.
4. Dispatches to:
   - `findOrCreateLineCustomer`
   - `handleLinePostback`
   - `handleLineSlashCommand`
   - `handleStaffOperationalCommand`
   - `handleCustomerMessageEvent`
5. Replies via `replyToLine(...)`.
6. `replyToLine(...)` sends `Bearer config.line.channelAccessToken`.

Tokenized resolver-only webhook:

1. `POST /api/line/webhook/:webhookPathToken`
2. Resolves `store_line_channels` row.
3. Resolves and verifies channel secret ref.
4. Returns `signature_verified_noop`.
5. Does not dispatch events.
6. Does not use `channelAccessTokenRef`.

Production implication: tokenized webhook processing must not be enabled by simply copying the legacy dispatch block until all reply/push helpers accept and use the resolved channel access token.

## 9. Multi-Store Collision Risk

Highest collision scenarios:

1. Store B webhook event is processed by legacy `/api/line/webhook`; reply uses Store A/global token.
2. A customer from Store B receives purchase confirmation, repair estimate, coupon result, survey, or reminder via Store A/global OA.
3. Telegram callback updates a Store B order/repair and sends the customer LINE status via the global token.
4. Cron reminders scan all stores and push every customer reminder through one token.
5. Settings page says LINE is connected based on the process-wide token, even if a store-specific channel mapping is absent or broken.

Risk rating:

- Reply token handling: Critical.
- Customer push helpers: High.
- Telegram to LINE bridge: High.
- Cron reminders: High.
- Internal group notification naming: Medium.
- Tokenized resolver-only route as currently implemented: Low send risk, but high production gap.

## 10. Store-Scoped Token Injection Candidates

Primary injection points:

1. `backend/src/utils/line.js`
   - Convert from `sendLineMessage(config, to, messages)` to an explicit token/context helper.
   - Keep a temporary backward-compatible wrapper only during migration.

2. `backend/src/services/lineWorkflowService.js`
   - Change `replyToLine(replyToken, messages)` to accept `{ accessToken, storeId, lineChannelId }`.
   - Change top-level handlers to accept a `lineContext`.
   - Pass context through postback, slash command, customer message, repair wizard, and staff wizard flows.

3. `backend/src/routes/line.js`
   - Tokenized route should resolve both secret and access token refs.
   - Legacy route should be explicitly marked single-store/global until retired.

4. Store-owned route sends
   - `orders.js`, `repairs.js`, `coupons.js`, `purchaseConfirmations.js`, `surveys.js`, `customers.js`.
   - Use authenticated `req.storeId` to resolve store channel token.

5. Non-LINE inbound bridges
   - `telegramService.js` and cron jobs cannot rely on webhook context.
   - Resolve token by order/repair/customer store before each customer push.

6. Async sends
   - `lineOrder.js` captures `responsePayload` and sends in `setImmediate`.
   - It should resolve token before scheduling and close over explicit token/context, not re-import singleton config inside the async block.

## 11. Smallest Safe Refactor Candidate

Smallest behavior-preserving refactor candidate:

1. Add a new explicit low-level helper shape, without changing current callers first:
   - `pushLineMessageWithToken({ accessToken, to, messages })`
   - `replyLineMessageWithToken({ accessToken, replyToken, messages })`
2. Keep current `sendLineMessage(config, ...)` and `replyToLine(...)` as compatibility wrappers that call the explicit helpers with global config.
3. Add audit logging fields to explicit helpers:
   - `storeId`
   - `lineChannelId`
   - `tokenSource`
   - no raw token logging.
4. Migrate one low-risk authenticated push path first, such as `customers.js` follow-up, using `req.storeId`.
5. Only after push paths are proven, migrate tokenized webhook reply path.

Reason this is safest:

- It does not require immediate workflow rewrite.
- It isolates LINE API HTTP behavior in one place.
- It allows old global-token behavior to remain as rollback path during migration.
- It gives tests a clear seam: explicit token in, Bearer header out.

## 12. Production No-Go

Do not do these in production yet:

- Do not process real events on `/api/line/webhook/:webhookPathToken` until reply and push helpers use the resolved access token.
- Do not activate multiple LINE channels while customer-facing sends still use `config.line.channelAccessToken`.
- Do not assume `store_line_channels.channel_access_token_ref` is effective; it is read by resolver but not used for sending.
- Do not rely on global settings status to prove a store-specific LINE channel is ready.
- Do not run multi-store repair reminder cron against all rows without store-scoped token resolution.
- Do not rotate the global token expecting per-store isolation.
- Do not pass client-provided `storeId` from public LINE/LIFF pages as token authority.

## 13. Rollback Complexity

Current audit artifact rollback:

- Trivial: delete this document.
- No runtime behavior changed.

Future refactor rollback complexity:

- Explicit low-level helper added but unused: low.
- Backward-compatible wrappers retained: low.
- Migrating one authenticated push route: low to medium.
- Migrating `replyToLine` and webhook handlers: medium to high because reply token handling is central to LINE UX.
- Migrating Telegram bridge and cron: medium because token source must be derived from persisted store ownership.

## 14. Next Safe Step

Recommended next safe step:

Create a no-behavior-change LINE messaging adapter design/patch that introduces explicit token-based push/reply helpers while preserving existing global-token wrappers. Do not wire tokenized webhook processing yet.

After that:

1. Add tests or a local stub around Bearer token selection.
2. Migrate one authenticated route push path using `req.storeId`.
3. Add a store/channel token resolver that consumes `channel_access_token_ref` through `resolveSecretRef`.
4. Migrate Telegram bridge sends by deriving store from order/repair/customer.
5. Migrate cron reminders by grouping rows by store/channel.
6. Only then enable event processing in tokenized LINE webhook route.
