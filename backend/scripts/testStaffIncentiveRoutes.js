const assert = require("assert");
const fs = require("fs");
const path = require("path");

const routeSource = fs.readFileSync(
  path.resolve(__dirname, "../src/routes/staffIncentives.js"),
  "utf8"
);
const appSource = fs.readFileSync(
  path.resolve(__dirname, "../src/app.js"),
  "utf8"
);

function includes(text, label) {
  assert(routeSource.includes(text), `Missing ${label}: ${text}`);
}

includes("authenticate", "authentication middleware");
includes("requireStoreScope()", "store scope middleware");
includes('router.get("/me"', "self dashboard route");
includes('router.get("/plan"', "plan route");
includes('router.post("/agreements/sign"', "agreement signing route");
includes('router.get("/agreements/me/pdf"', "self agreement PDF route");
includes('"/admin/agreements/:agreementId/pdf"', "admin agreement PDF route");
includes('router.post("/events/:eventId/disputes"', "self dispute route");
includes('"/admin/overview"', "admin overview route");
includes('"/admin/events"', "admin events route");
includes('"/admin/agreements"', "admin agreements route");
includes('"/admin/disputes"', "admin dispute list route");
includes('"/admin/disputes/:id"', "admin dispute update route");
includes('"/admin/adjustments"', "admin adjustment route");
includes('"/admin/payouts"', "admin payout route");

const storeReadGuardCount = (routeSource.match(/authorize\(\["ADMIN", "MANAGER"\]\)/g) || []).length;
const adminWriteGuardCount = (routeSource.match(/authorize\(\["ADMIN"\]\)/g) || []).length;
assert(storeReadGuardCount >= 7, "store-wide read endpoints must allow ADMIN and MANAGER");
assert(adminWriteGuardCount >= 1, "write endpoint must keep exact ADMIN authorization");
assert(routeSource.includes("staffUserId: requestStaffId(req)"), "self API must use authenticated staff id");
assert(!/req\.query\.staffUserId[\s\S]{0,180}getSelfDashboard/.test(routeSource), "self API must not accept another staff id");
assert(routeSource.includes("withTransaction((connection) =>\n      createDispute"), "dispute creation must use transaction");
assert(appSource.includes('require("./routes/staffIncentives")'), "app route import missing");
assert(appSource.includes('app.use("/api/staff-incentives", staffIncentiveRoutes)'), "app route mount missing");

console.log("staff incentive route tests passed");
