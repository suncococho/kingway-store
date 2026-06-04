#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/volume1/docker/kingway-store"
BACKUP_ROOT="$REPO_DIR/backups/production-pre-saas"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"
SQL_GZ="$BACKUP_DIR/mysql_kingway_store.sql.gz"
UPLOADS_TAR="$BACKUP_DIR/backend_uploads.tar.gz"
PDFS_TAR="$BACKUP_DIR/backend_storage_pdfs.tar.gz"
ENV_BACKUP="$BACKUP_DIR/.env.backup"
COMPOSE_BACKUP="$BACKUP_DIR/docker-compose.production.yml"
ROW_COUNT_FILE="$BACKUP_DIR/row_counts.tsv"
MANIFEST_FILE="$BACKUP_DIR/manifest.txt"
CHECKSUM_FILE="$BACKUP_DIR/sha256sums.txt"
NGINX_NOTE_FILE="$BACKUP_DIR/nginx_reverse_proxy_location.txt"
NGINX_CONF_PATH="/etc/nginx/sites-enabled/server.ReverseProxy.conf"

log() {
  printf '%s\n' "$1"
}

require_file() {
  local path="$1"
  if [ ! -e "$path" ]; then
    printf 'Required path not found: %s\n' "$path" >&2
    exit 1
  fi
}

read_env_value() {
  local key="$1"
  local value
  value="$(grep -m1 "^${key}=" "$REPO_DIR/.env" | cut -d= -f2- || true)"
  printf '%s' "$value"
}

main() {
  require_file "$REPO_DIR/.env"
  require_file "$REPO_DIR/docker-compose.yml"
  require_file "$REPO_DIR/backend/uploads"
  require_file "$REPO_DIR/backend/storage/pdfs"

  mkdir -p "$BACKUP_DIR"
  local mysql_host="127.0.0.1"
  local mysql_port="3306"
  local mysql_database
  local mysql_user
  local mysql_password

  mysql_database="$(read_env_value MYSQL_DATABASE)"
  mysql_user="$(read_env_value MYSQL_USER)"
  mysql_password="$(read_env_value MYSQL_PASSWORD)"

  mysql_database="${mysql_database:-kingway_store}"
  mysql_user="${mysql_user:-kingway}"

  if [ -z "$mysql_password" ]; then
    printf 'MYSQL_PASSWORD is empty in .env\n' >&2
    exit 1
  fi

  log "== Production pre-SaaS migration backup =="
  log "Backup directory: $BACKUP_DIR"
  log "MySQL target: ${mysql_host}:${mysql_port}/${mysql_database}"

  log "Backing up production MySQL with mysqldump..."
  MYSQL_PWD="$mysql_password" mysqldump \
    -h "$mysql_host" \
    -P "$mysql_port" \
    -u "$mysql_user" \
    --single-transaction \
    --quick \
    --routines \
    --triggers \
    --no-tablespaces \
    --default-character-set=utf8mb4 \
    "$mysql_database" \
    | gzip -c > "$SQL_GZ"

  log "Archiving backend/uploads..."
  tar -C "$REPO_DIR" -czf "$UPLOADS_TAR" backend/uploads

  log "Archiving backend/storage/pdfs..."
  tar -C "$REPO_DIR" -czf "$PDFS_TAR" backend/storage/pdfs

  log "Copying .env and docker-compose.yml..."
  cp "$REPO_DIR/.env" "$ENV_BACKUP"
  cp "$REPO_DIR/docker-compose.yml" "$COMPOSE_BACKUP"

  log "Recording git metadata..."
  git -C "$REPO_DIR" branch --show-current > "$BACKUP_DIR/git_branch.txt"
  git -C "$REPO_DIR" rev-parse HEAD > "$BACKUP_DIR/git_commit.txt"
  git -C "$REPO_DIR" log -1 --oneline > "$BACKUP_DIR/git_commit_oneline.txt"

  log "Recording nginx reverse proxy reference..."
  {
    printf 'nginx_reverse_proxy_config_path=%s\n' "$NGINX_CONF_PATH"
    if [ -r "$NGINX_CONF_PATH" ]; then
      printf 'nginx_reverse_proxy_config_readable=yes\n'
      cp "$NGINX_CONF_PATH" "$BACKUP_DIR/server.ReverseProxy.conf"
    else
      printf 'nginx_reverse_proxy_config_readable=no\n'
    fi
  } > "$NGINX_NOTE_FILE"

  log "Recording production row counts..."
  {
    printf 'table_name\trow_count\n'
    MYSQL_PWD="$mysql_password" mysql \
      -N \
      -h "$mysql_host" \
      -P "$mysql_port" \
      -u "$mysql_user" \
      -D "$mysql_database" \
      -e "
        SELECT 'customers', COUNT(*) FROM customers
        UNION ALL SELECT 'products', COUNT(*) FROM products
        UNION ALL SELECT 'orders', COUNT(*) FROM orders
        UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
        UNION ALL SELECT 'repair_orders', COUNT(*) FROM repair_orders
        UNION ALL SELECT 'purchase_confirmations', COUNT(*) FROM purchase_confirmations
        UNION ALL SELECT 'coupons', COUNT(*) FROM coupons;
      "
  } > "$ROW_COUNT_FILE"

  log "Generating checksums..."
  (
    cd "$BACKUP_DIR"
    checksum_files=(
      "$(basename "$SQL_GZ")"
      "$(basename "$UPLOADS_TAR")"
      "$(basename "$PDFS_TAR")"
      "$(basename "$ENV_BACKUP")"
      "$(basename "$COMPOSE_BACKUP")"
      "git_branch.txt"
      "git_commit.txt"
      "git_commit_oneline.txt"
      "row_counts.tsv"
      "nginx_reverse_proxy_location.txt"
    )
    if [ -f "server.ReverseProxy.conf" ]; then
      checksum_files+=("server.ReverseProxy.conf")
    fi
    sha256sum "${checksum_files[@]}" > "$CHECKSUM_FILE"
  )

  {
    printf 'timestamp=%s\n' "$TIMESTAMP"
    printf 'backup_dir=%s\n' "$BACKUP_DIR"
    printf 'mysql_target=%s:%s/%s\n' "$mysql_host" "$mysql_port" "$mysql_database"
    printf 'git_branch=%s\n' "$(cat "$BACKUP_DIR/git_branch.txt")"
    printf 'git_commit=%s\n' "$(cat "$BACKUP_DIR/git_commit.txt")"
    printf '\n[backup_files]\n'
    ls -lh "$BACKUP_DIR"
  } > "$MANIFEST_FILE"

  log "Backup complete."
  log "Backup files:"
  ls -lh "$BACKUP_DIR"
}

main "$@"
