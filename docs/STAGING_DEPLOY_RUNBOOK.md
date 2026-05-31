# Staging Deploy Runbook

## Purpose

`scripts/deploy-staging.sh` is a staging-only helper for deploying the KINGWAY staging backend and frontend. It is intended to reduce repeated manual terminal commands.

This script is not for production.

## What The Script Does

The script:

- changes directory to `/volume1/docker/kingway-store`
- prints the current branch
- prints `git status --short`
- stops if the working tree is dirty
- pulls latest `origin beta/staging-architecture`
- runs backend syntax checks
- runs the frontend production build
- builds staging Docker images for `backend` and `frontend`
- starts staging `backend` and `frontend`
- waits 8 seconds
- prints Docker Compose service status
- checks staging backend health and SaaS status endpoints
- prints the staging frontend and API URLs

## When To Run It

Run it after a commit has been pushed to `origin/beta/staging-architecture` and you want the staging containers to use the latest branch state.

Run from the repository root:

```sh
scripts/deploy-staging.sh
```

## Successful Output

A successful run should show:

- clean `git status --short`
- successful `git pull`
- passing `node --check` commands
- successful `npm --prefix frontend run build`
- successful Docker build
- `backend` and `frontend` listed by `docker compose ps`
- successful `curl -f` responses for:
  - `http://127.0.0.1:3010/health`
  - `http://127.0.0.1:3010/api/saas-admin/stores`
  - `http://127.0.0.1:3010/api/system/saas-status`

At the end it prints:

- `http://59.127.191.213:5180`
- `http://59.127.191.213:5180/saas-admin`
- `http://59.127.191.213:3010/api/saas-admin/stores`

## If Sudo Asks For Password

Enter the NAS admin password in the terminal. If the session cannot prompt for a password, run the script manually in an interactive SSH terminal.

Do not bypass sudo by changing production config or Docker socket permissions during a staging deploy.

## If Git Pull Fails

Check:

- network access to GitHub
- Git credentials for the repository
- whether the branch is still `beta/staging-architecture`
- whether local commits exist that are not pushed

Resolve Git state first, then rerun the script.

## If Frontend Build Fails

Read the first Vite or JavaScript error. Fix the frontend code, commit the fix, and rerun the script.

Known warnings that do not fail the build can be reviewed separately, but any non-zero build exit stops the deploy.

## If Docker Build Fails

Check:

- Docker daemon status
- Docker Compose file: `docker-compose.staging-restore.yml`
- backend/frontend Dockerfile errors
- dependency install failures
- disk space on the NAS

Fix the build cause before rerunning. Do not switch to production compose files.

## If Health Check Fails

Check:

- `sudo docker compose -f docker-compose.staging-restore.yml ps`
- backend logs:
  ```sh
  sudo docker compose -f docker-compose.staging-restore.yml logs backend
  ```
- whether SchemaGuard failed startup
- whether MySQL staging DB is reachable
- whether port `3010` is bound by the staging backend

After fixing the issue, rerun the deploy script.

## NAS Reboot

NAS reboot remains manual for now. This deploy script only rebuilds and restarts staging backend/frontend containers.

Do not add automatic NAS reboot behavior to this script unless explicitly requested.
