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

for file in \
  frontend/src/pages/StaffSchedulingPage.jsx \
  frontend/src/lib/staffSchedulingApi.js \
  backend/src/routes/staffScheduling.js \
  backend/src/services/staffSchedulingService.js \
  backend/src/services/staffWorkdayRequestService.js \
  backend/test/staffScheduling.test.js \
  backend/test/staffWorkdayRequests.test.js \
  database/migrations/20260802_01_create_staff_scheduling_foundation.sql \
  database/migrations/20260802_02_create_staff_schedule_drafts.sql \
  database/migrations/20260804_create_staff_workday_request_core.sql
do
  require_file "$file"
done

require_once frontend/src/App.jsx \
  'import StaffSchedulingPage from "./pages/StaffSchedulingPage";' \
  "frontend import"
require_once frontend/src/App.jsx \
  '<Route path="/staff-scheduling" element={<StaffSchedulingPage />} />' \
  "frontend route"
require_once frontend/src/lib/mobileNavigation.js \
  '{ to: "/staff-scheduling", label: "員工排班", description: "可排班時間、休假申請與排班草稿", menuKey: "staff_scheduling" }' \
  "permission-bound menu"
require_once frontend/src/lib/menuPermissions.js \
  '{ path: "/staff-scheduling", key: "staff_scheduling" }' \
  "path permission mapping"
require_once backend/src/app.js \
  'const staffSchedulingRoutes = require("./routes/staffScheduling");' \
  "backend import"
require_once backend/src/app.js \
  'app.use("/api/staff-scheduling", staffSchedulingRoutes);' \
  "backend mount"

grep -Fq 'const manage = requireStoreRole(["owner", "admin", "manager"]);' \
  backend/src/routes/staffScheduling.js \
  || fail "admin/manager scheduling mutation guard missing"
grep -Fq 'requireStoreFeature("staff_management_enabled")' \
  backend/src/routes/staffScheduling.js \
  || fail "staff management feature guard missing"
grep -Fq 'requireStoreFeature("staff_workday_selection_enabled")' \
  backend/src/routes/staffScheduling.js \
  || fail "workday selection feature guard missing"

for role in MANAGER CASHIER REPAIR INVENTORY; do
  grep -E "${role}:.*staff_scheduling" frontend/src/lib/menuPermissions.js >/dev/null \
    || fail "$role fallback no longer exposes staff scheduling"
done

grep -Fq 'workdayCalendar:' frontend/src/lib/staffSchedulingApi.js \
  || fail "employee workday API client missing"
grep -Fq 'adminWorkdayCalendar:' frontend/src/lib/staffSchedulingApi.js \
  || fail "admin workday API client missing"

echo "OK: staff work schedule integration checks passed"
