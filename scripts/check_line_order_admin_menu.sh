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

for file in   frontend/src/App.jsx   frontend/src/lib/mobileNavigation.js   frontend/src/lib/menuPermissions.js   frontend/src/pages/LineOrderPage.jsx   frontend/src/pages/LineOrderOptionsPage.jsx   frontend/src/pages/OrdersPage.jsx   backend/src/app.js   backend/src/routes/lineOrder.js   backend/src/routes/lineOrderOptions.js   backend/src/services/lineOrderOptionService.js; do
  require_file "$file"
done

require_once frontend/src/App.jsx   'import LineOrderPage from "./pages/LineOrderPage";'   "public frontend import"
require_once frontend/src/App.jsx   'import LineOrderOptionsPage from "./pages/LineOrderOptionsPage";'   "management frontend import"
require_once frontend/src/App.jsx   '<Route path="/line-order" element={<LineOrderPage />} />'   "public frontend route"
require_once frontend/src/App.jsx   '<Route path="/admin/line-order-options" element={<LineOrderOptionsPage />} />'   "protected management route"
require_once frontend/src/lib/mobileNavigation.js   '{ to: "/admin/line-order-options", label: "LINE訂單選配管理", description: "設定客戶 LINE 訂車流程的配件群組與商品", menuKey: "line_order_options" }'   "management menu"
require_once frontend/src/lib/menuPermissions.js   '{ path: "/admin/line-order-options", key: "line_order_options" }'   "management permission mapping"

grep -Fq 'to: "/line-order"' frontend/src/lib/mobileNavigation.js   && fail "public /line-order must not be registered as an administrator menu"
grep -Fq '{ path: "/line-order",' frontend/src/lib/menuPermissions.js   && fail "public /line-order must not have an administrator permission mapping"

node <<'NODE'
const fs = require("fs");
const app = fs.readFileSync("frontend/src/App.jsx", "utf8");
const publicRoute = app.indexOf('<Route path="/line-order" element={<LineOrderPage />} />');
const protectedLayout = app.indexOf("<Route element={<ProtectedLayout />}>");
const managementRoute = app.indexOf('<Route path="/admin/line-order-options" element={<LineOrderOptionsPage />} />');
if (publicRoute < 0 || protectedLayout < 0 || publicRoute > protectedLayout) {
  throw new Error("/line-order must remain outside ProtectedLayout");
}
if (managementRoute < protectedLayout) {
  throw new Error("/admin/line-order-options must remain inside ProtectedLayout");
}
NODE

grep -Fq 'router.get("/customer"' backend/src/routes/lineOrder.js   || fail "public customer GET API missing"
grep -Fq 'router.get("/ebikes"' backend/src/routes/lineOrder.js   || fail "public ebikes GET API missing"
grep -Fq 'router.get("/options"' backend/src/routes/lineOrder.js   || fail "public options GET API missing"
grep -Fq 'router.post("/create"' backend/src/routes/lineOrder.js   || fail "public create POST API missing"
grep -Fq 'optionSelections' frontend/src/pages/LineOrderPage.jsx   || fail "public option selection flow missing"

grep -Fq 'app.use("/api/line-order-options", lineOrderOptionRoutes);' backend/src/app.js   || fail "management backend mount missing"
grep -Fq 'router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER"]));' backend/src/routes/lineOrderOptions.js   || fail "management authenticate/store-scope/role middleware missing"
grep -Fq 'LINE 預約單' frontend/src/pages/OrdersPage.jsx   || fail "OrdersPage LINE reservation marker missing"
grep -Fq 'paymentModal' frontend/src/pages/OrdersPage.jsx   || fail "OrdersPage payment management marker missing"

node <<'NODE'
const fs = require("fs");
const source = fs.readFileSync("backend/src/services/lineOrderOptionService.js", "utf8");
for (const name of ["getOptionSettings", "listOptionGroups", "getLineOrderOptionConfig"]) {
  const start = source.indexOf("async function " + name);
  if (start < 0) throw new Error(name + " missing");
  const rest = source.slice(start + 1);
  const offsets = [rest.indexOf("\nasync function "), rest.indexOf("\nfunction ")].filter((value) => value >= 0);
  const end = offsets.length ? start + 1 + Math.min(...offsets) : source.length;
  if (/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(source.slice(start, end))) {
    throw new Error(name + " must remain DB-write free");
  }
}
NODE

node scripts/check_core_feature_contract.js --feature line-order-public
node scripts/check_core_feature_contract.js --feature orders-management
node scripts/check_core_feature_contract.js --feature line-order-options-management

echo "OK: LINE public booking, orders management, and option management are semantically separated"
