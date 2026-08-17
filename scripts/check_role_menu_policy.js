#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const repo = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");
const permissions = read("frontend/src/lib/menuPermissions.js");
const navigation = read("frontend/src/lib/mobileNavigation.js");
const app = read("frontend/src/App.jsx");

function fail(message) {
  console.error("ERROR: " + message);
  process.exit(1);
}
function sameSet(actual, expected, label) {
  const a = [...new Set(actual)].sort();
  const e = [...new Set(expected)].sort();
  if (JSON.stringify(a) !== JSON.stringify(e)) {
    fail(label + " mismatch; actual=" + JSON.stringify(a) + " expected=" + JSON.stringify(e));
  }
}
function keysFor(role) {
  const match = permissions.match(new RegExp(role + ": \\[([^\\]]*)\\]"));
  if (!match) fail(role + " fallback missing");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

const menus = [...navigation.matchAll(/\{ to: "([^"]+)", label: "([^"]+)"[^}]*menuKey: "([^"]+)" \}/g)]
  .map((item) => ({ path: item[1], key: item[3] }));
if (menus.length !== 35) fail("mobile menu expected 35, got " + menus.length);
const pathsFor = (keys) => menus.filter((menu) => keys === null || keys.includes(menu.key)).map((menu) => menu.path);

if (!permissions.includes('normalizeRole(user?.role) === "ADMIN"')) fail("ADMIN full-menu condition missing");
if (!permissions.includes("isOwnerUser(user) ||")) fail("storeRole owner full-menu condition missing");
if (permissions.includes("STORE_OWNER:")) fail("virtual STORE_OWNER staff role must not exist");
if (/platform|saas/i.test(permissions)) fail("store menu permissions must not grant platform/SaaS privileges");

const approvedKeys = {
  MANAGER: ["dashboard", "pos", "orders", "repairs", "customers", "products", "inventory", "sales_management", "suppliers", "staff", "staff_scheduling", "staff_incentives", "coupons", "line", "settings", "store_replenishment_requests", "store_transfers", "inbound_transfers"],
  CASHIER: ["dashboard", "pos", "orders", "customers", "staff_scheduling", "staff_incentives", "coupons"],
  REPAIR: ["dashboard", "orders", "repairs", "customers", "staff_scheduling", "staff_incentives"],
  INVENTORY: ["dashboard", "products", "inventory", "suppliers", "staff_scheduling", "staff_incentives", "store_replenishment_requests", "store_transfers", "inbound_transfers"],
  STAFF: ["dashboard", "staff_scheduling", "staff_incentives"]
};
for (const [role, expected] of Object.entries(approvedKeys)) sameSet(keysFor(role), expected, role + " keys");

const expectedCounts = { MANAGER: 35, CASHIER: 15, REPAIR: 15, INVENTORY: 15, STAFF: 10 };
for (const [role, count] of Object.entries(expectedCounts)) {
  const actual = pathsFor(keysFor(role));
  if (actual.length !== count) fail(role + " menu count expected " + count + " got " + actual.length);
}
if (pathsFor(null).length !== 35) fail("ADMIN/storeRole owner menu count must be 35");

const staffPaths = pathsFor(keysFor("STAFF"));
sameSet(staffPaths, [
  "/customer-status",
  "/dashboard",
  "/notifications",
  "/messages",
  "/daily-tasks",
  "/store-cash-reports",
  "/store-visit-records",
  "/settings/manual",
  "/staff-scheduling",
  "/staff-incentives"
], "STAFF self-service menus");

const lineRoute = app.indexOf('<Route path="/line-order" element={<LineOrderPage />} />');
const protectedLayout = app.indexOf("<Route element={<ProtectedLayout />}>");
if (lineRoute < 0 || protectedLayout < 0 || lineRoute > protectedLayout) fail("/line-order must remain public");

console.log("OK: approved role menu policy passed.");
console.log("ADMIN=35 STORE_ROLE_OWNER=35 MANAGER=35 CASHIER=15 REPAIR=15 INVENTORY=15 STAFF=10");
