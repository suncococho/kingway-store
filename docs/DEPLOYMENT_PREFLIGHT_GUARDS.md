# KINGWAY Deployment Preflight Guards

These scripts are guardrails for production deploy and approved migrations. They do not replace operator review.

## SAFE BUILD

Use before local validation or a build-only task:

```sh
./scripts/preflight_safe_build.sh
```

It fails when the git working tree is not clean. It only prints deploy guidance and DB-write warnings. It must not run migrations or production deploy.

## CRITICAL FLOW

Before production deploy:

```sh
./scripts/preflight_production_deploy.sh
```

Optional expected HEAD:

```sh
./scripts/preflight_production_deploy.sh 74e2b46
```

The guard checks ContainerManager response, Docker response, production MySQL ping, backend `/health`, clean git state, optional HEAD, available memory, and available disk.

After it passes, deploy only the approved service scope with the deploy lock. Do not include MySQL.

```sh
./scripts/with_deploy_lock.sh "backend/frontend deploy" -- sudo docker compose up -d --no-deps --force-recreate backend frontend
```

Forbidden for production deploy:

```sh
docker compose down
docker compose down -v
sudo docker compose up -d mysql
sudo docker compose restart mysql
```

## Migration Approval Flow

Production migration requires explicit approval and a completed backup. The migration runner refuses to execute without both.

```sh
KINGWAY_ALLOW_MIGRATION=YES ./scripts/run_approved_migration.sh database/migrations/example.sql backups/production/example-backup.sql.gz
```

Rules:

- Run a production backup first.
- Pass the migration SQL file path.
- Pass a real backup file or backup directory path.
- Set `KINGWAY_ALLOW_MIGRATION=YES` only for the approved migration command.
- Do not run ad hoc `UPDATE`, `DELETE`, or `INSERT` outside the approved migration.

## Core Feature Release Contract

The release source of truth is:

- `config/core-feature-contract.json`
- `config/core-feature-production-baseline.json`
- `config/core-feature-role-snapshot.json`
- `scripts/check_core_feature_contract.js`

A completed production feature must not be removed, renamed, hidden from an allowed role, or lose its frontend route, menu path, permission mapping, frontend API marker, backend route, or backend mount without a separately reviewed manifest and baseline change.

Run the source contract before every build:

```sh
node scripts/check_core_feature_contract.js
```

After a frontend build, validate the exact generated asset:

```sh
node scripts/check_core_feature_contract.js --asset-file frontend/dist/assets/index-<hash>.js
```

Both preflight scripts run the core contract and the feature-specific checks. A non-zero result blocks build or deploy.

## Git and Release Workflow

1. Use a separate worktree for each feature.
2. Do not commit a feature before its completion criteria and related tests pass.
3. Commit completed features atomically; keep unrelated or incomplete files out.
4. Keep feature tests with the corresponding feature commit.
5. Never overwrite whole shared route, menu, permission, compose, or app-mount files from an older worktree.
6. Never build from a dirty main worktree.
7. Build staging and production artifacts only from a clean release branch based on the verified current production release.
8. The core feature manifest, production baseline, and role snapshot checks must pass.
9. A failed preflight prohibits build and deploy.
10. Validate the exact release commit and artifact in staging before requesting separate production approval.
11. After an approved production deploy, create a `production-YYYYMMDD-HHMM` tag.
12. Record the previous frontend/backend image IDs as rollback targets.
13. Commit approval and deploy approval are separate.
14. Git push requires separate approval.
15. Integrate approved feature diffs, not files grouped by modification time.

Staging and production must use the same commit and the same build artifact. Immediately before an approved production deploy, create a timestamped snapshot under `/volume1/backup/kingway/releases/YYYYMMDD-HHMMSS/` containing the release commit, image IDs, asset filename/hash, compose hash, core file hashes, route/menu/API and role snapshots, health results, previous release ID, and rollback image IDs.

Production deploys must use `./scripts/with_deploy_lock.sh`. Do not use `docker compose down`, recreate or restart MySQL, or run a production DB write/migration without explicit approval. A frontend-only change must not restart backend or MySQL.


## Bidirectional Production Coverage

The version 3 contract is a bidirectional inventory, not only a list of selected features. It accounts for every registered frontend route, navigation menu, permission mapping, backend mount, direct endpoint, and protected background workflow. The reviewed inventory currently contains 53 feature families, 83 frontend routes, 35 menus, 35 menu permission mappings, 59 unique backend mounts, 10 direct endpoints, and 17 workflows.

Release checks enforce both directions:

- Every contract entry must still exist in source and, where applicable, in the generated frontend asset.
- Every source route, menu, backend mount, direct endpoint, and workflow must belong to a feature or an explicitly documented classification.
- Alias, detail, print, public workflow, redirect/helper, fallback, and conditional routes remain protected; `*` is an explicit fallback classification.
- Conditional, disabled, legacy, and unmounted entries require a reason. `/api/debug`, the intentional `/files/pdfs` 404, and the unmounted Telegram router are not silently treated as production features.
- Role snapshots cover the complete menu set. Both reductions and unreviewed expansions fail for protected roles.
- The manifest, production baseline, and role snapshot must be reviewed together whenever coverage or permissions change.

Adding a source route, menu, mount, endpoint, or workflow without contract classification is a preflight failure. Removing a production baseline entry or required asset marker is also a failure. Feature deletion or permission change therefore requires a separately approved contract and baseline review before build or deploy.


## Approved Store Menu Policy and API Separation

The reviewed subjects are `ADMIN_ROLE`, `STORE_ROLE_OWNER`, `MANAGER_ROLE`, `CASHIER_ROLE`, `REPAIR_ROLE`, `INVENTORY_ROLE`, and `STAFF_ROLE`. `STORE_ROLE_OWNER` means the actual `storeRole=owner` identity and must never be implemented as a virtual staff role. ADMIN, store owner, and MANAGER require all 35 store-operation menus; CASHIER, REPAIR, and INVENTORY require their exact 15-menu fallbacks; STAFF requires the common eight menus plus `/staff-scheduling` and `/staff-incentives`. Platform and SaaS authorization remains separate.

Menu visibility is not backend read or write authorization. The feature contract records `menuRoles`, self-service read/write roles, management read/write roles, public access, and the source middleware independently. Known mismatches are retained in `knownAuthorizationGaps` until a separately approved backend security change resolves them. A menu grant must not be interpreted as permission to call a write endpoint.


## Read-only Backend Validation

Set `BACKEND_VALIDATION_MODE=read-only` only on an isolated or approved staging backend. The default is `off`, preserving normal production startup. Read-only validation runs the SELECT-only schema guard but skips schema bootstrap, default ADMIN/staff reconciliation, storage initialization, scheduler registration, and outbound LINE/Telegram delivery. HTTP `GET`, `HEAD`, and `OPTIONS` remain available; `POST`, `PUT`, `PATCH`, and `DELETE` return a non-sensitive 503 response. The database wrapper also rejects transactions and non-SELECT SQL so a side-effecting GET cannot write.

Role validation must select only existing actor IDs and roles, create JWTs inside the validation runtime, and never print or return token values. `backend/scripts/validateReadOnlyRoleGets.js --fixture` verifies that runner structure without connecting to a database or creating a real token.

Immutable backend staging images use `backend/Dockerfile`, a commit-based `kingway-staging-backend:<commit>` tag, and the full commit in `org.opencontainers.image.revision`. Build from a repository-root `git archive` of the exact release commit so the backend and its reviewed shared warranty terms retain their repository layout without admitting untracked env, upload, or storage files. The image uses `npm ci --omit=dev --no-audit --no-fund`, runs `node src/server.js` as `node`, and excludes env files, dependencies, uploads, storage, and generated PDF data from the build context.
