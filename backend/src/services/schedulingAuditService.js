"use strict";

const AUDITED_ACTIONS = new Set([
  "REQUEST_SUBMIT", "REQUEST_CANCEL", "REQUEST_APPROVE", "REQUEST_REJECT",
  "DATE_ADJUST", "WEEKLY_LIMIT_OVERRIDE", "CAPACITY_OVERRIDE", "DATE_LOCK",
  "DATE_UNLOCK", "SCORE_TIER_CHANGE"
]);

async function createWorkdayAuditLog(connection, input) {
  if (!connection || typeof connection.query !== "function") throw new TypeError("需要資料庫連線");
  if (!AUDITED_ACTIONS.has(input.actionType)) throw new Error("不支援的排班稽核動作");
  if (!input.storeId || !input.actorStaffUserId || !input.entityId) throw new Error("稽核資料不完整");
  if (["WEEKLY_LIMIT_OVERRIDE", "CAPACITY_OVERRIDE", "DATE_LOCK", "DATE_UNLOCK", "SCORE_TIER_CHANGE", "REQUEST_REJECT", "DATE_ADJUST"].includes(input.actionType) && !String(input.reason || "").trim()) {
    throw new Error("管理員覆寫必須填寫原因");
  }
  await connection.query(
    `INSERT INTO scheduling_audit_logs
      (store_id,actor_staff_user_id,action_type,entity_type,entity_id,old_value_json,new_value_json,reason,correlation_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [input.storeId, input.actorStaffUserId, input.actionType, input.entityType, input.entityId,
      input.oldValue == null ? null : JSON.stringify(input.oldValue), input.newValue == null ? null : JSON.stringify(input.newValue),
      String(input.reason || "").trim() || null, input.correlationId || null]
  );
}

module.exports = { AUDITED_ACTIONS, createWorkdayAuditLog };
