#!/bin/bash

set -euo pipefail

LOCK_PATH="${KINGWAY_DEPLOY_LOCK_PATH:-/tmp/kingway_deploy.lock}"
STALE_SECONDS="${KINGWAY_DEPLOY_LOCK_STALE_SECONDS:-1800}"
DESCRIPTION="${1:-}"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/with_deploy_lock.sh "description" -- command [args...]

Examples:
  ./scripts/with_deploy_lock.sh "backend deploy" -- sudo docker compose up -d --no-deps --force-recreate backend
  ./scripts/with_deploy_lock.sh "frontend deploy" -- sudo docker compose up -d --no-deps frontend

The lock path defaults to /tmp/kingway_deploy.lock and can be overridden with KINGWAY_DEPLOY_LOCK_PATH.
USAGE
}

if [ -z "$DESCRIPTION" ] || [ "${2:-}" != "--" ]; then
  usage >&2
  exit 2
fi

shift 2
if [ "$#" -eq 0 ]; then
  usage >&2
  exit 2
fi

read_lock_value() {
  local key="$1"
  local file="$2"

  [ -r "$file" ] || return 1
  awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$file"
}

pid_is_alive() {
  local pid="$1"

  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

timestamp_epoch() {
  local value="$1"

  [ -n "$value" ] || return 1
  date -d "$value" +%s 2>/dev/null
}

lock_age_seconds() {
  local started_at started_epoch now_epoch
  started_at="$(read_lock_value "started_at" "$LOCK_PATH" 2>/dev/null || true)"
  started_epoch="$(timestamp_epoch "$started_at" 2>/dev/null || true)"
  now_epoch="$(date -u +%s)"

  if [ -n "$started_epoch" ] && [ "$started_epoch" -le "$now_epoch" ]; then
    printf '%s\n' "$((now_epoch - started_epoch))"
    return 0
  fi

  printf '%s\n' "-1"
}

command_string() {
  local output=""
  local arg

  for arg in "$@"; do
    printf -v output '%s%q ' "$output" "$arg"
  done
  printf '%s' "${output% }"
}

remove_stale_lock_if_allowed() {
  [ -e "$LOCK_PATH" ] || return 0

  local lock_pid lock_command age
  lock_pid="$(read_lock_value "pid" "$LOCK_PATH" 2>/dev/null || true)"
  lock_command="$(read_lock_value "command" "$LOCK_PATH" 2>/dev/null || true)"

  if pid_is_alive "$lock_pid"; then
    printf 'deploy lock active: %s pid=%s command=%s\n' "$LOCK_PATH" "$lock_pid" "$lock_command" >&2
    return 1
  fi

  age="$(lock_age_seconds)"
  if [ "$age" -ge "$STALE_SECONDS" ]; then
    printf 'stale deploy lock detected and removed: %s pid=%s age_seconds=%s command=%s\n' "$LOCK_PATH" "$lock_pid" "$age" "$lock_command" >&2
    rm -f "$LOCK_PATH"
    return 0
  fi

  printf 'deploy lock exists and is not stale: %s pid=%s age_seconds=%s command=%s\n' "$LOCK_PATH" "$lock_pid" "$age" "$lock_command" >&2
  return 1
}

write_lock() {
  local command_text
  command_text="$(command_string "$@")"

  umask 077
  {
    set -o noclobber
    {
      printf 'pid=%s\n' "$$"
      printf 'started_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
      printf 'command=%s\n' "$DESCRIPTION: $command_text"
      printf 'user=%s\n' "$(id -un 2>/dev/null || printf unknown)"
      printf 'cwd=%s\n' "$(pwd)"
    } > "$LOCK_PATH"
  } 2>/dev/null
}

lock_owner_is_self() {
  local lock_pid
  lock_pid="$(read_lock_value "pid" "$LOCK_PATH" 2>/dev/null || true)"
  [ "$lock_pid" = "$$" ]
}

cleanup_lock() {
  if [ -e "$LOCK_PATH" ] && lock_owner_is_self; then
    rm -f "$LOCK_PATH"
  fi
}

remove_stale_lock_if_allowed
if ! write_lock "$@"; then
  remove_stale_lock_if_allowed
  write_lock "$@" || {
    printf 'failed to create deploy lock: %s\n' "$LOCK_PATH" >&2
    exit 1
  }
fi

trap cleanup_lock EXIT INT TERM

printf 'deploy lock acquired: %s\n' "$LOCK_PATH"
"$@"
