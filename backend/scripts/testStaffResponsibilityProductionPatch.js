const fs = require("fs");
const path = require("path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", "..", relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const dashboardService = read("backend/src/services/staffIncentiveDashboardService.js");
assert(
  !dashboardService.includes('new Date(`${range.month}-15T12:00:00+08:00`)'),
  "dashboard must not resolve the active plan from the middle of the selected month"
);
assert(
  (dashboardService.match(/getActiveIncentivePlan\(/g) || []).length >= 2,
  "dashboard must still load active incentive plans"
);

const orderRoutes = read("backend/src/routes/orders.js");
const handoverRoute = orderRoutes.match(
  /router\.post\("\/:id\/confirm-handover"[\s\S]{0,300}?authorize\(\[([^\]]+)\]\)/
);
assert(handoverRoute, "confirm-handover route was not found");
for (const role of ["ADMIN", "MANAGER", "CASHIER", "REPAIR"]) {
  assert(handoverRoute[1].includes(`"${role}"`), `confirm-handover must allow ${role}`);
}

const incentiveRoutes = read("backend/src/routes/staffIncentives.js");
for (const marker of [
  'router.post("/agreements/sign"',
  'router.get("/agreements/me/pdf"',
  '"/admin/agreements/:agreementId/pdf"'
]) {
  assert(incentiveRoutes.includes(marker), `missing agreement route: ${marker}`);
}

const agreementService = read("backend/src/services/staffIncentiveAgreementService.js");
for (const key of [
  "completionStandards",
  "caseOwnership",
  "truthfulRecords",
  "ordinaryWorkDuty",
  "pendingUntilComplete",
  "exceptionReporting",
  "policyAccepted"
]) {
  assert(agreementService.includes(`"${key}"`), `missing required agreement check: ${key}`);
}
assert(agreementService.includes("NotoSansCJKtc-Regular.ttf"), "agreement PDF font must be configured");

const responsibilityMigration = read(
  "database/migrations/20260723_create_case_completion_responsibility_plan.sql"
);
assert(
  responsibilityMigration.includes("KINGWAY-2026-07-R2-RESPONSIBILITY"),
  "responsibility plan migration version is missing"
);
assert(
  responsibilityMigration.includes("FROM_BASE64"),
  "responsibility agreement text payload is missing"
);

const activationMigration = read(
  "database/migrations/20260724_activate_case_completion_responsibility_plan.sql"
);
assert(
  activationMigration.includes("DATE_SUB(NOW(), INTERVAL 1 DAY)"),
  "activation migration must avoid timezone boundary gaps"
);
assert(
  activationMigration.includes("status = 'ACTIVE'"),
  "activation migration must activate the responsibility plan"
);

const frontendPage = read("frontend/src/pages/StaffIncentivesPage.jsx");
assert(frontendPage.includes("同意並完成簽署"), "frontend signing action is missing");
assert(frontendPage.includes("案件完成責任版本"), "frontend responsibility plan label is missing");

console.log("staff responsibility production patch tests passed");
