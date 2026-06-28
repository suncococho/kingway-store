# KINGWAY Default LINE Channel Registration Runbook

Date: 2026-06-28
Scope: documentation only
Target: preparing the default KINGWAY LINE channel registration in `store_line_channels`

## 1. Purpose

This runbook describes how to prepare the default KINGWAY LINE Channel registration in `store_line_channels` while keeping the existing KINGWAY global LINE configuration active.

This phase is only a preparation step.

- It is not a webhook replacement.
- It is not a live LINE runtime migration.
- It is not a real LINE message sending test.
- It is a dry-run and management-screen preparation step.
- The purpose is to prepare the later SaaS store-level LINE Channel migration safely.

Adding a row to `store_line_channels` must not change the current live LINE behavior.

The current legacy `/api/line/webhook` must remain active until a separate channel-aware webhook migration is approved.

## 2. Current Confirmed State

The current global LINE configuration is still key-based. Only key names are documented here; values must not be written into this document.

Confirmed key names:

- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `LINE_UNIFIED_QA_GROUP_MODE`
- `LINE_QA_GROUP_ID`
- `LINE_CHANNEL_ID`
- `VITE_LIFF_ID`

Confirmed code behavior:

- `backend/src/config.js` reads `LINE_CHANNEL_ACCESS_TOKEN` into `config.line.channelAccessToken`.
- `backend/src/config.js` reads `LINE_CHANNEL_SECRET` into `config.line.channelSecret`.
- `backend/src/config.js` reads `LINE_UNIFIED_QA_GROUP_MODE` and `LINE_QA_GROUP_ID` for LINE group behavior.
- `frontend/src/lib/lineContext.js` and LINE customer-facing pages reference `VITE_LIFF_ID`.
- `backend/src/utils/lineSecretResolver.js` currently supports `env:` references, such as `env:LINE_CHANNEL_ACCESS_TOKEN` and `env:LINE_CHANNEL_SECRET`.
- Raw secret values or unsupported reference formats are rejected by the resolver.
- The legacy `/api/line/webhook` remains global-config based.
- Production `store_line_channels` count was confirmed as `0` before this runbook work.
- `/settings/line-channels` exists as the management UI.
- The dry-run target behavior is `actualLineApiCalled=false`.
- Staging dry-run row creation/reuse has been prepared in prior work, but a full authenticated `actualLineApiCalled=false` recheck has an unfinished segment due authentication-token availability. Recheck it before any production row registration.

Do not document raw token values, secret values, raw LINE userId values, or raw groupId values.

## 3. Current Runtime Model

Current live LINE flow:

```text
LINE Developers Console
  -> /api/line/webhook
  -> legacy/global LINE config
  -> current LINE order / repair / confirmation flows
```

This is the current production runtime path.

Adding a row to `store_line_channels` does not automatically change this path. At this stage, `store_line_channels` is a management and preparation table. Actual runtime migration must be implemented only in a later approved Phase C/D/E task.

## 4. Future Target Model

Future store-level LINE flow:

```text
LINE Developers Console
  -> channel-aware webhook route
  -> resolve store_line_channels by channel/webhook path
  -> inject company_id/store_id into LINE context
  -> resolve token/secret ref
  -> execute store-specific LINE workflow
```

This target supports store-specific LINE Official Accounts and Messaging API Channels.

- Direct stores use HQ-managed channels.
- Franchise stores can connect their own store channels.
- Independent stores can connect their own store channels.
- The legacy global fallback should remain during the first transition window.

## 5. Default KINGWAY Channel Registration Fields

The default KINGWAY row should include:

- `store_id`
- `ownership_type = HQ_MANAGED`
- `line_official_account_name`
- `line_official_account_id`
- `line_basic_id`
- `line_channel_id`
- `line_channel_secret_ref`
- `channel_access_token_ref`
- `liff_id`
- `webhook_path`
- `is_primary = true`
- `enabled = false`

Recommended initial values:

- `enabled = false`
- `connection_status = NOT_TESTED`

The row should first be created for management-screen visibility and dry-run validation. Changing `enabled` to `true` requires a separate approved task. Before a channel-aware webhook migration, this row must not be used for live LINE sending.

## 6. Secret and Token Policy

Strictly prohibited:

- Storing raw Channel Access Token values.
- Storing raw Channel Secret values.
- Entering `Bearer ...` values.
- Entering JWT-like `eyJ...` values.
- Logging raw token values.
- Logging raw secret values.
- Documenting or logging raw LINE userId or groupId values.

Allowed today:

- `env:LINE_CHANNEL_ACCESS_TOKEN`
- `env:LINE_CHANNEL_SECRET`

Potential future option:

- `secret://...` only if a separately approved secret backend is implemented and the resolver supports it. The current resolver should be treated as `env:` only.

UI/API display policy:

- Token ref should display only `已設定` / `未設定` or masked metadata.
- Secret ref should display only `已設定` / `未設定` or masked metadata.
- Channel ID may be masked when not needed in full.
- userId/groupId values must be masked.
- API responses must not return raw token or secret values.

## 7. Production Registration Pre-Checklist

Before registering the default row in production:

1. Confirm `git status` is clean.
2. Confirm the current HEAD.
3. Complete a production DB backup.
4. Confirm `store_line_channels` schema.
5. Confirm `store_line_channels` count.
6. Confirm the existing `/api/line/webhook` still works.
7. Confirm `/health` returns 200.
8. Confirm `/settings/line-channels` returns 200.
9. Confirm existing LINE order, repair, and confirmation flows are unaffected.
10. Confirm the target `store_id`.
11. Confirm `line_official_account_id`, `line_basic_id`, and `line_channel_id`.
12. Prepare token/secret references only, not raw values.
13. Confirm the row will be created with `enabled=false`.
14. Confirm only dry-run will be executed.
15. Confirm `actualLineApiCalled=false`.
16. Confirm no real LINE push/reply occurs.
17. Confirm logs do not contain raw token, secret, userId, or groupId values.

## 8. Production Registration Draft Procedure

Draft procedure for a later approved production registration task:

1. Create a production DB backup.
2. Check current `store_line_channels` count.
3. Create the default KINGWAY row through UI or API.
4. Keep `enabled=false`.
5. Execute dry-run.
6. Confirm dry-run result:
   - `connection_status = DRY_RUN_OK`
   - `actualLineApiCalled = false`
7. Recheck the `store_line_channels` row read-only.
8. Run route smoke checks:
   - `/health`
   - `/settings/line-channels`
   - `/settings/line-notifications`
   - `/orders`
   - `/store-visit-records`
9. Check backend logs.
10. Confirm the existing `/api/line/webhook` behavior is unaffected.
11. Do not change LINE Developers Console.

This is not a webhook migration. Do not send real LINE messages, and do not use real customer data for this preparation step.

## 9. Example Payload

The following payload is an example only. Use only approved production values in an approved production task.

```json
{
  "storeId": 1,
  "ownershipType": "HQ_MANAGED",
  "lineOfficialAccountName": "KINGWAY Default LINE",
  "lineOfficialAccountId": "782hapxg",
  "lineBasicId": "@kingway",
  "lineChannelId": "LINE_CHANNEL_ID_VALUE_OR_APPROVED_REF",
  "lineChannelSecretRef": "env:LINE_CHANNEL_SECRET",
  "channelAccessTokenRef": "env:LINE_CHANNEL_ACCESS_TOKEN",
  "liffId": "env:VITE_LIFF_ID",
  "webhookPath": "kingway-default",
  "isPrimary": true,
  "enabled": false
}
```

Important:

- `lineChannelId` is not a token.
- `lineChannelSecretRef` is not a raw secret.
- `channelAccessTokenRef` is not a raw access token.
- Actual values must be approved by the operator before production registration.

## 10. Dry-Run Behavior

Dry-run should validate configuration only.

Dry-run should check:

- Store exists.
- `line_channel_id` exists.
- `line_channel_secret_ref` exists.
- `channel_access_token_ref` exists.
- `webhook_path` exists.
- Webhook preview can be generated.
- `enabled` status is visible.
- `connection_status` can be updated.

Dry-run must not:

- Call the LINE API.
- Send push messages.
- Send reply messages.
- Change LINE Developers Console.
- Externally validate token status.
- Change customer LINE flow behavior.

Expected result:

- `connection_status = DRY_RUN_OK`
- `actualLineApiCalled = false`

## 11. Staging Verification Status

Known status from the preceding implementation phase:

- `store_line_channels` dry-run management was implemented and staging-tested.
- Raw token input blocking was verified in the `3cc632d` phase.
- Production has not created or dry-run-tested a real row.
- A staging default row creation/reuse path exists, but an authenticated recheck of `actualLineApiCalled=false` remains an unfinished segment due authentication-token availability.
- Recheck the staging dry-run with an authenticated admin session before production registration.

## 12. Things Not To Do Yet

Do not:

- Change the LINE Developers Console webhook URL.
- Remove the existing `/api/line/webhook`.
- Remove global fallback.
- Set the default row to `enabled=true`.
- Connect store-level runtime sending.
- Enable real LINE group push.
- Auto-link groupId candidates before a channel-aware `line_group_candidates` migration.
- Switch customer LINE workflow to store-level token resolve immediately.
- Create fake/test LINE rows in production without approval.

## 13. Next Phase C

Phase C should be a separate implementation task:

- Add a channel-aware webhook route, such as:
  - `/api/line/webhook/channel/:channelId`
  - `/api/line/webhook/store/:storeCode`
  - `/api/line/webhook/:webhookPath`
- Resolve `store_line_channels` by webhook path or channel.
- Inject `company_id` and `store_id` into LINE context.
- Resolve token/secret through the approved ref resolver.
- Keep the legacy `/api/line/webhook` fallback active.
- Do not change production LINE Developers Console until staging passes.

## 14. Rollback Concept

This documentation step needs no runtime rollback.

For a future row-registration step:

- If `enabled=false`, risk remains limited.
- If any issue appears, keep the row disabled.
- Do not drop schema.
- Keep legacy/global LINE settings active.
- Keep `/api/line/webhook` as the current live route.

## 15. Conclusion

The default KINGWAY LINE Channel registration is a preparation step for SaaS store-level LINE migration.

It is not a live LINE runtime migration.

Safe conditions:

- Use token/secret refs only.
- Keep `enabled=false`.
- Run dry-run only.
- Confirm `actualLineApiCalled=false`.
- Keep legacy webhook active.
- Do not change production webhook URL.

The default LINE channel registration must remain a safe, reversible preparation step until the channel-aware webhook migration is separately implemented and approved.
