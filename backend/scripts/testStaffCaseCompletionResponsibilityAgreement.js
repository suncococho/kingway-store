const assert = require("assert");
const fs = require("fs");
const path = require("path");
function read(relative) { return fs.readFileSync(path.resolve(__dirname, "..", "..", relative), "utf8"); }
const migration = read("database/migrations/20260723_create_case_completion_responsibility_plan.sql");
const service = read("backend/src/services/staffIncentiveAgreementService.js");
const page = read("frontend/src/pages/StaffIncentivesPage.jsx");
assert(migration.includes("KINGWAY-2026-07-R2-RESPONSIBILITY"), "new responsibility plan version missing");
assert(migration.includes("old_plan.status = 'ACTIVE'") && migration.includes("old_plan.id <> new_plan.id"), "previous active plan preservation transition missing");
assert(!migration.includes("UPDATE staff_incentive_agreements"), "signed agreements must not be mutated");
assert(service.includes("案件完成責任同意書"), "PDF responsibility title missing");
assert(service.includes('"pendingUntilComplete"') && service.includes('"exceptionReporting"'), "responsibility checks missing");
assert(page.includes("不得虛報、代簽、倒填或提前標示完成"), "employee responsibility confirmation missing");
console.log("staff case completion responsibility agreement tests passed");
