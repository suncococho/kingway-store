#!/bin/sh
set -e

REPO_DIR="/volume1/docker/kingway-store"
BACKUP_ROOT="$REPO_DIR/backups/staging"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"
SQL_TMP="$BACKUP_DIR/mysql_kingway_store.sql"
MYSQL_CONTAINER="kingway-staging-mysql"
MYSQL_DATABASE="kingway_store"
MYSQL_USER="kingway"
KEEP_COUNT=14

if docker ps >/dev/null 2>&1; then
  DOCKER_CMD="docker"
else
  DOCKER_CMD="sudo docker"
fi

mkdir -p "$BACKUP_DIR"
trap 'rm -f "$SQL_TMP"' EXIT

log() {
  printf '%s\n' "$1"
}

log "== KINGWAY staging local backup =="
log "Backup directory: $BACKUP_DIR"

log "Backing up staging MySQL..."
$DOCKER_CMD exec -e MYSQL_PWD=kingway "$MYSQL_CONTAINER" \
  sh -c "mysqldump -u$MYSQL_USER --single-transaction --quick --routines --triggers --no-tablespaces $MYSQL_DATABASE" \
  > "$SQL_TMP"
gzip -c "$SQL_TMP" > "$BACKUP_DIR/mysql_kingway_store.sql.gz"
rm -f "$SQL_TMP"

log "Backing up project files..."
tar -C "$REPO_DIR"   --exclude='./node_modules'   --exclude='./backend/node_modules'   --exclude='./frontend/node_modules'   --exclude='./frontend/dist'   --exclude='./backups'   --exclude='./.git'   -czf "$BACKUP_DIR/project_files.tar.gz" .

STORAGE_PATHS=""
if [ -d "$REPO_DIR/backend/storage" ]; then
  STORAGE_PATHS="$STORAGE_PATHS backend/storage"
fi
if [ -d "$REPO_DIR/storage" ]; then
  STORAGE_PATHS="$STORAGE_PATHS storage"
fi

if [ -n "$STORAGE_PATHS" ]; then
  log "Backing up storage folders..."
  # shellcheck disable=SC2086
  tar -C "$REPO_DIR" -czf "$BACKUP_DIR/storage_files.tar.gz" $STORAGE_PATHS
else
  log "No storage folders found; skipping storage_files.tar.gz."
fi

MANIFEST="$BACKUP_DIR/manifest.txt"
{
  printf 'timestamp=%s\n' "$TIMESTAMP"
  printf 'backup_dir=%s\n' "$BACKUP_DIR"
  printf 'git_branch=%s\n' "$(git -C "$REPO_DIR" branch --show-current 2>/dev/null || printf 'unknown')"
  printf 'git_commit=%s\n' "$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || printf 'unknown')"
  printf '\n[docker_ps]\n'
  $DOCKER_CMD ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
  printf '\n[backup_file_sizes]\n'
  du -h "$BACKUP_DIR"/*.gz 2>/dev/null | sort
} > "$MANIFEST"

log "Cleaning up old backups, keeping latest $KEEP_COUNT folders..."
CLEANUP_LIST="$BACKUP_DIR/.cleanup_list"
ls -1dt "$BACKUP_ROOT"/*/ 2>/dev/null | sed -e "1,${KEEP_COUNT}d" > "$CLEANUP_LIST" || true
if [ -s "$CLEANUP_LIST" ]; then
  while IFS= read -r old_backup; do
    [ -n "$old_backup" ] || continue
    rm -rf "$old_backup"
  done < "$CLEANUP_LIST"
  CLEANUP_RESULT="deleted_old_backups=yes"
else
  CLEANUP_RESULT="deleted_old_backups=no"
fi
rm -f "$CLEANUP_LIST"
printf '%s\n' "$CLEANUP_RESULT" >> "$MANIFEST"

log "Backup complete."
log "Files:"
ls -lh "$BACKUP_DIR"
log "$CLEANUP_RESULT"
