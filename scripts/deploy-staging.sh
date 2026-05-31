#!/bin/sh
set -e

REPO_DIR="/volume1/docker/kingway-store"
BRANCH="beta/staging-architecture"
COMPOSE_FILE="docker-compose.staging-restore.yml"

cd "$REPO_DIR"

echo "== KINGWAY staging deploy =="
echo "Repository: $REPO_DIR"
echo

echo "== Current branch =="
git branch --show-current
echo

echo "== Git status =="
git status --short
if [ -n "$(git status --short)" ]; then
  echo
  echo "Working tree is dirty. Commit, stash, or discard local changes before staging deploy."
  exit 1
fi
echo

echo "== Pull latest =="
git pull origin "$BRANCH"
echo

echo "== Backend syntax checks =="
node --check backend/src/app.js
node --check backend/src/routes/saasAdmin.js
node --check backend/src/routes/systemStatus.js
echo

echo "== Frontend build =="
npm --prefix frontend run build
echo

echo "== Docker build =="
sudo docker compose -f "$COMPOSE_FILE" build backend frontend
echo

echo "== Docker start =="
sudo docker compose -f "$COMPOSE_FILE" up -d backend frontend
echo

echo "== Waiting for services =="
sleep 8
echo

echo "== Container status =="
sudo docker compose -f "$COMPOSE_FILE" ps
echo

echo "== Health checks =="
curl -f http://127.0.0.1:3010/health
echo
curl -f http://127.0.0.1:3010/api/saas-admin/stores
echo
curl -f http://127.0.0.1:3010/api/system/saas-status
echo

echo "== Staging URLs =="
echo "Frontend: http://59.127.191.213:5180"
echo "SaaS Admin: http://59.127.191.213:5180/saas-admin"
echo "SaaS Stores API: http://59.127.191.213:3010/api/saas-admin/stores"
echo
echo "Staging deploy completed."
