#!/bin/bash

set -euo pipefail

APPLY=0
if [ "${1:-}" = "--apply" ]; then
  APPLY=1
elif [ "${1:-}" != "" ]; then
  echo "Usage: $0 [--apply]" >&2
  exit 2
fi

PROJECT_DIR="/volume1/docker/kingway-store"
PROJECT_NAME="$(basename "$PROJECT_DIR")"
SERVICES_REGEX='^(backend|frontend)$'
STATUS_REGEX='^(created|exited|dead)$'
DOCKER_BIN="${DOCKER_BIN:-docker}"

echo "Scanning stale compose containers for project=$PROJECT_NAME services=backend,frontend"
echo "Default mode is dry-run. Pass --apply to remove matching non-running containers."

if ! docker_rows="$($DOCKER_BIN ps -a --format '{{.ID}}|{{.Names}}|{{.Status}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}|{{.State}}')"; then
  echo "Failed to read Docker containers. Run with Docker privileges, for example: sudo -n $0" >&2
  exit 1
fi

mapfile -t rows < <(
  printf '%s\n' "$docker_rows" \
    | awk -F'|' -v project="$PROJECT_NAME" -v services="$SERVICES_REGEX" -v statuses="$STATUS_REGEX" '
      $4 == project && $5 ~ services && tolower($6) ~ statuses {
        print $0
      }
    '
)

if [ "${#rows[@]}" -eq 0 ]; then
  echo "No stale backend/frontend compose containers found."
  exit 0
fi

printf '%s\n' "${rows[@]}" | while IFS='|' read -r id name status project service state; do
  printf 'candidate id=%s name=%s service=%s state=%s status=%s\n' "$id" "$name" "$service" "$state" "$status"
done

if [ "$APPLY" -ne 1 ]; then
  echo "Dry-run only; no containers removed."
  exit 0
fi

for row in "${rows[@]}"; do
  IFS='|' read -r id name status project service state <<< "$row"
  if [ "$state" = "running" ]; then
    echo "skip running container id=$id name=$name"
    continue
  fi
  $DOCKER_BIN rm "$id"
done
