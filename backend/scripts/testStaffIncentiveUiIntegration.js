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
const migration = read("database/migrations/20260722_seed_default_staff_incentive_plan.sql");

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
assert(page.includes("openOwnAgreementPdf"), "employee agreement PDF action missing");
assert(page.includes("openAdminAgreementPdf"), "admin agreement PDF action missing");
assert(page.includes('String(currentUser?.role || "").trim().toUpperCase() === "ADMIN"'), "admin UI must be exact ADMIN only");
assert(repairs.includes('triggerSource: "REPAIR_INSPECTION_UPDATED"'), "repair inspection trigger missing");
assert(repairs.includes('triggerSource: "REPAIR_STAFF_ASSIGNED"'), "repair staff trigger missing");
assert(migration.includes("'KINGWAY-2026-07-V1'"), "default active plan migration missing");
assert(migration.includes("420.00") && migration.includes("120.00") && migration.includes("60.00"), "bike plan amounts missing");
assert(migration.includes("0.100000") && migration.includes("100.00"), "accessory/repair plan values missing");

console.log("staff incentive UI integration tests passed");
