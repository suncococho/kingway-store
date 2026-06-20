#!/bin/bash

set -euo pipefail

BASE_DIR="/volume1/docker/kingway-store"
LOG_DIR="$BASE_DIR/logs"
LOG_FILE="$LOG_DIR/kingway_watchdog.log"
LOCK_DIR="/tmp/kingway_watchdog.lock"
DEPLOY_LOCK_PATH="${KINGWAY_DEPLOY_LOCK_PATH:-/tmp/kingway_deploy.lock}"
DEPLOY_LOCK_STALE_SECONDS="${KINGWAY_DEPLOY_LOCK_STALE_SECONDS:-1800}"
WATCHDOG_ENV="$BASE_DIR/.env.watchdog"
PROJECT_ENV="$BASE_DIR/.env"
THRESHOLD_PERCENT=85

PATH="/usr/syno/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export PATH

umask 077
mkdir -p "$LOG_DIR"
touch "$LOG_FILE"
chmod 600 "$LOG_FILE" 2>/dev/null || true

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S%z')" "$*" >> "$LOG_FILE"
}

read_lock_value() {
  key="$1"
  file="$2"

  [ -r "$file" ] || return 1
  awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$file"
}

pid_is_alive() {
  pid="$1"

  case "$pid" in
    ''|*[!0-9]*)
      return 1
      ;;
  esac

  kill -0 "$pid" 2>/dev/null
}

timestamp_epoch() {
  value="$1"

  [ -n "$value" ] || return 1
  date -d "$value" +%s 2>/dev/null
}

deploy_lock_age_seconds() {
  started_at="$(read_lock_value "started_at" "$DEPLOY_LOCK_PATH" 2>/dev/null || true)"
  started_epoch="$(timestamp_epoch "$started_at" 2>/dev/null || true)"
  now_epoch="$(date -u +%s)"

  if [ -n "$started_epoch" ] && [ "$started_epoch" -le "$now_epoch" ]; then
    printf '%s\n' "$((now_epoch - started_epoch))"
    return 0
  fi

  # Future or unreadable timestamps are treated as active enough to skip once.
  printf '%s\n' "-1"
}

deploy_lock_allows_recovery() {
  [ -e "$DEPLOY_LOCK_PATH" ] || return 0

  lock_pid="$(read_lock_value "pid" "$DEPLOY_LOCK_PATH" 2>/dev/null || true)"
  lock_command="$(read_lock_value "command" "$DEPLOY_LOCK_PATH" 2>/dev/null || true)"

  if pid_is_alive "$lock_pid"; then
    log "[watchdog] deploy lock active, skip compose recovery pid=$lock_pid command=$lock_command"
    return 1
  fi

  lock_age="$(deploy_lock_age_seconds)"
  if [ "$lock_age" -ge "$DEPLOY_LOCK_STALE_SECONDS" ]; then
    log "[watchdog] stale deploy lock detected pid=$lock_pid age_seconds=$lock_age command=$lock_command"
    rm -f "$DEPLOY_LOCK_PATH" 2>/dev/null || true
    log "[watchdog] stale deploy lock removed"
    return 0
  fi

  log "[watchdog] deploy lock active, skip compose recovery pid=$lock_pid age_seconds=$lock_age command=$lock_command"
  return 1
}

release_lock() {
  rm -f "$LOCK_DIR/pid" 2>/dev/null || true
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$LOCK_DIR/pid" 2>/dev/null || true
    trap 'release_lock' EXIT INT TERM
    return 0
  fi

  log "another watchdog is already running; exit"
  return 1
}

env_value() {
  key="$1"
  file="$2"

  [ -r "$file" ] || return 1
  awk -F= -v key="$key" '
    $0 ~ "^[[:space:]]*" key "=" {
      value = substr($0, index($0, "=") + 1)
      sub(/\r$/, "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      gsub(/^"|"$/, "", value)
      gsub(/^'\''|'\''$/, "", value)
      print value
      exit
    }
  ' "$file"
}

first_env_value() {
  key="$1"
  value="$(env_value "$key" "$PROJECT_ENV" 2>/dev/null || true)"
  if [ -n "$value" ]; then
    printf '%s' "$value"
    return 0
  fi

  value="$(env_value "$key" "$WATCHDOG_ENV" 2>/dev/null || true)"
  if [ -n "$value" ]; then
    printf '%s' "$value"
    return 0
  fi

  return 1
}

telegram_token() {
  first_env_value "TELEGRAM_BOT_TOKEN" \
    || first_env_value "TELEGRAM_NOTIFY_BOT_TOKEN" \
    || first_env_value "TELEGRAM_STOCK_BOT_TOKEN"
}

telegram_chat_id() {
  first_env_value "TELEGRAM_CHAT_ID" \
    || first_env_value "TELEGRAM_HQ_GROUP_ID" \
    || first_env_value "TELEGRAM_ORDER_GROUP_ID" \
    || first_env_value "TELEGRAM_STOCK_GROUP_ID"
}

alert() {
  message="$1"
  token="$(telegram_token 2>/dev/null || true)"
  chat_id="$(telegram_chat_id 2>/dev/null || true)"

  if [ -z "$token" ] || [ -z "$chat_id" ]; then
    log "Telegram alert skipped: credentials not configured"
    return 0
  fi

  config_file="$(mktemp "/tmp/kingway_watchdog_curl.XXXXXX")" || {
    log "Telegram alert skipped: cannot create temp config"
    return 0
  }
  chmod 600 "$config_file" 2>/dev/null || true
  {
    printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$token"
    printf 'silent\n'
    printf 'show-error\n'
    printf 'max-time = 10\n'
    printf 'data-urlencode = "chat_id=%s"\n' "$chat_id"
    printf 'data-urlencode = "text=%s"\n' "$message"
  } > "$config_file"

  if ! curl --config "$config_file" >/dev/null 2>>"$LOG_FILE"; then
    log "Telegram alert failed"
  fi
  rm -f "$config_file"
}

container_manager_running() {
  synopkg status ContainerManager 2>/dev/null | grep -qi "running"
}

start_container_manager() {
  log "ContainerManager is not running; attempting start"

  if command -v timeout >/dev/null 2>&1; then
    timeout 90 synopkg start ContainerManager >>"$LOG_FILE" 2>&1 || true
  else
    synopkg start ContainerManager >>"$LOG_FILE" 2>&1 &
    start_pid="$!"
    waited=0
    while kill -0 "$start_pid" 2>/dev/null && [ "$waited" -lt 90 ]; do
      sleep 2
      waited=$((waited + 2))
    done
    if kill -0 "$start_pid" 2>/dev/null; then
      log "ContainerManager start command timed out"
      kill "$start_pid" 2>/dev/null || true
    fi
  fi

  waited=0
  while [ "$waited" -lt 60 ]; do
    if container_manager_running; then
      log "ContainerManager is running"
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
  done

  log "ContainerManager failed to reach running state"
  alert "KINGWAY Watchdog: Container Manager not running"
  return 1
}

ensure_container_manager() {
  if container_manager_running; then
    log "ContainerManager status: running"
    return 0
  fi

  start_container_manager
}

docker_available() {
  docker ps >/dev/null 2>&1
}

ensure_docker() {
  if docker_available; then
    log "Docker daemon is available; skip ContainerManager start"
    return 0
  fi

  log "Docker daemon unavailable; checking ContainerManager"
  ensure_container_manager || true

  waited=0
  while [ "$waited" -lt 60 ]; do
    if docker_available; then
      log "Docker daemon is available after ContainerManager recovery"
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
  done

  log "Docker daemon not available"
  alert "KINGWAY Watchdog: Docker daemon not available"
  return 1
}

compose_up() {
  cd "$BASE_DIR" || {
    log "Cannot enter $BASE_DIR"
    alert "KINGWAY Watchdog: repository directory unavailable"
    return 1
  }

  if [ "${KINGWAY_WATCHDOG_DRY_RUN:-0}" = "1" ]; then
    log "[watchdog] dry-run: would run docker compose up -d --no-deps backend frontend"
    return 0
  fi

  log "Running docker compose up -d --no-deps backend frontend"
  if docker compose up -d --no-deps backend frontend >>"$LOG_FILE" 2>&1; then
    log "docker compose up -d --no-deps backend frontend completed"
  else
    log "docker compose up -d --no-deps backend frontend failed"
    alert "KINGWAY Watchdog: docker compose up failed"
    return 1
  fi

  docker compose ps >>"$LOG_FILE" 2>&1 || true
}

check_url() {
  name="$1"
  url="$2"
  message="$3"

  if curl -fsS -L --max-time 15 -o /dev/null "$url" >>"$LOG_FILE" 2>&1; then
    log "$name health ok"
    return 0
  fi

  log "$name health failed"
  alert "$message"
  return 1
}

usage_percent() {
  mode="$1"
  path="$2"

  if [ "$mode" = "inode" ]; then
    df -Pi "$path" 2>/dev/null | awk 'NR==2 { gsub(/%/, "", $5); print $5 }'
  else
    df -P "$path" 2>/dev/null | awk 'NR==2 { gsub(/%/, "", $5); print $5 }'
  fi
}

check_usage() {
  mode="$1"
  path="$2"
  label="$3"
  usage="$(usage_percent "$mode" "$path")"

  case "$usage" in
    ''|*[!0-9]*)
      log "Cannot read $label usage for $path"
      return 0
      ;;
  esac

  log "$label usage for $path: ${usage}%"
  if [ "$usage" -ge "$THRESHOLD_PERCENT" ]; then
    alert "KINGWAY Watchdog: disk usage warning ($label $path ${usage}%)"
  fi
}

check_disk() {
  log "Disk usage snapshot:"
  df -h / >>"$LOG_FILE" 2>&1 || true
  df -h /volume1 >>"$LOG_FILE" 2>&1 || true
  df -ih / >>"$LOG_FILE" 2>&1 || true
  df -ih /volume1 >>"$LOG_FILE" 2>&1 || true

  check_usage "disk" "/" "disk"
  check_usage "disk" "/volume1" "disk"
  check_usage "inode" "/" "inode"
  check_usage "inode" "/volume1" "inode"
}

main() {
  acquire_lock || exit 0

  log "===== KINGWAY watchdog start ====="

  recovery_allowed=1
  if ! deploy_lock_allows_recovery; then
    recovery_allowed=0
    log "[watchdog] docker recovery skipped because deploy lock is active"
  fi

  if [ "$recovery_allowed" -eq 1 ]; then
    if [ "${KINGWAY_WATCHDOG_DRY_RUN:-0}" = "1" ]; then
      log "[watchdog] dry-run: skip docker availability recovery"
      compose_up || true
    elif ensure_docker; then
      compose_up || true
    fi
  fi

  check_url "backend" "http://127.0.0.1:3000/health" "KINGWAY Watchdog: backend health failed" || true
  check_url "frontend local" "http://127.0.0.1:5173/pos" "KINGWAY Watchdog: frontend 5173 failed" || true
  check_url "frontend public" "https://pos.kingway.tw/pos" "KINGWAY Watchdog: public pos.kingway.tw failed" || true

  check_disk
  log "===== KINGWAY watchdog end ====="
}

main "$@"
