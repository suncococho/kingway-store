# Store LINE Settings Plan

Date: 2026-06-03
Branch: `beta/staging-architecture`

## 1. Purpose

This document defines the design for store-scoped LINE settings in the KINGWAY multi-store SaaS architecture.

Backend-only API Phase was implemented on `2026-06-03`.

Implemented in this phase:

- idempotent bootstrap for `store_line_settings`
- `GET /api/store/settings/line`
- `PATCH /api/store/settings/line`
- masked response behavior for token/secret fields
- `req.storeId`-scoped persistence only

Still not implemented in this phase:

- Store Admin UI
- Platform Admin LINE settings UI/API
- actual LINE webhook/runtime switching
- actual LIFF resolver switching
- raw secret encrypted-at-rest persistence
- any customer-facing OA flow changes

Do not use this document as approval to:

- modify production config
- modify production `.env`
- print raw LINE tokens or secrets
- change the existing customer LINE OA / Business flow
- change the existing legacy webhook behavior
- deploy credential changes
- change runtime credential resolution without a later approved phase

Primary references:

1. `docs/KINGWAY_STORE_MASTER_SPEC.md`
2. `docs/STORE_ADMIN_SETTINGS_PLAN.md`
3. `docs/LINE_MULTI_STORE_RESOLVER_PLAN.md`
4. `docs/STORE_LINE_CHANNELS_RESOLVER_ONLY_WIRING_PLAN.md`
5. `docs/LINE_SEND_TOKEN_INJECTION_DESIGN.md`
6. `docs/STAFF_LINE_GROUP_NOTIFICATION_PLAN.md`

## 2. Goals

The store LINE settings phase should make it possible for each store to maintain its own:

- LINE Official Account identity
- Messaging API channel binding
- LIFF IDs and public entry URLs
- webhook path metadata
- staff notification group routing metadata

Without:

- exposing raw secret values in UI or logs
- breaking the current single-store legacy KINGWAY 台南 flow
- forcing production credential migration in the same phase

## 3. Non-goals

This phase does not implement:

- real token rotation
- secret manager integration rollout
- actual webhook route behavior changes
- actual LIFF resolver behavior changes
- customer-facing OA message flow rewrites
- Telegram removal
- legacy `/api/line/webhook` removal
- store-scoped reply/push runtime changes

## 3-1. Current implemented backend scope

The current backend API stores a dedicated store-scoped LINE settings record in `store_line_settings`.

Stored fields:

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
- `updated_by_staff_id`

Important limitation:

- the current project only has an `env:` secret-ref resolver
- there is no DB encryption helper for raw LINE secret/token values
- therefore this phase does not persist raw `channelSecret` or raw `channelAccessToken`
- if a caller sends a non-empty raw secret/token, the API records only presence metadata and returns a masked pending-storage state
- if a caller sends `env:SECRET_NAME`, the API stores that secret ref and still returns only a masked value

## 4. Design Principles

### 4-1. Store-scoped ownership

Each store owns its own LINE configuration.

Scope source:

- Store Admin reads/writes only the authenticated `req.storeId`
- Platform Admin reads any store by `:id`

No client-provided `store_id` may be trusted.

### 4-2. Raw secret non-disclosure

Raw values must never be:

- returned in API response
- written to browser logs
- written to backend logs
- included in thrown error messages
- shown in Platform Admin status views

### 4-3. Legacy-safe rollout

Existing legacy route must remain:

- `POST /api/line/webhook`

Existing KINGWAY 台南 customer flow must remain unchanged until later migration phases.

### 4-4. Public-safe separation

Public-safe metadata may be returned to Store Admin UI:

- status
- enabled flag
- webhook URL
- LIFF URL
- masked identifiers
- updated time

Secret-bearing material must remain internal-only.

## 5. Settings Scope

Recommended store-scoped LINE settings payload shape for future service normalization:

```json
{
  "enabled": false,
  "status": "not_configured",
  "oaBasic": {
    "displayName": "",
    "oaManagerNote": ""
  },
  "messagingApi": {
    "channelId": "",
    "channelSecretMasked": "",
    "channelSecretRef": null,
    "channelAccessTokenMasked": "",
    "channelAccessTokenRef": null,
    "tokenLastRotatedAt": null
  },
  "webhook": {
    "mode": "legacy",
    "pathToken": null,
    "pathTokenMasked": "",
    "url": "",
    "legacyUrl": "/api/line/webhook",
    "candidateUrl": "",
    "verificationStatus": "not_started",
    "lastVerifiedAt": null
  },
  "liff": {
    "entryLiffId": "",
    "entryLiffUrl": "",
    "orderLiffId": "",
    "orderLiffUrl": "",
    "repairLiffId": "",
    "repairLiffUrl": "",
    "reviewLiffId": "",
    "reviewLiffUrl": "",
    "purchaseConfirmLiffId": "",
    "purchaseConfirmLiffUrl": "",
    "supportLiffId": "",
    "supportLiffUrl": ""
  },
  "staffGroups": {
    "managerGroupIdMasked": "",
    "managerGroupStatus": "unregistered",
    "repairGroupIdMasked": "",
    "repairGroupStatus": "unregistered",
    "salesGroupIdMasked": "",
    "salesGroupStatus": "unregistered",
    "reviewGroupIdMasked": "",
    "reviewGroupStatus": "unregistered",
    "dailyReportGroupIdMasked": "",
    "dailyReportGroupStatus": "unregistered"
  },
  "audit": {
    "updatedAt": null,
    "updatedByStaffId": null
  }
}
```

## 6. Field Definitions

### 6-1. `enabled`

Meaning:

- whether the store intends to use store-scoped LINE configuration

Rules:

- `false` keeps the store on placeholder or legacy-safe mode
- `true` does not automatically switch runtime traffic in this design phase

### 6-2. `status`

Recommended values:

- `not_configured`
- `draft`
- `credentials_saved`
- `webhook_pending`
- `ready_for_staging`
- `active`
- `error`

Purpose:

- summarize setup state in Store Admin and Platform Admin

### 6-3. `oaBasic`

Fields:

- `displayName`
- `oaManagerNote`

Purpose:

- operator-facing identity note only
- not used for credential resolution

### 6-4. `messagingApi`

Fields:

- `channelId`
- `channelSecretRef`
- `channelAccessTokenRef`
- masked display fields
- rotation metadata

Rules:

- `channelId` may be shown in masked or full non-secret form depending on UI policy
- `channelSecretRef` stores a secret reference or encrypted-field marker
- `channelAccessTokenRef` stores a secret reference or encrypted-field marker
- masked fields are derived output, not source of truth

### 6-5. `webhook`

Fields:

- `mode`
- `pathToken`
- `url`
- `legacyUrl`
- `candidateUrl`
- verification metadata

Recommended `mode` values:

- `legacy`
- `store_scoped_candidate`
- `store_scoped_active`

Rules:

- in early phases, all existing stores may remain effectively `legacy`
- `candidateUrl` is for future webhook rollout planning only
- no actual runtime switch occurs in this design phase

### 6-6. `liff`

Recommended LIFF entries are split by business flow because KINGWAY uses multiple customer actions:

- customer center entry
- order / reservation
- repair reservation
- Google review request
- purchase confirmation
- support handoff

Reason:

- different LIFF apps may need different scopes or menu entry points
- future per-store public URLs must not assume one global LIFF id

### 6-7. `staffGroups`

Recommended operator-facing logical groups:

- `managerGroup`
- `repairGroup`
- `salesGroup`
- `reviewGroup`
- `dailyReportGroup`

Purpose:

- clarify which operational notifications should go to which store group

Important:

- this phase does not replace existing `line_group_registrations`
- future implementation may derive or sync from existing registration data instead of creating a brand-new table immediately

## 7. Storage Strategy

## Preferred direction

Store LINE settings should live under store-scoped settings payload, but secret-bearing values must not be stored as plain text JSON.

Recommended split:

- non-secret metadata stored in `app_settings` `STORE_PROFILE` or a dedicated future `STORE_LINE_SETTINGS` scope
- secret-bearing values stored as:
  - secret reference strings such as `env:...`, `vault:...`, `dbenc:...`
  - or encrypted columns in a dedicated table

## Recommended practical approach for Phase 3 API

Use a dedicated store LINE settings service with two layers:

1. public-safe normalized settings snapshot
2. protected persistence model for secret refs

Recommended logical record model:

```json
{
  "storeId": 2,
  "enabled": true,
  "channelId": "2007xxxxxx",
  "channelSecretRef": "dbenc:store_line_settings:2:channel_secret",
  "channelAccessTokenRef": "dbenc:store_line_settings:2:channel_access_token",
  "webhookPathTokenRef": "dbenc:store_line_settings:2:webhook_path_token",
  "entryLiffId": "2007xxxxxx-abc123",
  "orderLiffId": "",
  "repairLiffId": "",
  "reviewLiffId": "",
  "purchaseConfirmLiffId": "",
  "supportLiffId": "",
  "status": "draft",
  "updatedAt": "2026-06-03T00:00:00Z"
}
```

## Why not plain JSON only

Plain JSON in `app_settings.payload_json` is not sufficient for secrets because:

- secrets are too easy to leak through generic logs or debug dumps
- platform/store settings endpoints already return JSON payloads
- future masking and audit controls become harder if raw values are mixed into ordinary payload blobs

## 8. Secret Persistence Options

### Option A: secret ref only

Store only references:

- `env:STORE2_LINE_CHANNEL_SECRET`
- `env:STORE2_LINE_CHANNEL_ACCESS_TOKEN`

Pros:

- avoids DB raw secret storage
- simple masking policy

Cons:

- requires env/config rollout per store
- conflicts with the instruction to avoid production config churn for every setup

### Option B: encrypted DB fields

Store encrypted values in DB through a dedicated table or dedicated encrypted columns.

Pros:

- Store Admin API can save credentials without production `.env` edits
- more scalable for SaaS

Cons:

- needs application encryption key management
- adds encryption/decryption code and operational controls

### Option C: hybrid

Recommended direction:

- support both secret refs and encrypted DB values through one resolver interface
- start with encrypted DB fields or `dbenc:` references for SaaS stores
- keep legacy env-backed global config for KINGWAY 台南 route compatibility

## 9. Recommended DB Direction

For future implementation, prefer a dedicated table instead of overloading `STORE_PROFILE`.

Recommended conceptual table:

```sql
CREATE TABLE store_line_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(40) NOT NULL DEFAULT 'not_configured',
  oa_display_name VARCHAR(190) NULL,
  oa_manager_note VARCHAR(255) NULL,
  channel_id VARCHAR(120) NULL,
  channel_secret_ref VARCHAR(255) NULL,
  channel_access_token_ref VARCHAR(255) NULL,
  webhook_mode VARCHAR(40) NOT NULL DEFAULT 'legacy',
  webhook_path_token_ref VARCHAR(255) NULL,
  entry_liff_id VARCHAR(120) NULL,
  order_liff_id VARCHAR(120) NULL,
  repair_liff_id VARCHAR(120) NULL,
  review_liff_id VARCHAR(120) NULL,
  purchase_confirm_liff_id VARCHAR(120) NULL,
  support_liff_id VARCHAR(120) NULL,
  manager_group_id_masked VARCHAR(80) NULL,
  repair_group_id_masked VARCHAR(80) NULL,
  sales_group_id_masked VARCHAR(80) NULL,
  review_group_id_masked VARCHAR(80) NULL,
  daily_report_group_id_masked VARCHAR(80) NULL,
  updated_by_staff_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_line_settings_store (store_id)
);
```

Notes:

- masked group fields above are only conceptual placeholders
- actual raw group ids should not be persisted in display-oriented columns without masking strategy
- future implementation may separate group registration state from store settings metadata

## 10. API Design for Future Phase 3

This section is design only. No API implementation in this phase.

### `GET /api/store/line-settings`

Purpose:

- return a store-scoped, public-safe LINE settings snapshot for the authenticated store

Auth:

- staff auth required
- `req.storeId` required

Recommended role:

- `ADMIN`, `MANAGER` read allowed

Response shape:

```json
{
  "lineSettings": {
    "enabled": true,
    "status": "draft",
    "oaBasic": {
      "displayName": "KINGWAY 高雄 LINE OA",
      "oaManagerNote": ""
    },
    "messagingApi": {
      "channelId": "2007xxxxxx",
      "channelSecretMasked": "已儲存",
      "channelAccessTokenMasked": "已儲存",
      "tokenLastRotatedAt": null
    },
    "webhook": {
      "mode": "legacy",
      "url": "/api/line/webhook",
      "candidateUrl": "https://.../api/line/webhook/<masked>",
      "verificationStatus": "not_started"
    },
    "liff": {
      "entryLiffId": "",
      "orderLiffId": "",
      "repairLiffId": "",
      "reviewLiffId": "",
      "purchaseConfirmLiffId": "",
      "supportLiffId": ""
    },
    "staffGroups": {
      "managerGroupStatus": "unregistered",
      "repairGroupStatus": "registered",
      "salesGroupStatus": "unregistered",
      "reviewGroupStatus": "unregistered",
      "dailyReportGroupStatus": "registered"
    },
    "audit": {
      "updatedAt": "2026-06-03T00:00:00Z",
      "updatedByStaffId": 12
    }
  }
}
```

### `PATCH /api/store/line-settings`

Purpose:

- update store-scoped LINE settings without exposing raw values after write

Auth:

- staff auth required
- `req.storeId` required
- `ADMIN` or `MANAGER` write required

Rules:

- ignore any client-provided `store_id`
- never echo raw `channelSecret`, `accessToken`, or `webhookPathToken`
- persist secret values as secret refs or encrypted values
- return masked snapshot only

Accepted write categories:

- enable flag
- OA operator note
- channel id
- channel secret input
- channel access token input
- LIFF ids
- webhook mode metadata

Not in scope for PATCH:

- live credential verification against LINE API
- test send with real token
- webhook switch-over

## 11. UI Design for Later Phase

Future store admin page:

- `/settings/line`

Sections:

1. LINE 狀態總覽
2. Messaging API credentials
3. Webhook settings
4. LIFF settings
5. Staff notification groups

Visible rules:

- zh-TW only
- tokens never shown in full
- secrets represented by:
  - `已儲存`
  - `尚未設定`
  - `已更新`

Suggested credential field behavior:

- empty input means keep existing secret
- explicit replace action required to change saved secret
- success message must never mention the raw value

## 12. Webhook URL Strategy

Existing legacy route must remain:

- `/api/line/webhook`

Future candidate store-scoped route:

- `/api/line/webhook/:webhookPathToken`

Design rules:

- do not activate in this phase
- do not repoint customer traffic in this phase
- do not fallback from tokenized route to global route

Store settings should therefore display both:

- legacy webhook URL
- future candidate webhook URL

Recommended display semantics:

- `目前正式 webhook：/api/line/webhook`
- `未來門市專屬 webhook：/api/line/webhook/<masked-token>`

## 13. LIFF Structure Strategy

Recommended baseline:

- one required entry LIFF per store
- optional dedicated LIFF ids per business flow

Minimum fields for initial rollout:

- `entryLiffId`
- `repairLiffId`
- `reviewLiffId`
- `purchaseConfirmLiffId`

Optional later additions:

- `orderLiffId`
- `supportLiffId`

Why not one LIFF for everything:

- future store-scoped public routing may separate business flows
- purchase confirmation and repair flows can have different access assumptions
- one LIFF ID for all flows makes migration harder when scopes diverge

## 14. Staff Group Strategy

Current system already has LINE group registration behavior.

Recommended near-term design:

- store LINE settings page should show logical store group states
- runtime may continue reading from `line_group_registrations`
- a resolver layer can map store + role intent to active registration

Recommended statuses:

- `unregistered`
- `registered`
- `inactive`
- `legacy_shared`

Important safety rule:

- do not expose full raw group ids in Store Admin UI
- show masked values only when needed

## 15. Logging Policy

Never log:

- raw channel secret
- raw access token
- raw webhook path token
- raw LIFF secret or client secret if ever introduced
- full group id if policy treats it as sensitive operational metadata

Allowed safe log fields:

- `storeId`
- `status`
- `enabled`
- `channelIdPresent`
- `channelSecretPresent`
- `channelAccessTokenPresent`
- `webhookMode`
- `candidateWebhookConfigured`
- `entryLiffIdPresent`
- per-group registration status

## 16. Backward Compatibility

During the design and early implementation phases:

- legacy KINGWAY 台南 runtime stays global
- existing OA message behavior remains unchanged
- existing Telegram integrations remain unchanged
- existing LINE group registration remains unchanged

Store-scoped LINE settings can therefore exist in `draft` or `ready_for_staging` state without affecting production behavior.

## 17. Recommended Implementation Sequence

1. Design doc only
2. Store Admin `GET /api/store/line-settings`
3. Store Admin `PATCH /api/store/line-settings`
4. `/settings/line` UI
5. Platform Admin status-only view
6. store-scoped webhook resolver documentation and no-behavior-change route skeleton
7. secret-backed reply/push abstraction
8. targeted staging-only store-scoped webhook verification
9. final KINGWAY 台南 migration

## 18. Open Questions

Questions to resolve before implementation:

- Will Phase 3 store secret values as encrypted DB fields immediately, or use a secret-ref abstraction backed by the DB?
- Should LIFF ids be one per flow from day one, or should unused fields remain optional placeholders?
- Should staff group status be fully derived from `line_group_registrations`, or partially cached in store settings for admin UX speed?
- Should Platform Admin later be allowed to force-disable a store LINE configuration without editing credentials?

## 19. Phase Output

This phase produces:

- design for store-scoped LINE settings
- secret-handling boundaries
- future API contract draft
- future UI contract draft
- webhook and LIFF linkage plan

This phase does not produce:

- code changes
- env changes
- DB migrations
- credential rollout
- webhook behavior changes
