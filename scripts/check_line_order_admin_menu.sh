#!/bin/sh
set -eu

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

require_file() {
  [ -s "$1" ] || fail "missing or empty file: $1"
}

require_once() {
  file="$1"
  pattern="$2"
  label="$3"
  count="$(grep -cF "$pattern" "$file" || true)"
  [ "$count" -eq 1 ] || fail "$label expected exactly once in $file, found $count"
}

require_file frontend/src/pages/LineOrderPage.jsx
require_file backend/src/routes/lineOrder.js

require_once frontend/src/App.jsx \
  'import LineOrderPage from "./pages/LineOrderPage";' \
  "frontend import"
require_once frontend/src/App.jsx \
  '<Route path="/line-order" element={<LineOrderPage />} />' \
  "public frontend route"
require_once frontend/src/lib/mobileNavigation.js \
  '{ to: "/line-order", label: "LINE 訂單管理", description: "LINE 訂單商品與客戶查詢", menuKey: "line" }' \
  "permission-bound management menu"
require_once frontend/src/lib/menuPermissions.js \
  '{ path: "/line-order", key: "line" }' \
  "path permission mapping"
require_once backend/src/app.js \
  'app.use("/api/line-order", lineOrderRoutes);' \
  "backend mount"

grep -Fq 'getMobileMenuSectionsForUser' frontend/src/components/Sidebar.jsx \
  || fail "desktop Sidebar no longer uses shared navigation"
grep -Fq 'getMobileMenuSectionsForUser' frontend/src/pages/MorePage.jsx \
  || fail "mobile MorePage no longer uses shared navigation"

grep -E 'MANAGER:.*"line"' frontend/src/lib/menuPermissions.js >/dev/null \
  || fail "MANAGER fallback no longer exposes LINE management"

for role in CASHIER REPAIR INVENTORY; do
  role_line="$(grep -E "^[[:space:]]*${role}:" frontend/src/lib/menuPermissions.js || true)"
  echo "$role_line" | grep -q '"line"' \
    && fail "$role fallback unexpectedly exposes LINE management"
done

grep -Fq 'router.get("/customer"' backend/src/routes/lineOrder.js \
  || fail "customer GET API missing"
grep -Fq 'router.get("/ebikes"' backend/src/routes/lineOrder.js \
  || fail "ebikes GET API missing"
grep -Fq 'router.post("/create"' backend/src/routes/lineOrder.js \
  || fail "create POST API missing"

echo "OK: LINE order management navigation checks passed"
