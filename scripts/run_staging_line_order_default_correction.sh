#!/bin/bash
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCK_WRAPPER="$REPO_DIR/scripts/with_deploy_lock.sh"
MIGRATION_FILE="$REPO_DIR/database/migrations/20260818_fix_line_order_option_defaults_utf8.sql"
MIGRATION_SHA256="cf88591c0f569dafecc57186ce20a2aaaa76e0c663a783d4ebd00d3ebd2f24fd"
ALLOWED_STAGING_CONTAINER_ID="539dc44be02dae0a327d11fe57535e44be4c8620a039b3dda2babb518320d781"
PRODUCTION_MYSQL_CONTAINER_ID="769e1e1fc9834a1da7a65d7c7ee799e2ea558ffb75532222d6973777d0879e10"
EXPECTED_CONTAINER_NAME="/kingway-staging-mysql"
EXPECTED_NETWORK="kingway-staging-restore_kingway-staging-network"
EXPECTED_VOLUME="kingway-staging-restore_kingway-staging-mysql-data"
PRODUCTION_NETWORK="kingway-store_default"
PRODUCTION_VOLUME="kingway-store_mysql_data"
EXPECTED_DATABASE="kingway_store"
EXPECTED_VERSION="8.0.45"
EXPECTED_TITLE_HEX="E981B8E69387E682A8E99C80E8A681E79A84E9858DE4BBB6"
EXPECTED_DESCRIPTION_HEX="E58FAFE4BE9DE785A7E99C80E6B182E981B8E69387E9858DE4BBB6EFBC8CE4B99FE58FAFE4BBA5E795A5E9818EE6ADA4E6ADA5E9A99F"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

usage() {
  printf 'Usage: KINGWAY_ALLOW_STAGING_DEFAULT_CORRECTION=YES %s <exact-staging-container-id> <existing-result-dir>\n' "$0" >&2
}

EXPECTED_CONTAINER_ID="${1:-}"
RESULT_DIR="${2:-}"
[ -n "$EXPECTED_CONTAINER_ID" ] && [ -n "$RESULT_DIR" ] || { usage; exit 2; }
[ "$#" -eq 2 ] || { usage; exit 2; }
[ "${KINGWAY_ALLOW_STAGING_DEFAULT_CORRECTION:-}" = "YES" ] || fail "explicit staging correction approval flag is required"
[ "$EXPECTED_CONTAINER_ID" != "$PRODUCTION_MYSQL_CONTAINER_ID" ] || fail "production MySQL container ID is forbidden"
[ "$EXPECTED_CONTAINER_ID" = "$ALLOWED_STAGING_CONTAINER_ID" ] || fail "expected container ID is not the approved staging MySQL"
[ -d "$RESULT_DIR" ] || fail "existing result directory is required"
[ -f "$MIGRATION_FILE" ] || fail "migration file missing"
[ "${KINGWAY_DEPLOY_LOCK_PATH:-/tmp/kingway_deploy.lock}" = "/tmp/kingway_deploy.lock" ] || fail "alternate deploy lock is forbidden"

if [ "${KINGWAY_LINE_OPTION_CANONICAL_LOCK_HELD:-}" != "YES" ]; then
  exec "$LOCK_WRAPPER" "staging LINE option default correction" -- env \
    KINGWAY_LINE_OPTION_CANONICAL_LOCK_HELD=YES \
    KINGWAY_ALLOW_STAGING_DEFAULT_CORRECTION=YES \
    "$0" "$EXPECTED_CONTAINER_ID" "$RESULT_DIR"
fi

umask 077
LOCK_PID="$(awk -F= '$1=="pid"{print $2;exit}' /tmp/kingway_deploy.lock 2>/dev/null || true)"
[ -n "$LOCK_PID" ] && [ "$LOCK_PID" = "$PPID" ] || fail "canonical deploy lock ownership is not active"

actual_id="$(sudo -n docker inspect --format '{{.Id}}' "$EXPECTED_CONTAINER_ID")"
container_name="$(sudo -n docker inspect --format '{{.Name}}' "$EXPECTED_CONTAINER_ID")"
container_status="$(sudo -n docker inspect --format '{{.State.Status}}' "$EXPECTED_CONTAINER_ID")"
restart_count="$(sudo -n docker inspect --format '{{.RestartCount}}' "$EXPECTED_CONTAINER_ID")"
networks="$(sudo -n docker inspect --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$EXPECTED_CONTAINER_ID")"
mounts="$(sudo -n docker inspect --format '{{range .Mounts}}{{.Name}}|{{.Destination}} {{end}}' "$EXPECTED_CONTAINER_ID")"

[ "$actual_id" = "$EXPECTED_CONTAINER_ID" ] || fail "container ID changed"
[ "$container_name" = "$EXPECTED_CONTAINER_NAME" ] || fail "container name mismatch"
[ "$container_status" = "running" ] || fail "staging MySQL is not running"
[ "$restart_count" = "0" ] || fail "staging MySQL restart count is not zero"
printf '%s\n' "$networks" | grep -qw "$EXPECTED_NETWORK" || fail "staging network missing"
printf '%s\n' "$networks" | grep -qw "$PRODUCTION_NETWORK" && fail "production network attached"
printf '%s\n' "$mounts" | grep -Fq "$EXPECTED_VOLUME|/var/lib/mysql" || fail "staging volume missing"
printf '%s\n' "$mounts" | grep -Fq "$PRODUCTION_VOLUME" && fail "production volume attached"

actual_migration_sha="$(sha256sum "$MIGRATION_FILE" | awk '{print $1}')"
[ "$actual_migration_sha" = "$MIGRATION_SHA256" ] || fail "migration SHA-256 mismatch"

mysql_query() {
  sudo -n docker exec -i "$EXPECTED_CONTAINER_ID" sh -lc 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --batch --skip-column-names -u"$MYSQL_USER" "$MYSQL_DATABASE"'
}

identity="$(printf '%s\n' "SELECT DATABASE(), @@hostname, VERSION(), IF(SUBSTRING_INDEX(CURRENT_USER(),CHAR(64),1)=CHAR(114,111,111,116),'root','non-root');" | mysql_query)"
db_name="$(printf '%s\n' "$identity" | awk -F '\t' 'NR==1{print $1}')"
db_hostname="$(printf '%s\n' "$identity" | awk -F '\t' 'NR==1{print $2}')"
db_version="$(printf '%s\n' "$identity" | awk -F '\t' 'NR==1{print $3}')"
db_account_class="$(printf '%s\n' "$identity" | awk -F '\t' 'NR==1{print $4}')"
[ "$db_name" = "$EXPECTED_DATABASE" ] || fail "database name mismatch"
case "$EXPECTED_CONTAINER_ID" in "$db_hostname"*) ;; *) fail "MySQL hostname does not match staging container ID" ;; esac
[ "$db_version" = "$EXPECTED_VERSION" ] || fail "MySQL version mismatch"
[ "$db_account_class" = "non-root" ] || fail "root account is forbidden"

grants="$(printf '%s\n' 'SHOW GRANTS;' | mysql_query)"
normalized_grants="$(printf '%s\n' "$grants" | tr -d '`\\')"
printf '%s\n' "$normalized_grants" | grep -Fqi "GRANT ALL PRIVILEGES ON kingway_store.* TO" || fail "current schema ALTER/SELECT privilege missing"
printf '%s\n' "$normalized_grants" | grep -Fqi "GRANT ALL PRIVILEGES ON *.* TO" && fail "global ALL privilege is forbidden"
unset grants normalized_grants identity

capture_snapshot() {
  target="$1"
  mysql_query > "$target" <<'SQL'
SET SESSION group_concat_max_len = 1048576;
SELECT 'database', DATABASE()
UNION ALL SELECT 'page_title_default_hex', COALESCE((SELECT HEX(COLUMN_DEFAULT) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='line_order_option_settings' AND COLUMN_NAME='page_title' LIMIT 1),'NULL')
UNION ALL SELECT 'page_description_default_hex', COALESCE((SELECT HEX(COLUMN_DEFAULT) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='line_order_option_settings' AND COLUMN_NAME='page_description' LIMIT 1),'NULL')
UNION ALL SELECT 'row_count', CAST((SELECT COUNT(*) FROM line_order_option_settings) AS CHAR)
UNION ALL SELECT 'row_data_sha256', (SELECT SHA2(COALESCE(GROUP_CONCAT(SHA2(CONCAT_WS('|',
 COALESCE(HEX(CAST(id AS CHAR)),'NULL'),COALESCE(HEX(CAST(store_id AS CHAR)),'NULL'),
 COALESCE(HEX(CAST(is_enabled AS CHAR)),'NULL'),COALESCE(HEX(page_title),'NULL'),
 COALESCE(HEX(page_description),'NULL'),COALESCE(HEX(CAST(allow_skip AS CHAR)),'NULL'),
 COALESCE(HEX(CAST(show_out_of_stock AS CHAR)),'NULL'),COALESCE(HEX(CAST(show_prices AS CHAR)),'NULL'),
 COALESCE(HEX(CAST(created_by_staff_id AS CHAR)),'NULL'),COALESCE(HEX(CAST(updated_by_staff_id AS CHAR)),'NULL'),
 COALESCE(HEX(DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s.%f')),'NULL'),
 COALESCE(HEX(DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s.%f')),'NULL')
),256) ORDER BY id SEPARATOR ''),''),256) FROM line_order_option_settings)
UNION ALL SELECT 'column_structure_sha256', (SELECT SHA2(GROUP_CONCAT(CONCAT_WS('|',TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COALESCE(CHARACTER_SET_NAME,'NULL'),COALESCE(COLLATION_NAME,'NULL'),EXTRA) ORDER BY TABLE_NAME,ORDINAL_POSITION SEPARATOR '\n'),256) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('line_order_option_settings','line_order_option_groups','line_order_option_group_products','order_items'))
UNION ALL SELECT 'index_structure_sha256', (SELECT SHA2(GROUP_CONCAT(CONCAT_WS('|',TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME) ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX SEPARATOR '\n'),256) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('line_order_option_settings','line_order_option_groups','line_order_option_group_products'))
UNION ALL SELECT 'constraint_structure_sha256', (SELECT SHA2(GROUP_CONCAT(CONCAT_WS('|',TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE) ORDER BY TABLE_NAME,CONSTRAINT_NAME SEPARATOR '\n'),256) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('line_order_option_settings','line_order_option_groups','line_order_option_group_products'));
SQL
  [ -s "$target" ] || fail "snapshot output is empty"
}

snapshot_value() {
  awk -F '\t' -v key="$1" '$1==key{print $2;exit}' "$2"
}

before="$RESULT_DIR/db-before.tsv"
after="$RESULT_DIR/db-after.tsv"
migration_stdout="$RESULT_DIR/migration.stdout.sanitized.txt"
migration_stderr="$RESULT_DIR/migration.stderr.sanitized.txt"
capture_snapshot "$before"
[ "$(snapshot_value database "$before")" = "$EXPECTED_DATABASE" ] || fail "before snapshot database mismatch"
[ -n "$(snapshot_value row_data_sha256 "$before")" ] || fail "before row hash missing"

set +e
sudo -n docker exec -i "$EXPECTED_CONTAINER_ID" sh -lc 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --batch --skip-column-names -u"$MYSQL_USER" "$MYSQL_DATABASE"' < "$MIGRATION_FILE" > "$migration_stdout" 2> "$migration_stderr"
migration_exit=$?
set -e
sed -E -i 's/(password|token|authorization)[^[:space:]]*/\1=[REDACTED]/Ig' "$migration_stdout" "$migration_stderr"
capture_snapshot "$after"

[ "$migration_exit" -eq 0 ] || fail "migration failed; no retry is permitted"
[ "$(snapshot_value page_title_default_hex "$after")" = "$EXPECTED_TITLE_HEX" ] || fail "page_title default assertion failed"
[ "$(snapshot_value page_description_default_hex "$after")" = "$EXPECTED_DESCRIPTION_HEX" ] || fail "page_description default assertion failed"
for key in row_count row_data_sha256 column_structure_sha256 index_structure_sha256 constraint_structure_sha256; do
  [ "$(snapshot_value "$key" "$before")" = "$(snapshot_value "$key" "$after")" ] || fail "before/after invariant failed: $key"
done

final_restart_count="$(sudo -n docker inspect --format '{{.RestartCount}}' "$EXPECTED_CONTAINER_ID")"
[ "$final_restart_count" = "0" ] || fail "staging MySQL restart count changed"
printf 'migration_exit=0\ncontainer_id=%s\nrow_count=%s\nrow_data_sha256=%s\n' "$EXPECTED_CONTAINER_ID" "$(snapshot_value row_count "$after")" "$(snapshot_value row_data_sha256 "$after")" > "$RESULT_DIR/migration-result.txt"
chmod 600 "$before" "$after" "$migration_stdout" "$migration_stderr" "$RESULT_DIR/migration-result.txt"
