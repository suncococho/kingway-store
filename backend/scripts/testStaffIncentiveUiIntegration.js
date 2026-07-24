const assert = require("assert");
const fs = require("fs");
const path = require("path");

function read(relative) {
  return fs.readFileSync(path.resolve(__dirname, "..", "..", relative), "utf8");
}

const ordersPage = read("frontend/src/pages/OrdersPage.jsx");
const app = read("frontend/src/App.jsx");
const navigation = read("frontend/src/lib/mobileNavigation.js");
const permissions = read("frontend/src/lib/permissions.js");
const page = read("frontend/src/pages/StaffIncentivesPage.jsx");
const repairs = read("backend/src/routes/repairs.js");
const migration = read("database/migrations/20260724_activate_staff_incentive_sale600.sql");
const rollbackMigration = read("database/migrations/20260724_activate_staff_incentive_sale600_rollback.sql");
const stagingCompose = read("docker-compose.staging-restore.yml");

assert(
  ordersPage.includes('body: JSON.stringify({\n              status: salesFollowupForm.status'),
  "sales follow-up body must be JSON encoded"
);
assert(app.includes('import StaffIncentivesPage from "./pages/StaffIncentivesPage"'), "page import missing");
assert(app.includes('<Route path="/staff-incentives" element={<StaffIncentivesPage />} />'), "page route missing");
assert(navigation.includes('to: "/staff-incentives"'), "menu item missing");
assert(permissions.includes('"/staff-incentives"'), "limited staff route permission missing");
assert(page.includes('title="我的銷售服務績效"'), "page title missing");
assert(page.includes('body: JSON.stringify({ reason: disputeForm.reason.trim() })'), "dispute body must be JSON encoded");
assert(page.includes('import SignaturePad from "../components/SignaturePad"'), "agreement signature pad missing");
assert(page.includes('apiRequest("/staff-incentives/agreements/sign"'), "agreement signing request missing");
assert(page.includes("planVersionId: selfData.plan.id"), "agreement signing must submit displayed plan id");
assert(page.includes("同意並完成簽署"), "agreement submit button missing");
assert(page.includes("案件完成責任") && page.includes("pendingUntilComplete"), "responsibility agreement UI missing");
assert(page.includes("openOwnAgreementPdf"), "employee agreement PDF action missing");
assert(page.includes("openAdminAgreementPdf"), "admin agreement PDF action missing");
assert(page.includes('const canViewStore = ["ADMIN", "MANAGER"].includes(role)'), "ADMIN and MANAGER store read UI missing");
assert(page.includes('disabled={!isAdmin || !adminDispute.id}'), "manager write controls must be disabled");
assert(repairs.includes('triggerSource: "REPAIR_INSPECTION_UPDATED"'), "repair inspection trigger missing");
assert(repairs.includes('triggerSource: "REPAIR_STAFF_ASSIGNED"'), "repair staff trigger missing");
assert(migration.includes("'KINGWAY-2026-07-SALE600-V2'"), "default active plan migration missing");
assert(migration.includes("600.00") && migration.includes("0.00") && migration.includes("0.00"), "bike plan amounts missing");
assert(migration.includes("0.100000") && migration.includes("100.00"), "accessory/repair plan values missing");
assert(
  migration.includes("INSERT IGNORE INTO kingway_schema_migrations (migration_key)") &&
    migration.includes("20260724_activate_staff_incentive_sale600"),
  "sale600 migration marker missing"
);
assert(
  rollbackMigration.includes("DELETE FROM kingway_schema_migrations") &&
    rollbackMigration.includes("AND NOT EXISTS (\n    SELECT 1\n    FROM staff_incentive_plan_versions"),
  "sale600 rollback must remove its marker only after all V2 plans are removed"
);
assert(
  stagingCompose.includes("- /volume1/docker/kingway-store-staging-storage:/app/storage") &&
    stagingCompose.includes("- kingway-staging-uploads:/app/uploads") &&
    stagingCompose.includes("- ./shared:/shared:ro"),
  "staging storage/uploads/shared mounts missing"
);

console.log("staff incentive UI integration tests passed");
