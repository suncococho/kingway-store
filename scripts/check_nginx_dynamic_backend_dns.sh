#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
NGINX_CONFIG="$REPO_DIR/frontend/nginx.conf"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

require_literal() {
  grep -F "$1" "$NGINX_CONFIG" >/dev/null || fail "nginx.conf is missing: $1"
}

require_literal 'resolver 127.0.0.11 valid=10s ipv6=off;'
require_literal 'set $backend_origin http://backend:3000;'
[ "$(grep -F -c 'proxy_pass $backend_origin$request_uri;' "$NGINX_CONFIG")" -eq 2 ] ||   fail 'both backend proxy locations must preserve the original request URI'
if grep -E '^[[:space:]]*(upstream[[:space:]]+backend|proxy_pass[[:space:]]+http://backend)' "$NGINX_CONFIG" >/dev/null; then
  fail 'static backend DNS resolution remains in nginx.conf'
fi
require_literal 'location /api/'
require_literal 'location /files/'
require_literal 'proxy_set_header Upgrade $http_upgrade;'
require_literal 'proxy_set_header Connection $http_connection;'
require_literal 'client_max_body_size 50M;'
require_literal 'try_files $uri $uri/ /index.html;'
require_literal 'add_header Cache-Control "public, max-age=31536000, immutable" always;'

echo 'PASS: nginx dynamic backend DNS static contract'

[ "${1:-}" = '--image' ] || exit 0
[ "$#" -eq 2 ] || fail 'usage: check_nginx_dynamic_backend_dns.sh --image IMAGE_TAG'

IMAGE_TAG=$2
DOCKER_BIN=${DOCKER_BIN:-docker}
case "$IMAGE_TAG" in
  kingway-staging-frontend:*) ;;
  *) fail 'runtime canary accepts only a kingway-staging-frontend tag' ;;
esac

$DOCKER_BIN image inspect "$IMAGE_TAG" >/dev/null 2>&1 || fail "frontend image is not local: $IMAGE_TAG"
$DOCKER_BIN image inspect nginx:1.27-alpine >/dev/null 2>&1 || fail 'local nginx:1.27-alpine image is required'

CANARY_SUFFIX="$$-$(date +%s)"
CANARY_NETWORK="kingway-nginx-dns-canary-$CANARY_SUFFIX"
CANARY_FRONTEND="kingway-nginx-frontend-canary-$CANARY_SUFFIX"
CANARY_BACKEND="kingway-nginx-backend-canary-$CANARY_SUFFIX"
CANARY_CONFIG=$(mktemp /tmp/kingway-nginx-backend-canary.XXXXXX.conf)

cleanup() {
  $DOCKER_BIN rm -f "$CANARY_BACKEND" >/dev/null 2>&1 || true
  $DOCKER_BIN rm -f "$CANARY_FRONTEND" >/dev/null 2>&1 || true
  $DOCKER_BIN network rm "$CANARY_NETWORK" >/dev/null 2>&1 || true
  rm -f "$CANARY_CONFIG"
}
trap cleanup EXIT INT TERM

cat >"$CANARY_CONFIG" <<'CANARY_EOF'
events {}
http {
  server {
    listen 3000;
    location / {
      default_type text/plain;
      return 200 "canary:$request_method:$request_uri:$http_upgrade\n";
    }
  }
}
CANARY_EOF

$DOCKER_BIN network create "$CANARY_NETWORK" >/dev/null
$DOCKER_BIN run -d --pull=never --name "$CANARY_FRONTEND"   --network "$CANARY_NETWORK" --restart=no -p 127.0.0.1::80 "$IMAGE_TAG" >/dev/null

CANARY_PORT=$($DOCKER_BIN port "$CANARY_FRONTEND" 80/tcp | sed -n '1s/.*://p')
[ -n "$CANARY_PORT" ] || fail 'could not determine frontend canary port'

elapsed=0
while [ "$elapsed" -lt 30 ]; do
  [ "$($DOCKER_BIN inspect -f '{{.State.Running}}' "$CANARY_FRONTEND")" = true ] ||     fail 'frontend exited while backend DNS was unavailable'
  sleep 5
  elapsed=$((elapsed + 5))
done

for route in / /line-order /staff-incentives /staff-scheduling; do
  status=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$CANARY_PORT$route")
  [ "$status" = 200 ] || fail "$route returned HTTP $status without backend"
done

status=$(curl -sS -o /dev/null -w '%{http_code}'   "http://127.0.0.1:$CANARY_PORT/api/health?probe=before")
[ "$status" = 502 ] || fail "backend-free API returned HTTP $status instead of 502"
[ "$($DOCKER_BIN inspect -f '{{.State.Running}}' "$CANARY_FRONTEND")" = true ] ||   fail 'frontend exited after backend-free API request'
[ "$($DOCKER_BIN inspect -f '{{.RestartCount}}' "$CANARY_FRONTEND")" = 0 ] ||   fail 'frontend restart count increased during backend-free test'

$DOCKER_BIN run -d --pull=never --name "$CANARY_BACKEND"   --network "$CANARY_NETWORK" --network-alias backend --restart=no   -v "$CANARY_CONFIG:/etc/nginx/nginx.conf:ro" nginx:1.27-alpine >/dev/null

recovered=false
attempt=0
while [ "$attempt" -lt 15 ]; do
  body=$(curl -sS -H 'Upgrade: websocket' -H 'Connection: Upgrade'     "http://127.0.0.1:$CANARY_PORT/api/health?probe=uri" || true)
  if [ "$body" = 'canary:GET:/api/health?probe=uri:websocket' ]; then
    recovered=true
    break
  fi
  sleep 2
  attempt=$((attempt + 1))
done
[ "$recovered" = true ] || fail 'proxy did not recover after backend appeared'
[ "$($DOCKER_BIN inspect -f '{{.RestartCount}}' "$CANARY_FRONTEND")" = 0 ] ||   fail 'frontend restarted during dynamic recovery test'

$DOCKER_BIN rm -f "$CANARY_BACKEND" >/dev/null
attempt=0
while [ "$attempt" -lt 15 ]; do
  status=$(curl -sS -o /dev/null -w '%{http_code}'     "http://127.0.0.1:$CANARY_PORT/api/health?probe=after" || true)
  [ "$status" = 502 ] && break
  sleep 2
  attempt=$((attempt + 1))
done
[ "$status" = 502 ] || fail "API returned HTTP $status after canary backend removal"
[ "$($DOCKER_BIN inspect -f '{{.State.Running}}' "$CANARY_FRONTEND")" = true ] ||   fail 'frontend exited after canary backend removal'
[ "$($DOCKER_BIN inspect -f '{{.RestartCount}}' "$CANARY_FRONTEND")" = 0 ] ||   fail 'frontend restart count increased after canary backend removal'
if $DOCKER_BIN logs "$CANARY_FRONTEND" 2>&1 | grep -F '[emerg]' >/dev/null; then
  fail 'nginx logged an emerg-level startup failure'
fi

echo 'PASS: isolated backend-free and dynamic DNS recovery canary'
