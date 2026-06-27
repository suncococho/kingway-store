# KINGWAY Store-Level LINE Channel Management Design

Date: 2026-06-27

Scope: audit and design only. This document does not introduce code changes, DB migration, production deploy, DB writes, or LINE sending.

## A. Current Structure Audit

### `backend/src/config.js`

- Role: central runtime config for the current KINGWAY LINE integration.
- Current dependency: `config.line.channelAccessToken` and `config.line.channelSecret` are global singleton credentials sourced from environment variables.
- Multi-channel gap: customer, staff, supplier, and webhook flows can still fall back to the same global token/secret. This is not enough for store-level LINE Official Accounts.
- Risk: if a future store-specific route accidentally uses the global token fallback, a message can be sent from the wrong LINE channel.

### `backend/src/utils/line.js`

- Role: shared LINE signature verification, reply, push, and token resolution helpers.
- Current capability: `normalizeLineSendContext()` already accepts store/channel-shaped context such as `storeId`, `storeCode`, `lineChannelId`, `channelAccessTokenRef`, and `channelSecretRef`.
- Current compatibility behavior: `resolveLineAccessToken()` can use scoped credentials, but it also supports global token fallback unless explicitly disabled.
- Multi-channel gap: all call sites must pass store/channel context and should set fallback policy intentionally.
- Risk: LINE send failures include response details in thrown errors. Future work should continue avoiding raw token, full groupId, or raw userId output.

### `backend/src/utils/lineSecretResolver.js`

- Role: resolves secret references.
- Current capability: supports `env:` references and rejects raw literal secret refs.
- Multi-channel fit: this is a good foundation for `channel_access_token_ref` and `line_channel_secret_ref`.
- Gap: a canonical store-level channel table should use secret refs or encrypted secrets only. Plain credential storage should be avoided.

### `backend/src/services/storeLineSettingsService.js`

- Role: existing store-scoped LINE settings prototype around `store_line_settings`.
- Current fields include store id, channel id, webhook path, LIFF URL, login auth URL, customer OA name, `channel_secret_ref`, `channel_access_token_ref`, and direct credential value fields.
- Current capability: generates a store webhook path and resolves store credentials.
- Multi-channel gap: this table is a settings prototype, not a complete channel ownership model. It does not express `HQ_MANAGED`, `FRANCHISE_OWNED`, or `INDEPENDENT_OWNED`.
- Security risk: direct credential value fields conflict with the preferred long-term rule that raw access tokens and channel secrets should not be stored directly in the DB.

### `backend/src/bootstrap.js`

- Role: creates runtime-support tables including `store_line_settings`, `line_webhook_events`, and `line_chat_sessions`.
- Current behavior: `store_line_settings` can be created by backend bootstrap.
- Multi-channel gap: the requested canonical design should use explicit migrations for `store_line_channels`, not production schema creation from backend startup.
- Risk: schema writes during application startup conflict with the production migration discipline used elsewhere in KINGWAY.

### `backend/src/utils/publicStoreResolver.js`

- Role: resolves public store context for customer-facing routes.
- Current capability: includes draft support for resolving by LINE channel and LIFF id. It references `store_line_channels` if that table exists.
- Current gap: no active migration for canonical `store_line_channels` is present in this audit. The current production-ready implementation still relies on legacy fallback and existing store context routes.
- Multi-channel fit: this is the right direction for injecting `store_id`, `company_id`, `line_channel_id`, token refs, and webhook context before routing LINE events.

### `backend/src/routes/line.js`

- Role: main LINE webhook route.
- Current routes:
  - Legacy `/api/line/webhook` route verifies with the global channel secret.
  - Tokenized `/api/line/webhook/:webhookPathToken` route resolves `store_line_settings`, verifies with scoped credentials, and currently behaves as a limited dry-run/ping skeleton.
- Current group candidate behavior: group or room messages containing `KINGWAY` are detected and saved through `lineGroupCandidateService`.
- Multi-channel gap: the legacy route still processes real customer workflows with global credentials, while the tokenized route does not yet route full LINE customer/order/repair workflows.
- Risk: switching the full webhook too quickly can break all customer LINE interactions.

### `backend/src/routes/lineOrder.js`

- Role: public LINE order reservation flow.
- Current store context: uses public store context middleware with a legacy KINGWAY fallback store.
- Multi-channel gap: the flow is store-aware for business data, but not yet channel-aware for LIFF/OA token selection.
- Risk: generated links and subsequent messaging must resolve the correct store channel before multi-channel rollout.

### `backend/src/routes/lineRepair.js`

- Role: public LINE repair reservation flow.
- Current store context: uses public store context middleware and legacy fallback behavior.
- Multi-channel gap: repair reservation data can be associated with a store, but LINE send/reply behavior still needs store channel context propagation.
- Risk: repair reservation, repair estimate, repair completion, and survey flows must stay LINE-first and cannot be moved to unrelated channels.

### `backend/src/services/lineWorkflowService.js`

- Role: shared LINE workflow handling for follow events, postbacks, customer binding, and customer interaction routing.
- Multi-channel gap: workflow handlers need an explicit webhook context containing `store_id`, `company_id`, `store_line_channel_id`, and token refs.
- Compatibility requirement: existing KINGWAY default behavior must continue until all customer workflows are channel-aware.

### `backend/src/services/lineGroupCandidateService.js`

- Role: captures LINE group/room ids as registration candidates.
- Current schema model: `line_group_candidates` is centered on `line_group_id`.
- Current unique key: `UNIQUE(line_group_id)`.
- Current UI/API behavior: returns masked group ids and links candidates to `store_notification_settings` or `supplier_notification_settings`.
- Multi-channel gap: there is no `store_line_channel_id`, `company_id`, `store_id`, or `line_channel_id` on candidates. Once multiple LINE channels exist, the same candidate list cannot safely be global.

### `database/migrations/20260627_create_line_group_candidates.sql`

- Role: creates the current group candidate table.
- Current important fields: `line_group_id`, `group_type_hint`, `source_type`, `last_message_text`, `display_name`, linked store/supplier ids, status, timestamps.
- Multi-channel gap: unique key is only by `line_group_id`, so it cannot distinguish which LINE channel detected the group.

### `backend/src/routes/lineNotificationSettings.js`

- Role: authenticated API for staff/supplier LINE group notification settings and group candidates.
- Current API coverage: store settings, supplier settings, dry-run tests, candidate list, candidate ignore, link to store, and link to supplier.
- Current behavior: candidate responses expose masked ids only.
- Multi-channel gap: this route configures notification targets, not LINE channel credentials or webhook ownership.

### `backend/src/services/lineNotificationSettingsService.js`

- Role: service for `store_notification_settings` and `supplier_notification_settings`.
- Current relation: linked candidates write the raw group id into notification target fields for later staff/supplier notification usage.
- Current sending policy: dry-run/test behavior is separate from actual LINE group push policy.
- Multi-channel gap: notification target settings are store/supplier-specific, but they do not know which LINE channel detected the group.

### `frontend/src/pages/LineNotificationSettingsPage.jsx`

- Role: POS screen for `LINE 通知設定`.
- Current UI: staff group settings, supplier group settings, `LINE 群組候選清單`, masked candidate display, and dry-run test buttons.
- Multi-channel gap: it does not manage LINE Official Account channel credentials, ownership type, webhook URL, or LIFF id.
- Required separation: this page can continue to manage notification target groups, while a new `LINE Channel 管理` page manages store-level channel credentials.

### `frontend/src/lib/lineNotificationSettingsApi.js`

- Role: frontend API client for LINE notification settings and candidate linking.
- Multi-channel gap: no channel management API client exists yet.

### `docs/PUBLIC_STORE_RESOLVER_PLAN.md`

- Role: existing planning material for public store resolution.
- Current relevance: it already points toward a `store_line_channels` concept.
- Gap: this audit/design document turns that direction into a store-level LINE channel management plan, with group candidate expansion and rollout constraints.

## B. Target Structure

KINGWAY should support one LINE channel per store or per operational ownership boundary. The same customer and staff workflows remain LINE-first, but the channel is resolved by store context.

### Direct Stores

- Headquarters creates and controls the LINE Official Account and Messaging API channel.
- The channel is linked to the direct store's `store_id`.
- `ownership_type = 'HQ_MANAGED'`.
- Store staff use the HQ-managed channel and cannot directly edit token/secret values.

### Franchise Stores

- The franchise owner creates and controls their own LINE Official Account and Messaging API channel.
- The channel is linked to that franchise store's `store_id`.
- `ownership_type = 'FRANCHISE_OWNED'`.
- The franchise owner can maintain their own channel credentials within their own store boundary.

### Independent Stores

- The independent store creates and controls its own LINE channel.
- The channel is linked to that independent store's `store_id`.
- `ownership_type = 'INDEPENDENT_OWNED'`.
- The independent operator can maintain channel configuration for only their own store.

## C. Common Runtime Logic

All LINE customer, staff, and supplier flows should resolve channel configuration by `store_id` before sending, replying, verifying, or creating group candidates.

Examples:

- 台南 LINE 訂單預約 resolves the 台南 `store_line_channel`.
- 高雄 LINE 維修預約 resolves the 高雄 `store_line_channel`.
- Franchise A customer messages resolve Franchise A's `store_line_channel`.
- Supplier group notification candidates are shown only in the store/channel scope where the group was detected.

The runtime context passed into workflow services should include:

- `company_id`
- `store_id`
- `store_code`
- `store_line_channel_id`
- `line_channel_id`
- `channel_access_token_ref`
- `line_channel_secret_ref`
- `liff_id`
- `webhook_path`

## D. Recommended DB Design

### `store_line_channels`

Recommended table:

```sql
CREATE TABLE store_line_channels (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT NULL,
  store_id BIGINT NOT NULL,
  ownership_type ENUM('HQ_MANAGED','FRANCHISE_OWNED','INDEPENDENT_OWNED') NOT NULL,
  line_official_account_id VARCHAR(120) NULL,
  line_basic_id VARCHAR(120) NULL,
  line_channel_id VARCHAR(120) NOT NULL,
  line_channel_secret_ref VARCHAR(255) NOT NULL,
  channel_access_token_ref VARCHAR(255) NOT NULL,
  liff_id VARCHAR(120) NULL,
  webhook_path VARCHAR(255) NOT NULL,
  webhook_url VARCHAR(500) NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  connected_at DATETIME NULL,
  last_webhook_at DATETIME NULL,
  last_error_at DATETIME NULL,
  last_error_message VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_line_channels_channel (line_channel_id),
  UNIQUE KEY uk_store_line_channels_webhook_path (webhook_path),
  KEY idx_store_line_channels_store_primary (store_id, is_primary, enabled),
  KEY idx_store_line_channels_company (company_id, enabled),
  KEY idx_store_line_channels_ownership (ownership_type, enabled)
);
```

Security requirements:

- Do not store raw channel access token values.
- Do not store raw channel secret values.
- Use `channel_access_token_ref` and `line_channel_secret_ref`, or encrypted secrets with strict masking.
- UI must show only credential presence/status, never raw values.

Compatibility note:

- `store_line_settings` currently overlaps with part of this shape.
- Future implementation should choose one canonical path:
  - migrate `store_line_settings` into `store_line_channels`, or
  - keep `store_line_settings` as a legacy compatibility source and make `store_line_channels` canonical for new stores.

## E. Webhook Design

Candidate routes:

- `/api/line/webhook/channel/:channelId`
- `/api/line/webhook/store/:storeCode`
- `/api/line/webhook/:webhookPath`

Recommended approach:

1. Use a channel-aware route such as `/api/line/webhook/channel/:channelId`, or a security-first opaque route such as `/api/line/webhook/:webhookPath`.
2. Resolve `store_line_channels` before signature verification.
3. Fetch `line_channel_secret_ref` through the secret resolver.
4. Verify LINE signature with the resolved channel secret.
5. Inject `store_id`, `company_id`, `store_line_channel_id`, and token refs into webhook context.
6. Pass the context into existing customer workflow, order reservation, repair reservation, group candidate, and notification logic.

Design notes:

- `channelId` and `storeCode` are routing identifiers, not secrets.
- `webhook_path` can be opaque to reduce accidental discovery.
- Signature verification remains the actual security boundary.
- `last_webhook_at` and `last_error_at` should be updated only through explicit application logic, not by schema bootstrap.

## F. Existing Global LINE Compatibility

The current KINGWAY channel should remain as a default/legacy channel during transition.

Compatibility plan:

- Register the existing KINGWAY channel as the primary `store_line_channels` row for the current main store.
- Keep `/api/line/webhook` as the legacy fallback route until the store/channel-aware route passes staging and production smoke tests.
- Restrict global token fallback to legacy webhook handling only.
- New multi-channel webhook handling must resolve token/secret through `store_line_channels`.
- Do not remove global fallback before order, repair, purchase confirmation, repair confirmation, survey, CRM binding, staff approval, and supplier approval flows are confirmed channel-aware.

Transition rule:

- Existing customers must continue to complete LINE workflows without changing their behavior.
- Store-level channel routing is an internal architecture change, not a customer UX change.

## G. groupId Auto-Recognition Extension

### Current Model

Current `line_group_candidates` is centered on:

- `line_group_id`
- `group_type_hint`
- `source_type`
- `last_message_text`
- `display_name`
- `linked_store_id`
- `linked_supplier_id`
- `status`

Current unique key:

```sql
UNIQUE KEY uk_line_group_candidates_group (line_group_id)
```

### Extended Model

Recommended added columns:

- `store_line_channel_id BIGINT NULL`
- `company_id BIGINT NULL`
- `store_id BIGINT NULL`
- `line_channel_id VARCHAR(120) NULL`
- `line_group_id VARCHAR(255) NOT NULL`
- `group_type_hint ENUM('UNKNOWN','STAFF_GROUP','SUPPLIER_GROUP') NOT NULL DEFAULT 'UNKNOWN'`
- `status ENUM('NEW','LINKED','IGNORED') NOT NULL DEFAULT 'NEW'`
- `linked_store_id BIGINT NULL`
- `linked_supplier_id BIGINT NULL`

Recommended unique key change:

```sql
UNIQUE KEY uk_line_group_candidates_channel_group (store_line_channel_id, line_group_id)
```

Reason:

- Multiple LINE channels need to know which channel detected a group.
- Candidate lists must be separated by store/channel.
- A groupId shown in POS must always be masked and scoped to the correct store.
- Linking a candidate from the wrong channel can send staff/supplier notifications to the wrong business group.

Migration approach:

1. Add nullable channel/store fields.
2. Backfill existing rows to the legacy/default KINGWAY channel if safe.
3. Add the new compound unique key.
4. Remove or relax the old global `UNIQUE(line_group_id)` only after backfill is confirmed.

## H. Settings Screen Design

Menu candidates:

- `平台管理 / LINE Channel 管理`
- `系統設定 / LINE Channel 管理`

Recommended page title:

- `LINE Channel 管理`

Display fields:

- `公司`
- `門市`
- `Ownership Type`
- `LINE OA 名稱`
- `Basic ID`
- `Channel ID`
- `Channel Secret 狀態`
- `Access Token 狀態`
- `LIFF ID`
- `Webhook URL`
- `啟用`
- `主要 Channel`
- `最後 Webhook 時間`
- `連線狀態`
- `測試連線`

Actions:

- Create/update channel metadata.
- Save secret refs or encrypted secret values without ever displaying raw values.
- Copy webhook URL.
- Run dry-run connection validation.
- Show masked channel status and last error summary.

Relationship to existing `LINE 通知設定`:

- `LINE Channel 管理` manages OA/channel credentials and webhook routing.
- `LINE 通知設定` continues to manage staff/supplier group targets and group candidates.
- Group candidate rows should show the detecting channel/store after the candidate table becomes channel-aware.

## I. Store-Level Permissions

### HQ / `company_owner`

- Can view all store LINE channels.
- Can register and edit direct-store channels.
- Can view franchise and independent channel status.
- Can enter support mode for franchise/independent channel troubleshooting if explicitly allowed by policy.

### `DIRECT_STORE`

- Uses HQ-managed channel.
- Can view connection status and webhook URL if needed.
- Cannot directly edit token/secret refs.

### `FRANCHISE_STORE`

- Can create/edit only its own store channel.
- Cannot view or edit other stores' channel configuration.
- Can manage its own group candidates and notification group links.

### `INDEPENDENT`

- Can create/edit only its own store channel.
- Cannot view or edit other stores' channel configuration.
- Can manage its own group candidates and notification group links.

### Staff Users

- Ordinary staff should not edit channel credentials.
- Store managers may view status and manage group links according to existing notification settings permissions.

## J. Token and Secret Security Design

Mandatory rules:

- Never store raw channel access tokens in plain DB columns.
- Never store raw channel secrets in plain DB columns.
- Prefer `secret_ref` values such as `env:KINGWAY_TAINAN_LINE_ACCESS_TOKEN`.
- If DB-backed storage is required later, encrypt secrets and return only presence/masked metadata.
- Never log raw token values.
- Never return raw token values in API responses.
- Never include raw token values in audit docs.
- Show groupId only as masked prefix/suffix in UI/logs/reports.
- Reduce raw LINE userId logging; use masked values unless a protected debug workflow explicitly requires otherwise.

Current audit concern:

- `store_line_settings` includes direct credential value fields.
- Some legacy debug endpoints and logs should be reviewed before multi-channel rollout to make sure raw user identifiers are not printed.

## K. LIFF Design

Store-level LIFF support should use:

- `store_line_channels.liff_id`
- store/channel-aware customer URLs

Example customer URLs:

- `/line/customer?store=KINGWAY_TAINAN`
- `/line/repair?store=FRANCHISE_A`
- `/repair-reservation?store=KINGWAY_TAINAN`

Design notes:

- LIFF endpoint URLs and webhook URLs are separate.
- If each store owns a separate LINE Official Account, LIFF apps may also need to be separated per store/channel.
- The customer entry route should resolve store context before rendering customer forms.
- Existing customer minimal-input and LINE-first rules still apply.

## L. Phased Implementation Plan

### Phase A: Audit and Design

- Create this design/audit document.
- List current global token dependencies.
- No code, DB, or deploy changes.

### Phase B: `store_line_channels` Migration/API/UI

- Add explicit migration for `store_line_channels`.
- Add backend API for channel metadata and dry-run validation.
- Add `LINE Channel 管理` frontend UI.
- Do not enable actual LINE group push.
- Do not replace existing webhook routing yet.

### Phase C: Store/Channel-Aware Webhook

- Add channel-aware webhook route.
- Resolve store/channel context first.
- Verify signature with the resolved channel secret.
- Keep existing global legacy webhook fallback.
- Route only controlled staging test traffic first.

### Phase D: Channel-Aware Group Candidates

- Expand `line_group_candidates` with `store_line_channel_id`, `company_id`, `store_id`, and `line_channel_id`.
- Backfill existing candidates to the default KINGWAY channel if safe.
- Change uniqueness from global `line_group_id` to `(store_line_channel_id, line_group_id)`.
- Update `LINE 群組候選清單` to filter by store/channel.

### Phase E: Customer Workflow Channel Resolution

- Convert LINE order reservation, repair reservation, purchase confirmation, repair confirmation, survey, CRM binding, staff approval, and supplier approval flows to resolve `store_line_channels`.
- Require channel context for sending/replying in new routes.
- Leave global fallback only for legacy/default route during transition.

### Phase F: Production Transition

- Register current KINGWAY channel as the default `store_line_channels` row.
- Test 台南 and 高雄 channel routing first.
- Then onboard franchise store channels one by one.
- Confirm webhook, LIFF, group candidate, order, repair, confirmation, notification, and KPI flows for each store before enabling broader rollout.

## M. Risks

- Wrong webhook mapping can break all customer LINE workflows for a store.
- Wrong channel token or secret ref can make replies and pushes fail.
- Franchise-owned token changes can interrupt webhook processing.
- LINE quota may be distributed by channel, but operational complexity increases.
- A groupId candidate can be linked to the wrong store/channel if candidate scope remains global.
- Removing the legacy global fallback too early can break existing KINGWAY customers.
- Storing raw access tokens or channel secrets directly creates avoidable credential exposure.
- Logging raw LINE userId, groupId, or token data can leak personal or operational identifiers.
- Mixing `store_line_settings` and `store_line_channels` without a clear canonical source can create inconsistent behavior.

## N. Recommended Next Implementation

Recommended next task:

> `store_line_channels` 테이블/API/UI + dry-run 연결 테스트

Do not do yet:

- Replace the entire existing webhook flow.
- Remove the global token fallback.
- Enable actual LINE group push.
- Run production migration.
- Store raw channel access tokens or channel secrets.
