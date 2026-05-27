# LINE Send Token Injection Design

## 1. Purpose

This document defines a gradual design for reducing direct dependency on the global `config.line.channelAccessToken` when sending LINE messages.

Target functions and flows:

- `sendLineMessage(config, ...)`
- `replyToLine(...)`
- workflow-level customer sends
- tokenized webhook context from `req.lineStoreContext`
- legacy `/api/line/webhook` fallback behavior

This is a design-only phase. No code, DB, env, LINE credential, webhook, or git operation is part of this document.

## 2. Current Global Token Dependency

Current runtime LINE send behavior is process-global:

- `backend/src/config.js` reads `LINE_CHANNEL_ACCESS_TOKEN` into `config.line.channelAccessToken`.
- `backend/src/utils/line.js` uses `config.line.channelAccessToken` as the Bearer token for LINE push API.
- `backend/src/services/lineWorkflowService.js` imports singleton `config` and uses `config.line.channelAccessToken` for LINE reply API.
- Route and service callers usually pass imported singleton `config` into `sendLineMessage(config, ...)`.
- Workflow callers usually call `replyToLine(replyToken, messages)` with no token or store context.

This works for a single LINE Official Account, but it is not safe for multiple store-scoped LINE channels.

## 3. `sendLineMessage(config, ...)` Problem

Current shape:

```js
sendLineMessage(config, to, messages)
```

Problems:

- The first argument looks injectable, but callers pass the singleton application config.
- The token source is not visible at the call site.
- There is no `storeId`, `lineChannelId`, or `channelAccessTokenRef` in the function contract.
- Store-owned records such as customers, orders, repairs, coupons, and surveys can trigger customer-facing LINE sends through the wrong LINE OA if more than one channel exists.
- Async callers can re-import global config later instead of carrying the resolved channel context forward.
- Testing token selection is difficult because token lookup and HTTP send behavior are coupled through global config.

Design implication:

`sendLineMessage` should become a compatibility wrapper, not the long-term primitive. The long-term primitive should send with an explicit access token or explicit LINE send context.

## 4. `replyToLine(...)` Problem

Current shape:

```js
replyToLine(replyToken, messages)
```

Problems:

- It imports singleton `config` internally.
- It has no parameter for `accessToken`, `storeId`, `lineChannelId`, or `channelAccessTokenRef`.
- It cannot safely process events from tokenized webhooks because LINE reply tokens are channel-bound.
- A reply token from Store B's LINE channel must be answered with Store B's access token, not the process-global token.
- The implicit global dependency is harder to audit than push sends because most callers only show `replyToLine(...)`.

Design implication:

`replyToLine` needs an explicit token-capable signature before `/api/line/webhook/:webhookPathToken` can process real events.

## 5. Credential Ref Flow

Existing resolver pieces:

- `store_line_channels.channel_access_token_ref`
- `req.lineStoreContext.channelAccessTokenRef`
- `resolveSecretRef(ref)`

Target flow:

```text
store_line_channels.channel_access_token_ref
  -> req.lineStoreContext.channelAccessTokenRef
  -> resolveSecretRef(channelAccessTokenRef)
  -> lineSendContext.accessToken
  -> push/reply helper Authorization Bearer
```

Rules:

- `channel_access_token_ref` stores a reference such as `env:LINE_CHANNEL_ACCESS_TOKEN`, not a raw token.
- `resolveSecretRef` returns the raw secret as a non-enumerable field.
- Raw access tokens must never be logged, returned in JSON, stored in workflow events, or included in thrown error messages.
- Logs may include safe metadata:
  - `storeId`
  - `tenantId`
  - `lineChannelId`
  - `tokenSource`
  - `channelAccessTokenRefPresent`
  - `secretHashPrefix` from resolver audit, if already intentionally exposed by `resolveSecretRef`
  - failure reason such as `secret_env_missing` or `secret_blank`

## 6. Tokenized Webhook Context Direction

Current tokenized route:

```text
POST /api/line/webhook/:webhookPathToken
  -> resolveLineWebhookChannelContext(...)
  -> req.lineStoreContext
  -> verify signature with channelSecretRef
  -> return signature_verified_noop
```

Target processing direction:

```text
POST /api/line/webhook/:webhookPathToken
  -> resolveLineWebhookChannelContext(...)
  -> req.lineStoreContext
  -> resolveSecretRef(req.lineStoreContext.channelSecretRef)
  -> verify signature
  -> resolveSecretRef(req.lineStoreContext.channelAccessTokenRef)
  -> build lineSendContext
  -> dispatch events with lineSendContext
  -> replyToLine(..., { lineSendContext })
  -> sendLineMessageWithContext(..., { lineSendContext })
```

Target `lineSendContext` fields:

```js
{
  accessToken,
  tokenSource: "store_line_channels.channel_access_token_ref",
  storeId,
  tenantId,
  lineChannelId,
  channelAccessTokenRef,
  webhookPathTokenHash
}
```

`accessToken` must be treated as secret data and omitted from logs.

## 7. Legacy Webhook Fallback

The existing legacy route must keep its current global-token fallback during migration:

```text
POST /api/line/webhook
  -> verify with config.line.channelSecret
  -> build legacy lineSendContext from config.line.channelAccessToken
  -> dispatch existing workflow
```

Target legacy context:

```js
{
  accessToken: config.line.channelAccessToken,
  tokenSource: "legacy_config.line.channelAccessToken",
  storeId: null,
  tenantId: null,
  lineChannelId: null,
  channelAccessTokenRef: "legacy_env:LINE_CHANNEL_ACCESS_TOKEN"
}
```

Rules:

- Legacy route remains single-store/global by design.
- Legacy behavior should not be removed in the no-behavior-change phase.
- Legacy fallback must be clearly labeled in logs as legacy/global, without logging the raw token.
- Tokenized route must not silently fall back to the global token if its store-scoped token ref is missing or invalid. That should fail closed for tokenized processing.

## 8. Raw Token Logging Policy

Never log:

- LINE channel access token
- LINE channel secret
- Full credential ref values if they can reveal secret naming conventions that are considered sensitive by deployment policy
- Authorization header
- Full `lineSendContext` object if it contains `accessToken`

Allowed safe log helper output:

```js
{
  storeId,
  tenantId,
  lineChannelId,
  tokenSource,
  channelAccessTokenRefPresent: Boolean(channelAccessTokenRef),
  webhookPathTokenHash,
  secretResolved: true,
  secretHashPrefix
}
```

Recommended implementation rule:

Do not pass raw `lineSendContext` into generic logger calls. Use a sanitizer such as `summarizeLineSendContext(lineSendContext)`.

## 9. Function Signature Candidates

### Low-Level Explicit Helpers

Preferred new primitives:

```js
async function pushLineMessageWithToken({ accessToken, to, messages, auditContext = {} })
```

```js
async function replyLineMessageWithToken({ accessToken, replyToken, messages, auditContext = {} })
```

Pros:

- Small and testable.
- Token choice is explicit.
- Existing wrappers can call into them.
- No need to pass the full app config.

Cons:

- Callers must resolve or receive a token before sending.

### Context-Based Helpers

Alternative or wrapper shape:

```js
async function sendLineMessageWithContext(lineSendContext, to, messages)
```

```js
async function replyToLine(replyToken, messages, options = {})
// options.lineSendContext
// options.accessToken
```

Pros:

- Carries audit metadata with the token.
- Easier to propagate through workflow functions.
- Can support both tokenized and legacy contexts.

Cons:

- Needs sanitizer discipline so raw token is not logged accidentally.

### Compatibility Wrappers

Keep existing signatures temporarily:

```js
async function sendLineMessage(config, to, messages) {
  return pushLineMessageWithToken({
    accessToken: config.line.channelAccessToken,
    to,
    messages,
    auditContext: { tokenSource: "legacy_config.line.channelAccessToken" }
  });
}
```

```js
async function replyToLine(replyToken, messages, options = {}) {
  const context = options.lineSendContext || buildLegacyLineSendContext();
  return replyLineMessageWithToken({
    accessToken: context.accessToken,
    replyToken,
    messages,
    auditContext: summarizeLineSendContext(context)
  });
}
```

This keeps behavior unchanged while adding a path for explicit token injection.

## 10. Workflow Function Signature Candidates

Top-level webhook handlers:

```js
handleLinePostback(event, options = {})
handleLineSlashCommand(event, options = {})
handleCustomerMessageEvent(event, options = {})
handleStaffOperationalCommand(event, options = {})
```

Target options:

```js
{
  lineSendContext,
  storeContext,
  source: "legacy_webhook" | "tokenized_webhook"
}
```

Workflow customer push helpers:

```js
sendRepairEstimateQuotation(repairId, payload, staffId, source, connection, options = {})
notifyRepairCustomer(repairId, text, options = {})
sendLineOrderStatusUpdate(order, message, options = {})
sendRepairPickupReminders(options = {})
```

For authenticated routes, `options` can be populated from `req.storeId` after resolving the store's LINE channel token.

For Telegram callbacks and cron jobs, `options` should be derived from persisted store ownership:

- order store id
- repair order store id
- customer store id
- coupon/customer store id

## 11. Store Token Resolver Candidate

Candidate helper:

```js
async function resolveLineSendContextByStoreId(storeId, options = {})
```

Responsibilities:

- Query active `store_line_channels` for the store.
- Prefer default active channel if multiple channels become supported.
- Read `channel_access_token_ref`.
- Resolve through `resolveSecretRef`.
- Return `lineSendContext`.
- Return structured failure without raw secret.

Candidate failure reasons:

- `missing_store_id`
- `store_line_channels_table_missing`
- `line_channel_not_found`
- `line_channel_inactive`
- `channel_access_token_ref_missing`
- `secret_env_missing`
- `secret_blank`
- `secret_ref_unsupported_scheme`

No behavior-change phase note:

This helper can be introduced unused or used only by tests/staging dry routes first. Existing global wrappers remain intact.

## 12. Smallest Safe Refactor Candidate

Smallest safe sequence:

1. Add low-level explicit token helpers for push and reply.
2. Convert existing `sendLineMessage(config, ...)` to call the explicit push helper with global token.
3. Convert existing `replyToLine(...)` to call the explicit reply helper with global token unless `options.lineSendContext` is provided.
4. Add context sanitizer for logs.
5. Add `buildLegacyLineSendContext()` for current `/api/line/webhook`.
6. Do not change any call sites yet.
7. Add tests or stubs for helper token selection.
8. Migrate one low-risk authenticated push call to store-scoped context.
9. Migrate tokenized webhook event processing only after reply context propagation is complete.

Why this is safest:

- No existing behavior changes at the beginning.
- The global token remains the fallback for legacy routes.
- The explicit helper creates a single place to test and audit Bearer token selection.
- Later call-site migration can be incremental and reversible.

## 13. No Behavior Change Phase

The first implementation phase should guarantee:

- Existing routes still send with `config.line.channelAccessToken`.
- Existing `/api/line/webhook` behavior is unchanged.
- Tokenized `/api/line/webhook/:webhookPathToken` remains no-op unless a later phase explicitly enables processing.
- Function exports stay backward compatible.
- No DB schema changes.
- No credential changes.
- No webhook endpoint changes.

Allowed changes in that later implementation phase:

- Add new helper functions.
- Add optional `options` parameters that default to legacy behavior.
- Add tests for token selection.
- Add sanitized debug logs if needed.

Not allowed in no-behavior-change phase:

- Requiring store token resolution for existing sends.
- Removing global token fallback from legacy route.
- Enabling tokenized webhook event dispatch.
- Changing message content or workflow state transitions.

## 14. Staging Test Plan

### Unit / Local Stub Tests

Test explicit push helper:

- Given `accessToken = "token-a"`, outbound request uses `Authorization: Bearer token-a`.
- Given missing token, helper fails with safe error and no raw token output.
- Error response from LINE API does not include Authorization header in logs.

Test explicit reply helper:

- Given `accessToken = "token-b"`, reply request uses `Authorization: Bearer token-b`.
- `replyToken` is sent in body, not logs.
- Missing token fails closed.

Test wrappers:

- Existing `sendLineMessage(config, ...)` still uses `config.line.channelAccessToken`.
- Existing `replyToLine(replyToken, messages)` still uses legacy global context.
- `replyToLine(replyToken, messages, { lineSendContext })` uses the injected token.

### Resolver Tests

For `channelAccessTokenRef -> resolveSecretRef`:

- `env:LINE_CHANNEL_ACCESS_TOKEN` resolves when env exists.
- Missing env produces `secret_env_missing`.
- Blank env produces `secret_blank`.
- Raw literal ref is rejected.
- Sanitized audit includes no raw token.

### Tokenized Webhook Staging Tests

Before enabling event dispatch:

- Tokenized route resolves store/channel context.
- Signature verification uses resolved channel secret.
- Access token ref is resolved in a dry-run path only.
- Response remains no-op.

After explicit approval to enable staging dispatch:

- A test event received on tokenized route passes `lineSendContext` to all workflow handlers.
- Reply helper uses store-scoped token.
- Push helper uses store-scoped token for postback-triggered customer notifications.
- Legacy route still works with global fallback.

### Cross-Store Collision Tests

Use two fake channel refs:

- Store 1 token: `token-store-1`
- Store 2 token: `token-store-2`

Assertions:

- Store 1 webhook replies with `token-store-1`.
- Store 2 webhook replies with `token-store-2`.
- Store 2 order/purchase confirmation push never uses `token-store-1`.
- Cron grouping does not mix recipients across token contexts.

## 15. Production No-Go

Do not proceed to production with store-scoped LINE channels if any of these remain true:

- `replyToLine(...)` cannot accept an explicit token/context.
- Tokenized webhook event dispatch uses global token fallback.
- Customer-facing push sends still use only `config.line.channelAccessToken`.
- Telegram callback to LINE bridge has no store-derived token lookup.
- Repair reminder cron scans all stores and sends through one token.
- Raw LINE tokens can appear in logs, workflow events, API responses, or thrown errors.
- Settings UI reports LINE connected based only on global token in a multi-store mode.
- `store_line_channels.channel_access_token_ref` is missing, blank, duplicated in unsafe ways, or not resolved before sends.

Specific rule:

Tokenized webhook processing must fail closed when its store-scoped access token cannot be resolved. It must not silently use the global legacy token.

## 16. Rollback Plan

Design document rollback:

- Delete this document.
- No runtime rollback required.

No-behavior-change helper phase rollback:

- Revert helper additions and wrapper rewiring.
- Since wrappers preserve signatures, rollback complexity should be low.

First migrated route rollback:

- Restore that route to `sendLineMessage(config, ...)`.
- Keep explicit helper in place if other routes still use it.

Tokenized webhook dispatch rollback:

- Disable event dispatch on `/api/line/webhook/:webhookPathToken`.
- Return to `signature_verified_noop`.
- Keep legacy `/api/line/webhook` active with global token fallback.

Cron / Telegram bridge rollback:

- Revert those call sites to global-token wrappers only if production is still single-store.
- If production is already multi-store, rollback should disable the affected send path instead of falling back to the wrong token.

Credential rollback:

- No credential rollback should be required for this design.
- If future implementation changes refs, rollback by restoring previous `channel_access_token_ref` values only through an approved DB/env change process.

## 17. Recommended Next Step

Next safe implementation phase:

Add explicit push/reply token helper primitives and backward-compatible wrappers only. Do not migrate tokenized webhook processing, DB schema, credentials, or existing route behavior in that phase.
