# Store Public Identity Mapping Schema Plan

## 1. Purpose

This document defines the schema plan for resolving a public request to the correct store through hostname, LIFF app, and LINE Messaging API channel identity.

This is a planning document only.

Do not use this document as approval to:

- modify code
- run database migrations
- change webhook behavior
- change LINE credentials
- deploy
- stage, commit, or push git changes

Primary source of truth remains:

1. `docs/KINGWAY_STORE_MASTER_SPEC.md`
2. The user's newest explicit instruction
3. Existing code structure
4. Older temporary patches or assumptions

## 2. Why These Mapping Tables Are Needed

Public routes do not receive authenticated staff store context. They need a separate, auditable way to identify the store before reading or writing store-scoped data.

### 2-1. `store_hostnames`

Hostname mapping is needed for browser and public web entry points such as store information pages, public customer pages, and future store-specific public URLs.

It answers:

- Which store owns `tainan.pos.kingway.tw`?
- Which store owns a future custom domain?
- Should this host be accepted for public store reads?

Hostname mapping must not rely on `req.query.store_id` or any body-provided store id.

### 2-2. `store_liff_apps`

LIFF app mapping is needed because customer-facing LINE pages can be opened from inside LINE without staff auth.

It answers:

- Which store owns this LIFF ID?
- Is this LIFF app allowed for this route scope?
- Is the LIFF app active, inactive, or retired?

LIFF ID mapping is stronger than hostname for LINE in-app customer pages because a LIFF app is configured in the LINE developer console.

### 2-3. `store_line_channels`

LINE channel mapping is needed because webhook requests and LINE push/reply behavior must be scoped to one Official Account / Messaging API channel.

It answers:

- Which store owns this LINE channel?
- Which channel secret and access token reference should be used?
- Which webhook path token maps to the store before signature verification?

This is mandatory before multiple stores can safely share the same backend.

## 3. `store_hostnames` Schema Draft

```sql
CREATE TABLE store_hostnames (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  hostname VARCHAR(255) NOT NULL,
  hostname_type ENUM('SUBDOMAIN', 'CUSTOM_DOMAIN', 'LEGACY') NOT NULL DEFAULT 'SUBDOMAIN',
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  verified_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_hostnames_hostname (hostname),
  INDEX idx_store_hostnames_store_status (store_id, status),
  INDEX idx_store_hostnames_store_primary (store_id, is_primary),
  CONSTRAINT fk_store_hostnames_store
    FOREIGN KEY (store_id) REFERENCES stores(id)
);
```

Rules:

- `hostname` must be lowercase, portless, and without protocol.
- One hostname can map to only one store.
- `ACTIVE` rows may be used by `publicStoreResolver`.
- `INACTIVE` rows must never resolve public traffic.
- `verified_at` is required before a custom domain can be used in production.
- `LEGACY` is only for current KINGWAY compatibility and must be observable in audit logs.

## 4. `store_liff_apps` Schema Draft

```sql
CREATE TABLE store_liff_apps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  liff_id VARCHAR(80) NOT NULL,
  liff_name VARCHAR(150) NULL,
  route_scope ENUM(
    'GENERAL',
    'STORE_INFO',
    'LINE_ORDER',
    'REPAIR_RESERVATION',
    'COUPON_CENTER',
    'GOOGLE_REVIEW',
    'PURCHASE_CONFIRMATION',
    'SURVEY',
    'SUPPORT'
  ) NOT NULL DEFAULT 'GENERAL',
  status ENUM('ACTIVE', 'INACTIVE', 'RETIRED') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_liff_apps_liff_id (liff_id),
  INDEX idx_store_liff_apps_store_status (store_id, status),
  INDEX idx_store_liff_apps_scope_status (route_scope, status),
  CONSTRAINT fk_store_liff_apps_store
    FOREIGN KEY (store_id) REFERENCES stores(id)
);
```

Rules:

- `liff_id` must be globally unique.
- A LIFF app belongs to exactly one store.
- `ACTIVE` rows may resolve public LINE pages.
- `INACTIVE` rows are temporarily disabled and must fail closed.
- `RETIRED` rows are kept for audit but must not resolve traffic.
- A `GENERAL` LIFF app can be accepted for low-risk public reads only when route policy allows it.
- Sensitive customer write flows should prefer a scope-specific LIFF app or a signed context token.

## 5. `store_line_channels` Schema Draft

```sql
CREATE TABLE store_line_channels (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  channel_id VARCHAR(120) NOT NULL,
  channel_name VARCHAR(150) NULL,
  channel_secret_ref VARCHAR(255) NOT NULL,
  channel_access_token_ref VARCHAR(255) NOT NULL,
  webhook_path_token VARCHAR(160) NOT NULL,
  webhook_path VARCHAR(255) NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('ACTIVE', 'INACTIVE', 'ROTATING') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_line_channels_channel_id (channel_id),
  UNIQUE KEY uk_store_line_channels_path_token (webhook_path_token),
  INDEX idx_store_line_channels_store_status (store_id, status),
  INDEX idx_store_line_channels_store_default (store_id, is_default),
  CONSTRAINT fk_store_line_channels_store
    FOREIGN KEY (store_id) REFERENCES stores(id)
);
```

Rules:

- `channel_id` must be globally unique.
- `webhook_path_token` must be globally unique and unguessable.
- A LINE channel belongs to exactly one store.
- `ACTIVE` rows may resolve webhook/store context.
- `INACTIVE` rows must reject webhook resolution.
- `ROTATING` rows may be accepted only by a route that explicitly supports credential rotation.
- Credential values should not be stored directly in this table. Store references to secrets instead.

## 6. Unique Constraints

Required uniqueness:

- `store_hostnames.hostname`: globally unique.
- `store_liff_apps.liff_id`: globally unique.
- `store_line_channels.channel_id`: globally unique.
- `store_line_channels.webhook_path_token`: globally unique.

Recommended additional guardrails:

- At most one primary active hostname per store, enforced by application validation or a generated-column unique index if the database strategy supports it.
- At most one default active LINE channel per store, enforced by application validation or a generated-column unique index.
- Do not create partial uniqueness that behaves differently across MySQL versions without staging rehearsal.

## 7. Active / Inactive Rules

Resolver behavior:

- Only `ACTIVE` mappings can resolve normal public traffic.
- `INACTIVE` mappings must fail closed.
- `RETIRED` LIFF mappings must fail closed and remain audit-only.
- `ROTATING` LINE channel mappings must be route-gated and temporary.
- Store status must also be active before a mapping resolves.

Operational rules:

- Disable a public identity by marking the mapping inactive before deleting anything.
- Deletion should be avoided unless audit retention has been reviewed.
- Any change to active public identity mappings should be logged as an operational change.

## 8. Hostname Collision Policy

Hostname collision means one hostname is requested for more than one store.

Policy:

1. Normalize hostname before comparison.
2. Reject duplicate normalized hostnames at write time.
3. Do not allow active duplicate hostnames.
4. Do not auto-transfer a hostname between stores.
5. To transfer a hostname, mark the old mapping inactive, verify ownership, then activate the new mapping.
6. Custom domain activation requires `verified_at`.
7. Production must reject ambiguous or unverified hostnames.

## 9. LIFF ID Uniqueness

LIFF ID must be globally unique because it is issued by LINE and identifies a configured LIFF app.

Policy:

- One LIFF ID maps to one store only.
- A LIFF ID cannot be shared across stores even if route scopes differ.
- If a LIFF app is moved to another store, retire or deactivate the old mapping first.
- Route scope should narrow where the LIFF app is accepted.

## 10. LINE Channel Uniqueness

LINE channel identity must be globally unique because webhook signature verification and reply/push delivery depend on the channel.

Policy:

- One LINE channel maps to one store only.
- One webhook path token maps to one LINE channel only.
- A store can have more than one LINE channel only when explicitly supported.
- Channel secret and access token references must not be inferred from request body or query parameters.

## 11. Legacy KINGWAY Seed Example

This is an example only. Do not run it without a reviewed migration.

```sql
-- Example assumes KINGWAY 台南 already exists as stores.id = 1.

INSERT INTO store_hostnames (
  store_id,
  hostname,
  hostname_type,
  is_primary,
  status,
  verified_at
) VALUES (
  1,
  'pos.kingway.tw',
  'LEGACY',
  1,
  'ACTIVE',
  CURRENT_TIMESTAMP
);

INSERT INTO store_liff_apps (
  store_id,
  liff_id,
  liff_name,
  route_scope,
  status
) VALUES (
  1,
  'REPLACE_WITH_KINGWAY_LEGACY_LIFF_ID',
  'KINGWAY 台南 LIFF',
  'GENERAL',
  'ACTIVE'
);

INSERT INTO store_line_channels (
  store_id,
  channel_id,
  channel_name,
  channel_secret_ref,
  channel_access_token_ref,
  webhook_path_token,
  webhook_path,
  is_default,
  status
) VALUES (
  1,
  'REPLACE_WITH_KINGWAY_LINE_CHANNEL_ID',
  'KINGWAY 台南 LINE OA',
  'env:LINE_CHANNEL_SECRET',
  'env:LINE_CHANNEL_ACCESS_TOKEN',
  'REPLACE_WITH_RANDOM_WEBHOOK_PATH_TOKEN',
  '/api/line/webhook/REPLACE_WITH_RANDOM_WEBHOOK_PATH_TOKEN',
  1,
  'ACTIVE'
);
```

Seed rules:

- Do not guess LINE channel id, LIFF id, or credential references.
- Do not expose secrets in SQL.
- Do a dry run before inserting rows.
- Verify current production/staging store id before assuming `1`.

## 12. Staging Migration Order

Recommended order:

1. Confirm `stores` table and KINGWAY 台南 store row in staging.
2. Dry-run candidate rows for hostname, LIFF, and LINE channel mappings.
3. Create mapping tables in staging only.
4. Add indexes and foreign keys.
5. Insert legacy KINGWAY mapping rows with explicit reviewed values.
6. Run read-only checks for uniqueness and active row counts.
7. Point only `GET /api/settings/public` at hostname/legacy fallback resolution.
8. Add LIFF resolver checks to a low-risk read route only.
9. Add LINE channel resolver checks to a staging-only webhook path without changing production webhook.
10. Promote route wiring gradually after smoke tests and rollback rehearsal.

## 13. Rollback Plan

Schema rollback:

- Mark new mapping rows `INACTIVE`.
- Disable route usage flags before dropping tables.
- Drop foreign keys before dropping tables only after confirming no runtime code depends on them.

Runtime rollback:

- Revert route wiring to explicit legacy fallback for `GET /api/settings/public`.
- Do not restore scattered route-level `store_id = 1` assumptions.
- Keep warning logs enabled until fallback removal is complete.

Data rollback:

- Do not delete mapping rows unless audit retention has been approved.
- Prefer `INACTIVE` status for reversible rollback.
- If a migration inserted wrong mappings, export affected rows before correction.

## 14. Production No-Go Conditions

Do not enable production multi-store public resolver wiring if any condition is true:

- More than one active mapping exists for the same hostname, LIFF ID, channel ID, or webhook path token.
- A production hostname is unverified.
- A LINE channel row has missing credential references.
- A webhook path token is predictable or shared.
- `publicStoreResolver` still relies on automatic `store_id = 1` outside explicit legacy fallback mode.
- Public write routes still trust request body/query `store_id`.
- Customer, coupon, repair, order, purchase confirmation, or survey writes are not store-scoped.
- Rollback has not been rehearsed in staging.
- LINE webhook behavior has not been tested with the exact channel mapping that will be enabled.

## 15. `publicStoreResolver` Connection Order

Recommended implementation sequence:

1. Keep `publicStoreResolver` as the only helper allowed to resolve public store context.
2. Use explicit legacy fallback only for `GET /api/settings/public` until mapping tables exist.
3. Add read-only hostname lookup after `store_hostnames` is created and seeded.
4. Add LIFF lookup only for low-risk public reads.
5. Add signed context token support for public customer write flows.
6. Add LINE channel lookup to staging webhook path only.
7. Move LINE webhook signature verification to store channel credential references after staging proof.
8. Wire repair/order/customer/coupon flows only after their writes are store-scoped.

Do not connect LINE, LIFF, repair, order, coupon, or purchase confirmation writes before the schema and rollback path are verified.

## 16. Next Safe Implementation Step

Next safe step:

Create a staging-only dry-run SQL/report document that checks whether the current database can support these mappings without writing data.

The dry-run should report:

- current active stores
- candidate KINGWAY 台南 store id
- existing hostname-like config values
- existing LIFF id sources
- existing LINE channel id availability
- proposed insert rows
- duplicate/collision risks
- whether `stores.id = 1` is valid in staging

No migration should run until the dry-run output is reviewed.
