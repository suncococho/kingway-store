# Store-scoped LINE Webhook / LIFF Plan

Date: 2026-06-03
Branch: `beta/staging-architecture`

## Status

- Phase 1 route skeleton implemented on `2026-06-03`
- Phase 2 signature verification implemented on `2026-06-03`
- implemented scope:
  - `POST /api/line/webhook/:webhookPathToken`
  - `store_line_settings.webhook_path` lookup only
  - `channel_secret_ref` lookup and `env:` secret resolution
  - per-store `X-Line-Signature` verification
  - safe response only after successful verification
- not implemented in Phase 1:
  - real event processing
  - reply / push
  - customer/order/repair/coupon writes

## 1. Purpose

This document defines the recommended SaaS design for store-scoped LINE webhook and LIFF routing in the KINGWAY multi-store architecture.

This phase is documentation only.

Do not use this document as approval to:

- modify production config
- modify production `.env`
- change the existing production webhook URL
- send real LINE messages
- print raw LINE token or secret values
- deploy behavior changes

Primary references:

1. `docs/KINGWAY_STORE_MASTER_SPEC.md`
2. `docs/CODEX_SAFETY_RULES.md`
3. `docs/STORE_LINE_SETTINGS_PLAN.md`
4. `docs/LINE_MULTI_STORE_RESOLVER_PLAN.md`
5. `docs/STORE_LINE_CHANNELS_RESOLVER_ONLY_WIRING_PLAN.md`
6. `docs/SAAS_STORE_ID_ROUTE_ENFORCEMENT_PLAN.md`

## 2. Current Legacy `/api/line/webhook` Structure

Current legacy route:

```text
POST /api/line/webhook
```

Current behavior summary:

- The route is global, not store-scoped.
- Signature verification uses one global `config.line.channelSecret`.
- Reply/push behavior uses one global `config.line.channelAccessToken`.
- Runtime behavior is still tied to the current KINGWAY 台南 single-store compatibility model.
- The route does not derive store context from path, LIFF, or store code.
- Existing customer-facing LINE operations depend on this route remaining stable.

Current architectural limitation:

- Signature validity only proves the request belongs to the currently configured global LINE channel.
- It does not decide which SaaS store owns the event once multiple LINE channels exist.

Legacy safety rule:

- `POST /api/line/webhook` must remain unchanged until store-scoped verification and store-scoped send behavior are proven separately.

## 3. Candidate Store-scoped Webhook Routes

Two requested candidates:

### 3-1. Candidate A

```text
/api/stores/:storeCode/line/webhook
```

Pros:

- Human-readable
- Explicitly store-scoped
- Consistent with other public store-oriented URL ideas

Cons:

- `storeCode` becomes part of the public operational webhook path
- Easier to enumerate than a secret path token
- Path alone is not sufficient authority for signature verification
- Operational rotation is harder if the path itself should be treated as semi-sensitive metadata

### 3-2. Candidate B

```text
/api/line/webhook/:storeCode
```

Pros:

- Closer to the current legacy webhook namespace
- Easy to recognize as a LINE-specific route

Cons:

- Same enumeration problem as Candidate A
- `storeCode` is public but not secret
- Makes it easier to accidentally treat `storeCode` as sole authority
- Less future-proof if webhook path needs to rotate independently of store branding

### 3-3. Recommended Route

Recommended final design:

```text
/api/line/webhook/:webhookPathToken
```

Recommended compatibility alias for future operator visibility only:

```text
/api/stores/:storeCode/line/webhook
```

but only as an optional indirection layer, not as the authority used for verification.

Reason:

- Webhook resolution should be channel-first and token-first, not slug/storeCode-first.
- A random tokenized path is safer than exposing a predictable store code.
- A tokenized path supports rotation without renaming the store.
- It matches the existing LINE route family and previous resolver-only design documents.
- It reduces the risk of another store's webhook traffic being accepted under a guessed store code.

Recommendation summary:

- Keep `POST /api/line/webhook` as legacy KINGWAY 台南 compatibility.
- Use `POST /api/line/webhook/:webhookPathToken` as the real store-scoped webhook candidate.
- Treat `storeCode` URL forms as optional admin-facing convenience only, not as the source of trust.

## 4. Store Identification in Webhook Requests

Store identity should be resolved in this order:

1. `webhookPathToken` from the request path
2. mapped `channelId`
3. store-owned secret reference for signature verification
4. explicit legacy fallback only for `POST /api/line/webhook`

### 4-1. Path storeCode

If a future route exposes `:storeCode`, it may be used as a hint only.

Rules:

- `storeCode` must not be the sole authority for store ownership.
- `storeCode` may be compared against the resolved store for mismatch detection.
- If `storeCode` and resolved store do not match, fail closed and log a redacted audit event.

### 4-2. Channel ID mapping

Preferred store authority comes from channel mapping.

Recommended mapping source:

- `store_line_settings.channel_id`
  or
- a dedicated future `store_line_channels` table if channel metadata is separated later

Rules:

- one active channel id maps to one active store only
- duplicate active channel mappings must fail closed
- channel mapping is stronger than storeCode

### 4-3. Signature verification

Signature verification must happen after resolving the store-owned secret reference.

Rules:

- resolve store context first
- then resolve the channel secret reference for that store
- then verify `x-line-signature`
- never verify store-scoped webhook requests with the legacy global secret
- legacy `POST /api/line/webhook` keeps current global verification until migration is complete

## 5. LIFF URL Structure

Recommended customer-entry URL structure:

```text
/line-order?store=xxx
/line-repair?store=xxx
/purchase-confirm?store=xxx
```

Recommended normalized public routes in this repo context:

```text
/line-order?store=KINGWAY_TAINAN
/repair-reservation?store=KINGWAY_TAINAN
/purchase-confirm/:token?store=KINGWAY_TAINAN
```

Notes:

- `store` query is useful for frontend routing and diagnostics.
- `store` query is not sufficient authority by itself.
- Sensitive writes should still be validated by LIFF mapping, signed token, or business token ownership.

Recommended LIFF resolution rule:

- LIFF app ownership is stronger than the query string.
- query `store=xxx` is a presentation hint and mismatch detector.

Recommended route guidance:

- order flow: `/line-order?store=<storeCode>`
- repair flow: `/repair-reservation?store=<storeCode>`
- purchase confirmation entry: `/purchase-confirm/:token` remains token-authoritative, with optional `?store=<storeCode>` only as a consistency hint

## 6. Connection to `store_line_settings`

Current `store_line_settings` already stores the first usable store-scoped LINE settings layer.

Relevant fields:

- `line_enabled`
- `channel_id`
- `channel_secret_ref`
- `channel_secret_present`
- `channel_access_token_ref`
- `channel_access_token_present`
- `liff_url`
- `login_auth_url`
- `webhook_path`
- `customer_oa_name`
- `staff_group_enabled`

Recommended connection model:

- webhook route resolves by `webhook_path`
- webhook channel ownership resolves by `channel_id`
- signature verification resolves by `channel_secret_ref`
- future reply/push resolves by `channel_access_token_ref`
- LIFF/public entry resolver begins from `liff_url` in the short term
- later, flow-specific LIFF IDs should expand beyond one generic field

Recommended future LIFF additions:

- `entry_liff_id`
- `order_liff_id`
- `repair_liff_id`
- `purchase_confirm_liff_id`
- `review_liff_id`

## 7. KINGWAY_TAINAN Legacy Retention

Legacy compatibility must remain explicit.

Rules:

- Keep `POST /api/line/webhook` active for current KINGWAY 台南 production behavior.
- Do not repoint existing LINE Developer Console webhook in this phase.
- Do not route tokenized webhook failures into the legacy path.
- Do not let new SaaS stores share the legacy global path once store-scoped routes exist.

Recommended legacy policy:

- `KINGWAY_TAINAN` remains the only store allowed on the legacy global webhook during compatibility mode.
- Any new store must use store-scoped routing once implementation phases begin.

## 8. No-behavior-change Migration Plan

Migration principle:

- add resolver structure first
- keep runtime behavior unchanged until each dependency is proven

### 8-1. Migration summary

1. document route and resolver design
2. add route skeleton only
3. resolve store/channel context without processing real events
4. add per-store signature verification
5. add LIFF store resolver
6. add store-scoped send context for reply/push
7. migrate KINGWAY 台南 last

### 8-2. Safety rules

- no production webhook URL switch in early phases
- no fallback from tokenized store route to legacy route
- no customer/order/repair/coupon writes from new route until signature and token selection are proven
- no real LINE send on incomplete store-scoped token logic

## 9. Token / Secret Handling

Rules:

- never log raw `channelSecret`
- never log raw `channelAccessToken`
- never log raw webhook path token
- never return raw secrets in API responses
- always mask secret-bearing response fields
- prefer `env:` secret references first

Recommended policy:

- `env:SECRET_NAME` is the preferred persisted value
- if raw input is temporarily accepted by UI/API, only presence metadata may be stored unless encrypted-at-rest is added later
- store admin responses must return masked values only

Examples:

- `channelSecret: "已設定（安全參照）"`
- `channelAccessToken: "已設定（安全參照）"`
- `webhookPath: "/api/line/webhook/<masked>"`

## 10. Staff LINE Group and Customer OA Separation

Principle:

- customer LINE OA identity and staff internal group routing must be treated as separate operational concerns

Customer OA side:

- customer onboarding
- coupon flows
- repair reservation
- estimate confirmation
- purchase confirmation
- survey flow

Staff group side:

- repair approval
- Google review verification
- purchase confirmation completion notice
- inventory / PO / return notices
- manager/admin daily summary

Rules:

- do not reuse customer OA credentials as staff group routing authority
- do not let staff group registration decide customer webhook ownership
- customer-facing webhook/channel resolution must remain tied to store LINE channel ownership
- staff group routing may reference the resolved store after webhook ownership is already established

## 11. Test Plan

### 11-1. Route resolution tests

- legacy `POST /api/line/webhook` still works unchanged
- unknown tokenized webhook path fails closed
- inactive store mapping fails closed
- duplicate channel/path mapping fails closed
- tokenized route never falls back to legacy route

### 11-2. Signature tests

- valid per-store signature passes on store-scoped route
- invalid signature fails with no event processing
- legacy route still uses legacy global signature verification

### 11-3. LIFF tests

- LIFF order page resolves correct store from LIFF mapping
- repair LIFF page resolves correct store from LIFF mapping
- purchase confirmation token remains authoritative even when `store` query exists
- query `store` mismatch is logged and rejected for sensitive writes where policy requires it

### 11-4. Data isolation tests

- one store's webhook cannot create/update another store's customer data
- one store's LIFF flow cannot create another store's order
- store 1 and store 4 mappings remain isolated

### 11-5. Logging and masking tests

- no raw token or secret appears in logs
- store settings API returns masked values only
- error messages do not echo secret material

## 12. Implementation Phases

### Phase 1. Route skeleton only

- add store-scoped webhook route skeleton
- recommended route: `POST /api/line/webhook/:webhookPathToken`
- resolve store/channel context only
- no event processing
- no reply/push
- no business writes

### Phase 2. Signature verification per store

- resolve store-scoped secret ref
- verify `x-line-signature` with that store's channel secret
- fail closed on mismatch
- keep legacy route unchanged

### Phase 3. LIFF store resolver

- resolve store from LIFF mapping for customer-opened pages
- support `?store=<storeCode>` as hint only
- protect sensitive public writes with LIFF mapping or signed token authority

### Phase 4. Store-scoped reply/push

- introduce explicit send context per resolved store
- stop relying on one global access token in store-scoped routes
- keep legacy send path available only for legacy route until migration completion

### Phase 5. KINGWAY_TAINAN migration

- migrate KINGWAY 台南 from legacy global route to store-scoped route last
- verify webhook, LIFF, reply/push, and business flow parity in staging first
- only then consider removing legacy-only dependency from active production behavior

## 13. Final Recommendation

Recommended webhook route:

```text
POST /api/line/webhook/:webhookPathToken
```

Recommended LIFF route pattern:

```text
/line-order?store=<storeCode>
/repair-reservation?store=<storeCode>
/purchase-confirm/:token?store=<storeCode>
```

Reason:

- storeCode is useful for readability but too weak to be sole webhook authority
- tokenized webhook path is safer and more rotation-friendly
- LIFF/public URLs may expose storeCode as a hint, but real authority should come from LIFF mapping, signed token, or business token ownership
