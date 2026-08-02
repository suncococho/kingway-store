"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname,"../..");
const read = (file) => fs.readFileSync(path.join(root,file),"utf8");
const route=read("backend/src/routes/staffScheduling.js"), service=read("backend/src/services/staffSchedulingService.js"), app=read("backend/src/app.js");
const foundation=read("database/migrations/20260802_create_staff_scheduling_foundation.sql"), drafts=read("database/migrations/20260802_create_staff_schedule_drafts.sql");
const frontendPermissions=read("frontend/src/lib/menuPermissions.js"), mobileNavigation=read("frontend/src/lib/mobileNavigation.js"), schedulingPage=read("frontend/src/pages/StaffSchedulingPage.jsx"), menuPermissionService=read("backend/src/services/menuPermissionService.js");

test("all scheduling APIs require auth, store scope and active staff feature",()=>{
 assert.match(route,/router\.use\(authenticate, requireStoreScope\(\), requireStoreFeature\("staff_management_enabled"\)\)/);
 assert.match(service,/sm\.store_id = \? AND sm\.staff_user_id = \? AND sm\.status = 'active'/);
 assert.match(app,/app\.use\("\/api\/staff-scheduling", staffSchedulingRoutes\)/);
});
test("staff scheduling has an independent menu key enabled for every staff role",()=>{
 assert.match(frontendPermissions,/\{ key: "staff_scheduling", label: "員工排班" \}/);
 assert.match(frontendPermissions,/\{ path: "\/staff-scheduling", key: "staff_scheduling" \}/);
 assert.match(mobileNavigation,/to: "\/staff-scheduling"[^\n]+menuKey: "staff_scheduling"/);
 assert.ok((menuPermissionService.match(/staff_scheduling: allow\(\)/g)||[]).length>=4);
});
test("regular staff initial load excludes manager-only scheduling APIs",()=>{
 assert.match(schedulingPage,/manager\?\[schedulingApi\.profiles\(\)\]:\[\]/);
 assert.doesNotMatch(schedulingPage,/Promise\.all\(\[schedulingApi\.periods\(\),schedulingApi\.profiles/);
 assert.match(schedulingPage,/error\.message === "Not Found" \? fallback/);
 assert.match(schedulingPage,/tabs\.filter\(t=>manager\|\|!\["排班草稿","僱用資料"\]\.includes\(t\)\)/);
});
test("manager mutations use server-side store role middleware",()=>{
 const protectedRoutes=["employment-profiles/:staffUserId","/periods\"","calendar/:businessDate","calendar/defaults","time-off/:id/review","periods/:periodId/revisions","revisions/:revisionId/shifts","shifts/:shiftId/assignments"];
 protectedRoutes.forEach((needle)=>assert.ok(route.includes(needle),`missing ${needle}`));
 assert.ok((route.match(/, manage, handler/g)||[]).length>=11);
 assert.match(route,/const manage = requireStoreRole\(\["owner", "admin", "manager"\]\)/);
 assert.match(route,/router\.get\("\/employment-profiles", manage/);
 assert.match(route,/router\.get\("\/calendar", manage/);
 assert.match(route,/router\.get\("\/revisions\/:revisionId", manage/);
 assert.doesNotMatch(route,/router\.(get|put|post)\("\/me\/[^\n]+, manage/);
 assert.doesNotMatch(route,/req\.body\.storeId|req\.query\.storeId/);
});
test("self endpoints remain available to active staff while manager endpoints are denied",async()=>{
 const { requireStoreRole }=require("../src/middleware/auth");
 const middleware=requireStoreRole(["owner","admin","manager"]);
 const runRole=(storeRole)=>new Promise((resolve,reject)=>{const req={user:{id:7,role:"CASHIER",storeRole},storeId:3,storeRole};const res={status(code){this.code=code;return this;},json(body){resolve({code:this.code,body});}};middleware(req,res,(error)=>error?reject(error):resolve({code:200}));});
 assert.equal((await runRole("staff")).code,403);
 assert.equal((await runRole("manager")).code,200);
 assert.match(route,/router\.get\("\/periods", handler/);
 assert.match(route,/router\.get\("\/time-off", handler/);
 assert.match(service,/staff_user_id=\?/);
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
const policyShift={revision_id:5,period_id:4,shiftDate:"2026-08-04",starts_at:"10:00:00",ends_at:"18:00:00",addedHours:8};
const policyConnection=(results,calls=[])=>({calls,query:async(sql,params)=>{calls.push({sql,params});return [results.shift()];}});
test("approved time off conflicts with assignment but rejected time off does not",async()=>{
 const {validateShiftAssignment}=require("../src/services/staffSchedulingService");
 await assert.rejects(validateShiftAssignment(policyConnection([[{id:91}]]),3,7,policyShift),error=>error.statusCode===409&&error.code==="APPROVED_TIME_OFF_CONFLICT");
 const connection=policyConnection([[],[],[{maxWeeklyHours:40,scheduledHours:8}]]);
 await validateShiftAssignment(connection,3,7,policyShift);
 assert.match(connection.calls[0].sql,/status='APPROVED'/);
});
test("overlapping shift conflicts with assignment",async()=>{
 const {validateShiftAssignment}=require("../src/services/staffSchedulingService");
 await assert.rejects(validateShiftAssignment(policyConnection([[],[{id:92}]]),3,7,policyShift),error=>error.statusCode===409&&error.code==="SHIFT_OVERLAP");
});
function assignmentConnection(timeOff){
 const calls=[];
 return{calls,query:async(sql,params)=>{calls.push({sql,params});if(sql.includes("FROM staff_time_off_requests")){const shiftEnd=new Date(`${params[2]}T${params[3]}Z`),shiftStart=new Date(`${params[4]}T${params[5]}Z`);const conflict=timeOff&&timeOff.storeId===params[0]&&timeOff.staffUserId===params[1]&&timeOff.status==="APPROVED"&&new Date(timeOff.startsAt)<shiftEnd&&new Date(timeOff.endsAt)>shiftStart;return[conflict?[{id:timeOff.id}]:[]];}if(sql.startsWith("SELECT a.id FROM work_shift_assignments"))return[[]];if(sql.includes("max_weekly_hours"))return[[]];if(sql.startsWith("INSERT INTO work_shift_assignments"))return[{insertId:501}];throw new Error(`unexpected SQL: ${sql}`);}};
}
test("approved time-off SQL uses MySQL TIMESTAMP with stable parameter order",async()=>{
 const {validateShiftAssignment}=require("../src/services/staffSchedulingService");const connection=assignmentConnection(null);await validateShiftAssignment(connection,7,12,{...policyShift,shiftDate:"2036-08-05"});
 assert.match(connection.calls[0].sql,/status='APPROVED'/);assert.match(connection.calls[0].sql,/starts_at < TIMESTAMP\(\?, \?\) AND ends_at > TIMESTAMP\(\?, \?\)/);
 assert.deepEqual(connection.calls[0].params,[7,12,"2036-08-05","18:00:00","2036-08-05","10:00:00"]);
});
test("approved overlap rejects before assignment INSERT",async()=>{
 const {insertShiftAssignment}=require("../src/services/staffSchedulingService");const connection=assignmentConnection({id:3,storeId:7,staffUserId:12,status:"APPROVED",startsAt:"2036-08-05T09:00:00Z",endsAt:"2036-08-05T19:00:00Z"});
 await assert.rejects(insertShiftAssignment(connection,7,12,8,{...policyShift,id:6,shiftDate:"2036-08-05"},{assignmentReason:"test"}),error=>error.statusCode===409&&error.code==="APPROVED_TIME_OFF_CONFLICT");
 assert.equal(connection.calls.some(call=>call.sql.startsWith("INSERT INTO work_shift_assignments")),false);
});
test("rejected, other-store and other-staff time-off do not block assignment",async()=>{
 const {insertShiftAssignment}=require("../src/services/staffSchedulingService");const cases=[{id:1,storeId:7,staffUserId:12,status:"REJECTED",startsAt:"2036-08-05T09:00:00Z",endsAt:"2036-08-05T19:00:00Z"},{id:2,storeId:8,staffUserId:12,status:"APPROVED",startsAt:"2036-08-05T09:00:00Z",endsAt:"2036-08-05T19:00:00Z"},{id:3,storeId:7,staffUserId:13,status:"APPROVED",startsAt:"2036-08-05T09:00:00Z",endsAt:"2036-08-05T19:00:00Z"}];
 for(const fixture of cases){const connection=assignmentConnection(fixture);const result=await insertShiftAssignment(connection,7,12,8,{...policyShift,id:6,shiftDate:"2036-08-05"},{assignmentReason:"test"});assert.equal(result.id,501);assert.equal(connection.calls.filter(call=>call.sql.startsWith("INSERT INTO work_shift_assignments")).length,1);}
});
test("touching time-off boundaries are allowed",async()=>{
 const {insertShiftAssignment}=require("../src/services/staffSchedulingService");const cases=[{id:1,storeId:7,staffUserId:12,status:"APPROVED",startsAt:"2036-08-05T08:00:00Z",endsAt:"2036-08-05T10:00:00Z"},{id:2,storeId:7,staffUserId:12,status:"APPROVED",startsAt:"2036-08-05T18:00:00Z",endsAt:"2036-08-05T19:00:00Z"}];
 for(const fixture of cases){const connection=assignmentConnection(fixture);const result=await insertShiftAssignment(connection,7,12,8,{...policyShift,id:6,shiftDate:"2036-08-05"},{assignmentReason:"test"});assert.equal(result.id,501);}
});
test("max weekly hours rejects with hour details",async()=>{
 assert.match(route,/errorCode:error\.code/);assert.match(route,/error\.details/);
 const {validateShiftAssignment}=require("../src/services/staffSchedulingService");
 await assert.rejects(validateShiftAssignment(policyConnection([[],[],[{maxWeeklyHours:"40.00",scheduledHours:"36.00"}]]),3,7,policyShift),error=>error.statusCode===409&&error.code==="MAX_WEEKLY_HOURS_EXCEEDED"&&error.details.scheduledHours===36&&error.details.addedHours===8&&error.details.maxWeeklyHours===40);
});
test("NOT_PREFERRED allows assignment and produces a warning",async()=>{
 const {validateShiftAssignment,attachAssignmentWarnings}=require("../src/services/staffSchedulingService");
 await validateShiftAssignment(policyConnection([[],[],[{maxWeeklyHours:null,scheduledHours:0}]]),3,7,policyShift);
 const shifts=attachAssignmentWarnings([{id:11,warnings:[],assignmentWarnings:[]}],[{shiftId:11,staffUserId:7,displayName:"王小明",availabilitySubmitted:1,availableOrPreferred:0,notPreferred:1}]);
 assert.deepEqual(shifts[0].assignmentWarnings[0],{staffUserId:7,displayName:"王小明",code:"NOT_PREFERRED",message:"員工已標記此時段為不希望排班"});
});
test("outside availability allows assignment and produces a warning",async()=>{
 const {validateShiftAssignment,attachAssignmentWarnings}=require("../src/services/staffSchedulingService");
 await validateShiftAssignment(policyConnection([[],[],[]]),3,7,policyShift);
 const shifts=attachAssignmentWarnings([{id:11,warnings:[],assignmentWarnings:[]}],[{shiftId:11,staffUserId:7,displayName:"王小明",availabilitySubmitted:1,availableOrPreferred:0,notPreferred:0}]);
 assert.equal(shifts[0].assignmentWarnings[0].message,"員工未提供此時段可排班");
});
test("missing availability submission allows assignment and produces a warning",async()=>{
 const {validateShiftAssignment,attachAssignmentWarnings}=require("../src/services/staffSchedulingService");
 await validateShiftAssignment(policyConnection([[],[],[]]),3,7,policyShift);
 const shifts=attachAssignmentWarnings([{id:11,warnings:[],assignmentWarnings:[]}],[{shiftId:11,staffUserId:7,displayName:"王小明",availabilitySubmitted:0,availableOrPreferred:0,notPreferred:0}]);
 assert.equal(shifts[0].assignmentWarnings[0].message,"員工尚未提交可排班時間");
});
test("contracted weekly hours allows assignment and produces a warning",async()=>{
 const {validateShiftAssignment,attachAssignmentWarnings}=require("../src/services/staffSchedulingService");
 await validateShiftAssignment(policyConnection([[],[],[{maxWeeklyHours:60,scheduledHours:44}]]),3,7,policyShift);
 const shifts=attachAssignmentWarnings([{id:11,warnings:[],assignmentWarnings:[]}],[{shiftId:11,staffUserId:7,displayName:"王小明",availabilitySubmitted:1,availableOrPreferred:1,notPreferred:0,contractedWeeklyHours:40,scheduledHours:44}]);
 assert.equal(shifts[0].assignmentWarnings[0].message,"已超過契約週工時");
});
test("conflict and warning queries remain scoped to the current store and latest submitted availability",async()=>{
 const {validateShiftAssignment}=require("../src/services/staffSchedulingService");const connection=policyConnection([[],[],[]]);await validateShiftAssignment(connection,3,7,policyShift);
 connection.calls.forEach(call=>assert.ok(call.params.includes(3),"store id must be bound"));
 assert.match(service,/av\.store_id=a\.store_id/);assert.match(service,/status='SUBMITTED' ORDER BY av\.revision_no DESC LIMIT 1/);assert.doesNotMatch(service,/OUTSIDE_AVAILABILITY\"\)/);
});
test("draft warnings preserve legacy strings and expose structured assignment warnings",()=>{
 const {attachAssignmentWarnings}=require("../src/services/staffSchedulingService");const shifts=attachAssignmentWarnings([{id:11,warnings:["休業日仍有班次","尚缺 1 人"],assignmentWarnings:[]}],[{shiftId:11,staffUserId:7,displayName:"王小明",availabilitySubmitted:0}]);
 assert.deepEqual(shifts[0].warnings,["休業日仍有班次","尚缺 1 人","員工尚未提交可排班時間"]);assert.deepEqual(Object.keys(shifts[0].assignmentWarnings[0]),["staffUserId","displayName","code","message"]);
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
