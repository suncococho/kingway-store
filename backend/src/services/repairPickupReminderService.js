const { pool } = require("../db");
const { createError } = require("../utils/errors");
const { getTableColumns, hasColumn } = require("../utils/schema");

async function buildPickupReminderQuery(connection = pool, options = {}) {
  const repairAlias = options.repairAlias || "ro";
  const confirmationAlias = options.confirmationAlias || "rc";
  const includeSuppression = options.includeSuppression !== false;
  const includeCompletedConfirmation = options.includeCompletedConfirmation !== false;

  const repairColumns = await getTableColumns(connection, "repair_orders");
  const confirmationColumns = await getTableColumns(connection, "repair_confirmations");

  const joins = [];
  const conditions = [
    `${repairAlias}.status = 'completed_waiting_pickup'`,
    `${repairAlias}.completed_at IS NOT NULL`,
    `${repairAlias}.picked_up_at IS NULL`
  ];

  if (hasColumn(repairColumns, "deleted_at")) {
    conditions.push(`${repairAlias}.deleted_at IS NULL`);
  }
  if (hasColumn(repairColumns, "is_deleted")) {
    conditions.push(`COALESCE(${repairAlias}.is_deleted, 0) = 0`);
  }
  if (hasColumn(repairColumns, "closed_at")) {
    conditions.push(`${repairAlias}.closed_at IS NULL`);
  }
  if (hasColumn(repairColumns, "pickup_reminder_suppressed") && includeSuppression) {
    conditions.push(`COALESCE(${repairAlias}.pickup_reminder_suppressed, 0) = 0`);
  }
  if (hasColumn(repairColumns, "handover_confirmed_at")) {
    conditions.push(`${repairAlias}.handover_confirmed_at IS NULL`);
  }

  if (includeCompletedConfirmation && confirmationColumns.length > 0) {
    joins.push(
      `LEFT JOIN repair_confirmations ${confirmationAlias} ON ${confirmationAlias}.repair_order_id = ${repairAlias}.id AND ${confirmationAlias}.store_id = ${repairAlias}.store_id AND ${confirmationAlias}.status = 'COMPLETED'`
    );
    conditions.push(`${confirmationAlias}.id IS NULL`);
  }

  return {
    repairColumns,
    confirmationColumns,
    joins,
    conditions
  };
}

async function listPickupReminderCandidates(connection = pool, options = {}) {
  const { joins, conditions } = await buildPickupReminderQuery(connection, options);
  const includeCustomerLineUser = options.includeCustomerLineUser !== false;
  const customerJoin = includeCustomerLineUser ? "INNER JOIN customers c ON c.id = ro.customer_id" : "";
  const customerColumns = includeCustomerLineUser ? ["c.name AS customerName", "c.line_user_id AS lineUserId"] : [];

  const [rows] = await connection.query(
    `
      SELECT
        ro.id,
        ro.completed_at AS completedAt,
        ro.storage_fee AS storageFee,
        ${customerColumns.length ? customerColumns.join(", ") + "," : ""}
        TIMESTAMPDIFF(DAY, ro.completed_at, NOW()) AS daysAfterComplete
      FROM repair_orders ro
      ${customerJoin}
      ${joins.join("\n      ")}
      WHERE ${conditions.join(" AND ")}
      ORDER BY ro.completed_at ASC, ro.id ASC
    `
  );

  return rows;
}

async function markRepairPickedUp(repairId, connection = pool, options = {}) {
  const repairIdValue = Number(repairId);
  if (!Number.isInteger(repairIdValue) || repairIdValue <= 0) {
    throw createError("維修單號不正確", 400);
  }

  const repairColumns = await getTableColumns(connection, "repair_orders");
  const updates = [
    "status = 'picked_up'",
    "picked_up_at = COALESCE(picked_up_at, NOW())"
  ];

  if (hasColumn(repairColumns, "pickup_reminder_suppressed")) {
    updates.push("pickup_reminder_suppressed = 1");
  }
  if (hasColumn(repairColumns, "pickup_reminder_suppressed_at")) {
    updates.push("pickup_reminder_suppressed_at = COALESCE(pickup_reminder_suppressed_at, NOW())");
  }
  if (hasColumn(repairColumns, "updated_at")) {
    updates.push("updated_at = NOW()");
  }

  const whereParts = ["id = ?"];
  const params = [repairIdValue];
  const storeId = Number(options.storeId || 0);
  if (Number.isSafeInteger(storeId) && storeId > 0 && hasColumn(repairColumns, "store_id")) {
    whereParts.push("store_id = ?");
    params.push(storeId);
  }

  const [result] = await connection.query(
    `
      UPDATE repair_orders
      SET ${updates.join(", ")}
      WHERE ${whereParts.join(" AND ")}
    `,
    params
  );

  return {
    affectedRows: Number(result.affectedRows || 0),
    changedRows: Number(result.changedRows || 0)
  };
}

async function suppressPickupReminder(repairId, connection = pool, options = {}) {
  const repairIdValue = Number(repairId);
  if (!Number.isInteger(repairIdValue) || repairIdValue <= 0) {
    throw createError("維修單號不正確", 400);
  }

  const repairColumns = await getTableColumns(connection, "repair_orders");
  if (!hasColumn(repairColumns, "pickup_reminder_suppressed")) {
    throw createError("目前資料庫尚未加入保管提醒欄位，請先更新結構", 400);
  }

  const updates = ["pickup_reminder_suppressed = 1"];
  const params = [];
  if (hasColumn(repairColumns, "pickup_reminder_suppressed_at")) {
    updates.push("pickup_reminder_suppressed_at = COALESCE(pickup_reminder_suppressed_at, NOW())");
  }
  if (hasColumn(repairColumns, "pickup_reminder_suppressed_by") && options.suppressedBy) {
    updates.push("pickup_reminder_suppressed_by = COALESCE(pickup_reminder_suppressed_by, ?)");
    params.push(String(options.suppressedBy));
  }
  if (hasColumn(repairColumns, "updated_at")) {
    updates.push("updated_at = NOW()");
  }

  const whereParts = ["id = ?"];
  params.push(repairIdValue);
  const storeId = Number(options.storeId || 0);
  if (Number.isSafeInteger(storeId) && storeId > 0 && hasColumn(repairColumns, "store_id")) {
    whereParts.push("store_id = ?");
    params.push(storeId);
  }

  const [result] = await connection.query(
    `
      UPDATE repair_orders
      SET ${updates.join(", ")}
      WHERE ${whereParts.join(" AND ")}
    `,
    params
  );

  return {
    affectedRows: Number(result.affectedRows || 0),
    changedRows: Number(result.changedRows || 0)
  };
}

module.exports = {
  buildPickupReminderQuery,
  listPickupReminderCandidates,
  markRepairPickedUp,
  suppressPickupReminder
};
