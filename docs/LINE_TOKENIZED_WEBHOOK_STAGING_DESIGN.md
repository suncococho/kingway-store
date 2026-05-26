# LINE Tokenized Webhook Staging Design

## 1. Purpose

This document defines a staging-only design for adding a tokenized LINE webhook route that can resolve store/channel context before signature verification.

The existing production webhook path must remain unchanged:

```text
POST /api/line/webhook
```

The candidate staging-only path is:

```text
POST /api/line/webhook/:webhookPathToken
```

This is a design document only.

Do not use this document as approval to:

- modify application code
- modify database schema or data
- change the production webhook URL
- change LINE credentials
- deploy
- stage, commit, or push git changes

Primary source of truth remains:

1. `docs/KINGWAY_STORE_MASTER_SPEC.md`
2. The user's newest explicit instruction
3. Existing code structure
4. Older temporary patches or assumptions

## 2. Why Keep Existing `/api/line/webhook`

The current production LINE Official Account is already configured to call:

```text
POST /api/line/webhook
```

That path should remain stable because:

- It protects current KINGWAY 台南 LINE-first production workflows.
- It avoids changing LINE Developer Console production settings during a resolver design phase.
- It keeps current friend-add, phone binding, repair reservation, order, Google review, staff group, and postback flows operational.
- It avoids coupling webhook routing migration with credential changes.
- It gives staging a separate proving ground for tokenized routing and rollback.

Current production path policy:

- Keep `/api/line/webhook` as explicit legacy KINGWAY compatibility.
- Continue using the existing global `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN` only for this legacy path until a later approved implementation phase.
- Do not add new stores to this legacy path.
- Do not infer a generic multi-store context from this route.

## 3. Staging-only Candidate Route

Candidate route:

```text
POST /api/line/webhook/:webhookPathToken
```

Example shape:

```text
POST /api/line/webhook/stg_lw_unguessable_random_token
```

Route constraints:

- Staging only.
- Token must be unguessable.
- Token must map to exactly one active LINE channel row.
- Token must not be logged in full in normal application logs.
- Route must reject unresolved, inactive, ambiguous, or malformed tokens.
- Route must not change current production webhook behavior.

The path token is not a replacement for LINE signature verification. It is only the selector that tells the backend which channel secret reference to use for verification.

## 4. `store_line_channels` Lookup Flow

Expected table shape is defined in `docs/STORE_PUBLIC_IDENTITY_MAPPING_SCHEMA_PLAN.md`.

Relevant fields:

- `store_id`
- `channel_id`
- `channel_name`
- `channel_secret_ref`
- `channel_access_token_ref`
- `webhook_path_token`
- `webhook_path`
- `status`

Resolution flow:

1. Extract `webhookPathToken` from route params.
2. Normalize by trimming whitespace.
3. Reject empty tokens and tokens that fail the approved format.
4. Query `store_line_channels` by `webhook_path_token`.
5. Require `store_line_channels.status = 'ACTIVE'`.
6. Join `stores` and require active store status.
7. Require exactly one matching row.
8. Build `req.lineStoreContext`.
9. Continue to signature verification with the resolved `channel_secret_ref`.

Expected lookup behavior:

```sql
SELECT
  slc.store_id,
  slc.channel_id,
  slc.channel_secret_ref,
  slc.channel_access_token_ref,
  slc.webhook_path_token,
  slc.status
FROM store_line_channels slc
JOIN stores s ON s.id = slc.store_id
WHERE slc.webhook_path_token = ?
  AND slc.status = 'ACTIVE'
  AND s.status = 'active'
LIMIT 1;
```

No route should ever resolve channel/store from request body or query `store_id`.

## 5. Signature Verification With Channel Secret Ref

Current global flow:

```text
rawBody + config.line.channelSecret + x-line-signature
```

Tokenized staging flow:

```text
webhookPathToken
  -> store_line_channels row
  -> channel_secret_ref
  -> secret value from approved secret source
  -> verify rawBody against x-line-signature
```

Required sequence:

1. Capture raw request body before JSON parsing mutates payload semantics.
2. Resolve store/channel from `webhookPathToken`.
3. Resolve secret value from `channel_secret_ref`.
4. Verify HMAC SHA256 signature against `x-line-signature`.
5. Reject request before event handling if verification fails.
6. Never log the raw secret or full token.

Why this order matters:

- LINE signatures are channel-specific.
- Multi-store support means multiple LINE channels can share one backend.
- The backend must choose the correct channel secret before verification.
- Verifying with a global secret only proves the request belongs to the legacy KINGWAY channel.

## 6. Reply / Push Token Separation

Current global behavior:

- Replies use global `config.line.channelAccessToken`.
- Push messages use global `config.line.channelAccessToken`.

Tokenized direction:

- Replies from tokenized webhook events should use the resolved row's `channel_access_token_ref`.
- Push messages tied to a store/customer should use the store/channel context associated with that workflow.
- Helper functions should accept explicit LINE channel context instead of reading global config implicitly.

Target conceptual shape:

```js
replyToLineWithContext(req.lineStoreContext, replyToken, messages)
sendLineMessageWithContext(lineStoreContext, lineUserId, messages)
```

The first implementation should not rewrite all LINE helpers at once. It should create a narrow context-aware path for staging webhook smoke tests first.

## 7. Legacy KINGWAY Fallback Policy

Legacy fallback applies only to the existing production path:

```text
POST /api/line/webhook
```

Allowed behavior:

- Current KINGWAY 台南 production webhook continues to use current env credentials.
- Fallback is explicit and observable.
- Fallback may map to KINGWAY store only through a central resolver/config rule.
- Fallback should include audit metadata:
  - `source: "legacy_kingway_fallback"`
  - `legacyFallbackUsed: true`
  - `storeId`
  - `reason`

Not allowed:

- Route-local `const storeId = 1`.
- Accepting a second active store through the legacy path.
- Hiding unresolved tokenized webhook failures by falling back to KINGWAY.
- Using public body/query `store_id` as fallback authority.

Tokenized route policy:

- `POST /api/line/webhook/:webhookPathToken` must fail closed.
- It must not fall back to KINGWAY if token lookup or signature verification fails.

## 8. `req.lineStoreContext` Shape

Recommended request context:

```js
{
  storeId: 1,
  tenantId: 1,
  source: "line_channel",
  confidence: "high",
  lineChannelId: "1234567890",
  channelSecretRef: "env:LINE_CHANNEL_SECRET",
  channelAccessTokenRef: "env:LINE_CHANNEL_ACCESS_TOKEN",
  webhookPathTokenHash: "sha256:...",
  webhookPath: "/api/line/webhook/:webhookPathToken",
  legacyFallbackUsed: false,
  resolvedAt: "2026-05-27T00:00:00.000Z",
  audit: {
    route: "/api/line/webhook/...",
    method: "POST",
    resolverSource: "line_channel",
    signatureVerified: false,
    attempts: []
  }
}
```

Notes:

- Store only token hash or redacted token in context/logs.
- `signatureVerified` should be set true only after HMAC validation succeeds.
- `channelSecretRef` and `channelAccessTokenRef` are references, not raw secret values.
- `req.lineStoreContext` should be immutable after verification where practical.

## 9. Signature Failure Handling

Failure cases:

| Failure | Response | Event handling |
| --- | --- | --- |
| Missing `x-line-signature` | `401` | Do not process |
| Missing path token | `404` or `400` | Do not process |
| Unknown path token | `404` | Do not process |
| Inactive channel mapping | `403` | Do not process |
| Missing secret ref | `500` in staging, production no-go | Do not process |
| Secret ref cannot be resolved | `500` in staging, production no-go | Do not process |
| HMAC mismatch | `401` | Do not process |
| Malformed JSON after valid signature | `400` | Do not process business events |

Logging policy:

- Log status, store id when resolved, channel id when resolved, and redacted token hash.
- Do not log raw channel secret, access token, full webhook path token, full request body, or full customer payload.
- Signature mismatch should be warning-level with rate-limit-friendly metadata.

## 10. Replay and Security Considerations

Replay handling:

- Continue using LINE webhook event id when available.
- Scope duplicate claims by store/channel for tokenized route.
- Include `store_id` and `line_channel_id` in webhook event audit rows after schema approval.
- Treat fallback hash keys as legacy-only.

Path token security:

- Token must be long, random, and unguessable.
- Token should be unique across all LINE channel rows.
- Token should not be derived from store slug, channel name, phone, domain, or sequential id.
- Token rotation should use a staged `ROTATING` policy only after explicitly designed.

Request security:

- Do not brute-force all LINE secrets to find a matching channel in production.
- Do not trust request body/query `store_id`.
- Do not accept inactive mappings.
- Do not let hostname or slug override a resolved webhook channel context.
- Do not use KINGWAY legacy fallback for tokenized route failures.

## 11. Staging Smoke Test Plan

Precheck:

1. Confirm staging DB target.
2. Confirm `stores` exists and the target staging store row is active.
3. Confirm `store_line_channels` exists.
4. Confirm exactly one active candidate row for the staging path token.
5. Confirm credential references are present and do not contain raw secrets.
6. Confirm production `/api/line/webhook` remains unchanged.

Smoke test phase 1: resolver only

1. Send request to tokenized route with missing signature.
2. Expect rejection before event handling.
3. Confirm logs show token lookup attempt without raw token leak.

Smoke test phase 2: invalid signature

1. Send request with known invalid signature.
2. Expect `401`.
3. Confirm no webhook event is claimed and no customer/order/repair write occurs.

Smoke test phase 3: valid signature no-op

1. Use staging LINE channel and exact tokenized webhook path.
2. Send a benign event from LINE Developer Console or controlled staging channel.
3. Confirm signature verifies using the resolved secret ref.
4. Confirm `req.lineStoreContext` resolves expected store/channel.
5. Confirm no production path or production credential was used.

Smoke test phase 4: narrow reply test

1. Use a low-risk text or diagnostic event.
2. Reply with a controlled zh-TW staging-only message.
3. Confirm reply uses resolved channel access token ref.
4. Confirm no global `LINE_CHANNEL_ACCESS_TOKEN` is used on the tokenized route.

Smoke test phase 5: duplicate/replay

1. Replay the same webhook event id where possible.
2. Confirm duplicate claim is scoped to store/channel.
3. Confirm duplicate is skipped without business writes.

Do not include order creation, repair reservation, phone binding, Google review coupon, or customer merge in the first tokenized webhook smoke test.

## 12. Rollback Strategy

Production rollback:

- No production webhook URL change should have occurred.
- Existing `/api/line/webhook` remains the production fallback path.
- If staging fails, stop using the tokenized staging webhook URL.

Staging runtime rollback:

- Remove or disable the staging LINE Developer Console webhook URL pointing to `/api/line/webhook/:webhookPathToken`.
- Mark the relevant `store_line_channels` row `INACTIVE` only after approved DB action.
- Disable tokenized route feature flag if one is introduced in a later implementation.

Code rollback:

- Revert tokenized route wiring if staging route affects existing behavior.
- Keep legacy `/api/line/webhook` logic isolated.
- Do not add scattered `store_id = 1` fallbacks during rollback.

Credential rollback:

- Do not rotate credentials unless a secret leak is confirmed.
- If a credential reference is wrong, correct the reference through the approved secret-management path.

Operational verification after rollback:

- Existing KINGWAY friend-add flow works.
- Existing customer message reply works.
- Existing repair reservation flow works.
- Existing Google review request and staff notification flow works.
- Existing LINE order flow works.

## 13. Production No-go Conditions

Do not enable production tokenized multi-store LINE webhook routing if any condition is true:

- Production `/api/line/webhook` has not been protected as legacy-only.
- `store_line_channels` has duplicate active `webhook_path_token` or `channel_id`.
- A token is predictable, short, reused, or exposed.
- A channel row has missing or raw credential values instead of references.
- Channel secret ref resolution is not implemented safely.
- Channel access token ref is not used for tokenized reply/push.
- Tokenized route can fall back to KINGWAY on lookup or signature failure.
- Signature verification still uses global `LINE_CHANNEL_SECRET`.
- Reply/push still uses global `LINE_CHANNEL_ACCESS_TOKEN` on tokenized route.
- Webhook duplicate claims are not scoped by store/channel.
- `line_user_id` customer writes remain unscoped for tokenized flows.
- `line_chat_sessions` remains unscoped for tokenized customer/staff flows.
- `line_group_registrations` remains unscoped for tokenized group registration.
- Telegram routing remains global for non-legacy stores.
- Staging smoke tests and rollback rehearsal are incomplete.

## 14. Next Safe Implementation Step

Next safe step for a later implementation phase:

1. Add a staging-only route skeleton for `POST /api/line/webhook/:webhookPathToken`.
2. Resolve `store_line_channels` by token.
3. Resolve channel secret by reference.
4. Verify signature.
5. Return a controlled no-op response after successful verification.
6. Log only redacted audit metadata.
7. Leave `/api/line/webhook` production behavior unchanged.

Only after that succeeds should event processing, reply token separation, duplicate claim scoping, and store-scoped workflow writes be implemented.

