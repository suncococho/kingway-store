#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${KINGWAY_REPO_DIR:-/volume1/docker/kingway-store}"
MIGRATION_FILE="${1:-}"
BACKUP_FILE="${2:-${KINGWAY_MIGRATION_BACKUP_FILE:-}}"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage:
  KINGWAY_ALLOW_MIGRATION=YES ./scripts/run_approved_migration.sh <migration.sql> <backup-file-or-dir>

Rules:
  - This script executes a production DB write.
  - It refuses to run unless KINGWAY_ALLOW_MIGRATION=YES.
  - A real backup file or backup directory path is required.
  - Run only after explicit approval for the specific migration.
USAGE
}

cd "$REPO_DIR"

[ -n "$MIGRATION_FILE" ] || {
  usage >&2
  fail "migration file path is required."
}

[ -n "$BACKUP_FILE" ] || {
  usage >&2
  fail "backup file or backup directory path is required."
}

[ "${KINGWAY_ALLOW_MIGRATION:-}" = "YES" ] || fail "KINGWAY_ALLOW_MIGRATION=YES is required."
[ -f "$MIGRATION_FILE" ] || fail "migration file not found: $MIGRATION_FILE"
[ -e "$BACKUP_FILE" ] || fail "backup path not found: $BACKUP_FILE"

cat <<MSG
Approved migration preflight:
  migration: $MIGRATION_FILE
  backup:    $BACKUP_FILE

Dry-run guidance before execution:
  - Review the SQL file manually.
  - Confirm backup integrity/checksums where available.
  - Confirm this is the only approved DB write for the task.

Executing migration now because KINGWAY_ALLOW_MIGRATION=YES is set.
MSG

sudo docker exec -i kingway-mysql sh -lc 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < "$MIGRATION_FILE"

printf 'Migration execution finished: %s\n' "$MIGRATION_FILE"
