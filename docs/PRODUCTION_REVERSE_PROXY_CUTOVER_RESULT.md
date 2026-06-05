# Production Reverse Proxy Cutover Result

Date: 2026-06-05
Branch: `beta/staging-architecture`

## Objective

Switch `pos.kingway.tw` reverse proxy backend from `localhost:5180` to `localhost:5173`.

Constraints:
- No DB changes
- No code changes
- No LINE message sending
- Backup required before any reverse proxy change

## Backup

- Source: `/usr/syno/etc/www/ReverseProxy.json`
- Backup file: `/volume1/docker/kingway-store/backups/production-pre-saas/20260605_004301/ReverseProxy.json.before_5173_cutover`
- Backup status: `CREATED`
- Backup existence check: `PASS`
- Backup size: `1841 bytes`

## Pre-cutover Checks

| Check | Result | Notes |
|---|---:|---|
| Current `pos.kingway.tw` backend | `localhost:5180` | Confirmed in `/usr/syno/etc/www/ReverseProxy.json` |
| `http://127.0.0.1:5173/` | `200` | 5173 frontend reachable |
| 5173 latest asset | `PASS` | `index-C78SEFUN.js` found |
| `http://127.0.0.1:5173/api/system/saas-status` | `200` | SaaS status reachable |
| `GET http://127.0.0.1:5173/api/login` | `404` | Login verification requires the production `POST /api/login` flow with credentials |

## Cutover Attempt

Target change:
- `pos.kingway.tw` backend port: `5180 -> 5173`

Result:
- `BLOCKED`

Reason:
- `/usr/syno/etc/www/ReverseProxy.json` is owned by `root:root`.
- Current shell user is `admin`, but non-interactive `sudo` is not available.
- The structured JSON update attempt failed with `Permission denied` before replacing the file.

No `synow3tool --gen-all`, `synow3tool --nginx=test`, or `synow3tool --nginx=reload` was performed because the reverse proxy configuration was not changed.

## Post-attempt State

| Check | Result | Notes |
|---|---:|---|
| Current `pos.kingway.tw` configured backend | `localhost:5180` | Still unchanged |
| `https://pos.kingway.tw/` | `200` | Current production domain reachable |
| Current domain latest asset | `PASS` | `index-C78SEFUN.js` found |
| `https://pos.kingway.tw/api/system/saas-status` | `200` | Current production domain reachable |
| `GET https://pos.kingway.tw/api/login` | `404` | Authenticated login check not completed |
| Authenticated dashboard/store/settings/store-features/core API checks | `NOT RUN` | Cutover blocked before reload; credentials were not printed or exposed |

## Rollback

Rollback required: `NO`

Reason:
- The root-owned reverse proxy file was not modified.
- `pos.kingway.tw` remains configured to `localhost:5180`.

If a privileged cutover later fails, restore:

```sh
cp /volume1/docker/kingway-store/backups/production-pre-saas/20260605_004301/ReverseProxy.json.before_5173_cutover /usr/syno/etc/www/ReverseProxy.json
synow3tool --gen-all
synow3tool --nginx=test
synow3tool --nginx=reload
```

## Final Status

- Backup: `DONE`
- Cutover success: `NO`
- Current connection target: `localhost:5180`
- Rollback needed: `NO`
- Sensitive output: no raw password/token was printed
