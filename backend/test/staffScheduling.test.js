"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname,"../..");
const read = (file) => fs.readFileSync(path.join(root,file),"utf8");
const route=read("backend/src/routes/staffScheduling.js"), service=read("backend/src/services/staffSchedulingService.js"), app=read("backend/src/app.js");
const foundation=read("database/migrations/20260802_create_staff_scheduling_foundation.sql"), drafts=read("database/migrations/20260802_create_staff_schedule_drafts.sql");

test("all scheduling APIs require auth, store scope and active staff feature",()=>{
 assert.match(route,/router\.use\(authenticate, requireStoreScope\(\), requireStoreFeature\("staff_management_enabled"\)\)/);
 assert.match(service,/sm\.store_id = \? AND sm\.staff_user_id = \? AND sm\.status = 'active'/);
 assert.match(app,/app\.use\("\/api\/staff-scheduling", staffSchedulingRoutes\)/);
});
test("manager mutations use server-side store role middleware",()=>{
 const protectedRoutes=["employment-profiles/:staffUserId","/periods\"","calendar/:businessDate","calendar/defaults","time-off/:id/review","periods/:periodId/revisions","revisions/:revisionId/shifts","shifts/:shiftId/assignments"];
 protectedRoutes.forEach((needle)=>assert.ok(route.includes(needle),`missing ${needle}`));
 assert.ok((route.match(/, manage, handler/g)||[]).length>=8);
 assert.doesNotMatch(route,/req\.body\.storeId|req\.query\.storeId/);
});
test("self endpoints never accept a staff id",()=>{
 assert.match(route,/\/me\/availability/); assert.match(route,/\/me\/time-off/);
 assert.doesNotMatch(route,/me\/availability[\s\S]{0,200}staffUserId/);
});
test("tenant filters and overlap protection are present",()=>{
 assert.ok((service.match(/store_id=\?|store_id = \?/g)||[]).length>=18);
 assert.match(service,/s\.starts_at < \? AND s\.ends_at > \?/);
 assert.match(service,/SHIFT_OVERLAP/);
 assert.match(service,/尚缺/);
});
test("exactly nine separate tables are created",()=>{
 const sql=`${foundation}\n${drafts}`; const tables=[...sql.matchAll(/CREATE TABLE ([a-z_]+)/g)].map(m=>m[1]);
 assert.deepEqual(tables,["staff_employment_profiles","staff_schedule_periods","store_business_calendars","staff_availability_submissions","staff_availability_windows","staff_time_off_requests","work_schedule_revisions","work_shifts","work_shift_assignments"]);
 tables.forEach((table)=>{const block=sql.slice(sql.indexOf(`CREATE TABLE ${table}`),sql.indexOf(") ENGINE",sql.indexOf(`CREATE TABLE ${table}`)));assert.match(block,/store_id BIGINT UNSIGNED NOT NULL/);});
});
test("rollbacks drop in dependency reverse order",()=>{
 assert.deepEqual([...read("database/migrations/20260802_create_staff_scheduling_foundation_rollback.sql").matchAll(/DROP TABLE IF EXISTS ([a-z_]+)/g)].map(m=>m[1]),["staff_time_off_requests","staff_availability_windows","staff_availability_submissions","store_business_calendars","staff_schedule_periods","staff_employment_profiles"]);
 assert.deepEqual([...read("database/migrations/20260802_create_staff_schedule_drafts_rollback.sql").matchAll(/DROP TABLE IF EXISTS ([a-z_]+)/g)].map(m=>m[1]),["work_shift_assignments","work_shifts","work_schedule_revisions"]);
});
