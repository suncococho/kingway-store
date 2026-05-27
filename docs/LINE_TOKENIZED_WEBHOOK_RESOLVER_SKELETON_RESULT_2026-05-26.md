# LINE Tokenized Webhook Resolver Skeleton Result - 2026-05-26

## Scope

Document the implemented resolver-only skeleton for tokenized LINE webhook routing.

This result records code inspection and syntax-check outcome only. No code changes, DB changes, staging, commit, push, or deployment were performed as part of this documentation step.

## Modified Files

- `backend/src/routes/line.js`
  - Added tokenized webhook route skeleton.
  - Imported `resolveLineWebhookChannelContext`.
- `backend/src/utils/publicStoreResolver.js`
  - Added `resolveLineWebhookChannelContext` and helper behavior for webhook path token extraction, safe token validation, redacted logging context, fail-closed resolver result, and successful channel/store context creation.
  - Exported `resolveLineWebhookChannelContext`.
- `docs/LINE_TOKENIZED_WEBHOOK_RESOLVER_SKELETON_RESULT_2026-05-26.md`
  - Added this result document.

No DB migration file was modified for this skeleton result.

## Added Route

Added:

```text
POST /api/line/webhook/:webhookPathToken
```

Implementation location:

- `backend/src/routes/line.js`

Observed behavior:

- Calls `resolveLineWebhookChannelContext(req, { db: pool, logger: console })`.
- Assigns the result to `req.lineStoreContext`.
- If unresolved, returns a controlled failure response using the resolver failure status/reason.
- If resolved, logs a redacted resolver-only no-op message.
- Returns:

```json
{ "ok": true, "mode": "resolver_only" }
```

## Resolver-Only No-Op Behavior

The tokenized route is intentionally resolver-only:

- It resolves `webhookPathToken` to LINE channel/store context.
- It logs only redacted resolver information, including `webhookPathTokenHash`.
- It does not verify LINE signature yet.
- It does not parse or process LINE events.
- It does not reply to LINE.
- It does not push LINE messages.
- It does not call order, repair, coupon, phone-binding, customer, staff, or supplier workflow handlers.

This matches Phase A from the resolver-only wiring plan: prove route and channel/store resolution before enabling signature verification or event handling.

## Existing Webhook Route

The existing route remains present and separate:

```text
POST /api/line/webhook
```

Observed from `backend/src/routes/line.js`:

- The legacy route still starts at `router.post("/webhook", ...)`.
- It still uses the global `config.line.channelSecret` signature verification path.
- Existing LINE event handling behavior was not changed by the tokenized skeleton.

## Unknown Token Fail Closed

The tokenized route does not fall back to KINGWAY or any legacy default store.

Observed fail-closed resolver behavior:

- Missing token: `400`, reason `missing_path_token`.
- Invalid token format: `400`, reason `invalid_path_token_format`.
- Missing `store_line_channels` table: `503`, reason `store_line_channels_table_missing`.
- Unknown token / no mapping: `404`, reason `line_channel_mapping_not_found`.
- Defensive duplicate mapping: `409`, reason `line_channel_mapping_ambiguous`.
- Inactive channel mapping: `403`, reason `line_channel_mapping_inactive`.
- Inactive store: `403`, reason `line_channel_store_inactive`.

The route returns `ok: false`, `mode: "resolver_only"`, and the resolver reason for unresolved contexts.

## No DB Write Confirmation

Confirmed by code inspection:

- `POST /api/line/webhook/:webhookPathToken` itself only calls the resolver, sets `req.lineStoreContext`, logs, and returns JSON.
- `resolveLineWebhookChannelContext` reads `store_line_channels` joined with `stores` using `SELECT`.
- The resolver checks table presence and tenant-id select metadata, but does not insert, update, delete, replace, or create business data.
- The tokenized route does not call `logWorkflowEvent`, `claimLineWebhookEvent`, customer creation/update handlers, coupon issuance handlers, repair/order handlers, LINE reply/push helpers, or staff/supplier workflow handlers.

Important boundary:

- `backend/src/routes/line.js` still contains DB writes in the existing `/api/line/webhook` legacy event-processing route, but that route was not changed and is not invoked by the new tokenized resolver-only path.

No DB write command was run during this documentation step.

## `node --check` Result

Commands run:

```sh
node --check backend/src/routes/line.js
node --check backend/src/utils/publicStoreResolver.js
```

Result:

- `backend/src/routes/line.js`: pass, exit code `0`.
- `backend/src/utils/publicStoreResolver.js`: pass, exit code `0`.

Note:

- The shell emitted a locale warning: `setlocale: LC_ALL: cannot change locale (C.UTF-8)`.
- No Node syntax error was reported.

## Runtime Risk

- If LINE is configured to call the tokenized route in this phase, valid mapped webhook requests will return resolver-only success but events will not be processed.
- Signature verification is not active on the tokenized route yet, so the route must remain diagnostic/resolver-only and must not process events until Phase B is implemented.
- Resolver correctness depends on `store_line_channels.webhook_path_token`, channel status, and linked store status data.
- Unknown or inactive mappings fail closed, which is safer for store isolation but can surface as webhook delivery failures if staging seed data is incomplete.
- Logs include token hashes and store/channel IDs, not raw path tokens.

## Rollback Plan

Rollback is narrow because the legacy webhook route is unchanged.

1. Stop using the tokenized webhook URL in LINE/staging configuration.
2. Keep or restore LINE webhook URL to:

   ```text
   /api/line/webhook
   ```

3. Remove or disable only `router.post("/webhook/:webhookPathToken", ...)` if route rollback is required.
4. Remove or leave unused `resolveLineWebhookChannelContext` after confirming no callers remain.
5. Do not modify the existing `/api/line/webhook` route for rollback.
6. No DB rollback is required for this resolver skeleton itself because it performs no DB writes and adds no migration.

## Next Safe Step

Implement Phase B as a small, isolated change:

- Resolve `webhookPathToken` first.
- Resolve `channel_secret_ref` to the actual LINE channel secret through the approved credential mechanism.
- Verify `x-line-signature` using the resolved channel secret.
- Keep event processing disabled after successful signature verification until a separate narrow smoke-test phase.
- Keep the existing `/api/line/webhook` route unchanged.
- Add request-level tests or smoke checks for known token, unknown token, invalid token format, inactive mapping, and signature failure.
