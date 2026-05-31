# Platform Admin Auth Design

## Purpose

The SaaS platform admin identity model must be separate from store staff identity. KINGWAY_TAINAN is a tenant store, not the SaaS platform. Platform admins manage stores, plans, integrations, feature flags, and platform status across tenants.

This document is a design plan only. Do not create migrations until the schema and rollout are reviewed.

## Planned Tables

### platform_admin_users

- `id`
- `email`
- `password_hash`
- `display_name`
- `role`: `PLATFORM_OWNER` / `PLATFORM_ADMIN` / `SUPPORT`
- `is_active`
- `created_at`
- `updated_at`

Platform admin users have no `store_id`. They belong to the SaaS platform, not a store tenant.

### platform_admin_sessions or JWT

Two implementation options are acceptable:

- `platform_admin_sessions`: server-side session records with revocation, expiry, user agent, and IP metadata.
- Platform-admin JWT: separate signing purpose/audience from existing store ERP JWTs.

Whichever option is selected, platform tokens must not be accepted as store staff tokens, and store staff tokens must not grant platform admin access.

### platform_audit_logs

Suggested fields:

- `id`
- `platform_admin_user_id`
- `action`
- `target_type`
- `target_id`
- `store_id`, nullable for platform-level actions
- `metadata_json`
- `created_at`

Audit logs are required for store creation, plan changes, feature changes, integration changes, support access, and future impersonation.

## Identity Boundaries

- Platform admin users are stored in `platform_admin_users`.
- Store staff remain in the existing store staff user model and must be scoped by `store_id`.
- Platform admin can view all stores.
- Store owner can only view and manage the owned store.
- Store staff can only use the workflows allowed for their store role and store scope.
- Platform admin authorization must not be inferred from KINGWAY_TAINAN `ADMIN` staff role.

## Future Impersonation

Optional support impersonation can be introduced later, but it must be explicit and audited.

Requirements:

- Record who started impersonation.
- Record target store and target user/role.
- Record start and end time.
- Show visible UI state while impersonating.
- Prevent sensitive secret viewing during impersonation unless separately authorized.
- Never allow silent customer or staff data mutation without audit logs.

## Rollout Plan

1. Keep current `/saas-admin` as a temporary staging skeleton.
2. Add `/platform-admin/login` and a platform-only auth boundary.
3. Add platform layout routes under `/platform-admin`.
4. Move SaaS store list and feature pages from `/saas-admin` into `/platform-admin`.
5. Keep existing store ERP routes under store-scoped login and authorization.
6. Add migrations only after the auth boundary and audit requirements are finalized.
