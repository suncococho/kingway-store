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
