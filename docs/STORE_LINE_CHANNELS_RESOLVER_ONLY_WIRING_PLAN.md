# Store LINE Channels Resolver-only Wiring Plan

## 1. Purpose

This document defines the minimum resolver-only wiring plan for a staging-only tokenized LINE webhook route before implementing real LINE reply/push, changing webhook URLs, or changing credentials.

This is a planning document only.

Do not use this document as approval to:

- modify application code
- modify database schema or data
- change webhook URLs
- change LINE credentials
- deploy
- stage, commit, or push git changes

Primary source of truth remains:

1. `docs/KINGWAY_STORE_MASTER_SPEC.md`
2. The user's newest explicit instruction
3. Existing code structure
4. Older temporary patches or assumptions

## 2. Existing `/api/line/webhook` Strategy

Keep the existing production webhook route unchanged:

```text
POST /api/line/webhook
```

Current route behavior:

- Uses `req.rawBody` captured by Express JSON middleware.
- Reads `x-line-signature`.
- Verifies signature with global `config.line.channelSecret`.
- Processes LINE events through current `lineWorkflowService` handlers.
- Replies and pushes through global `config.line.channelAccessToken`.

Transition strategy:

- Treat this route as legacy KINGWAY 台南 compatibility.
- Do not attach new stores to this route.
- Do not change the production LINE Developer Console webhook URL in this phase.
- Do not route tokenized webhook failures into this legacy route.
- Future legacy context, if added, must come from a central resolver/config rule and must be observable as `legacyFallbackUsed: true`.

## 3. Staging-only Candidate Route

Candidate route:

```text
POST /api/line/webhook/:webhookPathToken
```

Recommended route placement:

- Same router file: `backend/src/routes/line.js`.
- Declare before the current `router.post("/webhook", ...)` for readability and to keep tokenized handling visibly separate.
- Keep event processing no-op in the first implementation candidate.

Route constraints:

- Staging only.
- Must not require production webhook URL changes.
- Must resolve `store_line_channels` before any tokenized-route signature verification.
- Must not process customer/order/repair/coupon/session/group writes during resolver-only phase.
- Must fail closed when token resolution fails.

## 4. `store_line_channels` Resolve Flow

Resolver-only flow:

1. Extract `webhookPathToken` from route params.
2. Reject missing or malformed token.
3. Hash or redact token for logs.
4. Query `store_line_channels` by `webhook_path_token`.
5. Require `store_line_channels.status = 'ACTIVE'`.
6. Join `stores` and require active store.
7. Require exactly one matching row.
8. Build `req.lineStoreContext`.
9. Return no-op audit response in the first implementation candidate.

Conceptual lookup:

```sql
SELECT
  slc.store_id,
  slc.channel_id,
  slc.channel_secret_ref,
  slc.channel_access_token_ref,
  slc.webhook_path_token,
  slc.webhook_path,
  slc.status
FROM store_line_channels slc
JOIN stores s ON s.id = slc.store_id
WHERE slc.webhook_path_token = ?
  AND slc.status = 'ACTIVE'
  AND s.status = 'active'
LIMIT 1;
```

Implementation preference:

- Prefer reusing or extending `backend/src/utils/publicStoreResolver.js`.
- If the existing resolver context does not expose `channel_secret_ref` and `channel_access_token_ref`, add a narrow webhook-specific helper in a later implementation phase.
- Do not place scattered resolver SQL in multiple public routes.

## 5. `req.lineStoreContext` Shape

Recommended shape:

```js
{
  storeId: 1,
  tenantId: 1,
  source: "line_channel",
  confidence: "high",
  lineChannelId: "REDACTED",
  channelSecretRef: "env:LINE_CHANNEL_SECRET",
  channelAccessTokenRef: "env:LINE_CHANNEL_ACCESS_TOKEN",
  webhookPathTokenHash: "sha256:REDACTED_PREFIX",
  webhookPath: "/api/line/webhook/:webhookPathToken",
  legacyFallbackUsed: false,
  signatureVerified: false,
  audit: {
    route: "/api/line/webhook/REDACTED",
    method: "POST",
    resolverSource: "line_channel",
    attempts: []
  }
}
```

Rules:

- Do not store raw `webhookPathToken` in logs.
- Do not store raw channel secret or access token in request context.
- Store credential references only.
- Set `signatureVerified` only after a later signature-verification phase succeeds.
- Keep this context separate from generic `req.publicStoreContext` if that avoids accidentally treating tokenized webhook context as browser/LIFF context.

## 6. Audit-log-only Mode

The first wiring should be audit-log-only.

Allowed in resolver-only phase:

- Resolve token to store/channel row.
- Log redacted resolver result.
- Log missing/unknown/inactive token outcomes.
- Return controlled no-op response for successful resolution.
- Return fail-closed errors for invalid resolution.

Not allowed in resolver-only phase:

- Customer create/update.
- Phone binding.
- Coupon issuance.
- Order creation.
- Repair reservation creation.
- LINE group registration.
- Telegram notification.
- LINE reply or push.
- Webhook URL or credential change.

Suggested successful response:

```json
{
  "ok": true,
  "resolved": true,
  "mode": "resolver_only"
}
```

This response is only for staging diagnostics. It should not become the final production webhook behavior.

## 7. No Fallback on Tokenized Route

Tokenized route failure must not fall back to KINGWAY.

Fail closed when:

- `webhookPathToken` is missing.
- Token format is invalid.
- No active mapping exists.
- More than one mapping is detected by defensive checks.
- Linked store is inactive.
- Credential references are missing.
- Signature verification fails in the later verification phase.

Reason:

- Falling back from tokenized route to KINGWAY would hide misconfiguration.
- It could attach another store's webhook traffic to KINGWAY data.
- It would undermine the whole point of channel-first resolution.

Legacy fallback remains limited to:

```text
POST /api/line/webhook
```

## 8. Signature Verification Phase Separation

Recommended staged approach:

### Phase A: Resolver-only no-op

- Resolve `webhookPathToken`.
- Build `req.lineStoreContext`.
- Do not process events.
- Do not reply.
- Do not push.
- Do not write business data.

### Phase B: Token route signature verification

- Resolve `webhookPathToken`.
- Resolve `channel_secret_ref` to a secret value.
- Verify `x-line-signature` with the resolved channel secret.
- Reject before event handling when verification fails.
- Keep existing `/api/line/webhook` on global signature verification.

### Phase C: Narrow event smoke test

- Process only a low-risk diagnostic event.
- Keep customer/order/repair/coupon writes disabled.
- Use context-aware reply only after access-token reference resolution is proven.

Do not use global `LINE_CHANNEL_SECRET` for tokenized route verification once Phase B begins. The tokenized route exists specifically to choose the correct channel secret before verification.

## 9. Why Reply / Push Token Stays Unchanged for Now

Current reply/push behavior is global:

- `lineWorkflowService.replyToLine` uses `config.line.channelAccessToken`.
- `utils/line.sendLineMessage` uses `config.line.channelAccessToken`.

Do not change reply/push token behavior in resolver-only phase because:

- Reply/push creates external side effects.
- Existing helpers are used across many workflows.
- Changing them before resolver and signature boundaries are proven increases blast radius.
- Business workflows still need store-scoped customer/session/group changes before safe multi-store messaging.

Tokenized reply/push should be a later phase:

```js
replyToLineWithContext(req.lineStoreContext, replyToken, messages)
sendLineMessageWithContext(lineStoreContext, lineUserId, messages)
```

## 10. Staging Test Plan

Preconditions:

- `store_line_channels` table exists.
- Staging candidate row exists when approved.
- Candidate row uses approved staging `channel_id`.
- Candidate row uses an unguessable `webhook_path_token`.
- Candidate row stores credential references, not raw secret/token values.
- Production `/api/line/webhook` remains unchanged.

Resolver-only tests:

1. Request unknown token.
   - Expected: fail closed.
   - Expected: no business writes.
2. Request malformed token.
   - Expected: fail closed.
   - Expected: no business writes.
3. Request inactive token mapping.
   - Expected: fail closed.
   - Expected: no fallback to KINGWAY.
4. Request active token mapping.
   - Expected: `req.lineStoreContext` is built.
   - Expected: no-op response.
   - Expected: no LINE reply/push.
5. Confirm logs.
   - Expected: redacted token hash only.
   - Expected: no raw secret/token/path token.

Signature phase tests, only after Phase A passes:

1. Missing `x-line-signature`.
   - Expected: `401`.
2. Invalid signature.
   - Expected: `401`.
3. Valid staging signature.
   - Expected: no-op success before event handling.

Do not test order, repair, Google review, coupon, phone binding, or LINE group registration in resolver-only phase.

## 11. Rollback Plan

Production rollback:

- No production webhook change should have occurred.
- Existing `/api/line/webhook` remains active.

Staging rollback:

- Stop using the tokenized staging webhook URL.
- If a DB row was later seeded by approval, mark it `INACTIVE` rather than deleting it.
- Disable any feature flag introduced for tokenized webhook routing.

Code rollback for a later implementation:

- Remove or disable only the tokenized route skeleton.
- Keep existing `/api/line/webhook` untouched.
- Do not add route-local `store_id = 1` fallbacks.

Credential rollback:

- No credential change should occur in resolver-only phase.
- If a future credential reference is wrong, deactivate the mapping and correct the reference through approved secret-management steps.

## 12. Smallest Implementation Candidate

The smallest later implementation candidate is:

1. Add `POST /api/line/webhook/:webhookPathToken` in `backend/src/routes/line.js`.
2. Resolve token against `store_line_channels`.
3. Build `req.lineStoreContext`.
4. Log redacted audit metadata.
5. Return no-op resolver-only response.
6. Leave current `POST /api/line/webhook` unchanged.

Explicitly out of scope for the smallest candidate:

- Business event processing.
- Signature verification refactor for legacy route.
- LINE reply/push token separation.
- Customer/session/group store-scoping writes.
- Telegram routing changes.
- Production webhook URL changes.

