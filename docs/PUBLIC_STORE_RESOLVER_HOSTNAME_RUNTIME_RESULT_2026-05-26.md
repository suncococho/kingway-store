# Public Store Resolver Hostname Runtime Result - 2026-05-26

## 1. Scope

This document records the staging runtime result for `GET /api/settings/public` hostname-based public store resolution.

No code changes, database changes, webhook changes, LINE/LIFF seed changes, git staging, commits, or pushes were performed as part of this documentation step.

## 2. Staging Runtime

Target runtime:

- staging backend: `127.0.0.1:3010`
- route: `GET /api/settings/public`
- hostname mapping table: `store_hostnames`
- seeded hostname: `pos.kingway.tw`
- expected store: `stores.id = 1`, `KINGWAY_TAINAN`

Staging backend restart status:

- Staging backend restart completed before recording this runtime result.

## 3. HTTP Smoke Result

Request:

```bash
curl -s -H "Host: pos.kingway.tw" http://127.0.0.1:3010/api/settings/public
```

Result:

- HTTP `200 OK`
- Response returned KINGWAY public store settings.
- Returned visible store identity included `KINGWAY 台南門市`.

## 4. Client `store_id` Trust Check

Request:

```bash
curl -s -H "Host: pos.kingway.tw" "http://127.0.0.1:3010/api/settings/public?store_id=999"
```

Result:

- HTTP `200 OK`
- Response still returned KINGWAY public store settings.
- `store_id=999` did not change the selected store.

Conclusion:

- Public query `store_id` is not treated as authority.
- This matches the resolver trust-boundary rule: body/query `store_id` must be ignored for public store authority.

## 5. Direct Resolver Smoke

Read-only direct resolver smoke against 3310 staging DB confirmed:

```text
Host: pos.kingway.tw
storeId: 1
source: hostname
sourceResolved: true
legacyFallbackUsed: false
ignoredClientStoreId.queryStoreId: "999"
```

Resolver attempt sequence:

```text
signed_token: missing
line_channel: missing
liff_id: missing
store_slug: missing_or_reserved
hostname: resolved
```

Conclusion:

- `pos.kingway.tw` resolves through `store_hostnames`.
- Resolution source is `hostname`.
- `sourceResolved` is `true`.
- Legacy fallback is not used for the hostname match.

## 6. Unknown Host Behavior

Direct resolver smoke for an unknown host without fallback:

```text
Host: no-such-host.invalid
storeId: null
source: unresolved
sourceResolved: false
legacyFallbackUsed: false
```

Conclusion:

- Unknown host does not silently resolve to KINGWAY.
- Automatic `store_id=1` fallback remains prohibited.

## 7. Explicit Legacy Fallback Behavior

Direct resolver smoke for unknown host with explicit legacy fallback enabled:

```text
Host: no-such-host.invalid
storeId: 1
source: legacy_kingway_fallback
sourceResolved: false
legacyFallbackUsed: true
```

Conclusion:

- KINGWAY fallback is allowed only through explicit legacy fallback mode.
- Fallback keeps `sourceResolved=false`.
- Fallback warning metadata remains expected behavior.

## 8. Runtime Logs

Runtime log grep result:

```text
no matching resolver log output
```

Interpretation:

- HTTP behavior and direct resolver smoke confirm the expected routing behavior.
- Resolver log output was not available from grep for this runtime result.

## 9. Production Status

Production was not changed.

Not applied to production:

- hostname mapping runtime wiring validation
- LIFF seed
- LINE channel seed
- webhook changes
- credential changes
- frontend rebuild

## 10. Current Status

Completed in staging:

- `store_hostnames` table exists.
- `store_liff_apps` table exists with `0` rows.
- `store_line_channels` table exists with `0` rows.
- `pos.kingway.tw` active legacy hostname row exists for `store_id=1`.
- `GET /api/settings/public` returns KINGWAY public settings with `Host: pos.kingway.tw`.
- Query `store_id=999` is ignored.
- Direct resolver confirms hostname source.

Still on hold:

- LIFF seed.
- LINE channel seed.
- LINE webhook route changes.
- Public write route wiring.

## 11. Next Safe Step

Next safe step:

Document and execute a staging-only LIFF mapping dry audit before inserting any `store_liff_apps` row.

The LIFF dry audit should confirm:

- approved staging LIFF ID
- whether the current frontend fallback LIFF ID may be used as a DB mapping
- route scope for the first LIFF mapping
- no collision with existing rows
- no change to LINE credentials or webhook behavior

Do not proceed to LINE channel seed until a reviewed `LINE_CHANNEL_ID`, webhook path token, and credential reference policy are available.
