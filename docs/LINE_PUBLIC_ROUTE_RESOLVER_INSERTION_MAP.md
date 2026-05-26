# LINE Public Route Resolver Insertion Map

## 1. Purpose

This document maps where public store resolution should be inserted for current LINE webhook, LIFF, and public LINE customer flows before moving toward a multi-store LINE architecture.

This is a planning document only.

Do not use this document as approval to:

- modify application code
- modify database schema or data
- change LINE credentials
- change the production LINE webhook URL
- deploy
- stage, commit, or push git changes

Primary source of truth remains:

1. `docs/KINGWAY_STORE_MASTER_SPEC.md`
2. The user's newest explicit instruction
3. Existing code structure
4. Older temporary patches or assumptions

## 2. Current LINE Webhook Flow

Current mounted route:

- `POST /api/line/webhook`
- Router file: `backend/src/routes/line.js`
- Mounted from `backend/src/app.js` through `app.use("/api/line", lineRoutes)`

Current flow:

1. `backend/src/app.js` uses `express.json({ verify })` to capture `req.rawBody`.
2. `backend/src/routes/line.js` reads `x-line-signature`.
3. `backend/src/routes/line.js` verifies the signature using `verifyLineSignature(rawBody, config.line.channelSecret, signature)`.
4. `config.line.channelSecret` comes from one process env value: `LINE_CHANNEL_SECRET`.
5. After signature verification, route processing begins:
   - duplicate claim through `claimLineWebhookEvent(event, req.originalUrl)`
   - `follow` creates or loads customer by `line_user_id`
   - `postback` routes to `handleLinePostback(event)`
   - group `/register` writes `line_group_registrations`
   - staff slash and attendance commands use `staff_users.line_user_id`
   - user text fallback routes to `handleCustomerMessageEvent(event)`
6. LINE reply calls use one global `LINE_CHANNEL_ACCESS_TOKEN`.

Current singleton assumptions:

- One webhook URL.
- One channel secret.
- One channel access token.
- One LINE user namespace.
- One set of registered LINE groups.
- One implicit KINGWAY store context.

## 3. Current LIFF / Public Route List

Backend public LINE/customer routes:

| Route | File | Current store context |
| --- | --- | --- |
| `POST /api/line/webhook` | `backend/src/routes/line.js` | Global LINE config only |
| `POST /api/line/profile-name` | `backend/src/app.js` | None |
| `POST /api/line-bind-phone` | `backend/src/routes/lineBindPhone.js` | None |
| `GET /api/line-order/customer` | `backend/src/routes/lineOrder.js` | None |
| `GET /api/line-order/ebikes` | `backend/src/routes/lineOrder.js` | None |
| `POST /api/line-order/create` | `backend/src/routes/lineOrder.js` | None |
| `GET /api/line-repair/customer` | `backend/src/routes/lineRepair.js` | None |
| `POST /api/line-repair/create` | `backend/src/routes/lineRepair.js` | None |
| `GET /api/line-google-review/customer` | `backend/src/routes/lineGoogleReview.js` | None |
| `POST /api/line-google-review/request` | `backend/src/routes/lineGoogleReview.js` | None |
| `POST /api/line-support/create` | `backend/src/app.js` | None |
| LINE customer message handlers | `backend/src/services/lineWorkflowService.js` | None or partial `storeId` options in limited purchase-confirmation paths |

Frontend LIFF/public pages observed in the current app:

| Page | Role | Current LIFF behavior |
| --- | --- | --- |
| `/line-order` | LINE EBIKE order page | Global `VITE_LIFF_ID` fallback |
| `/line-customer` | LINE customer center | Global `VITE_LIFF_ID` fallback |
| `/repair-reservation` / `/repair-request` | LINE repair reservation | Global `VITE_LIFF_ID` fallback |
| `/coupon-center` | LINE coupon center | Global `VITE_LIFF_ID` fallback |
| `/google-review` | Google review coupon request | Global `VITE_LIFF_ID` fallback |
| `/progress` / `/line-progress` | Customer progress | Global `VITE_LIFF_ID` fallback |
| `/support` | LINE support request | Global `VITE_LIFF_ID` fallback |
| `/purchase-confirm/:token` | Public purchase confirmation | Token-based plus optional LIFF init |

Current LIFF singleton assumption:

- `frontend/.env` and `frontend/.env.production` use one `VITE_LIFF_ID`.
- Several pages also hardcode fallback `2010080463-s7I6a2BG`.
- Backend public write routes do not currently resolve store from LIFF ID.

## 4. Route Resolver Insertion Map

Target rule:

- Public route handlers should call one central resolver before reading or writing store-scoped business data.
- Public body/query `store_id` and `storeId` must not be treated as authority.
- Legacy fallback must be explicit and observable.

| Route | Resolver source | Insert before | First safe behavior |
| --- | --- | --- | --- |
| `POST /api/line/webhook` | Legacy KINGWAY fallback only for current path | Signature verification cannot use resolver unless path token is present | Keep current route behavior, add future audit-only legacy context in a later code phase |
| `POST /api/line/webhook/:webhookPathToken` | `store_line_channels.webhook_path_token` | Signature verification | Staging-only route, resolve channel/store before verifying signature |
| `POST /api/line/profile-name` | LIFF ID or signed context, legacy fallback for old LIFF | `UPDATE customers` | Resolve store, then update by `(store_id, line_user_id)` |
| `POST /api/line-bind-phone` | LIFF ID or signed context, legacy fallback for old LIFF | `bindPhoneAndIssueNewFriendCoupon` | Pass resolved store into binding service |
| `GET /api/line-order/customer` | LIFF ID or signed context, legacy fallback | Customer lookup/create | Lookup/create by `(store_id, line_user_id)` |
| `GET /api/line-order/ebikes` | LIFF ID, slug, hostname, or legacy fallback | Product query | Filter active products by resolved `store_id` |
| `POST /api/line-order/create` | LIFF ID or signed context, legacy fallback | Customer lookup, product lookup, coupon/order insert | Write customer, coupon, order, order_items with resolved `store_id` |
| `GET /api/line-repair/customer` | LIFF ID or signed context, legacy fallback | Customer lookup | Lookup by `(store_id, line_user_id)` |
| `POST /api/line-repair/create` | LIFF ID or signed context, legacy fallback | `line_chat_sessions` upsert and repair creation | Store-scope session and repair rows |
| `GET /api/line-google-review/customer` | LIFF ID or signed context, legacy fallback | Customer lookup | Lookup by `(store_id, line_user_id)` |
| `POST /api/line-google-review/request` | LIFF ID or signed context, legacy fallback | Customer/order/coupon lookup and coupon insert | Store-scope review coupon workflow |
| `POST /api/line-support/create` | LIFF ID, signed context, slug, hostname, or legacy fallback | Telegram/internal notification | Route support notification by resolved store |
| LINE message handling in `lineWorkflowService.js` | Webhook channel context | All customer/staff lookup and write calls | Thread resolved store/channel context through handlers |

## 5. `/api/line/webhook` Legacy Strategy

Keep the current production webhook path unchanged during the transition:

- Keep `POST /api/line/webhook` for current KINGWAY 台南 LINE channel.
- Continue using current global `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN` only for this legacy path until tokenized routing is proven in staging.
- Treat this route as explicit legacy compatibility, not as a generic multi-store webhook.
- Future code should mark resolver context as:
  - `source: "legacy_kingway_fallback"`
  - `storeId: 1` only from central resolver configuration
  - `legacyFallbackUsed: true`
  - `lineChannelId` if an approved mapping exists
- Do not add route-local `const storeId = 1`.
- Do not silently attach unresolved webhook traffic to KINGWAY once a second active store exists.

Removal condition:

- Before multi-store production rollout, fallback usage must be monitored and reduced to known legacy-only traffic.

## 6. Staging-only Tokenized Webhook Candidate

Candidate route:

```text
POST /api/line/webhook/:webhookPathToken
```

Expected flow:

1. Extract `webhookPathToken` from route params.
2. Resolve active `store_line_channels` by `webhook_path_token`.
3. Confirm linked `stores.status = 'active'`.
4. Load the channel secret from `channel_secret_ref`.
5. Verify `x-line-signature` against the raw request body with that store/channel secret.
6. Attach public store context to request or an explicit handler context.
7. Process events with store-scoped customer, session, group, and workflow logic.
8. Use the resolved channel access token reference for reply and push calls.
9. Log webhook duplicate claims with `store_id` and `line_channel_id`.

This route should be introduced in staging only and should not require changing the current production webhook URL.

## 7. Why Channel / Store Must Be Identified Before Signature Verification

LINE webhook signature verification depends on the channel secret.

In a multi-store model:

- Each store can own a different LINE Official Account.
- Each Official Account has a different Messaging API channel secret.
- The backend cannot verify the signature correctly until it knows which channel secret to use.
- Using one global secret means only one channel can be safely verified.
- Brute-forcing all active store secrets is not recommended for production unless a separate design adds strict rate limits, monitoring, and abuse controls.

Therefore the route must identify the candidate channel before verification. The safest candidate identifier is an unguessable webhook path token mapped through `store_line_channels`.

## 8. `line_user_id` Lookup Changes Needed

Current risky pattern:

```sql
WHERE line_user_id = ?
```

Target pattern:

```sql
WHERE store_id = ?
  AND line_user_id = ?
```

Primary insertion targets:

| Area | Current purpose | Required change |
| --- | --- | --- |
| `lineOrder.js` customer load/create | LINE order page customer identity | Use resolved store and create customer under store |
| `lineOrder.js` order history | Customer order/repair history | Scope customer, orders, repairs by store |
| `lineOrder.js` order create | Customer, coupon, product, order, order_items writes | Scope all reads/writes by store |
| `lineRepair.js` customer load | Repair reservation customer identity | Scope by store |
| `lineRepair.js` create | Session write and repair creation | Scope session and repair rows |
| `lineGoogleReview.js` customer/request | Review coupon request | Scope customer, order, coupon by store |
| `lineBindPhone.js` phone binding | Bind phone and issue coupon | Scope match by store and avoid cross-store phone merge |
| `lineWorkflowService.findOrCreateLineCustomer` | Webhook follow and fallback customer create | Scope by store |
| `lineWorkflowService.bindPhoneAndIssueNewFriendCoupon` | Phone binding and coupon issuance | Scope by store |
| `lineWorkflowService.getStaffUserByLineUserId` | Staff command auth | Scope staff lookup by store or store membership |
| `lineWorkflowService.findCustomerIdByLineUserId` | Customer message workflows | Scope by store |
| `lineWorkflowService.buildCustomerOrderStatusMessages` | Customer order status | Scope by store |
| `lineWorkflowService.buildCustomerBalanceMessages` | Balance lookup | Scope by store |
| `lineWorkflowService.findPendingRepairEstimateByLineUserId` | Repair estimate confirmation | Scope by store |
| `lineWorkflowService.handleLinePostback` | Staff/customer postback actions | Resolve action target store and compare to channel context |

Important data rule:

- Do not silently merge customers across stores by phone or LINE user ID.
- Existing KINGWAY data can remain under explicit legacy fallback during migration.

## 9. `line_chat_sessions` Store Scope Need

Current session identity is effectively:

```text
line_user_id + flow_type
```

This is not enough for multi-store because:

- The same LINE user could interact with more than one store.
- A repair reservation session in one store could overwrite another store's session.
- Staff repair estimate flows also use LINE user session state.
- Duplicate key behavior can hide cross-store collisions.

Target identity should include store context:

```text
store_id + line_channel_id + line_user_id + flow_type
```

Minimal first step:

- Add resolver context to the service call boundary first.
- Update session read/write/delete logic only after schema and rollback are approved.

## 10. `line_group_registrations` Store Scope Need

Current group registration stores:

- `line_group_id`
- `source_type`
- `registration_type`
- `group_name`
- `registered_by_line_user_id`
- `is_active`

It does not store public store context in active route usage.

Why store scope is required:

- Different stores need different admin/staff/repair/inventory/daily groups.
- A group registered through one LINE channel must not receive another store's notifications.
- Group registration should be tied to the resolved webhook channel/store.
- Notification target lookup should include `store_id`.

Target lookup:

```sql
WHERE store_id = ?
  AND is_active = 1
  AND registration_type IN (...)
```

The `/register` command should only register a group under the store resolved from the webhook channel.

## 11. Telegram Routing Store Scope Need

Current LINE-related notifications still route through Telegram in several paths.

Observed risks:

- `lineOrder.js` sends LINE order notification to a hardcoded Telegram chat id.
- `lineWorkflowService.sendToGroups` and `sendToGroupsWithResult` currently call `sendInternalTelegram`.
- `telegramService.resolveInternalRoute` selects env-configured groups and sometimes uses message text heuristics.
- Telegram allow lists and managed groups are global env values.

Multi-store requirement:

- Notification targets must be store-scoped.
- LINE group routing and Telegram routing should not share a global "admin/staff/repair" namespace.
- If Telegram remains during transition, it needs a store notification target mapping similar to LINE group registrations.

Recommended direction:

- Keep Telegram as legacy/internal compatibility for KINGWAY only.
- Do not connect new stores to Telegram routing until store-scoped notification target mapping exists.
- Prefer LINE-first group notification mapping for future store workflows, consistent with master spec.

## 12. `publicStoreResolver` and `store_line_channels` Connection Point

Existing planning and utility pieces already align:

- `docs/PUBLIC_STORE_RESOLVER_PLAN.md` recommends webhook path token before signature verification.
- `docs/STORE_PUBLIC_IDENTITY_MAPPING_SCHEMA_PLAN.md` defines `store_line_channels`.
- `backend/migrations/staging/2026-05-25_create_store_public_identity_mapping.sql` drafts the staging table.
- `backend/src/utils/publicStoreResolver.js` already contains LINE channel path token resolution behavior.

Target runtime connection:

```text
line webhook route
  -> extract webhookPathToken
  -> publicStoreResolver.resolveByLineChannel
  -> load secret from channel_secret_ref
  -> verify signature
  -> use channel_access_token_ref for reply/push
  -> pass store context into workflow handlers
```

The current gap is route wiring and credential reference resolution. The resolver can identify the row, but current LINE webhook handling still uses global `config.line`.

## 13. Smallest First Implementation Candidate

Smallest safe implementation candidate for a later code phase:

1. Add staging-only `POST /api/line/webhook/:webhookPathToken`.
2. Resolve `store_line_channels` by path token.
3. Verify signature with the resolved channel secret reference.
4. Do not process business events yet, or process only a no-op audit response in the first smoke test.
5. Log resolver result and signature result without storing secrets.
6. Keep production `/api/line/webhook` unchanged.

Second candidate after smoke test:

1. Thread resolved context into `claimLineWebhookEvent`.
2. Store `store_id` and `line_channel_id` in webhook event audit rows after schema approval.
3. Add reply helper that accepts resolved channel context.
4. Test only a low-risk event path in staging.

Do not start with order, repair, coupon, or phone binding writes. Those require store-scoped data changes first.

## 14. Production No-go Conditions

Do not enable production multi-store LINE routing if any condition is true:

- `store_line_channels` is missing, unseeded, or contains duplicate active `channel_id` or `webhook_path_token` values.
- A webhook path token is predictable, shared, or exposed in public docs/logs.
- LINE channel credential references are missing or point to raw secrets in the database.
- Webhook signature verification still uses global `LINE_CHANNEL_SECRET` for tokenized multi-store routes.
- Reply/push still uses global `LINE_CHANNEL_ACCESS_TOKEN` for tokenized multi-store routes.
- Public write routes still create or update customer, coupon, order, repair, survey, or purchase-confirmation data without resolved store context.
- `line_user_id` lookups remain unscoped in customer-facing writes.
- `line_chat_sessions` remains unscoped for multi-store flows.
- `line_group_registrations` remains unscoped for multi-store group notifications.
- Telegram routing remains global for stores beyond legacy KINGWAY.
- Legacy fallback is not centrally controlled and observable.
- Public body/query `store_id` is trusted as authority.
- Staging smoke tests and rollback rehearsal have not been completed.

## 15. Rollback Strategy

Schema rollback:

- Prefer marking mapping rows `INACTIVE` over deleting them.
- Do not drop mapping tables while runtime code may still reference them.
- Keep audit rows for traceability.

Runtime rollback:

- Disable tokenized webhook route usage by removing it from LINE Developer Console staging settings.
- Keep production `/api/line/webhook` unchanged during staging tests.
- Revert route wiring to legacy KINGWAY fallback only if resolver wiring causes staging failures.
- Do not reintroduce scattered route-level `store_id = 1` fallbacks.

Credential rollback:

- Do not rotate or change credentials as part of resolver rollback unless a credential leak is confirmed.
- If a bad credential reference is configured, mark the mapping inactive and correct the reference through the approved secret-management process.

Operational rollback:

- Confirm LINE webhook delivery returns to the previous known-good endpoint.
- Confirm no public write route is accepting unresolved new-store traffic.
- Confirm legacy KINGWAY LINE friend, repair reservation, order, review, and notification flows still work before advancing phases.

