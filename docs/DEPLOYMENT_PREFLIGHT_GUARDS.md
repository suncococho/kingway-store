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
