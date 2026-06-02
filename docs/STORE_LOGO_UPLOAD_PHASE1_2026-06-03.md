# Store Logo Upload Phase 1

## Scope
- Implement store-scoped logo upload for `門市設定`
- Keep existing LINE OA / Business flow unchanged
- Do not change production `.env` or token handling

## Design
- Reuse existing `STORE_PROFILE` settings scope in `app_settings`
- Persist uploaded logo path in `logoUrl`
- Store files under backend local storage:
  - `storage/store-logos/store-{storeId}/`
- Expose files through existing `/files/*` static route
- Limit upload to authenticated store users with `ADMIN` or `MANAGER` role
- Accept only:
  - `image/jpeg`
  - `image/png`
  - `image/webp`
  - `image/gif`
  - `image/svg+xml`
- Max file size: `4MB`

## API added
- `POST /api/store/settings/logo`
  - Auth required
  - Store scope required
  - Role required: `ADMIN` or `MANAGER`
  - Raw binary upload with `Content-Type` image mime type
  - Optional `X-File-Name` header for safe filename derivation
  - Response returns updated `store` payload and `logoUrl`

## UI added
- `frontend/src/pages/StoreSettingsPage.jsx`
  - Logo preview card
  - Upload button
  - Remove logo button
  - zh-TW only visible copy

## Non-goals for Phase 1
- No LINE settings changes
- No webhook / LIFF resolver changes
- No production config changes
- No customer-facing OA flow changes
