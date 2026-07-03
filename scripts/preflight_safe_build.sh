#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${KINGWAY_REPO_DIR:-/volume1/docker/kingway-store}"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

cd "$REPO_DIR"

if [ -n "$(git status --short)" ]; then
  git status --short >&2
  fail "working tree is not clean. Commit or stash changes before a safe build."
fi

cat <<'MSG'
SAFE BUILD preflight passed.

This guard is for code/build validation only.
Do not run production deploy from this script.

Production deploy must be started explicitly with:
  ./scripts/preflight_production_deploy.sh [expected-head]
  ./scripts/with_deploy_lock.sh "description" -- sudo docker compose up -d --no-deps --force-recreate backend frontend

WARNING:
  - Do not run DB writes here.
  - Do not run migrations here.
  - Production migration requires backup plus KINGWAY_ALLOW_MIGRATION=YES via scripts/run_approved_migration.sh.
MSG
