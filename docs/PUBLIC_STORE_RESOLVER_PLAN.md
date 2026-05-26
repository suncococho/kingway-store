# Public Store Resolver Plan

## 1. Purpose

This document defines the plan for resolving which store a public request belongs to in a future 100-store KINGWAY structure.

This is a planning document only.

Do not use this document as approval to:

- modify application code
- modify database schema or data
- deploy
- stage, commit, or push git changes
- change existing KINGWAY 台南 LINE-first workflows

Primary source of truth remains:

1. `docs/KINGWAY_STORE_MASTER_SPEC.md`
2. The user's newest explicit instruction
3. Existing code structure
4. Older temporary patches or assumptions

## 2. Current Public Route List

### 2-1. Backend Public Routes

These routes are public or LINE/customer-facing and do not receive authenticated staff store context from JWT middleware.

| Route | Current role | Current store context |
| --- | --- | --- |
| `GET /api/settings/public` | Public store profile/settings | Currently resolves KINGWAY compatibility settings |
| `POST /api/line/webhook` | LINE Messaging API webhook | Global LINE config only |
| `POST /api/line/profile-name` | Updates customer display name from LINE profile | None |
| `POST /api/line-bind-phone` | Binds LINE userId to phone and issues new-friend coupon | None |
| `GET /api/line-order/customer` | Loads or creates LINE customer for order page | None |
| `GET /api/line-order/ebikes` | Lists public EBIKE products | None |
| `POST /api/line-order/create` | Creates LINE reservation/order | None |
| `GET /api/line-repair/customer` | Loads customer for repair reservation page | None |
| `POST /api/line-repair/create` | Creates LINE repair reservation | None |
| `GET /api/line-google-review/customer` | Loads customer for Google review page | None |
| `POST /api/line-google-review/request` | Creates pending Google review coupon request | None |
| `POST /api/purchase-confirmations/line/latest-order` | Creates/returns purchase confirmation link for LINE user | None |
| `GET /api/purchase-confirmations/public/:token` | Loads public purchase confirmation | Token-based only |
| `POST /api/purchase-confirmations/public/:token` | Submits public purchase confirmation | Token-based only |
| `GET /api/purchase-confirmations/public/:token/pdf` | Serves public purchase confirmation PDF | Token-based only |
| `POST /api/purchase-confirmations/manual` | Public/manual purchase confirmation submit | Phone/order matching only |
| `GET /api/purchase-confirmations/manual/:id/pdf` | Serves manual purchase confirmation PDF | Id-based only |
| `GET /api/surveys/public/:token` | Loads public survey | Token-based only |
| `POST /api/surveys/public/:token` | Submits public survey | Token-based only |
| `POST /api/line-support/create` | Public LINE support request | None |
| `GET /api/customer-status` | Public customer status lookup | None |
| `POST /api/customer-status/orders/:id/payment` | Public payment status action | Id-based only |
| `POST /api/customer-status/orders/:id/deliver` | Public delivery action | Id-based only |
| `POST /api/customer-status/repairs/:id/payment` | Public repair payment action | Id-based only |
| `POST /api/customer-status/repairs/:id/pickup` | Public repair pickup action | Id-based only |
| `GET /api/coupons/by-phone/:phone` | Public coupon lookup by phone | None |

### 2-2. Frontend Public Pages

| Route | Current role | Current store context |
| --- | --- | --- |
| `/line-order` | LINE EBIKE order page | None |
| `/line-customer` | LINE customer center | None |
| `/repair-reservation` | LINE repair reservation page | None |
| `/repair-request` | Repair reservation alias | None |
| `/coupon-center` | LINE coupon center | None |
| `/google-review` | Google review coupon request page | None |
| `/progress` | Customer progress page | None |
| `/line-progress` | Customer progress alias | None |
| `/store-info` | Public store information page | Calls `/api/settings/public` |
| `/support` | LINE support page | None |
| `/purchase-confirm/:token` | Public purchase confirmation page | Token-based only |
| `/purchase-confirm/manual` | Manual purchase confirmation page | None |
| `/surveys/:token` | Public survey page | Token-based only |

## 3. Current Storeless Behavior

The current single-store assumptions are concentrated in these areas:

- Public settings can return KINGWAY data without request-level store identity.
- LINE customer lookup and creation often use only `line_user_id`.
- Phone binding can bind a LINE user to a phone without a store boundary.
- New-friend coupon issuance can occur without a resolved store.
- Google review coupon requests can be created by customer alone without store scope.
- EBIKE product listing for LINE order page is global.
- LINE order creation can create customers, coupons, orders, and order items without explicit `store_id`.
- LINE repair reservation can create sessions and repair records without explicit public store context.
- Purchase confirmation public routes are token-based but should verify or infer store from linked rows.
- Survey public routes are token-based but should verify or infer store from linked rows.
- LINE webhook signature verification uses one global channel secret and one global access token.
- LINE group registrations, chat sessions, and webhook duplicate claims are not yet clearly scoped by store.
- Frontend public URLs do not carry slug, hostname mapping, LIFF mapping, or signed store context.

These are acceptable only during current KINGWAY 台南 single-store compatibility. They are not safe for a 100-store structure.

## 4. Resolver Contract

All public route handlers should use one central resolver instead of inferring store context locally.

Target shape:

```js
{
  storeId,
  tenantId,
  source,
  confidence,
  hostname,
  slug,
  liffId,
  lineChannelId,
  tokenPurpose,
  signedTokenId,
  legacyFallbackUsed
}
```

Required rules:

- Public handlers must use the resolved context.
- Public handlers must not trust `req.body.store_id`, `req.body.storeId`, `req.query.store_id`, or `req.query.storeId`.
- Missing or ambiguous context must fail closed for new stores.
- Legacy fallback must be explicit and observable.
- User-facing errors must remain Taiwan Traditional Chinese.

## 5. Resolver Source Priority

Recommended confidence order:

1. Existing public token tied to stored business rows
2. Signed store context token generated by backend
3. LINE channel/webhook path token
4. LIFF ID mapping
5. Store slug from path
6. Hostname mapping
7. Explicit legacy KINGWAY fallback

The priority can vary by route type. For example, webhook routes should prefer channel/path token before LIFF, while purchase confirmation routes should prefer the purchase confirmation token.

## 6. Hostname Resolver

Hostname resolver maps request hostnames to active stores.

Example host patterns:

- `tainan.pos.kingway.tw`
- `{storeSlug}.pos.kingway.tw`
- custom domains assigned to a store

Resolution flow:

1. Normalize `Host` or trusted proxy host.
2. Remove port.
3. Match active hostname mapping.
4. Load active store.
5. Attach resolved context.

Strengths:

- Works for normal browser public pages.
- Does not require query parameters.
- Supports branded/custom domains.

Limitations:

- One host can serve many stores if the frontend uses path-based routing.
- Host headers require trusted proxy configuration.
- Hostname alone is not enough for sensitive write actions.

Recommended use:

- Safe for public store profile reads.
- Use with LIFF ID or signed store context token for customer writes.

## 7. Store Slug Resolver

Store slug resolver maps readable path segments to stores.

Recommended frontend patterns:

- `/s/:storeSlug/store-info`
- `/s/:storeSlug/line-order`
- `/s/:storeSlug/repair-reservation`
- `/s/:storeSlug/google-review`
- `/s/:storeSlug/support`

Recommended API patterns:

- `GET /api/public/:storeSlug/settings`
- `GET /api/public/:storeSlug/line-order/ebikes`
- `POST /api/public/:storeSlug/line-order/create`

Resolution flow:

1. Extract `storeSlug` from route params.
2. Normalize lowercase slug.
3. Reject reserved slugs.
4. Match active store by slug.
5. Attach resolved context.

Reserved slug examples:

- `api`
- `admin`
- `login`
- `line`
- `settings`
- `dashboard`
- `orders`
- `products`
- `customers`
- `repairs`

Strengths:

- Easy to understand in public URLs.
- Avoids exposing numeric `store_id`.
- Good fit for multi-store frontend pages.

Limitations:

- User can type any slug, so it proves only routing intent, not customer authorization.
- Sensitive write routes should combine slug with LIFF ID or signed context.

## 8. LIFF ID Resolver

LIFF ID resolver maps LINE LIFF app IDs to stores.

Resolution flow:

1. Frontend includes current `liffId` in public API request metadata.
2. Backend looks up active `store_liff_apps.liff_id`.
3. Backend verifies route scope when applicable.
4. Attach resolved store context.

Recommended use cases:

- `/line-order`
- `/repair-reservation`
- `/coupon-center`
- `/google-review`
- `/support`
- `/line-progress`
- purchase confirmation entry from LIFF

Strengths:

- Stronger than hostname for LINE customer flows.
- Closely matches LINE-first architecture.
- Helps prevent one store's LIFF page from writing to another store's customer data.

Limitations:

- Current frontend uses one configured LIFF ID.
- If one LIFF app serves many stores, LIFF ID alone is not enough.
- Store-specific LIFF setup must not reuse KINGWAY production credentials for test stores.

Rule:

- If a single LIFF app is shared by multiple stores, require a signed store context token or slug plus server validation.

## 9. LINE Channel / Webhook Resolver

Webhook resolver maps LINE Messaging API channel or webhook path token to one active store.

Recommended future route patterns:

- `POST /api/line/webhook/:webhookPathToken`
- `POST /api/stores/:storeSlug/line/webhook`

Resolution flow:

1. Extract webhook path token or slug.
2. Load active `store_line_channels` mapping.
3. Load that store's channel secret.
4. Verify `x-line-signature` with that store-specific secret.
5. Attach resolved context.
6. Use that store's access token for reply/push.
7. Scope webhook duplicate claims by store/channel.

Rules:

- If resolved channel signature fails, reject.
- Do not brute-force all store secrets in production unless separately designed with rate limits and monitoring.
- Webhook event logs must include resolver source and `store_id`.
- Group registration must register the group under the resolved store.

## 10. Signed Store Context Token

Signed store context token is recommended for backend-generated public links.

Example payload:

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

Required rules:

- Sign with server secret.
- Include purpose.
- Include expiry.
- Bind to reference type and id for sensitive actions.
- Do not accept unsigned `store_id`.
- Do not let token purpose be reused across unrelated workflows.

Recommended use cases:

- purchase confirmation links
- survey links
- repair estimate confirmation links
- Google review approval/reject links
- staff approval buttons generated in LINE notifications
- public support links generated from a store page

## 11. Legacy KINGWAY Fallback

Legacy fallback keeps current KINGWAY 台南 flows working during migration.

Allowed behavior:

- Existing old public URLs can resolve to KINGWAY 台南 store only while single-store compatibility mode is active.
- Fallback must be implemented centrally in the resolver.
- Fallback must log `legacyFallbackUsed: true`.
- Fallback must identify why it was allowed.

Allowed examples:

- old `/line-order`
- old `/repair-reservation`
- old `/google-review`
- old `/store-info`
- old `/purchase-confirm/:token` where token predates store-aware metadata
- old `/surveys/:token` where token predates store-aware metadata
- old `/api/line/webhook` for the current single KINGWAY LINE channel

Not allowed:

- route-level `const storeId = 1`
- SQL-level silent fallback for new writes
- accepting public body/query `store_id`
- using KINGWAY fallback for a second active store
- hiding resolver failure by attaching ambiguous data to store `1`

Removal condition:

- Before real multi-store production rollout, fallback usage must be monitored and reduced to known legacy-only traffic.

## 12. Public Request Body `store_id` Trust Ban

Public request body and query parameters are untrusted.

The following must not be treated as authority:

- `req.body.store_id`
- `req.body.storeId`
- `req.query.store_id`
- `req.query.storeId`
- hidden form fields containing store id
- arbitrary client-provided tenant id

Acceptable use:

- They may be logged as debug input.
- They may be compared against a resolved signed/LIFF/slug context to detect mismatch.
- They may be rejected when present on sensitive public routes.

Rule:

- Store authority must come from resolver-approved sources only: token linkage, signed context, LINE channel mapping, LIFF mapping, slug mapping, hostname mapping, or explicit legacy fallback.

## 13. Required Schema Candidates

These schema candidates are planning targets only. They are not approved migrations.

### 13-1. `store_hostnames`

Purpose: map public hostnames or custom domains to stores.

Draft:

```sql
CREATE TABLE store_hostnames (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  hostname VARCHAR(255) NOT NULL,
  hostname_type ENUM('SUBDOMAIN', 'CUSTOM_DOMAIN', 'LEGACY') NOT NULL DEFAULT 'SUBDOMAIN',
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  verified_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_hostnames_hostname (hostname),
  INDEX idx_store_hostnames_store_status (store_id, status)
);
```

Notes:

- Hostnames should be normalized to lowercase.
- Custom domains need verification before activation.
- Legacy hostname mapping can point current KINGWAY public host to store `1`.

### 13-2. `store_liff_apps`

Purpose: map LIFF app IDs to stores and route scopes.

Draft:

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
  INDEX idx_store_liff_apps_store_scope (store_id, route_scope, status)
);
```

Notes:

- One LIFF ID should map to one active store unless signed context is added.
- Route scope helps prevent using a support LIFF context to submit an unrelated sensitive workflow.

### 13-3. `store_line_channels`

Purpose: map LINE Messaging API channels and webhook path tokens to stores.

Draft:

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

- Store secrets should be referenced, not stored directly as plaintext if a secret manager is available.
- `is_default` is only for controlled legacy compatibility.
- A new store must not inherit KINGWAY production LINE credentials.

## 14. Production Apply Prohibition Conditions

Do not apply this resolver design to production if any condition below is true:

- Resolver is not implemented and tested in staging.
- Any public write route can create or update business data without resolved store context.
- Any route trusts public body/query `store_id`.
- Any route uses scattered hardcoded `store_id = 1`.
- Hostname mapping does not have uniqueness checks.
- Store slug uniqueness and reserved slug checks are missing.
- LIFF ID mapping is missing or ambiguous.
- LINE channel secret/token loading is still global for multi-store traffic.
- Webhook signature verification cannot identify the intended store/channel.
- Public generated links cannot infer store from token linkage or signed context.
- Legacy fallback is active for more than the existing KINGWAY 台南 compatibility path.
- Staging uses production LINE credentials for second-store tests.
- Cross-store tests for customers, products, coupons, orders, repairs, purchase confirmations, surveys, and LINE groups are missing.
- Resolver logs do not show `source`, `confidence`, `storeId`, and fallback usage.
- Rollback plan is missing.
- Existing KINGWAY LINE-first flows have not passed compatibility smoke tests.

## 15. Staging Test Checklist

### 15-1. KINGWAY Compatibility

- Existing `/store-info` returns KINGWAY 台南 public settings.
- Existing `/line-order` loads KINGWAY EBIKE products.
- Existing `/repair-reservation` can submit a repair reservation.
- Existing `/google-review` can submit a pending review coupon request.
- Existing `/purchase-confirm/:token` can load and submit a purchase confirmation.
- Existing `/surveys/:token` can load and submit a survey.
- Existing LINE webhook path still works in controlled legacy mode.
- Existing LINE friend add and phone binding still issue one NT$500 new-friend coupon.

### 15-2. Hostname Resolver

- Known KINGWAY hostname resolves to store `1`.
- Unknown hostname fails closed for new public routes.
- Custom test hostname resolves only after active mapping exists.
- Hostname comparison is lowercase and port-insensitive.

### 15-3. Store Slug Resolver

- Known slug resolves to the expected store.
- Unknown slug returns a Taiwan Traditional Chinese not-found message.
- Reserved slug is rejected.
- Slug cannot override a stronger signed token or LIFF mapping mismatch.

### 15-4. LIFF ID Resolver

- Known KINGWAY LIFF ID resolves to store `1`.
- Test store LIFF ID resolves to test store only.
- Unknown LIFF ID fails closed for write actions.
- Route scope mismatch is rejected.

### 15-5. LINE Channel / Webhook Resolver

- Webhook path token resolves to one active store.
- Signature verification uses the resolved store channel secret.
- Wrong signature is rejected.
- Webhook duplicate claims are scoped by store/channel.
- Group registration writes the resolved `store_id`.
- Reply/push uses the resolved store channel access token.

### 15-6. Signed Store Context Token

- Valid token resolves store and purpose.
- Expired token is rejected.
- Wrong purpose is rejected.
- Tampered token is rejected.
- Token store mismatch with slug/LIFF context is rejected or logged according to policy.

### 15-7. Cross-Store Isolation

- Same `lineUserId` in two stores does not cross-read customers unless explicitly designed.
- Same phone number in two stores does not merge customers silently.
- Store `2` LINE order page does not show store `1` products.
- Store `2` phone binding does not issue coupon under store `1`.
- Store `2` Google review request does not notify store `1` groups.
- Store `2` repair reservation does not create store `1` repair rows.
- Store `2` purchase confirmation token cannot load store `1` confirmation.
- Store `2` survey token cannot load store `1` survey.

### 15-8. Observability

- Resolver logs include route, source, confidence, store id, and fallback flag.
- Legacy fallback usage count is visible.
- Mismatch attempts are visible.
- Public route failure messages are customer-safe and zh-TW.

## 16. Next Safe Implementation Step

Recommended next step:

1. Create a read-only audit document listing every active public route and its current SQL/store-scope gaps.
2. Draft staging-only dry-run SQL for `store_hostnames`, `store_liff_apps`, and `store_line_channels`.
3. Define `resolvePublicStoreContext(req, options)` as an interface document before wiring it to routes.
4. Define resolver logging fields and fallback policy.
5. Define frontend context propagation for slug, hostname, LIFF ID, and signed token.
6. Rehearse only in staging with a fake second store and non-production LINE credentials.
7. Implement the resolver in staging starting with read-only routes:
   - `GET /api/settings/public`
   - public store-info page
   - LINE product listing
8. After read-only resolver behavior is stable, extend to customer write routes:
   - phone binding
   - LINE order create
   - repair reservation create
   - Google review request
   - purchase confirmation latest-order
9. Extend webhook resolver only after store-specific LINE channel credential loading is ready.

Do not start with production migration or public signup.

