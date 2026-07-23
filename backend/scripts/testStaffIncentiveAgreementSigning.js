const assert = require("assert");
const fs = require("fs");
const path = require("path");

function read(relative) {
  return fs.readFileSync(path.resolve(__dirname, "..", "..", relative), "utf8");
}

const service = read("backend/src/services/staffIncentiveAgreementService.js");
const route = read("backend/src/routes/staffIncentives.js");
const page = read("frontend/src/pages/StaffIncentivesPage.jsx");
const api = read("frontend/src/lib/api.js");

assert(service.includes('"policyRead"') && service.includes('"ordinaryWorkDuty"'), "required agreement checks missing");
assert(service.includes("image\\/(?:png|jpeg)"), "signature MIME validation missing");
assert(service.includes("2 * 1024 * 1024"), "signature size limit missing");
assert(service.includes("Number(plan.id) !== normalizedPlanVersionId"), "active plan version binding missing");
assert(service.includes("crypto.createHash(\"sha256\")"), "PDF document hash missing");
assert(service.includes("PASSWORD_SESSION"), "authentication method missing");
assert(service.includes("signer_ip") && service.includes("signer_user_agent"), "signer audit fields missing");
assert(service.includes("staff-incentive-agreements") && service.includes("resolveAgreementStoragePath"), "private NAS storage guard missing");
assert(service.includes("a.staff_user_id = ?") && service.includes("a.store_id = ?"), "self PDF store/staff scoping missing");
assert(route.includes('router.post("/agreements/sign"'), "sign route missing");
assert(route.includes('router.get("/agreements/me/pdf"'), "self PDF route missing");
assert(route.includes('"/admin/agreements/:agreementId/pdf"') && route.includes('authorize(["ADMIN"])'), "admin PDF authorization missing");
assert(page.includes("<SignaturePad") && page.includes("AGREEMENT_CHECKS.map"), "agreement form UI missing");
assert(page.includes("planVersionId: selfData.plan.id"), "UI plan version binding missing");
assert(api.includes("export async function apiOpenFile"), "authenticated PDF open helper missing");

console.log("staff incentive agreement signing tests passed");
