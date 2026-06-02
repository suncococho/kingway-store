# Store Admin Settings Plan

Date: 2026-06-03
Branch: `beta/staging-architecture`

## 1. Purpose

Goal:

- allow each tenant store owner/admin to maintain their own store profile without platform-side manual edits
- keep Store Admin updates scoped to the authenticated `store_id`
- preserve platform override capability for support and tenant operations
- separate public-safe presentation data from future secret integration settings

Business intent:

- each store should be able to manage its visible store identity directly
- this includes store name, address, phone, hours, logo, receipt display text, and basic local presentation settings
- LINE integration secrets and channel credentials must not be mixed into this phase

## 2. Settings Scope

### Required settings fields

Store profile fields for Phase 1:

- `store name`
- `address`
- `phone`
- `logo`
- `business hours`
- `tax/business number` optional
- `receipt/invoice display name`
- `default language`
- `timezone`
- `LINE settings` placeholder only

Recommended normalized payload shape:

```json
{
  "displayName": "KINGWAY 台南門市",
  "address": "台南市東區...",
  "phone": "06-000-0000",
  "logoUrl": "/files/public-logos/store-1/logo.png",
  "businessHours": "每日 13:00 - 21:00",
  "businessNumber": "12345678",
  "invoiceDisplayName": "KINGWAY 台南門市",
  "defaultLanguage": "zh-TW",
  "timezone": "Asia/Taipei",
  "lineSettings": {
    "status": "placeholder"
  }
}
```

### Public-safe vs internal-only

Public-safe store profile data:

- store name
- address
- phone
- logo URL
- business hours
- receipt/invoice display name
- default language
- timezone

Internal-only or deferred data:

- raw LINE channel token
- raw LINE secret
- any webhook secret
- any platform-only operational flag

## 3. Permissions

### Store Admin scope

Allowed:

- store owner/admin may read and update only their own store settings
- scope must come from `req.storeId`
- no client-provided `store_id` or `storeId` may be trusted

Rules:

- `ADMIN` and `MANAGER` may read
- owner/admin-level store role should be required for write
- ordinary staff should be read-only or blocked by policy

Recommended first-phase policy:

- `GET /api/store/settings`: allow `ADMIN`, `MANAGER`
- `PATCH /api/store/settings`: require owner/admin store role
- `POST /api/store/settings/logo`: require owner/admin store role

### Platform Admin scope

Allowed:

- platform admin may inspect and override settings for any store
- store target comes from path param `:id`, not from staff auth context

Recommended policy:

- `GET /api/saas-admin/stores/:id/settings`
- `PATCH /api/saas-admin/stores/:id/settings`
- only `PLATFORM_OWNER`, `PLATFORM_ADMIN`, `SUPPORT` may read
- only `PLATFORM_OWNER`, `PLATFORM_ADMIN` should write

### General staff scope

Options:

- read-only access for limited operational display
- or fully blocked if not needed in the UI

Recommendation:

- do not expose write for cashier/repair/inventory roles
- if read access is kept, return only store presentation fields, not future integration placeholders

## 4. API Design

### Store Admin APIs

#### `GET /api/store/settings`

Purpose:

- return the current store-scoped settings snapshot for the logged-in store admin

Auth:

- staff auth required
- `req.storeId` required

Response shape:

```json
{
  "store": {
    "displayName": "KINGWAY 台南門市",
    "address": "台南市東區...",
    "phone": "06-000-0000",
    "logoUrl": "/files/public-logos/store-1/logo.png",
    "businessHours": "每日 13:00 - 21:00",
    "businessNumber": "12345678",
    "invoiceDisplayName": "KINGWAY 台南門市",
    "defaultLanguage": "zh-TW",
    "timezone": "Asia/Taipei",
    "lineSettings": {
      "status": "placeholder"
    }
  }
}
```

#### `PATCH /api/store/settings`

Purpose:

- update the logged-in store's profile settings

Auth:

- staff auth required
- `req.storeId` required
- owner/admin write role required

Rules:

- ignore any client-provided `store_id`
- validate only supported fields
- reject raw token or secret-like fields

#### `POST /api/store/settings/logo`

Purpose:

- upload or replace the current store logo

Auth:

- staff auth required
- `req.storeId` required
- owner/admin write role required

Response:

```json
{
  "ok": true,
  "logoUrl": "/files/public-logos/store-1/logo.png"
}
```

### Platform Admin APIs

#### `GET /api/saas-admin/stores/:id/settings`

Purpose:

- read any store's settings from platform admin UI

#### `PATCH /api/saas-admin/stores/:id/settings`

Purpose:

- override any store's settings from platform admin UI

Platform notes:

- this should reuse the same normalization layer as store admin updates
- store target must come from `:id`
- audit logging should record platform actor id/email and target store id

## 5. DB Design

## Recommended DB structure

Preferred approach:

- keep `stores` as tenant identity table
- use `store_settings` for mutable store profile payloads
- do not overload `stores` with long-form presentation text and file metadata

Reasoning:

- `stores` is currently the tenant registry and onboarding anchor
- mutable display settings will grow faster than registry identity fields
- separate settings storage keeps onboarding API stable and avoids repeated `ALTER TABLE stores`
- platform/store write paths can share one normalization and versioning model

### Option A: extend `stores` directly

Candidate columns:

- `name`
- `address`
- `phone`
- `logo_url`
- `business_hours`
- `tax_business_number`
- `receipt_display_name`
- `default_language`
- `timezone`

Pros:

- simple read path
- no extra join for basic store card data

Cons:

- mixes tenant registry and mutable presentation settings
- harder to evolve for grouped settings
- awkward for future LINE placeholder or structured JSON sections
- not aligned with current `settingsService` pattern

### Option B: separate `store_settings` table

Recommended schema shape:

```sql
CREATE TABLE store_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  setting_scope ENUM('STORE_PROFILE','STORE_SYSTEM','LINE_PLACEHOLDER') NOT NULL,
  setting_key VARCHAR(120) NOT NULL,
  setting_value_json JSON NOT NULL,
  updated_by_staff_id BIGINT UNSIGNED NULL,
  updated_by_platform_admin_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_settings_scope_key (store_id, setting_scope, setting_key)
);
```

Recommended initial use:

- `STORE_PROFILE` scope for this plan
- `STORE_SYSTEM` may continue to map to the current settings model
- `LINE_PLACEHOLDER` reserved for later UI wiring only

### Compatibility with current code

Current code already has a store-scoped settings service pattern:

- `backend/src/routes/settings.js`
- `backend/src/services/settingsService.js`

Pragmatic recommendation:

- if the current `settings` table already stores JSON by scope and store id, prefer extending that existing model instead of introducing a second table immediately
- in that case, add a new normalized scope such as `STORE_PROFILE`
- reserve `stores` column expansion only for small identity fields that truly belong in the tenant registry

## 6. Logo File Storage Strategy

Recommended strategy:

- store only public-safe logo assets
- logo should be a small image intended for UI display, receipt header, and customer-facing pages

Recommended path pattern:

- `storage/public-logos/store-{storeId}/logo-{timestamp}.png`

Metadata to store:

- `logoUrl`
- `mimeType`
- `fileSize`
- `updatedAt`

Important rules:

- uploaded logo file itself may be public if it is only branding artwork
- raw upload path must still be controlled by authenticated upload route
- public download path should be limited to logo assets only, not a generic store file bucket

No behavior change migration plan:

1. start with no logo required
2. if no logo exists, frontend shows text-only store badge
3. when logo upload ships, store only the public URL in store settings JSON
4. do not reuse generic `/files/*` for arbitrary tenant documents
5. keep logo handling separate from purchase confirmation or repair attachment paths

## 7. UI Design

### Main page

Recommended route:

- `/settings/store`

Purpose:

- give Store Admin a dedicated store profile editor separate from system/operational settings

### Menu location

Recommendation:

- place under existing `設定` area as `門市設定`
- visible to owner/admin
- optional read-only visibility to manager if needed later

### Page sections

Suggested sections:

1. 基本資料
   - store name
   - address
   - phone
   - business number optional
2. 顯示設定
   - receipt/invoice display name
   - default language
   - timezone
3. 營業資訊
   - business hours
4. 品牌識別
   - logo upload
   - preview
5. LINE 設定
   - placeholder tab only in this phase

### UX behavior

Required behavior:

- load current store settings on page open
- allow edit and save in one page
- show dirty/saving/saved states clearly
- show current logo preview if set
- keep LINE settings as disabled placeholder or empty-state panel for now

## 8. Security Design

Core enforcement:

- always derive store authority from `req.storeId` for store admin APIs
- never trust `req.body.storeId` or query `storeId`
- platform admin override must use explicit `:id`

File upload rules:

- accept image types only: `image/png`, `image/jpeg`, `image/webp`, `image/svg+xml` only if sanitized policy is approved
- restrict file size, for example `<= 2 MB`
- reject executable or mixed-content file types
- server-side generate final storage name
- do not allow arbitrary client filenames or relative paths

Public asset rules:

- only logo asset may be public
- do not put tax documents, confirmations, signatures, or repair media into the same public path

Secret handling rules:

- raw LINE token storage is out of scope for this phase
- do not store raw bot/channel token in this settings payload
- keep LINE settings placeholder-only until a separate secret storage design exists

## 9. Implementation Phases

### Phase 1 API

- define normalized `STORE_PROFILE` payload
- add `GET /api/store/settings`
- add `PATCH /api/store/settings`
- add platform admin read/write variant for `:id`
- enforce `req.storeId` and platform role boundaries

Implemented on 2026-06-03 for Store Admin Phase 1:

- added `STORE_PROFILE` store-scoped settings payload
- implemented `GET /api/store/settings`
- implemented `PATCH /api/store/settings`
- restricted writes to store `ADMIN` and `MANAGER`
- blocked raw token or secret-like fields inside `lineSettings`
- kept logo upload and platform-admin override for later phases

### Phase 2 UI

- build `/settings/store`
- add Store Admin menu entry
- load/save store profile settings
- show success/error state

Implemented on 2026-06-03 for Store Admin UI Phase 2:

- added `/settings/store` Store Admin page
- load current store profile via `GET /api/store/settings`
- save current store profile via `PATCH /api/store/settings`
- show loading, success, and error states
- keep logo upload and LINE settings as `Coming Soon` placeholders
- keep non-admin users read-only with disabled save actions

### Phase 3 logo upload

- add `POST /api/store/settings/logo`
- validate image type and size
- save public-safe logo file only
- return `logoUrl` and preview in UI

### Phase 4 platform admin override

- add store settings inspector/editor in `/platform-admin/stores/:id/...`
- show target store profile values
- allow override with audit trail

### Phase 5 LINE settings integration

- keep separate tab or section
- implement placeholder first
- design secret storage and masking before allowing any credential write
- explicitly ban raw token display in ordinary admin UI

## 10. Recommended Next Step

Recommended DB structure:

- reuse the existing store-scoped settings JSON model if possible
- introduce a dedicated `STORE_PROFILE` scope instead of expanding `stores` first
- reserve `stores` for small registry identity fields only

Recommended next implementation step:

1. extend `settingsService` with a `STORE_PROFILE` scope
2. add `GET/PATCH /api/store/settings` using `req.storeId`
3. wire a minimal `/settings/store` form without logo upload first
4. add platform admin `:id/settings` read/write after store-admin path is stable
5. add logo upload only after the file path and public-asset boundary are finalized
