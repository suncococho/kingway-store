# Multi-Tenant Architecture

## 1. Purpose

This document defines how the KINGWAY store management system can evolve from a single independent store system into a controlled multi-tenant system.

The current source of truth remains:

1. `docs/KINGWAY_STORE_MASTER_SPEC.md`
2. The user's newest explicit instruction
3. Existing code structure

This document is architecture guidance only. It does not authorize code changes, database changes, migrations, deployment changes, or Docker changes by itself.

---

## 2. Non-Negotiable Business Constraints

Multi-tenant support must not weaken the existing KINGWAY operating rules.

Every tenant must preserve:

- LINE-first customer, staff, manager, and supplier workflows
- Taiwan Traditional Chinese visible UX (`zh-TW`)
- Customer CRM as the center of customer history
- Coupon issuance rules
- Google review manual approval rule
- Purchase confirmation signature and PDF rule
- Deposit / balance payment tracking
- Repair order classification rule
- Supplier approval and settlement workflows
- Staff attendance, checklist, KPI, and monthly summary workflows
- Manager/admin LINE group notification capability

The existing KINGWAY 台南 store must continue to work as a normal tenant, not as a special legacy exception.

---

## 3. Target Model

### 3-1. Tenant Definition

A tenant represents one independently operated store or store group.

Recommended tenant fields:

- `id`
- `slug`
- `display_name`
- `legal_name`
- `timezone`
- `locale`
- `currency`
- `status`
- `created_at`
- `updated_at`

Recommended default tenant:

- `slug`: `kingway-tainan`
- `display_name`: `KINGWAY 台南`
- `locale`: `zh-TW`
- `currency`: `TWD`
- `timezone`: `Asia/Taipei`

### 3-2. Tenant Boundary

The tenant boundary must apply to operational data:

- Customers
- LINE bindings
- CRM records
- Orders
- Order items
- Repairs
- Repair reservations
- Repair estimates
- Coupons
- Coupon approvals
- Purchase confirmations
- PDFs and uploaded files
- Products
- Product images
- Inventory movements
- Purchase orders
- Returns
- Suppliers
- Supplier settlements
- Staff users
- Attendance
- Daily checklists
- KPI records
- Notification logs
- Audit logs

Shared global data should be kept small and explicit:

- Application-level roles or permissions templates
- System feature flags
- Global schema version metadata
- Optional shared product category definitions, if they remain compatible with tenant display rules

---

## 4. Data Isolation Strategy

### 4-1. Preferred Approach

Use a single database with `tenant_id` on tenant-owned tables.

Reasons:

- Lower operational complexity
- Easier to keep one codebase and one deployment path
- Easier reporting across tenants if needed later
- Compatible with the current single-store system if introduced gradually

### 4-2. Required Rules

Every tenant-owned query must be scoped by `tenant_id`.

Every tenant-owned insert must write `tenant_id`.

Every tenant-owned update or delete must include tenant scope.

Every unique constraint that represents tenant-owned business data should include `tenant_id`.

Examples:

- Product SKU uniqueness should be tenant-scoped.
- Customer phone uniqueness, if enforced, should be tenant-scoped.
- LINE user binding should be tenant-scoped unless a future cross-store identity model is explicitly approved.
- Coupon one-per-customer rules should be tenant-scoped.

### 4-3. Cross-Tenant Protection

The application should enforce tenant isolation in at least three layers:

1. Request context
2. Service/repository query scope
3. Database indexes and constraints

Do not rely only on frontend filtering.

---

## 5. Tenant Resolution

The system should determine the active tenant before business logic runs.

Recommended resolution order:

1. Authenticated user's assigned tenant
2. Store subdomain or configured hostname
3. LINE channel / LIFF configuration
4. Explicit admin-selected tenant for platform-level operators only

For normal staff users, the tenant should be implicit and fixed after login.

For customer LINE flows, the tenant should come from the LINE channel, LIFF app, or signed flow token.

For supplier LINE flows, the tenant should come from the supplier approval token or LINE group binding.

---

## 6. Authentication and Authorization

### 6-1. Staff Users

Staff users should belong to one or more tenants.

Recommended relationship:

- `users`
- `tenants`
- `user_tenants`
- `roles`
- `user_tenant_roles`

Role checks must always be evaluated inside tenant context.

Example:

- A user may be `admin` in `KINGWAY 台南`.
- The same user should not automatically become `admin` in another tenant.

### 6-2. Customer Identity

Customer identity remains tenant-owned by default.

Phone and LINE userId backfills must stay conservative:

- Do not overwrite existing non-null identifiers unless the match is clearly safe.
- Do not silently merge customers across tenants.
- If Chinese text appears corrupted, verify stored bytes before treating data as broken.

### 6-3. Platform Admin

If platform administration is added later, it must be separate from store administration.

Platform admin capabilities should be limited to:

- Tenant provisioning
- Tenant status management
- Global diagnostics
- Cross-tenant operational support with audit logs

Platform admin should not bypass tenant auditability.

---

## 7. LINE Multi-Tenant Design

LINE remains the center of the workflow.

Each tenant should have its own LINE configuration:

- LINE Official Account channel ID
- Channel secret
- Channel access token
- LIFF app IDs
- Customer rich menu IDs
- Staff group IDs
- Manager/admin group IDs
- Supplier group IDs
- Webhook signing secret context

### 7-1. Webhooks

LINE webhooks must resolve tenant before processing events.

Tenant resolution can use:

- Webhook endpoint path
- Channel ID
- Destination field from LINE event payload
- Stored LINE channel configuration

The webhook handler must reject events if tenant resolution fails.

### 7-2. Messages and Buttons

All visible LINE messages and button labels must remain `zh-TW`.

Required labels include:

- `確認`
- `拒絕`
- `核准發券`
- `確認交車`
- `維修完成確認`
- `發注確認`
- `退貨確認`

### 7-3. Flow Tokens

Customer and supplier action links should use tenant-bound signed tokens.

Tokens should include:

- `tenant_id`
- Flow type
- Related entity ID
- Expiration time
- Nonce or version

Tokens must not allow access to another tenant's records.

---

## 8. Product, Category, and Repair Classification

Internal category enums may remain shared:

- `EBIKE`
- `REPAIR`
- `ACCESSORY`
- `OTHER`

Visible labels must remain:

- `電動自行車`
- `維修`
- `配件`
- `其他`

Repair classification remains mandatory:

If an order contains any repair-category product, the order is a repair order and must appear in `維修管理`.

This rule applies independently inside each tenant.

---

## 9. Files and PDFs

Tenant-owned files must be separated by tenant.

Recommended path pattern:

```text
tenant-files/{tenant_slug}/purchase-confirmations/{confirmation_id}.pdf
tenant-files/{tenant_slug}/products/{product_id}/{file_name}
tenant-files/{tenant_slug}/customers/{customer_id}/{file_name}
```

File metadata should store:

- `tenant_id`
- Owner entity type
- Owner entity ID
- Original filename
- Storage key
- MIME type
- File size
- Created by
- Created at

Purchase confirmation PDFs must remain visible from customer management for the same tenant only.

---

## 10. Reporting and Settlement

Tenant reports should default to single-tenant scope.

Required tenant-scoped reports:

- Daily settlement report
- Monthly settlement report
- Supplier settlement
- Staff KPI summary
- Sales report
- Repair report
- Coupon report
- Inventory report

Cross-tenant reporting should be treated as a future platform feature and must require platform-level authorization.

---

## 11. Audit and Observability

Important state changes should create tenant-scoped audit records.

Recommended audit fields:

- `tenant_id`
- Actor type
- Actor ID
- Action
- Entity type
- Entity ID
- Before value
- After value
- Source channel
- Request ID
- Created at

Important state changes should continue to support manager/admin LINE group notification:

- Order status changes
- Repair status changes
- Purchase confirmation completion
- Estimate events
- Review verification events
- Stock / purchase order / return events
- Daily settlement report
- Monthly settlement report

---

## 12. Migration Strategy

No migration should be executed without explicit approval.

Recommended phased approach:

1. Document tenant-owned tables and current assumptions.
2. Add tenant model and default tenant in a reversible migration.
3. Add nullable `tenant_id` columns to tenant-owned tables.
4. Backfill existing rows to `kingway-tainan` with a dry-run report first.
5. Add application-level tenant context.
6. Scope reads and writes by tenant.
7. Add tenant-aware unique indexes.
8. Make `tenant_id` non-null only after verification.
9. Add tenant-aware LINE configuration.
10. Add platform admin tools only if explicitly required.

Before any data write:

- Produce a dry-run report.
- Verify row counts by table.
- Verify customer, LINE binding, order, repair, coupon, and PDF counts.
- Verify repair-classified orders still appear in repair management.
- Verify purchase confirmation PDFs remain linked to customer records.

---

## 13. Implementation Guardrails

When implementing this architecture later:

- Keep changes small and reversible.
- Prefer mapping layers and derived flags.
- Avoid destructive bulk rewrites.
- Do not add Telegram workflows.
- Do not touch unrelated repos or `kw-bot`.
- Do not silently merge customers.
- Keep visible UI and LINE copy in Taiwan Traditional Chinese.
- Preserve the current KINGWAY 台南 workflow unless explicitly asked to change it.

---

## 14. Open Decisions

These decisions should be confirmed before implementation:

1. Whether each tenant gets a dedicated LINE Official Account.
2. Whether customers can be shared across tenants.
3. Whether products are fully tenant-owned or can be copied from templates.
4. Whether suppliers are tenant-owned or shared with tenant-specific terms.
5. Whether platform admin is needed in the first multi-tenant phase.
6. Whether cross-tenant reporting is required.
7. Whether tenant isolation should eventually move from single database to database-per-tenant.

Until these are decided, the safest default is:

- Single database
- Tenant-owned operational data
- Dedicated LINE configuration per tenant
- No shared customers
- No cross-tenant reporting for store staff
- KINGWAY 台南 as the default tenant
