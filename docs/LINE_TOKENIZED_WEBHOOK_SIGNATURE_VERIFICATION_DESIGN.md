# LINE Tokenized Webhook Signature Verification Design

## 1. Purpose

Design the next phase for `POST /api/line/webhook/:webhookPathToken` so the tokenized route can verify LINE signatures with the store/channel-specific secret referenced by `store_line_channels.channel_secret_ref`.

This is a design document only.

Do not use this document as approval to:

- modify application code
- modify database schema or data
- modify environment variables
- change LINE credentials
- change webhook URLs
- deploy
- stage, commit, or push git changes

## 2. Current Global Verification Structure

The existing production webhook route remains:

```text
POST /api/line/webhook
```

Current verification flow in `backend/src/routes/line.js`:

```text
req.rawBody
  + config.line.channelSecret
  + x-line-signature
  -> verifyLineSignature(...)
```

Current helper in `backend/src/utils/line.js`:

```text
verifyLineSignature(rawBody, channelSecret, signature)
```

The helper uses HMAC SHA256 with the provided channel secret and compares the base64 digest to `x-line-signature`.

Current route behavior after successful global verification:

- Reads LINE events from `req.body.events`.
- Logs webhook receipt.
- Claims/deduplicates events.
- Runs existing LINE workflow handlers.
- Replies/pushes through existing global LINE configuration paths.

This global route must remain unchanged in this phase.

## 3. Why Tokenized Route Must Resolve First

The tokenized route is:

```text
POST /api/line/webhook/:webhookPathToken
```

For a multi-store LINE architecture, the backend cannot verify the request before knowing which LINE channel secret to use.

Required order:

1. Extract `webhookPathToken`.
2. Resolve exactly one active `store_line_channels` row.
3. Confirm the linked store is active.
4. Read `channel_secret_ref` from the resolved row.
5. Resolve the ref to an actual secret value.
6. Verify `x-line-signature` with that secret.
7. Only then mark the context as signature-verified.

Reason:

- LINE signatures are channel-specific.
- `config.line.channelSecret` only proves the request belongs to the legacy global channel.
- A tokenized route is specifically the selector for store/channel context.
- Falling back to KINGWAY or another default store would hide misconfiguration and can attach traffic to the wrong store.

## 4. `channel_secret_ref` Design

`store_line_channels.channel_secret_ref` must store a credential reference, not a raw secret.

Recommended shape:

```text
env:LINE_CHANNEL_SECRET
env:LINE_CHANNEL_SECRET_STORE_1
env:LINE_CHANNEL_SECRET_STAGING_STORE_A
```

Rules:

- Do not store raw LINE channel secrets in `store_line_channels`.
- Do not include raw secrets in `req.lineStoreContext`.
- Do not log raw secrets.
- Treat `channel_secret_ref` as configuration metadata.
- Resolve the raw value only inside the narrow verification function/scope.
- Discard the raw value immediately after verification.

Recommended context after resolve, before verification:

```js
{
  storeId: 1,
  tenantId: 1,
  source: "line_channel",
  lineChannelId: "REDACTED",
  channelSecretRef: "env:LINE_CHANNEL_SECRET_STAGING_STORE_A",
  webhookPathTokenHash: "sha256:...",
  legacyFallbackUsed: false,
  signatureVerified: false
}
```

Recommended context after valid signature:

```js
{
  ...lineStoreContext,
  signatureVerified: true,
  signatureVerifiedAt: "2026-05-27T00:00:00.000Z"
}
```

Do not add the raw secret to either context.

## 5. Ref Lookup Strategy

Initial approved ref type:

```text
env:NAME
```

Lookup behavior:

1. Require `channel_secret_ref` to be a non-empty string.
2. Require the format to match `env:<ENV_VAR_NAME>`.
3. Require `<ENV_VAR_NAME>` to match a conservative environment variable name pattern:

   ```text
   ^[A-Z][A-Z0-9_]*$
   ```

4. Read the value from `process.env[ENV_VAR_NAME]`.
5. Reject if the value is missing or empty.
6. Return the secret value only to the signature verification call site.

Example:

```text
channel_secret_ref = env:LINE_CHANNEL_SECRET_STAGING_STORE_A
process.env.LINE_CHANNEL_SECRET_STAGING_STORE_A = <actual LINE channel secret>
```

Explicitly out of scope for this phase:

- Secret manager integration.
- Encrypted DB secret storage.
- Automatic credential rotation.
- Multiple ref schemes.
- Resolving channel access token refs for reply/push.

## 6. Raw Secret Logging Ban

Never log:

- raw LINE channel secret
- raw LINE channel access token
- full `webhookPathToken`
- full request body
- full customer payload
- raw env var value

Allowed log metadata:

- route with path token redacted
- `webhookPathTokenHash`
- `storeId` after successful resolve
- `tenantId` after successful resolve
- `lineChannelId` after successful resolve
- `channelSecretRef` only if needed and not sensitive by policy
- failure reason
- HTTP status
- `signatureVerified: true/false`

Prefer not to log `channelSecretRef` in high-volume request logs unless needed for staging diagnostics.

## 7. Failure Handling

All tokenized route failures must fail closed and must not fall back to the legacy route.

### Unknown, Disabled, or Ambiguous Channel Mapping

Reject before secret lookup:

| Case | Recommended status | Reason |
| --- | --- | --- |
| missing path token | `400` | `missing_path_token` |
| invalid token format | `400` | `invalid_path_token_format` |
| unknown token | `404` | `line_channel_mapping_not_found` |
| duplicate mapping | `409` | `line_channel_mapping_ambiguous` |
| inactive channel mapping | `403` | `line_channel_mapping_inactive` |
| inactive store | `403` | `line_channel_store_inactive` |

### Missing or Invalid Secret Ref

Reject before signature verification:

| Case | Recommended status | Reason |
| --- | --- | --- |
| missing `channel_secret_ref` | `500` in staging | `line_channel_secret_ref_missing` |
| unsupported ref scheme | `500` in staging | `line_channel_secret_ref_unsupported` |
| invalid env var name | `500` in staging | `line_channel_secret_ref_invalid` |
| env var missing/empty | `500` in staging | `line_channel_secret_unavailable` |

Production note:

- Any missing or invalid secret ref is a production no-go condition.
- Do not enable production tokenized routing until all active channel rows have resolvable secret refs.

### Missing or Invalid Signature

Reject before event processing:

| Case | Recommended status | Reason |
| --- | --- | --- |
| missing `x-line-signature` | `401` | `line_signature_missing` |
| HMAC mismatch | `401` | `line_signature_invalid` |

Do not expose whether the secret exists in the invalid-signature response body.

## 8. Valid Signature Still No-op

After a valid tokenized signature in this phase:

- Set `req.lineStoreContext.signatureVerified = true`.
- Log redacted verification success metadata.
- Return a controlled no-op response.
- Do not process LINE events yet.
- Do not call existing workflow handlers.
- Do not reply to LINE.
- Do not push LINE messages.
- Do not write customer/order/repair/coupon/staff/supplier data.

Recommended response:

```json
{
  "ok": true,
  "mode": "signature_verification_only",
  "signatureVerified": true
}
```

This keeps Phase B limited to proving the security boundary. Event processing remains a later phase.

## 9. Existing Global Route Strategy

Keep this route unchanged:

```text
POST /api/line/webhook
```

Strategy:

- Continue verifying with `config.line.channelSecret`.
- Continue current event processing behavior.
- Continue existing reply/push behavior.
- Do not share tokenized route failures with this route.
- Do not use `channel_secret_ref` on this legacy route in this phase.
- Do not move existing production LINE Developer Console webhook URL.

The global route remains the legacy production compatibility path while the tokenized route is verified in staging.

## 10. Staging Mock Credential Limits

Staging can use mock env names and locally controlled test values to validate ref parsing and failure handling, but that is not enough for production readiness.

Limits:

- A mock secret only proves code path mechanics.
- A locally generated signature only proves HMAC compatibility, not LINE delivery behavior.
- A mock `channel_secret_ref` does not prove the real LINE Developer Console channel secret is correctly configured.
- A test request cannot prove LINE retry behavior, event shape, or raw body capture under the actual ingress path.
- Staging no-op success does not prove reply/push token separation.

Required before production:

- Test with a real staging LINE channel.
- Use the exact raw body received through the deployed HTTP stack.
- Confirm the resolved secret ref matches the staging LINE channel secret.
- Confirm logs do not leak raw token or secret material.

## 11. Test Plan

Prechecks:

1. Confirm no production webhook URL change.
2. Confirm no credential or env change is made without explicit approval.
3. Confirm `POST /api/line/webhook` still uses global verification.
4. Confirm tokenized route still returns no-op after success.

Resolver failure tests:

1. Missing path token: expect fail closed before secret lookup.
2. Invalid token format: expect fail closed before DB mapping use.
3. Unknown token: expect `404`, no legacy fallback.
4. Inactive mapping: expect `403`, no legacy fallback.
5. Inactive store: expect `403`, no legacy fallback.

Secret ref tests:

1. Missing `channel_secret_ref`: expect closed failure.
2. Unsupported scheme such as `file:` or raw text: expect closed failure.
3. Invalid env name: expect closed failure.
4. Env var missing: expect closed failure.
5. Env var empty: expect closed failure.
6. Valid `env:NAME`: proceed to signature verification.

Signature tests:

1. Missing `x-line-signature`: expect `401`.
2. Invalid signature with valid token/ref: expect `401`.
3. Valid signature with valid token/ref: expect no-op success.
4. Confirm `signatureVerified` is true only for the valid-signature path.

No-write/no-side-effect checks:

1. Confirm no event claim is created.
2. Confirm no customer is created or updated.
3. Confirm no phone binding occurs.
4. Confirm no coupon is issued.
5. Confirm no order or repair row is created or updated.
6. Confirm no LINE reply/push is sent.

Legacy regression checks:

1. Existing `/api/line/webhook` still rejects invalid global signature.
2. Existing `/api/line/webhook` still accepts valid global signature.
3. Tokenized route failure does not call legacy route behavior.

## 12. Rollback Plan

Production rollback:

- No production webhook URL should have changed.
- Keep `/api/line/webhook` active with existing global verification.
- Stop any staging use of `/api/line/webhook/:webhookPathToken`.

Code rollback for a later implementation:

- Revert only the tokenized signature-verification additions.
- Keep the existing resolver skeleton isolated.
- Keep existing `/api/line/webhook` untouched.
- Do not add route-local fallback store IDs.

Credential rollback:

- Do not rotate LINE credentials unless a secret leak is confirmed.
- If a ref is wrong, correct or disable the mapping through an approved config/DB change.
- If a secret is unavailable, keep the mapping inactive or keep tokenized route unused.

Operational rollback verification:

- Existing production LINE webhook still verifies with global secret.
- Existing LINE workflows still process through the legacy route.
- Tokenized route either remains no-op or is disabled from staging traffic.

## 13. Production No-go Conditions

Do not enable production tokenized signature verification if any condition is true:

- `POST /api/line/webhook` behavior has not been protected as unchanged legacy behavior.
- Any active `store_line_channels` row has missing `channel_secret_ref`.
- Any active `channel_secret_ref` points to a missing or empty env var.
- Raw secrets are stored in DB rows.
- Raw secrets, full webhook path tokens, or full request bodies appear in logs.
- Tokenized route can fall back to KINGWAY or the global route.
- Tokenized route verifies with `config.line.channelSecret`.
- Valid tokenized signature starts event processing before the no-op phase is approved.
- Staging has not tested unknown token, inactive mapping, missing secret, invalid signature, and valid signature.
- Raw body capture has not been verified through the deployed staging HTTP stack.
- Rollback has not been rehearsed.

## 14. Next Safe Implementation Step

Smallest safe implementation step:

1. Add a narrow helper to resolve only `env:` credential refs.
2. In `POST /api/line/webhook/:webhookPathToken`, after `resolveLineWebhookChannelContext`, resolve `lineStoreContext.channelSecretRef`.
3. Verify `req.rawBody` and `x-line-signature` with the resolved secret.
4. On failure, return fail-closed status without event processing.
5. On success, set `signatureVerified: true` and return no-op JSON.
6. Add focused tests or smoke checks for missing ref, missing env, missing signature, invalid signature, and valid signature.
7. Leave existing `POST /api/line/webhook` unchanged.

Still out of scope after this next step:

- LINE event processing on tokenized route.
- Customer/order/repair/coupon writes.
- LINE reply/push with resolved access token refs.
- Production webhook URL changes.
- LINE credential changes.
