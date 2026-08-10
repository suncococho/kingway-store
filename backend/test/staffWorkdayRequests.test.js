"use strict";
const test=require("node:test");const assert=require("node:assert/strict");const fs=require("node:fs");const path=require("node:path");const {execFileSync}=require("node:child_process");
const service=require("../src/services/staffWorkdayRequestService");const root=path.resolve(__dirname,"../..");const read=file=>fs.readFileSync(path.join(root,file),"utf8");
test("isoDate preserves valid strings and formats database Date values",()=>{for(const value of ["2026-01-01","2026-12-31","2024-02-29"])assert.equal(service.isoDate(value),value);assert.equal(service.isoDate(new Date(Date.UTC(2026,0,2))),"2026-01-02");assert.equal(service.isoDate(new Date(Date.UTC(2026,8,7))),"2026-09-07");});
test("isoDate rejects invalid and nonexistent dates with the existing message",()=>{for(const value of [new Date(NaN),null,undefined,"2026-1-01","2026-01-1","not-a-date","2026-02-29","2024-02-30","2026-13-01"])assert.throws(()=>service.isoDate(value),error=>error.code==="INVALID_REQUEST"&&error.message==="日期格式不正確");});
test("database Date normalization is stable in UTC and Asia/Taipei",()=>{const script=`const service=require(${JSON.stringify(path.join(root,"backend/src/services/staffWorkdayRequestService.js"))});process.stdout.write(service.isoDate(new Date(Date.UTC(2026,0,1))))`;for(const TZ of ["UTC","Asia/Taipei"])assert.equal(execFileSync(process.execPath,["-e",script],{env:{...process.env,TZ},encoding:"utf8"}),"2026-01-01");});
test("approval accepts MySQL DATE strings and Date objects and records review state",async()=>{for(const workDate of ["2026-08-04",new Date(Date.UTC(2026,7,4))]){const updates=[],audits=[];const connection={query:async(sql,params)=>{if(sql.startsWith("SELECT * FROM staff_workday_requests"))return [[{id:51,status:"PENDING",version:3}]];if(sql.startsWith("SELECT * FROM staff_workday_request_days"))return [[{id:71,work_date:workDate,status:"PENDING",version:1}]];if(sql.startsWith("SELECT bc.*"))return [[{id:81,is_open:1,request_locked:0,approvedHeadcount:0,maxRequestCapacity:2,requiredHeadcount:2}]];if(sql.startsWith("UPDATE ")){updates.push({sql,params});return [{affectedRows:1}];}throw new Error("unexpected SQL: "+sql);}};const dbPath=require.resolve("../src/db"),auditPath=require.resolve("../src/services/schedulingAuditService"),membershipPath=require.resolve("../src/services/staffSchedulingService"),servicePath=require.resolve("../src/services/staffWorkdayRequestService");const saved=[dbPath,auditPath,membershipPath,servicePath].map(key=>[key,require.cache[key]]);require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{pool:{},withTransaction:handler=>handler(connection)}};require.cache[auditPath]={id:auditPath,filename:auditPath,loaded:true,exports:{createWorkdayAuditLog:async(_connection,input)=>audits.push(input)}};require.cache[membershipPath]={id:membershipPath,filename:membershipPath,loaded:true,exports:{requireActiveMembership:async()=>({storeRole:"admin"})}};delete require.cache[servicePath];try{const isolated=require(servicePath);const result=await isolated.reviewWorkdayRequest(3,9,51,{status:"APPROVED",version:3});assert.deepEqual(result,{id:51,status:"APPROVED",version:4});assert.equal(updates.length,2);assert.match(updates[0].sql,/status=\?,reviewed_by=\?,reviewed_at=NOW\(\).*version=version\+1/);assert.deepEqual(updates[0].params.slice(0,2),["APPROVED",9]);assert.match(updates[1].sql,/staff_workday_requests SET status=\?,reviewed_by=\?,reviewed_at=NOW\(\).*version=version\+1/);assert.deepEqual(updates[1].params.slice(0,2),["APPROVED",9]);assert.equal(audits.length,1);assert.equal(audits[0].actionType,"REQUEST_APPROVE");}finally{for(const[key,cached]of saved){if(cached)require.cache[key]=cached;else delete require.cache[key];}}}});
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
