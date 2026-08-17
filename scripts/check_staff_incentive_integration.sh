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

require_file frontend/src/pages/StaffIncentivesPage.jsx
require_file backend/src/routes/staffIncentives.js
require_file backend/src/services/staffIncentiveAgreementService.js
require_file backend/src/services/staffIncentiveCalculator.js
require_file backend/src/services/staffIncentiveDashboardService.js
require_file backend/src/services/staffIncentiveEarningService.js
require_file backend/src/services/staffIncentiveService.js

require_once \
  frontend/src/App.jsx \
  'import StaffIncentivesPage from "./pages/StaffIncentivesPage";' \
  "frontend import"

require_once \
  frontend/src/App.jsx \
  '<Route path="/staff-incentives" element={<StaffIncentivesPage />} />' \
  "frontend route"

require_once \
  frontend/src/lib/mobileNavigation.js \
  '{ to: "/staff-incentives", label: "我的銷售服務績效", description: "查看銷售、配件、維修檢查與支付狀態", menuKey: "staff_incentives" }' \
  "permission-bound mobile menu"

require_once \
  frontend/src/lib/menuPermissions.js \
  '{ path: "/staff-incentives", key: "staff_incentives" }' \
  "frontend path permission mapping"

require_once \
  backend/src/services/menuPermissionService.js \
  '{ key: "staff_incentives", label: "員工績效獎金" }' \
  "backend menu permission catalog"

for role in MANAGER CASHIER REPAIR INVENTORY; do
  grep -E "${role}:.*staff_incentives" frontend/src/lib/menuPermissions.js >/dev/null \
    || fail "$role fallback no longer exposes staff incentives"
done

require_once \
  backend/src/app.js \
  'const staffIncentiveRoutes = require("./routes/staffIncentives");' \
  "backend import"

require_once \
  backend/src/app.js \
  'app.use("/api/staff-incentives", staffIncentiveRoutes);' \
  "backend route"

require_once \
  frontend/src/lib/api.js \
  'export async function apiOpenFile(path)' \
  "authenticated file opener"

grep -qF 'stage: "ALL_STAGES"' \
  backend/src/services/staffIncentiveEarningService.js \
  || fail "ALL_STAGES vehicle earning logic missing"

grep -qF 'plan.bikeTotalAmount' \
  backend/src/services/staffIncentiveCalculator.js \
  || fail "bike total amount calculation missing"

grep -qF 'rate: plan.accessoryRate' \
  backend/src/services/staffIncentiveEarningService.js \
  || fail "accessory incentive rate connection missing"

grep -qF 'repairInspectionAmount' \
  backend/src/services/staffIncentiveCalculator.js \
  || fail "repair inspection incentive calculation missing"

echo "OK: staff incentive integration checks passed"
