"use strict";
const test=require("node:test");const assert=require("node:assert/strict");const fs=require("node:fs");const path=require("node:path");
const service=require("../src/services/staffWorkdayRequestService");const root=path.resolve(__dirname,"../..");const read=file=>fs.readFileSync(path.join(root,file),"utf8");
test("Asia/Taipei weeks are Monday-Sunday across month boundaries",()=>{assert.equal(service.mondayOf("2026-08-03"),"2026-08-03");assert.equal(service.mondayOf("2026-08-09"),"2026-08-03");assert.equal(service.mondayOf("2026-08-01"),"2026-07-27");});
test("same active date counts once and rejected/cancelled do not count",()=>{assert.deepEqual(service.uniqueActiveDates([{workDate:"2026-08-04",status:"DRAFT"},{workDate:"2026-08-04",status:"APPROVED"},{workDate:"2026-08-05",status:"REJECTED"},{workDate:"2026-08-06",status:"CANCELLED"}]),["2026-08-04"]);});
test("2-day and 3-day limits work with stable conflict details",()=>{assert.equal(service.assertWeeklyLimit({dates:["2026-08-04","2026-08-05"],attemptedDate:"2026-08-05",maxSelectableDays:2,tierName:"一般",scoreStatus:"VALID"}).length,2);assert.equal(service.assertWeeklyLimit({dates:["2026-08-04","2026-08-05","2026-08-06"],attemptedDate:"2026-08-06",maxSelectableDays:3,tierName:"高分",scoreStatus:"VALID"}).length,3);assert.throws(()=>service.assertWeeklyLimit({dates:["2026-08-04","2026-08-05","2026-08-06"],attemptedDate:"2026-08-06",maxSelectableDays:2,tierName:"一般",scoreStatus:"INSUFFICIENT_DATA"}),error=>error.code==="WEEKLY_SELECTION_LIMIT_EXCEEDED"&&error.statusCode===409&&error.details.weekStart==="2026-08-03"&&error.details.totalDays===3&&error.details.maxSelectableDays===2);});
test("pending competition does not reserve capacity and employee payload is private",()=>{const result=service.publicEmployeeDay({workDate:"2026-08-08",isOpen:1,requestLocked:0,requiredHeadcount:2,maxRequestCapacity:null,approvedHeadcount:1,pendingRequestCount:9});assert.equal(result.availableSlots,1);assert.equal(result.pendingRequestCount,9);assert.equal("approvedNames" in result,false);assert.equal("staffUserId" in result,false);});
test("routes enforce feature, self identity and server-side manager review",()=>{const route=read("backend/src/routes/staffScheduling.js");assert.match(route,/staff_workday_selection_enabled/);assert.match(route,/\/me\/workday-calendar/);assert.doesNotMatch(route,/\/me\/workday-(calendar|summary)[^\n]+staffUserId/);assert.match(route,/\/admin\/workday-requests[^\n]+manage/);});
test("schema is additive, store-scoped and rollback is dependency-safe",()=>{const core=read("database/migrations/20260804_create_staff_workday_request_core.sql");for(const table of ["staff_workday_requests","staff_workday_request_days"]){const start=core.indexOf(`CREATE TABLE ${table}`),end=core.indexOf(") ENGINE",start);assert.match(core.slice(start,end),/store_id BIGINT UNSIGNED NOT NULL/);}const rollback=read("database/migrations/20260804_create_staff_workday_request_core_rollback.sql");assert.ok(rollback.indexOf("staff_workday_request_days")<rollback.indexOf("staff_workday_requests"));assert.match(rollback,/WARNING/);});
test("existing assignment conflict and warning logic remains unchanged",()=>{const legacy=read("backend/src/services/staffSchedulingService.js");for(const token of ["APPROVED_TIME_OFF_CONFLICT","SHIFT_OVERLAP","MAX_WEEKLY_HOURS_EXCEEDED","CONTRACTED_WEEKLY_HOURS_EXCEEDED"])assert.match(legacy,new RegExp(token));});

const schedulingRouter=require("../src/routes/staffScheduling");
const findRoute=(method,path)=>schedulingRouter.stack.find(layer=>layer.route&&layer.route.path===path&&layer.route.methods[method])?.route;
const runMiddleware=(middleware,req)=>new Promise((resolve,reject)=>{const res={status(code){this.code=code;return this;},json(body){resolve({code:this.code,body});}};middleware(req,res,(error)=>error?reject(error):resolve({code:200}));});

test("staff scheduling router rejects unauthenticated requests before route dispatch",async()=>{
 const result=await runMiddleware(schedulingRouter.stack[0].handle,{headers:{}});
 assert.equal(result.code,401);
});

test("admin workday mutations enforce the actual manage middleware chain",async()=>{
 const paths=["/admin/capacity/:date","/admin/score-tier-rules","/admin/staff/:staffUserId/weekly-limit"];
 for(const path of paths){
  const route=findRoute("put",path);
  assert.ok(route,"missing PUT "+path);
  assert.equal(route.stack.length,3,path+" must include feature, manage and handler middleware");
  const manageMiddleware=route.stack[1].handle;
  const staff=await runMiddleware(manageMiddleware,{user:{id:7,role:"STAFF",storeRole:"staff"},storeId:3,storeRole:"staff"});
  const admin=await runMiddleware(manageMiddleware,{user:{id:8,role:"ADMIN",storeRole:"admin"},storeId:3,storeRole:"admin"});
  assert.equal(staff.code,403,path+" must reject staff");
  assert.equal(admin.code,200,path+" must allow admin");
 }
});

test("staff draft and submit routes remain self-service while manager reads remain protected",async()=>{
 for(const entry of [["put","/me/workday-selection"],["post","/me/workday-selection/submit"]]){
  const method=entry[0],path=entry[1],route=findRoute(method,path);
  assert.ok(route,"missing "+method.toUpperCase()+" "+path);
  assert.equal(route.stack.length,2,path+" must retain feature plus self-service handler only");
 }
 for(const path of ["/admin/workday-calendar","/admin/workday-requests"]){
  const route=findRoute("get",path);
  assert.ok(route,"missing GET "+path);
  assert.equal(route.stack.length,3,path+" must retain manager read protection");
  const manager=await runMiddleware(route.stack[1].handle,{user:{id:9,role:"MANAGER",storeRole:"manager"},storeId:3,storeRole:"manager"});
  assert.equal(manager.code,200);
 }
});

test("bulk review source sorts ids and review rejects illegal status transitions",()=>{const serviceText=read("backend/src/services/staffWorkdayRequestService.js");assert.match(serviceText,/sort\(\(a,b\)=>Number\(a.id\)-Number\(b.id\)\)/);assert.match(serviceText,/INVALID_REQUEST_STATUS/);});
test("score provider rejects invalid max days and detects overlapping neutral tiers",()=>{const provider=require("../src/services/schedulingScoreProvider");assert.throws(()=>provider.mapResult({status:"INSUFFICIENT_DATA",maxSelectableDays:null}),/每週上限不正確/);});

test("concurrency guards lock request headers and calendar rows",()=>{const text=read("backend/src/services/staffWorkdayRequestService.js");assert.match(text,/staff_workday_requests WHERE id=\? AND store_id=\? AND staff_user_id=\? FOR UPDATE/);assert.match(text,/store_business_calendars WHERE store_id=\? AND business_date=\? FOR UPDATE/);assert.match(text,/sort\(\(a,b\)=>Number\(a.id\)-Number\(b.id\)\)/);});
test("frontend disables deadline-passed dates and exposes backend error codes",()=>{const utils=read("frontend/src/components/scheduling/calendarUtils.js");const panel=read("frontend/src/components/scheduling/WorkdaySelectionPanel.jsx");assert.match(utils,/deadlinePassed/);assert.match(panel,/error.errorCode/);});
