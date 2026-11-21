const { createError } = require("../utils/errors");

const STAFF_ASSIGNMENT_ROLES = ["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"];

function normalizeOptionalStaffId(value, label) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError(`${label}必須為有效員工`, 400);
  }
  return id;
}

function readExplicitNullableStaffId(body, fallbackKey) {
  const payload = body || {};
  if (Object.prototype.hasOwnProperty.call(payload, "staffId")) {
    return payload.staffId;
  }
  if (Object.prototype.hasOwnProperty.call(payload, fallbackKey)) {
    return payload[fallbackKey];
  }
  return undefined;
}

async function getAssignableStaffSnapshot(connection, storeId, staffId) {
  const [rows] = await connection.query(
    `
      SELECT
        su.id,
        COALESCE(NULLIF(TRIM(su.display_name), ''), su.username) AS displayName,
        su.role
      FROM staff_users su
      INNER JOIN store_memberships sm
        ON sm.staff_user_id = su.id
       AND sm.store_id = ?
       AND sm.status = 'active'
      WHERE su.id = ?
        AND su.is_active = 1
        AND su.role IN (?)
      LIMIT 1
    `,
    [storeId, staffId, STAFF_ASSIGNMENT_ROLES]
  );
  if (!rows[0]) {
    throw createError("只能選擇同門市啟用中的員工", 400);
  }
  return {
    id: Number(rows[0].id),
    name: String(rows[0].displayName || rows[0].id).trim().slice(0, 100),
    role: rows[0].role
  };
}

async function resolveStaffAssignment(connection, storeId, rawStaffId, label) {
  const staffId = normalizeOptionalStaffId(rawStaffId, label);
  if (staffId === undefined) return undefined;
  if (staffId === null) {
    return { id: null, name: null, role: null };
  }
  return getAssignableStaffSnapshot(connection, storeId, staffId);
}

function assertSharedSalesAssignments(
  primaryAssignment,
  supportAssignment
) {
  const primaryId = Number(
    primaryAssignment?.id || 0
  );

  const supportId = Number(
    supportAssignment?.id || 0
  );

  if (supportId > 0 && primaryId <= 0) {
    throw createError(
      "設定支援銷售人員前，請先選擇主要銷售人員",
      400
    );
  }

  if (
    primaryId > 0 &&
    supportId > 0 &&
    primaryId === supportId
  ) {
    throw createError(
      "主要銷售人員與支援銷售人員不可為同一人",
      400
    );
  }

  return {
    primary: primaryAssignment,
    support: supportAssignment
  };
}

async function resolveSharedSalesAssignments(
  connection,
  storeId,
  rawPrimaryStaffId,
  rawSupportStaffId
) {
  const primary = await resolveStaffAssignment(
    connection,
    storeId,
    rawPrimaryStaffId,
    "主要銷售人員"
  );

  const support = await resolveStaffAssignment(
    connection,
    storeId,
    rawSupportStaffId,
    "支援銷售人員"
  );

  return assertSharedSalesAssignments(
    primary,
    support
  );
}

async function listStaffSelectOptions(connection, storeId) {
  const [rows] = await connection.query(
    `
      SELECT
        su.id,
        COALESCE(NULLIF(TRIM(su.display_name), ''), su.username) AS displayName,
        su.role
      FROM staff_users su
      INNER JOIN store_memberships sm
        ON sm.staff_user_id = su.id
       AND sm.store_id = ?
       AND sm.status = 'active'
      WHERE su.is_active = 1
        AND su.role IN (?)
      ORDER BY displayName ASC, su.id ASC
    `,
    [storeId, STAFF_ASSIGNMENT_ROLES]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    displayName: row.displayName,
    role: row.role
  }));
}

module.exports = {
  STAFF_ASSIGNMENT_ROLES,
  normalizeOptionalStaffId,
  readExplicitNullableStaffId,
  getAssignableStaffSnapshot,
  resolveStaffAssignment,
  assertSharedSalesAssignments,
  resolveSharedSalesAssignments,
  listStaffSelectOptions
};
