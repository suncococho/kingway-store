"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const FIXTURE_PREFIX = "kw_stg_sched_";
const MANIFEST_VERSION = 1;
const TIER_CODE_MAX_LENGTH = 40;

function fail(message) { throw new Error(message); }
function csv(value) { return String(value || "").split(",").map((item) => item.trim()).filter(Boolean); }
function assertRunId(runId) {
  if (!/^[a-z0-9][a-z0-9_-]{5,48}$/i.test(String(runId || ""))) fail("run ID 格式不正確");
  return String(runId).toLowerCase();
}
function validateSafety(env, confirmed) {
  const appEnv = String(env.APP_ENV || env.NODE_ENV || "").toLowerCase();
  const host = String(env.DB_HOST || "").toLowerCase();
  const name = String(env.DB_NAME || env.MYSQL_DATABASE || "").toLowerCase();
  if (!appEnv.startsWith("staging")) fail("拒絕執行：APP_ENV 必須是 staging");
  if (!confirmed) fail("拒絕執行：缺少 --confirm-staging");
  if (!host || !name) fail("拒絕執行：缺少 DB host/name");
  if (/(^|[-_.])(prod|production)([-_.]|$)/.test(host) || /(^|[-_.])(prod|production)([-_.]|$)/.test(name)) fail("拒絕執行：疑似 Production DB");
  const allowedHosts = csv(env.STAGING_FIXTURE_ALLOWED_DB_HOSTS).map((value) => value.toLowerCase());
  const allowedNames = csv(env.STAGING_FIXTURE_ALLOWED_DB_NAMES).map((value) => value.toLowerCase());
  if (!allowedHosts.includes(host) || !allowedNames.includes(name)) fail("拒絕執行：DB host/name 不在 Staging allowlist");
  return { appEnv, host, name };
}
function validateTierCodes(tierCodes) {
  const values = Object.values(tierCodes || {});
  if (!values.length) fail("fixture tier_code 不可為空");
  for (const value of values) {
    if (typeof value !== "string" || !/^[A-Z0-9_]+$/.test(value)) fail("fixture tier_code 格式不正確");
    if (value.length > TIER_CODE_MAX_LENGTH) fail(`fixture tier_code 超過 ${TIER_CODE_MAX_LENGTH} 碼`);
  }
  if (new Set(values).size !== values.length) fail("fixture tier_code 重複，拒絕建立");
  return tierCodes;
}
function fixtureTierCodes(runId) {
  const id = assertRunId(runId);
  const suffix = crypto.createHash("sha256").update(id, "utf8").digest("hex").slice(0, 12).toUpperCase();
  return validateTierCodes({ neutral: `KW_STG_${suffix}_NEUTRAL`, extra: `KW_STG_${suffix}_EXTRA` });
}
function names(runId) {
  const id = assertRunId(runId);
  const marker = `${FIXTURE_PREFIX}${id}`;
  return { marker, storeCode: marker, adminUsername: `${marker}_admin`, staffUsername: `${marker}_staff`, tierCodes: fixtureTierCodes(id) };
}
function manifestPath(directory, runId) { return path.join(directory, `${FIXTURE_PREFIX}${assertRunId(runId)}.json`); }
function safeManifest(manifest) {
  return {
    manifestVersion: MANIFEST_VERSION,
    fixturePrefix: FIXTURE_PREFIX,
    runId: manifest.runId,
    createdAt: manifest.createdAt,
    dbTarget: manifest.dbTarget,
    identifiers: manifest.identifiers,
    ids: manifest.ids,
    cleanupOrder: manifest.cleanupOrder
  };
}
function writeManifest(file, manifest, fsApi = fs) {
  fsApi.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fsApi.existsSync(file)) fail("manifest 已存在，拒絕覆寫");
  fsApi.writeFileSync(file, `${JSON.stringify(safeManifest(manifest), null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}
async function insert(connection, sql, params) {
  const [result] = await connection.query(sql, params);
  if (Number(result.affectedRows) !== 1 || !Number(result.insertId)) fail("fixture 建立筆數不符");
  return Number(result.insertId);
}
function fixtureDates(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 14));
  start.setUTCDate(start.getUTCDate() + ((8 - start.getUTCDay()) % 7));
  const iso = (date) => date.toISOString().slice(0, 10);
  const days = [];
  for (let index = 0; index < 7; index += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    days.push(iso(day));
  }
  return { startsOn: days[0], endsOn: days[6], days };
}
async function assertNoIdentifierCollisions(connection, label) {
  const checks = [
    ["SELECT id FROM stores WHERE code=?", [label.storeCode], "store code"],
    ["SELECT id FROM staff_users WHERE username=?", [label.staffUsername], "STAFF username"],
    ["SELECT id FROM staff_users WHERE username=?", [label.adminUsername], "ADMIN username"]
  ];
  for (const [sql, params, description] of checks) {
    const [rows] = await connection.query(sql, params);
    if (rows.length) fail(`${description} 已存在，拒絕修改或重用`);
  }
}

async function createFixture({ db, env, confirmed, runId, password, hashPassword, directory, now = new Date(), fsApi = fs, failAfterStep, tierCodeFactory = fixtureTierCodes }) {
  const target = validateSafety(env, confirmed);
  const id = assertRunId(runId);
  const label = { ...names(id), tierCodes: validateTierCodes(tierCodeFactory(id)) };
  if (!password || String(password).length < 12) fail("fixture 密碼必須由環境變數提供且至少 12 碼");
  const file = manifestPath(directory, id);
  if (fsApi.existsSync(file)) fail("manifest 已存在，拒絕重複建立");
  const passwordHash = await hashPassword(password);
  const dates = fixtureDates(now);
  let wroteManifest = false;
  try {
    const manifest = await db.withTransaction(async (connection) => {
      await assertNoIdentifierCollisions(connection, label);
      const storeId = await insert(connection, "INSERT INTO stores(code,name,status,plan) VALUES (?,?,'active','single_store')", [label.storeCode, `Staging 排班 Fixture ${id}`]);
      if (failAfterStep === "store") fail("injected fixture failure");
      const adminId = await insert(connection, "INSERT INTO staff_users(username,password_hash,display_name,role,is_active,store_id) VALUES (?,?,?,'ADMIN',1,?)", [label.adminUsername, passwordHash, `STG ADMIN ${id}`, storeId]);
      const staffId = await insert(connection, "INSERT INTO staff_users(username,password_hash,display_name,role,is_active,store_id) VALUES (?,?,?,'CASHIER',1,?)", [label.staffUsername, passwordHash, `STG STAFF ${id}`, storeId]);
      const adminMembershipId = await insert(connection, "INSERT INTO store_memberships(store_id,staff_user_id,role,is_default,status) VALUES (?,?,'admin',1,'active')", [storeId, adminId]);
      const staffMembershipId = await insert(connection, "INSERT INTO store_memberships(store_id,staff_user_id,role,is_default,status) VALUES (?,?,'staff',1,'active')", [storeId, staffId]);
      const featureId = await insert(connection, "INSERT INTO store_features(store_id,staff_management_enabled,staff_workday_selection_enabled,line_enabled,telegram_enabled) VALUES (?,1,1,0,0)", [storeId]);
      const periodId = await insert(connection, "INSERT INTO staff_schedule_periods(store_id,name,starts_on,ends_on,input_deadline_at,timezone,status,created_by,updated_by) VALUES (?,?,?,?,?,'Asia/Taipei','DRAFT',?,?)", [storeId, `${label.marker}_period`, dates.startsOn, dates.endsOn, `${dates.startsOn} 23:59:59`, adminId, adminId]);
      const calendarIds = [];
      for (const date of dates.days) {
        calendarIds.push(await insert(connection, "INSERT INTO store_business_calendars(store_id,business_date,is_open,opens_at,closes_at,required_headcount,max_request_capacity,request_locked,request_deadline_at,pending_reserves_capacity,admin_assignment_counts_toward_limit,override_type,note,created_by,updated_by) VALUES (?,?,1,'10:00:00','19:00:00',1,2,0,?,0,1,'DEFAULT',?,?,?)", [storeId, date, `${dates.startsOn} 23:59:59`, label.marker, adminId, adminId]));
      }
      const profileId = await insert(connection, "INSERT INTO staff_employment_profiles(store_id,staff_user_id,employment_type,contracted_weekly_hours,max_weekly_hours,default_store_id,created_by,updated_by) VALUES (?,?,'PART_TIME',16,16,?,?,?)", [storeId, staffId, storeId, adminId, adminId]);
      const tierRuleId = await insert(connection, "INSERT INTO scheduling_score_tier_rules(store_id,tier_code,tier_name,minimum_score,max_selectable_days,effective_from,effective_to,is_neutral_default,is_enabled,created_by,updated_by) VALUES (?,?,?,NULL,2,?,?,1,1,?,?)", [storeId, label.tierCodes.neutral, "Fixture 一般", dates.startsOn, dates.endsOn, adminId, adminId]);
      const timeOffId = await insert(connection, "INSERT INTO staff_time_off_requests(store_id,staff_user_id,leave_type,starts_at,ends_at,status,public_note,reviewed_by,reviewed_at,review_note) VALUES (?,?,'OTHER',?,?,'APPROVED',?,?,NOW(),?)", [storeId, staffId, `${dates.days[2]} 10:00:00`, `${dates.days[2]} 19:00:00`, label.marker, adminId, label.marker]);
      const manifest = {
        runId: id,
        createdAt: now.toISOString(),
        dbTarget: target,
        identifiers: label,
        ids: { storeId, adminId, staffId, adminMembershipId, staffMembershipId, featureId, periodId, calendarIds, profileId, tierRuleId, timeOffId },
        cleanupOrder: ["scheduling flow data", "fixture scheduling setup", "store membership/features", "fixture users", "fixture store"]
      };
      writeManifest(file, manifest, fsApi);
      wroteManifest = true;
      return manifest;
    });
    return { manifestFile: file, manifest: safeManifest(manifest) };
  } catch (error) {
    if (wroteManifest) {
      try { fsApi.unlinkSync(file); } catch (_) {}
    }
    throw error;
  }
}

function readAndValidateManifest({ env, confirmed, runId, directory, fsApi = fs }) {
  const target = validateSafety(env, confirmed);
  const file = manifestPath(directory, runId);
  const manifest = JSON.parse(fsApi.readFileSync(file, "utf8"));
  const expected = names(runId);
  if (manifest.manifestVersion !== MANIFEST_VERSION || manifest.fixturePrefix !== FIXTURE_PREFIX || manifest.runId !== assertRunId(runId)) fail("manifest 格式或 run ID 不符");
  if (manifest.identifiers.storeCode !== expected.storeCode || manifest.identifiers.adminUsername !== expected.adminUsername || manifest.identifiers.staffUsername !== expected.staffUsername || JSON.stringify(manifest.identifiers.tierCodes) !== JSON.stringify(expected.tierCodes)) fail("manifest fixture prefix 驗證失敗");
  if (manifest.dbTarget.host !== target.host || manifest.dbTarget.name !== target.name) fail("manifest DB target 與目前 Staging 不符");
  return { file, manifest };
}
function exactId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) fail("manifest ID 格式不正確");
  return id;
}
async function verifyIdentity(connection, manifest) {
  const storeId = exactId(manifest.ids.storeId);
  const adminId = exactId(manifest.ids.adminId);
  const staffId = exactId(manifest.ids.staffId);
  const [stores] = await connection.query("SELECT id,code FROM stores WHERE id=? FOR UPDATE", [storeId]);
  if (stores.length !== 1 || Number(stores[0].id) !== storeId || stores[0].code !== manifest.identifiers.storeCode) fail("fixture store ID/code 驗證失敗，拒絕清理");
  const [users] = await connection.query("SELECT id,username FROM staff_users WHERE id IN (?,?) FOR UPDATE", [adminId, staffId]);
  const byId = new Map(users.map((user) => [Number(user.id), user.username]));
  if (users.length !== 2 || byId.get(adminId) !== manifest.identifiers.adminUsername || byId.get(staffId) !== manifest.identifiers.staffUsername) fail("fixture user ID/username 驗證失敗，拒絕清理");
  const [memberships] = await connection.query("SELECT id,store_id,staff_user_id FROM store_memberships WHERE id IN (?,?) FOR UPDATE", [exactId(manifest.ids.adminMembershipId), exactId(manifest.ids.staffMembershipId)]);
  const expectedMemberships = new Set([`${manifest.ids.adminMembershipId}:${storeId}:${adminId}`, `${manifest.ids.staffMembershipId}:${storeId}:${staffId}`]);
  if (memberships.length !== 2 || !memberships.every((row) => expectedMemberships.has(`${row.id}:${row.store_id}:${row.staff_user_id}`))) fail("fixture membership 驗證失敗，拒絕清理");
}
async function deleteExpected(connection, sql, params, expected, description) {
  const [result] = await connection.query(sql, params);
  if (Number(result.affectedRows) !== Number(expected)) fail(`${description} 清理筆數不符`);
}
async function storeRowCount(connection, table, storeId) {
  const [rows] = await connection.query(`SELECT COUNT(*) AS rowCount FROM ${table} WHERE store_id=?`, [storeId]);
  return Number(rows[0]?.rowCount || 0);
}
async function cleanupFixture({ db, env, confirmed, deleteConfirmed = false, runId, directory, fsApi = fs }) {
  const { file, manifest } = readAndValidateManifest({ env, confirmed, runId, directory, fsApi });
  if (!deleteConfirmed) return { dryRun: true, manifestFile: file, storeId: manifest.ids.storeId, runId: manifest.runId };
  await db.withTransaction(async (connection) => {
    await verifyIdentity(connection, manifest);
    const storeId = exactId(manifest.ids.storeId);
    const storeTables = [
      "scheduling_audit_logs", "work_shift_assignments", "work_shifts", "work_schedule_revisions",
      "staff_workday_request_days", "staff_workday_requests", "staff_time_off_requests",
      "staff_availability_windows", "staff_availability_submissions", "staff_weekly_limit_overrides",
      "scheduling_score_snapshots", "scheduling_score_tier_rules", "store_business_calendars",
      "staff_schedule_periods", "staff_employment_profiles", "store_features"
    ];
    const expected = new Map();
    for (const table of storeTables) expected.set(table, await storeRowCount(connection, table, storeId));
    const statements = [
      ["scheduling_audit_logs", "DELETE FROM scheduling_audit_logs WHERE store_id=?"],
      ["work_shift_assignments", "DELETE FROM work_shift_assignments WHERE store_id=?"],
      ["work_shifts", "DELETE FROM work_shifts WHERE store_id=?"],
      ["work_schedule_revisions", "DELETE FROM work_schedule_revisions WHERE store_id=?"],
      ["staff_workday_request_days", "DELETE d FROM staff_workday_request_days d JOIN staff_workday_requests r ON r.id=d.request_id AND r.store_id=d.store_id WHERE d.store_id=?"],
      ["staff_workday_requests", "DELETE FROM staff_workday_requests WHERE store_id=?"],
      ["staff_time_off_requests", "DELETE FROM staff_time_off_requests WHERE store_id=?"],
      ["staff_availability_windows", "DELETE w FROM staff_availability_windows w JOIN staff_availability_submissions a ON a.id=w.submission_id WHERE w.store_id=?"],
      ["staff_availability_submissions", "DELETE FROM staff_availability_submissions WHERE store_id=?"],
      ["staff_weekly_limit_overrides", "DELETE FROM staff_weekly_limit_overrides WHERE store_id=?"],
      ["scheduling_score_snapshots", "DELETE FROM scheduling_score_snapshots WHERE store_id=?"],
      ["scheduling_score_tier_rules", "DELETE FROM scheduling_score_tier_rules WHERE store_id=?"],
      ["store_business_calendars", "DELETE FROM store_business_calendars WHERE store_id=?"],
      ["staff_schedule_periods", "DELETE FROM staff_schedule_periods WHERE store_id=?"],
      ["staff_employment_profiles", "DELETE FROM staff_employment_profiles WHERE store_id=?"],
      ["store_features", "DELETE FROM store_features WHERE store_id=?"]
    ];
    for (const [table, sql] of statements) await deleteExpected(connection, sql, [storeId], expected.get(table), table);
    await deleteExpected(connection, "DELETE FROM store_memberships WHERE store_id=? AND ((id=? AND staff_user_id=?) OR (id=? AND staff_user_id=?))", [storeId, manifest.ids.adminMembershipId, manifest.ids.adminId, manifest.ids.staffMembershipId, manifest.ids.staffId], 2, "store_memberships");
    await deleteExpected(connection, "DELETE FROM staff_users WHERE (id=? AND username=?) OR (id=? AND username=?)", [manifest.ids.adminId, manifest.identifiers.adminUsername, manifest.ids.staffId, manifest.identifiers.staffUsername], 2, "staff_users");
    await deleteExpected(connection, "DELETE FROM stores WHERE id=? AND code=?", [storeId, manifest.identifiers.storeCode], 1, "stores");
  });
  fsApi.unlinkSync(file);
  return { dryRun: false, deleted: true, runId: manifest.runId };
}

module.exports = { FIXTURE_PREFIX, TIER_CODE_MAX_LENGTH, validateSafety, validateTierCodes, fixtureTierCodes, names, manifestPath, createFixture, cleanupFixture, readAndValidateManifest };
