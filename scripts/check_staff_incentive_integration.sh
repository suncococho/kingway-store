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
  'to: "/staff-incentives"' \
  "mobile menu"

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
