# LINE Multi-Store Resolver Plan

## 1. Purpose

This document defines a design plan for resolving `store_id` in LINE public routes before KINGWAY expands from the current single operating store to a multi-store model.

This is a design document only.

Do not use this document as approval to:

- modify code
- modify production DB
- change LINE route behavior
- deploy to production
- add hardcoded `store_id = 1` fallbacks

Primary references:

- `docs/KINGWAY_STORE_MASTER_SPEC.md`
- `docs/STORE_ID_API_SCOPE_STRATEGY.md`
- `docs/TENANT_STORE_SCHEMA_DRAFT.md`
- `docs/STORE_PERMISSION_MODEL_DESIGN.md`
- `docs/STORE_ID_IMPLEMENTATION_SEQUENCE.md`

## 2. Current LINE Public Route List

Current public LINE and LINE-adjacent routes are mounted before authenticated business route middleware or expose public token/customer flows.

### 2-1. Backend public LINE routes

| Route | Source file | Current role | Current store context |
|---|---|---|---|
| `POST /api/line/webhook` | `backend/src/routes/line.js` | LINE Messaging API webhook | none; verifies global `config.line.channelSecret` |
| `POST /api/line/push-test-welcome` | `backend/src/app.js` | sends test welcome message by phone | none |
| `POST /api/line/profile-name` | `backend/src/app.js` | updates customer display name from LIFF/profile data | none |
| `POST /api/line-bind-phone/` | `backend/src/routes/lineBindPhone.js` | binds LINE userId and phone; issues new-friend coupon | none |
| `GET /api/line-order/customer` | `backend/src/routes/lineOrder.js` | gets or creates LINE customer by `lineUserId` | none |
| `GET /api/line-order/ebikes` | `backend/src/routes/lineOrder.js` | lists active EBIKE products for LINE order page | none |
| `POST /api/line-order/create` | `backend/src/routes/lineOrder.js` | creates LINE reservation/order | none |
| `GET /api/line-repair/customer` | `backend/src/routes/lineRepair.js` | gets customer for repair reservation page | none |
| `POST /api/line-repair/create` | `backend/src/routes/lineRepair.js` | creates repair reservation through LINE page | none |
| `GET /api/line-google-review/customer` | `backend/src/routes/lineGoogleReview.js` | gets customer for Google review page | none |
| `POST /api/line-google-review/request` | `backend/src/routes/lineGoogleReview.js` | creates pending Google review coupon request | none |
| `POST /api/purchase-confirmations/line/latest-order` | `backend/src/routes/purchaseConfirmations.js` | resolves latest order and returns purchase-confirmation URL for LINE user | none |
| `GET /api/purchase-confirmations/public/:token` | `backend/src/routes/purchaseConfirmations.js` | public purchase confirmation load | token-based only |
| `POST /api/purchase-confirmations/public/:token` | `backend/src/routes/purchaseConfirmations.js` | public purchase confirmation submit | token-based only |
| `GET /api/purchase-confirmations/public/:token/pdf` | `backend/src/routes/purchaseConfirmations.js` | public purchase confirmation PDF | token-based only |
| `POST /api/purchase-confirmations/manual` | `backend/src/routes/purchaseConfirmations.js` | public/manual purchase confirmation submit | phone/order matching only |
| `GET /api/purchase-confirmations/manual/:id/pdf` | `backend/src/routes/purchaseConfirmations.js` | manual confirmation PDF | id-based only |
| `POST /api/line-support/create` | `backend/src/app.js` | LINE support request handoff | none |

Admin LINE routes under `backend/src/routes/line.js` such as `GET /api/line/groups`, `POST /api/line/daily-report/send`, and `POST /api/line/pending-summary/send` are authenticated, but they still depend on globally configured LINE delivery behavior.

### 2-2. Frontend public LINE entry routes

| Route | Source file | Current role |
|---|---|---|
| `/line-order` | `frontend/src/App.jsx` | LINE EBIKE order page |
| `/line-customer` | `frontend/src/App.jsx` | LINE customer center |
| `/repair-reservation` | `frontend/src/App.jsx` | LINE repair reservation page |
| `/repair-request` | `frontend/src/App.jsx` | alias for repair reservation |
| `/coupon-center` | `frontend/src/App.jsx` | LINE coupon center |
| `/google-review` | `frontend/src/App.jsx` | Google review coupon request page |
| `/progress` | `frontend/src/App.jsx` | progress lookup |
| `/line-progress` | `frontend/src/App.jsx` | progress lookup alias |
| `/store-info` | `frontend/src/App.jsx` | LINE store info entry page |
| `/support` | `frontend/src/App.jsx` | support request page |
| `/purchase-confirm/:token` | `frontend/src/App.jsx` | public purchase confirmation page |
| `/purchase-confirm/manual` | `frontend/src/App.jsx` | public manual purchase confirmation page |
| `/surveys/:token` | `frontend/src/App.jsx` | public survey page |

## 3. Current Single-Store Assumption Locations

The current code still assumes a single effective LINE store in these areas.

### 3-1. Global LINE configuration

`backend/src/config.js` has one `line` config block:

- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `LINE_UNIFIED_QA_GROUP_MODE`
- `LINE_QA_GROUP_ID`

Because the webhook verifier and delivery utilities use this global config, a request is implicitly treated as belonging to the single configured store.

### 3-2. Webhook route and signature verification

`POST /api/line/webhook` uses:

- one route path
- one `config.line.channelSecret`
- one channel access token for replies/pushes

The signature currently proves that the request came from the configured LINE channel. It does not identify which store should own the event when multiple LINE channels exist.

### 3-3. Public routes bypass authenticated store context

The public LINE routes are intentionally unauthenticated because they are used by LINE webhook, LIFF pages, public purchase-confirm links, and customer forms. Therefore they do not pass through `authenticate()` or `requireStoreScope()`.

Authenticated routes derive:

- `req.user` from JWT
- `req.storeId` from `req.user.storeId`
- `req.store_id` from `req.storeId`

Public LINE routes do not have those values.

### 3-4. Customer identity queries use global LINE identifiers

Several public routes and service functions lookup or create customers with only:

- `line_user_id`
- phone number
- public token

Examples:

- `findOrCreateLineCustomer(lineUserId)`
- `bindPhoneAndIssueNewFriendCoupon(lineUserId, phone)`
- `GET /api/line-order/customer`
- `GET /api/line-repair/customer`
- `GET /api/line-google-review/customer`
- `POST /api/purchase-confirmations/line/latest-order`

These flows must become store-scoped before two stores can share a codebase safely.

### 3-5. LINE operational state tables are global

The current design uses LINE state tables without store context:

- `line_chat_sessions`
- `line_webhook_events`
- `line_group_registrations`

That means sessions, duplicate webhook claims, and group routing are not yet store-isolated.

### 3-6. Frontend public paths do not carry store context

Public pages such as `/line-order`, `/repair-reservation`, `/coupon-center`, and `/google-review` currently rely on LIFF/user data and global API routes. The URL itself does not identify the target store.

### 3-7. Single frontend base URL

`config.frontendBaseUrl` resolves to one production base URL (`https://pos.kingway.tw`) unless overridden. Generated LINE links therefore point to one host without store identity.

## 4. Why `req.storeId` Is Missing in LINE Public Routes

`req.storeId` is missing by design because current public LINE routes do not use staff login.

Current authenticated store context flow:

1. Staff logs in.
2. JWT contains `storeId`.
3. `authenticate()` decodes JWT.
4. middleware sets `req.storeId` and `req.store_id`.
5. `requireStoreScope()` rejects missing store context.

Current LINE public flow:

1. Customer opens LIFF/public URL or LINE sends webhook.
2. Request has no staff JWT.
3. Route does not call `authenticate()`.
4. No middleware derives `req.storeId`.
5. Route code can only see request URL, headers, body, LINE userId, LIFF data, or token.

This means public LINE routes need a separate resolver, not staff auth middleware reuse.

## 5. Why Hardcoding `store_id = 1` Is Forbidden

Hardcoding `store_id = 1` in LINE public routes is not acceptable.

Reasons:

- It hides missing resolver logic and makes tests pass for the current store while failing silently for future stores.
- It creates cross-store data leakage risk once another store is added.
- It can bind a customer's LINE userId or phone to the wrong store.
- It can issue duplicate or wrong-store coupons.
- It can route repair reservations, approval prompts, purchase confirmations, and survey results to the wrong staff group.
- It breaks staging and restore rehearsal assumptions where seed ids may not match production.
- It makes rollback difficult because writes look valid at the row level but belong to the wrong store.
- It conflicts with `STORE_ID_API_SCOPE_STRATEGY.md`, which requires request-level store scope.

Allowed transitional behavior is only an explicit, observable legacy fallback that resolves to the existing KINGWAY 台南 store after all higher-confidence methods fail and only while the system is still in single-store compatibility mode.

## 6. Recommended Schema Draft

This section is a schema draft, not executable migration approval.

### 6-1. `stores`

Use the existing store draft as the base, with LINE resolver-friendly fields kept either in `stores` or store settings.

```sql
CREATE TABLE stores (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NULL,
  name VARCHAR(150) NOT NULL,
  region VARCHAR(100) NULL,
  address VARCHAR(255) NULL,
  phone VARCHAR(40) NULL,
  timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Taipei',
  locale VARCHAR(20) NOT NULL DEFAULT 'zh-TW',
  currency VARCHAR(10) NOT NULL DEFAULT 'TWD',
  status ENUM('ACTIVE', 'INACTIVE', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_stores_tenant_code (tenant_id, code),
  UNIQUE KEY uk_stores_slug (slug),
  INDEX idx_stores_tenant_status (tenant_id, status)
);
```

Notes:

- `slug` is useful for public URLs such as `/s/kingway-tainan/line-order`.
- Do not rely on numeric ids in public URLs.
- Existing KINGWAY 台南 remains the legacy/default store during compatibility mode.

### 6-2. `store_line_channels`

Each LINE Official Account / Messaging API channel should map to exactly one active store.

```sql
CREATE TABLE store_line_channels (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  channel_id VARCHAR(120) NULL,
  channel_name VARCHAR(150) NULL,
  channel_secret_ref VARCHAR(255) NOT NULL,
  channel_access_token_ref VARCHAR(255) NOT NULL,
  webhook_path_token VARCHAR(160) NULL,
  webhook_path VARCHAR(255) NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('ACTIVE', 'INACTIVE', 'ROTATING') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_line_channels_channel_id (channel_id),
  UNIQUE KEY uk_store_line_channels_path_token (webhook_path_token),
  INDEX idx_store_line_channels_store_status (store_id, status)
);
```

Notes:

- Store secrets should be referenced through secret names/refs, not stored as plain text if an external secret manager is available.
- `webhook_path_token` enables store-specific webhook paths without exposing numeric store ids.
- `is_default` is only for controlled legacy compatibility, not general resolver behavior.

### 6-3. `store_liff_apps`

LIFF IDs should be mapped to stores because LIFF pages can be opened without staff auth.

```sql
CREATE TABLE store_liff_apps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  liff_id VARCHAR(120) NOT NULL,
  liff_name VARCHAR(150) NULL,
  route_scope ENUM('CUSTOMER', 'ORDER', 'REPAIR', 'COUPON', 'REVIEW', 'PURCHASE_CONFIRM', 'SURVEY', 'SUPPORT', 'GENERAL') NOT NULL DEFAULT 'GENERAL',
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_liff_apps_liff_id (liff_id),
  INDEX idx_store_liff_apps_store_scope (store_id, route_scope)
);
```

Notes:

- A route may accept a `liffId` or LIFF context payload and resolve store from this table.
- If one LIFF app serves multiple stores, it must carry a signed store context token instead.

### 6-4. Future `store_id` columns for LINE state tables

Add nullable columns first, then backfill and enforce after resolver rollout.

```sql
ALTER TABLE line_chat_sessions
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_line_chat_sessions_store_user_flow (store_id, line_user_id, flow_type);
```

```sql
ALTER TABLE line_webhook_events
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_line_webhook_events_store_event (store_id, event_key),
  ADD INDEX idx_line_webhook_events_store_created (store_id, created_at);
```

```sql
ALTER TABLE line_group_registrations
  ADD COLUMN store_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_line_group_registrations_store_type (store_id, registration_type, is_active);
```

Future unique key direction:

- `line_chat_sessions`: unique/session identity should include `store_id`, `line_user_id`, and `flow_type`.
- `line_webhook_events`: duplicate claim should be scoped by channel/store plus event key.
- `line_group_registrations`: group registration should be scoped by `store_id` and LINE group/room id.

Do not convert to `NOT NULL` until:

- resolver is implemented
- existing rows are backfilled
- duplicate checks pass
- rollback plan exists

## 7. Resolver Strategy

The resolver should produce a consistent internal context object:

```js
{
  storeId,
  tenantId,
  source,
  confidence,
  lineChannelId,
  liffId,
  slug,
  legacyFallbackUsed
}
```

Public route handlers should not read arbitrary `req.body.storeId` or `req.query.storeId` directly. They should use the resolver result.

### 7-1. Webhook token/path resolver

Recommended for `POST /api/line/webhook`.

Preferred future route patterns:

- `POST /api/line/webhook/:webhookPathToken`
- `POST /api/stores/:storeSlug/line/webhook`

Flow:

1. Extract path token or slug from URL.
2. Find active `store_line_channels` mapping.
3. Load that store's channel secret.
4. Verify `x-line-signature` with that store's secret.
5. Attach resolved store context to request.
6. Write `store_id` into `line_webhook_events`.
7. Use that store's channel access token for reply/push.

If the signature fails for the resolved channel, reject the request. Do not try every store secret in production unless explicitly designed and rate-limited.

### 7-2. LIFF ID resolver

Recommended for customer-opened LIFF/public pages.

Flow:

1. Frontend obtains LIFF ID from environment or route config.
2. Public API request includes `liffId` or a server-issued LIFF context token.
3. Backend resolves `liffId` through `store_liff_apps`.
4. Route uses resolved `storeId`.

Use cases:

- `/line-order`
- `/repair-reservation`
- `/coupon-center`
- `/google-review`
- `/support`
- `/line-progress`

LIFF ID resolution is stronger than hostname alone because one host can serve many stores.

### 7-3. Store slug / hostname resolver

Recommended for readable public URLs and multi-store frontend routing.

Possible URL patterns:

- `/s/:storeSlug/line-order`
- `/s/:storeSlug/repair-reservation`
- `https://tainan.pos.kingway.tw/line-order`
- `https://{storeSlug}.pos.kingway.tw/line-order`

Flow:

1. Extract `storeSlug` from route or hostname.
2. Match active store by `stores.slug` or configured hostname mapping.
3. Continue only if store is active.
4. For sensitive write actions, combine with LIFF ID or signed store token.

Hostname/slug is convenient but should be treated as medium confidence unless paired with a signed token or LIFF mapping.

### 7-4. Signed store context token

Recommended for links generated by backend.

Token payload:

```json
{
  "storeId": 1,
  "tenantId": 1,
  "purpose": "purchase_confirm",
  "refType": "order",
  "refId": 123,
  "lineUserId": "U...",
  "iat": 1760000000,
  "exp": 1760604800
}
```

Rules:

- sign with server secret
- include short expiry
- bind to purpose
- bind to reference id when applicable
- never trust unsigned `storeId`

Use cases:

- purchase confirmation links
- survey links
- repair estimate confirmation links
- coupon approval/redeem links
- staff approval buttons generated from LINE notifications

### 7-5. Legacy fallback

Legacy fallback is allowed only for current single-store continuity.

Rules:

- fallback maps to the existing KINGWAY 台南 store only
- fallback must be centrally implemented, not scattered across route handlers
- fallback must log `legacyFallbackUsed: true`
- fallback must be disabled for new store routes/channels
- fallback must be removed before true multi-store production rollout

Allowed fallback examples:

- old `/api/line/webhook` path with the current single LINE channel
- old `/line-order` link without slug while only KINGWAY 台南 is live
- old purchase confirmation tokens that predate store-aware token metadata

Not allowed:

- route-level `const storeId = 1`
- SQL-level `COALESCE(store_id, 1)` for new writes
- accepting `storeId` from public request body without verification

## 8. Backward Compatibility for Existing Operating Store

Existing KINGWAY 台南 operations must keep working during migration.

Compatibility strategy:

1. Create or confirm a canonical KINGWAY 台南 store record.
2. Mark current LINE channel as the default legacy channel for that store.
3. Keep existing public URLs active:
   - `/line-order`
   - `/repair-reservation`
   - `/coupon-center`
   - `/google-review`
   - `/purchase-confirm/:token`
   - `/surveys/:token`
4. Resolve those old URLs through legacy fallback only while there is exactly one active LINE public store.
5. New generated links should include store context as soon as the resolver exists.
6. Existing tokens should continue to work through token lookup, then infer store from linked order/customer/confirmation when possible.
7. Existing `line_group_registrations` should be backfilled to KINGWAY 台南 after dry-run counts.
8. Existing `line_chat_sessions` and `line_webhook_events` should be backfilled only after confirming they belong to the current LINE channel.

Important: backward compatibility must preserve LINE-first workflows and visible Taiwan Traditional Chinese UX.

## 9. Incremental Migration Phases

### Phase 0: Documentation and route inventory

- Keep this document as design only.
- Confirm current public route list.
- Confirm current single-store assumptions.
- No code or DB change.

### Phase 1: Schema dry-run design

- Draft `store_line_channels`.
- Draft `store_liff_apps`.
- Draft nullable `store_id` additions for LINE state tables.
- Produce row-count and duplicate-risk dry-run SQL.
- Do not apply production DB changes.

### Phase 2: Resolver interface design

- Define one backend resolver contract for public LINE routes.
- Define resolver confidence order.
- Define logging fields.
- Define failure responses in zh-TW for public customer pages.
- Define no-store behavior for old links.

### Phase 3: Staging schema rehearsal

- Apply nullable schema only in staging.
- Backfill KINGWAY 台南 rows in staging.
- Verify row counts and rollback.
- Confirm no production LINE credential is used in staging.

### Phase 4: Staging resolver implementation

- Implement resolver in staging branch/environment.
- Attach resolved context to `req.lineStoreContext` and/or `req.storeId`.
- Scope LINE public reads/writes by resolved store.
- Use store-specific LINE channel credentials for webhook/reply/push.
- Add mismatch tests.

### Phase 5: Existing store compatibility test

- Test old KINGWAY 台南 links.
- Test LINE friend add.
- Test phone binding and NT$500 coupon.
- Test Google review pending approval.
- Test repair reservation approval.
- Test purchase confirmation link generation and submit.
- Test group registration/routing.

### Phase 6: New store simulation

- Add a fake second store in staging only.
- Add separate LINE channel/LIFF mappings in staging only.
- Verify same `lineUserId` does not cross stores unless explicitly designed.
- Verify products, coupons, repairs, orders, surveys, and LINE groups are store-isolated.

### Phase 7: Production readiness review

- Review resolver logs.
- Review fallback usage count.
- Review cross-store leakage tests.
- Review rollback.
- Review credential separation.
- Only then consider production rollout.

## 10. Production Apply Prohibition Conditions

Do not apply to production if any condition below is true.

- Public LINE resolver is not implemented and tested in staging.
- Any LINE public route still writes business data without resolved `store_id`.
- Any route uses hardcoded `store_id = 1`.
- `line_chat_sessions`, `line_webhook_events`, or `line_group_registrations` have ambiguous backfill rows.
- Store-specific LINE channel secret/token loading is not ready.
- Webhook signature verification cannot identify the intended store/channel.
- LIFF pages cannot carry or resolve store context.
- Public generated links do not include inferable or signed store context.
- Legacy fallback is used for a second active store.
- Staging uses production LINE credentials.
- Cross-store tests for customer binding, coupons, repairs, orders, purchase confirmations, and group notifications are missing.
- Rollback plan is missing.
- Monitoring cannot show resolver source and fallback usage.

## 11. Next Implementation Candidates

Recommended next work items, in order:

1. Create a read-only audit result for current LINE public routes and all SQL without store scope.
2. Draft dry-run SQL for `store_line_channels`, `store_liff_apps`, and LINE state table `store_id` columns.
3. Define a `resolveLinePublicStoreContext(req, options)` interface without wiring it to routes.
4. Define store-specific LINE credential loading strategy.
5. Add staging-only fixture plan for a second store and second LINE channel.
6. Design frontend public route context propagation:
   - slug
   - LIFF ID
   - signed token
7. Design token migration for purchase confirmations and surveys.
8. Design scoped unique keys for `line_user_id`, phone binding, chat sessions, and webhook duplicate claims.
9. Prepare staging resolver implementation for `POST /api/line/webhook` first.
10. After webhook resolver is stable, extend to LIFF page APIs:
    - phone binding
    - line order
    - repair reservation
    - Google review
    - purchase confirmation latest-order

## 12. Final Design Rule

LINE remains the center of the KINGWAY workflow. Multi-store support must add store resolution and isolation without replacing LINE-first customer, staff, repair, coupon, purchase confirmation, approval, and notification flows.

The correct target is:

- shared codebase
- store-scoped data
- store-specific LINE channel and LIFF mappings
- explicit resolver logs
- no hardcoded store fallback except controlled legacy compatibility for the existing KINGWAY 台南 store
