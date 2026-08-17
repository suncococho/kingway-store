#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${KINGWAY_REPO_DIR:-/volume1/docker/kingway-store}"
EXPECTED_HEAD="${1:-${KINGWAY_EXPECTED_HEAD:-}}"
MIN_MEM_AVAILABLE_MB="${KINGWAY_MIN_MEM_AVAILABLE_MB:-256}"
MIN_DISK_AVAILABLE_MB="${KINGWAY_MIN_DISK_AVAILABLE_MB:-1024}"
TMP_DIR="$(mktemp -d /tmp/kingway_preflight.XXXXXX)"
CONTAINER_MANAGER_STATUS_JSON="$TMP_DIR/container_manager_status.json"
CONTAINER_MANAGER_STATUS_ERR="$TMP_DIR/container_manager_status.err"
MYSQL_PING_OUT="$TMP_DIR/mysql_ping.out"
MYSQL_PING_ERR="$TMP_DIR/mysql_ping.err"
BACKEND_HEALTH_OUT="$TMP_DIR/backend_health.out"

cleanup_tmp() {
  rm -rf "$TMP_DIR"
}
trap cleanup_tmp EXIT

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

info() {
  printf 'OK: %s\n' "$1"
}

cd "$REPO_DIR"

node "$REPO_DIR/scripts/check_core_feature_contract.js"
sh "$REPO_DIR/scripts/check_staff_incentive_integration.sh"
sh "$REPO_DIR/scripts/check_staff_work_schedule_integration.sh"
sh "$REPO_DIR/scripts/check_line_order_admin_menu.sh"

set +e
synopkg status ContainerManager >"$CONTAINER_MANAGER_STATUS_JSON" 2>"$CONTAINER_MANAGER_STATUS_ERR"
CONTAINER_MANAGER_STATUS_EXIT="$?"
set -e
if [ ! -s "$CONTAINER_MANAGER_STATUS_JSON" ]; then
  cat "$CONTAINER_MANAGER_STATUS_ERR" >&2 || true
  fail "ContainerManager status check failed."
fi
info "ContainerManager status command responded (exit=${CONTAINER_MANAGER_STATUS_EXIT})."

if ! sudo docker ps >/dev/null; then
  fail "docker ps did not respond."
fi
info "docker ps responded."

if ! sudo docker exec kingway-mysql sh -lc 'mysqladmin -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" ping' >"$MYSQL_PING_OUT" 2>"$MYSQL_PING_ERR"; then
  cat "$MYSQL_PING_ERR" >&2 || true
  cat "$MYSQL_PING_OUT" >&2 || true
  fail "production MySQL ping failed."
fi
info "production MySQL ping responded."

if ! curl -fsS --max-time 10 http://127.0.0.1:3000/health >"$BACKEND_HEALTH_OUT"; then
  cat "$BACKEND_HEALTH_OUT" >&2 || true
  fail "backend /health check failed."
fi
info "backend /health responded."

if [ -n "$(git status --short)" ]; then
  git status --short >&2
  fail "working tree is not clean."
fi
info "git working tree is clean."

CURRENT_HEAD="$(git rev-parse --short HEAD)"
if [ -n "$EXPECTED_HEAD" ] && [ "$CURRENT_HEAD" != "$EXPECTED_HEAD" ]; then
  fail "HEAD mismatch. expected=$EXPECTED_HEAD actual=$CURRENT_HEAD"
fi
info "HEAD verified: $CURRENT_HEAD"

MEM_AVAILABLE_MB="$(free -m | awk '/^Mem:/ {print $7}')"
if [ "${MEM_AVAILABLE_MB:-0}" -lt "$MIN_MEM_AVAILABLE_MB" ]; then
  fail "available memory too low: ${MEM_AVAILABLE_MB}MB < ${MIN_MEM_AVAILABLE_MB}MB"
fi
info "available memory ${MEM_AVAILABLE_MB}MB"

DISK_AVAILABLE_MB="$(df -Pm "$REPO_DIR" | awk 'NR == 2 { print $4 }')"
if [ "${DISK_AVAILABLE_MB:-0}" -lt "$MIN_DISK_AVAILABLE_MB" ]; then
  fail "available disk too low: ${DISK_AVAILABLE_MB}MB < ${MIN_DISK_AVAILABLE_MB}MB"
fi
info "available disk ${DISK_AVAILABLE_MB}MB >= ${MIN_DISK_AVAILABLE_MB}MB"

cat <<'MSG'

Production deploy preflight passed.

Deploy rule:
  - Use ./scripts/with_deploy_lock.sh.
  - Recreate backend/frontend only.
  - Do not include mysql in docker compose deploy commands.
  - Never run docker compose down for deploy.

Allowed example:
  ./scripts/with_deploy_lock.sh "backend/frontend deploy" -- sudo docker compose up -d --no-deps --force-recreate backend frontend

Forbidden:
  sudo docker compose up -d mysql
  sudo docker compose restart mysql
  docker compose down
MSG
