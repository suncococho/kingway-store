"use strict";

const { pool, withTransaction } = require("../db");

function httpError(message, statusCode = 400, code = "INVALID_REQUEST") {
  const error = new Error(message); error.statusCode = statusCode; error.code = code; return error;
}
function positiveId(value, label = "識別碼") {
  const id = Number(value); if (!Number.isInteger(id) || id <= 0) throw httpError(`${label}不正確`); return id;
}
function text(value, max = 500) { const result = String(value ?? "").trim(); return result ? result.slice(0, max) : null; }
function requireEnum(value, allowed, label) { const normalized = String(value || "").trim().toUpperCase(); if (!allowed.includes(normalized)) throw httpError(`${label}不正確`); return normalized; }

async function requireActiveMembership(connection, storeId, staffUserId, lock = false) {
  const [rows] = await connection.query(
    `SELECT sm.role AS storeRole, su.role AS staffRole, su.display_name AS displayName
       FROM store_memberships sm INNER JOIN staff_users su ON su.id = sm.staff_user_id AND su.is_active = 1
      WHERE sm.store_id = ? AND sm.staff_user_id = ? AND sm.status = 'active' LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [positiveId(storeId, "門市"), positiveId(staffUserId, "員工")]
  );
  if (!rows[0]) throw httpError("找不到此門市的有效員工資格", 403, "ACTIVE_MEMBERSHIP_REQUIRED");
  return rows[0];
}

async function requireScheduleManager(connection, storeId, staffUserId) {
  const membership = await requireActiveMembership(connection, storeId, staffUserId);
  if (!["owner", "admin", "manager"].includes(String(membership.storeRole || "").toLowerCase())) {
    throw httpError("需要門市排班管理權限", 403, "SCHEDULING_MANAGER_REQUIRED");
  }
  return membership;
}

async function listEmploymentProfiles(storeId, actorId) {
  const membership = await requireActiveMembership(pool, storeId, actorId);
  const canManage = ["owner", "admin", "manager"].includes(String(membership.storeRole || "").toLowerCase());
  const params = [storeId]; let selfClause = "";
  if (!canManage) { selfClause = "AND su.id = ?"; params.push(actorId); }
  const [rows] = await pool.query(
    `SELECT su.id AS staffUserId, su.display_name AS displayName, su.role AS staffRole, sm.role AS storeRole,
            ep.id, ep.employment_type AS employmentType, ep.hourly_rate AS hourlyRate,
            ep.contracted_weekly_hours AS contractedWeeklyHours, ep.max_weekly_hours AS maxWeeklyHours,
            ep.default_store_id AS defaultStoreId, ep.updated_at AS updatedAt
       FROM store_memberships sm INNER JOIN staff_users su ON su.id = sm.staff_user_id AND su.is_active = 1
       LEFT JOIN staff_employment_profiles ep ON ep.store_id = sm.store_id AND ep.staff_user_id = su.id
      WHERE sm.store_id = ? AND sm.status = 'active' ${selfClause} ORDER BY su.display_name, su.id`, params);
  return rows;
}

async function upsertEmploymentProfile(storeId, actorId, staffUserId, input) {
  await requireScheduleManager(pool, storeId, actorId); await requireActiveMembership(pool, storeId, staffUserId);
  const employmentType = requireEnum(input.employmentType, ["FULL_TIME","PART_TIME","CONTRACT","TEMPORARY"], "僱用類型");
  const hourlyRate = input.hourlyRate === null || input.hourlyRate === "" ? null : Number(input.hourlyRate);
  const contracted = input.contractedWeeklyHours === null || input.contractedWeeklyHours === "" ? null : Number(input.contractedWeeklyHours);
  const maximum = input.maxWeeklyHours === null || input.maxWeeklyHours === "" ? null : Number(input.maxWeeklyHours);
  if ([hourlyRate, contracted, maximum].some((v) => v !== null && (!Number.isFinite(v) || v < 0))) throw httpError("工資或工時不可為負數");
  if (contracted !== null && maximum !== null && contracted > maximum) throw httpError("契約工時不可高於每週工時上限");
  await pool.query(
    `INSERT INTO staff_employment_profiles
       (store_id, staff_user_id, employment_type, hourly_rate, contracted_weekly_hours, max_weekly_hours, default_store_id, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE employment_type=VALUES(employment_type), hourly_rate=VALUES(hourly_rate),
       contracted_weekly_hours=VALUES(contracted_weekly_hours), max_weekly_hours=VALUES(max_weekly_hours),
       default_store_id=VALUES(default_store_id), updated_by=VALUES(updated_by)`,
    [storeId, staffUserId, employmentType, hourlyRate, contracted, maximum, storeId, actorId, actorId]);
  return (await listEmploymentProfiles(storeId, actorId, true)).find((row) => Number(row.staffUserId) === Number(staffUserId));
}

async function listPeriods(storeId, actorId) { await requireActiveMembership(pool, storeId, actorId); const [rows] = await pool.query("SELECT * FROM staff_schedule_periods WHERE store_id=? ORDER BY starts_on DESC", [storeId]); return rows; }
async function createPeriod(storeId, actorId, input) {
  await requireScheduleManager(pool, storeId, actorId);
  const startsOn = text(input.startsOn, 10), endsOn = text(input.endsOn, 10); if (!startsOn || !endsOn || endsOn < startsOn) throw httpError("排班期間不正確");
  const [result] = await pool.query(`INSERT INTO staff_schedule_periods (store_id,name,starts_on,ends_on,input_deadline_at,timezone,status,created_by,updated_by) VALUES (?,?,?,?,?,?,'DRAFT',?,?)`, [storeId,text(input.name,120)||`${startsOn}～${endsOn}`,startsOn,endsOn,input.inputDeadlineAt||null,text(input.timezone,64)||"Asia/Taipei",actorId,actorId]);
  return { id: result.insertId };
}

async function listCalendar(storeId, actorId, from, to) { await requireScheduleManager(pool, storeId, actorId); const [rows] = await pool.query("SELECT * FROM store_business_calendars WHERE store_id=? AND business_date BETWEEN ? AND ? ORDER BY business_date", [storeId,from,to]); return rows; }
async function upsertCalendar(storeId, actorId, input) {
  await requireScheduleManager(pool, storeId, actorId); const date = text(input.businessDate,10); if (!date) throw httpError("營業日期必填");
  const open = Boolean(input.isOpen); const headcount = open ? Number(input.requiredHeadcount) : 0;
  if (!Number.isInteger(headcount) || headcount < 0 || headcount > 100) throw httpError("最低需求人數不正確");
  await pool.query(`INSERT INTO store_business_calendars (store_id,business_date,is_open,opens_at,closes_at,required_headcount,override_type,note,created_by,updated_by)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE is_open=VALUES(is_open),opens_at=VALUES(opens_at),closes_at=VALUES(closes_at),required_headcount=VALUES(required_headcount),override_type=VALUES(override_type),note=VALUES(note),updated_by=VALUES(updated_by)`,
    [storeId,date,open?1:0,open?input.opensAt||null:null,open?input.closesAt||null:null,headcount,requireEnum(input.overrideType||"DEFAULT",["DEFAULT","SPECIAL_OPEN","SPECIAL_CLOSED","HEADCOUNT_OVERRIDE"],"例外類型"),text(input.note,255),actorId,actorId]);
  return { businessDate: date };
}

async function seedCalendarDefaults(storeId, actorId, periodId, input = {}) {
  await requireScheduleManager(pool, storeId, actorId); const [periods] = await pool.query("SELECT starts_on, ends_on FROM staff_schedule_periods WHERE id=? AND store_id=? AND status='DRAFT'",[periodId,storeId]);
  if (!periods[0]) throw httpError("找不到可編輯的草稿期間",404);
  const start = new Date(`${periods[0].starts_on.toISOString?.().slice(0,10)||periods[0].starts_on}T00:00:00Z`), end = new Date(`${periods[0].ends_on.toISOString?.().slice(0,10)||periods[0].ends_on}T00:00:00Z`);
  for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate()+1)) {
    const iso=day.toISOString().slice(0,10), weekday=day.getUTCDay(), isOpen=weekday!==1, required=!isOpen?0:(weekday===0||weekday===6?2:1);
    await pool.query(`INSERT IGNORE INTO store_business_calendars (store_id,business_date,is_open,opens_at,closes_at,required_headcount,override_type,created_by,updated_by) VALUES (?,?,?,?,?,?,'DEFAULT',?,?)`,[storeId,iso,isOpen?1:0,isOpen?(input.opensAt||"10:00:00"):null,isOpen?(input.closesAt||"19:00:00"):null,required,actorId,actorId]);
  }
  return listCalendar(storeId,actorId,start.toISOString().slice(0,10),end.toISOString().slice(0,10));
}

async function getAvailability(storeId, actorId, periodId) {
  await requireActiveMembership(pool,storeId,actorId); const [rows]=await pool.query(`SELECT s.*, w.id windowId,w.specific_date specificDate,w.weekday,w.starts_at startsAt,w.ends_at endsAt,w.preference,w.note FROM staff_availability_submissions s LEFT JOIN staff_availability_windows w ON w.submission_id=s.id AND w.store_id=s.store_id WHERE s.store_id=? AND s.period_id=? AND s.staff_user_id=? ORDER BY s.revision_no DESC,w.id`,[storeId,periodId,actorId]);
  if(!rows.length)return null; const head=rows[0]; return {...head,windows:rows.filter(r=>r.windowId).map(r=>({id:r.windowId,specificDate:r.specificDate,weekday:r.weekday,startsAt:r.startsAt,endsAt:r.endsAt,preference:r.preference,note:r.note}))};
}
async function saveAvailability(storeId,actorId,periodId,input,submit=false){
  return withTransaction(async(connection)=>{await requireActiveMembership(connection,storeId,actorId,true); const [periods]=await connection.query("SELECT * FROM staff_schedule_periods WHERE id=? AND store_id=? AND status='DRAFT' FOR UPDATE",[periodId,storeId]); if(!periods[0])throw httpError("找不到可提交的草稿期間",404);
    const [latest]=await connection.query("SELECT * FROM staff_availability_submissions WHERE store_id=? AND period_id=? AND staff_user_id=? ORDER BY revision_no DESC LIMIT 1 FOR UPDATE",[storeId,periodId,actorId]);
    let submissionId;if(latest[0]&&latest[0].status==='DRAFT'){submissionId=latest[0].id;await connection.query("DELETE FROM staff_availability_windows WHERE store_id=? AND submission_id=?",[storeId,submissionId]);}else{const [created]=await connection.query("INSERT INTO staff_availability_submissions (store_id,period_id,staff_user_id,revision_no,status) VALUES (?,?,?,?, 'DRAFT')",[storeId,periodId,actorId,Number(latest[0]?.revision_no||0)+1]);submissionId=created.insertId;}
    for(const window of input.windows||[]){const preference=requireEnum(window.preference,["AVAILABLE","PREFERRED","NOT_PREFERRED"],"可排班偏好");if(Boolean(window.specificDate)===Number.isInteger(Number(window.weekday)))throw httpError("日期與星期必須擇一填寫");await connection.query("INSERT INTO staff_availability_windows (store_id,submission_id,specific_date,weekday,starts_at,ends_at,preference,note) VALUES (?,?,?,?,?,?,?,?)",[storeId,submissionId,window.specificDate||null,window.specificDate?null:Number(window.weekday),window.startsAt,window.endsAt,preference,text(window.note,255)]);}
    if(submit)await connection.query("UPDATE staff_availability_submissions SET status='SUBMITTED',submitted_at=NOW() WHERE id=? AND store_id=?",[submissionId,storeId]);return {id:submissionId,status:submit?'SUBMITTED':'DRAFT'};});
}

async function listTimeOff(storeId,actorId){const membership=await requireActiveMembership(pool,storeId,actorId);const canManage=["owner","admin","manager"].includes(String(membership.storeRole||"").toLowerCase());const params=[storeId];const self=canManage?"":"AND r.staff_user_id=?";if(!canManage)params.push(actorId);const [rows]=await pool.query(`SELECT r.id,r.staff_user_id staffUserId,su.display_name displayName,r.leave_type leaveType,r.starts_at startsAt,r.ends_at endsAt,r.status,r.public_note publicNote,${canManage?'r.private_reason privateReason,r.attachment_ref attachmentRef,':''}r.reviewed_by reviewedBy,r.reviewed_at reviewedAt,r.review_note reviewNote,r.created_at createdAt FROM staff_time_off_requests r JOIN staff_users su ON su.id=r.staff_user_id WHERE r.store_id=? ${self} ORDER BY r.starts_at DESC`,params);return rows;}
async function createTimeOff(storeId,actorId,input){await requireActiveMembership(pool,storeId,actorId);const type=requireEnum(input.leaveType,["ANNUAL","SICK","PERSONAL","STATUTORY","OTHER"],"休假類型");const [r]=await pool.query("INSERT INTO staff_time_off_requests (store_id,staff_user_id,leave_type,starts_at,ends_at,public_note,private_reason,attachment_ref) VALUES (?,?,?,?,?,?,?,?)",[storeId,actorId,type,input.startsAt,input.endsAt,text(input.publicNote,255),text(input.privateReason,4000),text(input.attachmentRef,500)]);return{id:r.insertId,status:'PENDING'};}
async function reviewTimeOff(storeId,actorId,id,input){await requireScheduleManager(pool,storeId,actorId);const status=requireEnum(input.status,["APPROVED","REJECTED"],"審核狀態");const [r]=await pool.query("UPDATE staff_time_off_requests SET status=?,reviewed_by=?,reviewed_at=NOW(),review_note=? WHERE id=? AND store_id=? AND status='PENDING'",[status,actorId,text(input.reviewNote,255),id,storeId]);if(!r.affectedRows)throw httpError("找不到待審核休假申請",404);return{id:Number(id),status};}

async function createRevision(storeId,actorId,periodId,input){await requireScheduleManager(pool,storeId,actorId);const [latest]=await pool.query("SELECT id,revision_no FROM work_schedule_revisions WHERE store_id=? AND period_id=? ORDER BY revision_no DESC LIMIT 1",[storeId,periodId]);const [r]=await pool.query("INSERT INTO work_schedule_revisions (store_id,period_id,revision_no,status,previous_revision_id,change_reason,created_by,updated_by) SELECT ?,p.id,?,'DRAFT',?,?,?,? FROM staff_schedule_periods p WHERE p.id=? AND p.store_id=? AND p.status='DRAFT'",[storeId,Number(latest[0]?.revision_no||0)+1,latest[0]?.id||null,text(input.changeReason,500),actorId,actorId,periodId,storeId]);if(!r.affectedRows)throw httpError("找不到草稿排班期間",404);return{id:r.insertId};}
function attachAssignmentWarnings(shifts,rows){const byShift=new Map(shifts.map(shift=>[Number(shift.id),shift]));for(const row of rows){const shift=byShift.get(Number(row.shiftId));if(!shift)continue;let code=null,message=null;if(!Number(row.availabilitySubmitted)){code="AVAILABILITY_NOT_SUBMITTED";message="員工尚未提交可排班時間";}else if(Number(row.notPreferred)){code="NOT_PREFERRED";message="員工已標記此時段為不希望排班";}else if(!Number(row.availableOrPreferred)){code="OUTSIDE_AVAILABILITY";message="員工未提供此時段可排班";}if(code){shift.assignmentWarnings.push({staffUserId:Number(row.staffUserId),displayName:row.displayName,code,message});if(!shift.warnings.includes(message))shift.warnings.push(message);}if(row.contractedWeeklyHours!==null&&row.contractedWeeklyHours!==undefined&&Number(row.scheduledHours)>Number(row.contractedWeeklyHours)){message="已超過契約週工時";shift.assignmentWarnings.push({staffUserId:Number(row.staffUserId),displayName:row.displayName,code:"CONTRACTED_WEEKLY_HOURS_EXCEEDED",message});if(!shift.warnings.includes(message))shift.warnings.push(message);}}return shifts;}
async function getDraft(storeId,actorId,revisionId){await requireScheduleManager(pool,storeId,actorId);const [revisions]=await pool.query("SELECT * FROM work_schedule_revisions WHERE id=? AND store_id=?",[revisionId,storeId]);if(!revisions[0])throw httpError("找不到排班版本",404);
 const [shiftRows]=await pool.query(`SELECT sh.*,bc.is_open isOpen,bc.required_headcount calendarRequiredHeadcount,COUNT(CASE WHEN a.status='DRAFT' THEN 1 END) assignedHeadcount FROM work_shifts sh JOIN store_business_calendars bc ON bc.id=sh.business_calendar_id AND bc.store_id=sh.store_id LEFT JOIN work_shift_assignments a ON a.shift_id=sh.id AND a.store_id=sh.store_id WHERE sh.store_id=? AND sh.revision_id=? GROUP BY sh.id ORDER BY sh.shift_date,sh.starts_at`,[storeId,revisionId]);
 const shifts=shiftRows.map(s=>({...s,warnings:[...(!s.isOpen?["休業日仍有班次"]:[]),...(Number(s.assignedHeadcount)<Number(s.required_headcount)?[`尚缺 ${Number(s.required_headcount)-Number(s.assignedHeadcount)} 人`]:[])],assignmentWarnings:[]}));
 const [assignments]=await pool.query(`SELECT a.shift_id shiftId,a.staff_user_id staffUserId,su.display_name displayName,ep.contracted_weekly_hours contractedWeeklyHours,EXISTS(SELECT 1 FROM staff_availability_submissions av WHERE av.store_id=a.store_id AND av.period_id=r.period_id AND av.staff_user_id=a.staff_user_id AND av.status='SUBMITTED') availabilitySubmitted,
 EXISTS(SELECT 1 FROM staff_availability_windows w WHERE w.store_id=a.store_id AND w.submission_id=(SELECT av.id FROM staff_availability_submissions av WHERE av.store_id=a.store_id AND av.period_id=r.period_id AND av.staff_user_id=a.staff_user_id AND av.status='SUBMITTED' ORDER BY av.revision_no DESC LIMIT 1) AND (w.specific_date=sh.shift_date OR (w.specific_date IS NULL AND w.weekday=DAYOFWEEK(sh.shift_date)-1)) AND w.starts_at<=sh.starts_at AND w.ends_at>=sh.ends_at AND w.preference IN ('AVAILABLE','PREFERRED')) availableOrPreferred,
 EXISTS(SELECT 1 FROM staff_availability_windows w WHERE w.store_id=a.store_id AND w.submission_id=(SELECT av.id FROM staff_availability_submissions av WHERE av.store_id=a.store_id AND av.period_id=r.period_id AND av.staff_user_id=a.staff_user_id AND av.status='SUBMITTED' ORDER BY av.revision_no DESC LIMIT 1) AND (w.specific_date=sh.shift_date OR (w.specific_date IS NULL AND w.weekday=DAYOFWEEK(sh.shift_date)-1)) AND w.starts_at<sh.ends_at AND w.ends_at>sh.starts_at AND w.preference='NOT_PREFERRED') notPreferred,
 (SELECT COALESCE(SUM(TIME_TO_SEC(TIMEDIFF(ws.ends_at,ws.starts_at)))/3600,0) FROM work_shift_assignments wa JOIN work_shifts ws ON ws.id=wa.shift_id AND ws.store_id=wa.store_id WHERE wa.store_id=a.store_id AND wa.staff_user_id=a.staff_user_id AND wa.status<>'CANCELLED' AND ws.revision_id=sh.revision_id AND YEARWEEK(ws.shift_date,3)=YEARWEEK(sh.shift_date,3)) scheduledHours FROM work_shift_assignments a JOIN work_shifts sh ON sh.id=a.shift_id AND sh.store_id=a.store_id JOIN work_schedule_revisions r ON r.id=sh.revision_id AND r.store_id=sh.store_id JOIN staff_users su ON su.id=a.staff_user_id LEFT JOIN staff_employment_profiles ep ON ep.store_id=a.store_id AND ep.staff_user_id=a.staff_user_id WHERE a.store_id=? AND sh.revision_id=? AND a.status<>'CANCELLED'`,[storeId,revisionId]);return{revision:revisions[0],shifts:attachAssignmentWarnings(shifts,assignments)};}
async function createShift(storeId,actorId,revisionId,input){await requireScheduleManager(pool,storeId,actorId);const [r]=await pool.query(`INSERT INTO work_shifts (store_id,revision_id,business_calendar_id,shift_date,starts_at,ends_at,required_headcount,required_role,note,created_by,updated_by) SELECT ?,rev.id,bc.id,bc.business_date,?,?,?,?,?,?,? FROM work_schedule_revisions rev JOIN store_business_calendars bc ON bc.store_id=rev.store_id AND bc.business_date=? WHERE rev.id=? AND rev.store_id=? AND rev.status='DRAFT'`,[storeId,input.startsAt,input.endsAt,Number(input.requiredHeadcount||1),text(input.requiredRole,40),text(input.note,255),actorId,actorId,input.shiftDate,revisionId,storeId]);if(!r.affectedRows)throw httpError("找不到草稿版本或該日營業設定",404);return{id:r.insertId};}
async function validateShiftAssignment(connection,storeId,staffUserId,shift){
 const checks=[["SELECT id FROM staff_time_off_requests WHERE store_id=? AND staff_user_id=? AND status='APPROVED' AND starts_at < TIMESTAMP(?, ?) AND ends_at > TIMESTAMP(?, ?) LIMIT 1 FOR UPDATE",[storeId,staffUserId,shift.shiftDate,shift.ends_at,shift.shiftDate,shift.starts_at],"此員工在班次期間已有核准休假","APPROVED_TIME_OFF_CONFLICT"],["SELECT a.id FROM work_shift_assignments a JOIN work_shifts s ON s.id=a.shift_id AND s.store_id=a.store_id JOIN work_schedule_revisions r ON r.id=s.revision_id AND r.store_id=s.store_id WHERE a.store_id=? AND a.staff_user_id=? AND a.status<>'CANCELLED' AND (s.revision_id=? OR r.status='PUBLISHED') AND s.shift_date=? AND s.starts_at < ? AND s.ends_at > ? LIMIT 1 FOR UPDATE",[storeId,staffUserId,shift.revision_id,shift.shiftDate,shift.ends_at,shift.starts_at],"此員工已有重疊班次","SHIFT_OVERLAP"]];
 for(const [sql,params,message,code] of checks){const [rows]=await connection.query(sql,params);if(rows[0])throw httpError(message,409,code);}
 const [hours]=await connection.query(`SELECT ep.max_weekly_hours maxWeeklyHours,COALESCE(SUM(TIME_TO_SEC(TIMEDIFF(s.ends_at,s.starts_at)))/3600,0) scheduledHours FROM staff_employment_profiles ep LEFT JOIN work_shift_assignments a ON a.store_id=ep.store_id AND a.staff_user_id=ep.staff_user_id AND a.status<>'CANCELLED' LEFT JOIN work_shifts s ON s.id=a.shift_id AND s.store_id=a.store_id AND s.shift_date>=DATE_SUB(?,INTERVAL WEEKDAY(?) DAY) AND s.shift_date<DATE_ADD(DATE_SUB(?,INTERVAL WEEKDAY(?) DAY),INTERVAL 7 DAY) WHERE ep.store_id=? AND ep.staff_user_id=? GROUP BY ep.id,ep.max_weekly_hours FOR UPDATE`,[shift.shiftDate,shift.shiftDate,shift.shiftDate,shift.shiftDate,storeId,staffUserId]);
 const max=hours[0]?.maxWeeklyHours,scheduled=Number(hours[0]?.scheduledHours||0),added=Number(shift.addedHours);if(max!==null&&max!==undefined&&scheduled+added>Number(max)){const error=httpError("指派後將超過此員工的每週工時上限",409,"MAX_WEEKLY_HOURS_EXCEEDED");error.details={scheduledHours:scheduled,addedHours:added,maxWeeklyHours:Number(max)};throw error;}}
async function insertShiftAssignment(connection,storeId,staffUserId,actorId,shift,input){await validateShiftAssignment(connection,storeId,staffUserId,shift);const [r]=await connection.query("INSERT INTO work_shift_assignments (store_id,shift_id,staff_user_id,status,assigned_by,assignment_reason,is_manual,version) VALUES (?,?,?,'DRAFT',?,?,1,1)",[storeId,shift.id,staffUserId,actorId,text(input.assignmentReason,500)]);return{id:r.insertId,version:1};}
async function assignShift(storeId,actorId,shiftId,input){return withTransaction(async(connection)=>{await requireScheduleManager(connection,storeId,actorId);const staffUserId=positiveId(input.staffUserId,"員工");await requireActiveMembership(connection,storeId,staffUserId,true);const [shifts]=await connection.query("SELECT sh.*,DATE_FORMAT(sh.shift_date,'%Y-%m-%d') shiftDate,r.period_id,TIME_TO_SEC(TIMEDIFF(sh.ends_at,sh.starts_at))/3600 addedHours FROM work_shifts sh JOIN work_schedule_revisions r ON r.id=sh.revision_id AND r.store_id=sh.store_id WHERE sh.id=? AND sh.store_id=? AND r.status='DRAFT' FOR UPDATE",[shiftId,storeId]);if(!shifts[0])throw httpError("找不到可編輯班次",404);return insertShiftAssignment(connection,storeId,staffUserId,actorId,shifts[0],input);});}

module.exports={requireActiveMembership,listEmploymentProfiles,upsertEmploymentProfile,listPeriods,createPeriod,listCalendar,upsertCalendar,seedCalendarDefaults,getAvailability,saveAvailability,listTimeOff,createTimeOff,reviewTimeOff,createRevision,getDraft,createShift,attachAssignmentWarnings,validateShiftAssignment,insertShiftAssignment,assignShift};
