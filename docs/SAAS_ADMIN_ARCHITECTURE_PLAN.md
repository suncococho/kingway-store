# SaaS Admin Architecture Plan

## Purpose

KINGWAY is moving from a single-store POS/ERP into a multi-store SaaS architecture. The first visible SaaS product surface starts at `/saas-admin`.

`/api/system/saas-status` is only a technical verification endpoint for schema readiness and strict SchemaGuard checks. It is not the real SaaS management UI.

## Roles

### SaaS platform administrator

- Manages all stores from the SaaS platform layer.
- Creates, suspends, and reviews stores.
- Configures store-level enabled modules, integration status, and plan visibility.
- Does not manage day-to-day store POS data unless explicitly acting inside a store context.

### Store owner

- Owns one store tenant.
- Manages store settings, staff, POS defaults, LINE / LIFF / domain settings, feature enablement, and billing-facing plan options.
- Can review all operational data scoped to the owned store.

### Store staff

- Works inside one store context.
- Uses daily workflows such as POS, customers, repairs, inventory, coupons, attendance, and supplier requests.
- Does not access SaaS-wide store administration.

## Target Routes

- `/saas-admin`: SaaS platform management dashboard.
- `/saas-admin/stores`: future store list and store creation view.
- `/saas-admin/stores/:storeId/settings`: future store metadata and plan settings.
- `/saas-admin/stores/:storeId/features`: future feature flag management.
- `/saas-admin/stores/:storeId/integrations`: future LINE, LIFF, Telegram, domain, and notification settings.
- `/settings?section=store`: store owner/admin settings inside the current store context.
- `/settings?section=system`: store-level operational settings inside the current store context.

## Target APIs

- `GET /api/saas-admin/stores`: read-only SaaS store dashboard data.
- `POST /api/saas-admin/stores`: future store creation.
- `GET /api/saas-admin/stores/:storeId`: future store detail.
- `PATCH /api/saas-admin/stores/:storeId`: future store metadata update.
- `GET /api/saas-admin/stores/:storeId/features`: future feature flag read.
- `PATCH /api/saas-admin/stores/:storeId/features`: future feature flag update.
- `GET /api/saas-admin/stores/:storeId/integrations`: future integration status read without raw secrets.
- `PATCH /api/saas-admin/stores/:storeId/integrations`: future integration setting update with secret-safe handling.

## Store Feature Flags Plan

Feature flags should be store-scoped and reversible. The first table can be introduced after the read-only SaaS admin dashboard is stable.

Candidate flags:

- POS
- customers / CRM
- repairs
- coupons
- purchase confirmations
- surveys
- inventory
- suppliers
- attendance
- KPI
- payroll
- LINE customer flows
- LINE staff approval flows
- Telegram bridge, if still required for a specific store

Guidance:

- Default existing KINGWAY 台南 store to the current enabled behavior.
- Avoid changing core workflows while introducing flags.
- Prefer a mapping layer over scattering feature checks throughout route handlers.
- Do not store secrets in feature flag tables.

## Store Integrations Plan

Store integrations should be separated from business records and never exposed with raw secret values.

Target integration groups:

- LINE Official Account settings
- LINE group notification settings
- LIFF app IDs and public LIFF URLs
- Telegram bot/group settings, only for stores that explicitly enable it
- Store public domain and callback URLs
- Notification routing defaults

Guidance:

- Show configured/not configured status in SaaS admin.
- Mask secret values.
- Keep customer-facing LINE flows as the primary business channel.
- Do not touch existing LINE token logic during the first SaaS admin skeleton phase.

## Implementation Phases

### Phase 1: Read-only SaaS visibility

- Add `/saas-admin`.
- Add `GET /api/saas-admin/stores`.
- Display environment, SchemaGuard state, total stores, and per-store business counts.
- Show placeholder action buttons for 店鋪設定, 功能設定, LINE 設定, Telegram 設定, POS 設定, 權限設定.

### Phase 2: Store detail shell

- Add store detail routing.
- Split store settings, feature settings, integrations, POS defaults, and permissions into separate sections.
- Keep every section read-only until persistence rules are finalized.

### Phase 3: Feature flag persistence

- Add store feature flag schema.
- Backfill the default store to preserve current behavior.
- Add a dry-run migration report before applying writes.

### Phase 4: Integration settings persistence

- Add integration settings schema with secret-safe storage rules.
- Add masked display values and rotation workflows.
- Keep LINE-first flows unchanged unless a store-specific override is explicitly enabled.

### Phase 5: Platform admin enforcement

- Add SaaS platform admin authorization separate from store owner/admin authorization.
- Keep store staff scoped to their store only.
- Add audit logs for SaaS admin changes.
