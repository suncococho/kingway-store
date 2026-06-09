const express = require("express");
const { pool } = require("../db");
const { authenticate, requireStoreScope, requireStoreRole } = require("../middleware/auth");
const { requireStoreFeature } = require("../middleware/storeFeature");
const { hashPassword } = require("../utils/passwords");

const router = express.Router();
const STAFF_ROLES = new Set(["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"]);
const MANAGED_STORE_ROLES = new Set(["admin", "staff"]);

router.use(authenticate, requireStoreScope(), requireStoreFeature("staff_management_enabled"));

const requireStaffManagementStoreRole = requireStoreRole(["owner", "admin"]);

function getRequestStoreId(req) {
  const storeId = Number(req.storeId || req.user?.storeId || req.user?.store_id || 0);
  return Number.isFinite(storeId) && storeId > 0 ? storeId : 0;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value).trim();
}

function normalizeStaffRole(value) {
  const role = normalizeText(value).toUpperCase();
  if (!STAFF_ROLES.has(role)) {
    const error = new Error("員工工作角色不正確");
    error.statusCode = 400;
    throw error;
  }
  return role;
}

function normalizeManagedStoreRole(value, fallback = "staff") {
  const role = normalizeText(value || fallback).toLowerCase();
  if (!MANAGED_STORE_ROLES.has(role)) {
    const error = new Error("管理權限只能設定為 admin 或 staff");
    error.statusCode = 400;
    throw error;
  }
  return role;
}

function normalizeActiveValue(value) {
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["0", "false", "disabled", "inactive"].includes(normalized)) return false;
  }
  return true;
}

function mapStaffRow(row) {
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.displayName,
    lineUserId: row.lineUserId || null,
    role: row.role,
    storeRole: row.storeRole || null,
    membershipStatus: row.membershipStatus || null,
    isDefaultStore: Boolean(row.isDefaultStore),
    isActive: Boolean(row.isActive),
    createdAt: row.createdAt
  };
}

async function findStoreStaff(connection, storeId, staffUserId, lock = false) {
  const [rows] = await connection.query(
    `
      SELECT
        su.id,
        su.username,
        su.display_name AS displayName,
        su.line_user_id AS lineUserId,
        su.role,
        sm.role AS storeRole,
        sm.status AS membershipStatus,
        sm.is_default AS isDefaultStore,
        su.is_active AS isActive,
        su.created_at AS createdAt
      FROM staff_users su
      INNER JOIN store_memberships sm
        ON sm.staff_user_id = su.id
       AND sm.store_id = ?
       AND sm.status IN ('active', 'disabled')
      WHERE su.id = ?
      LIMIT 1
      ${lock ? "FOR UPDATE" : ""}
    `,
    [storeId, staffUserId]
  );
  return rows[0] || null;
}

router.get("/", async (req, res, next) => {
  try {
    const storeId = getRequestStoreId(req);
    const [rows] = await pool.query(
      `
        SELECT
          su.id,
          su.username,
          su.display_name AS displayName,
          su.line_user_id AS lineUserId,
          su.role,
          sm.role AS storeRole,
          sm.status AS membershipStatus,
          sm.is_default AS isDefaultStore,
          su.is_active AS isActive,
          su.created_at AS createdAt
        FROM staff_users su
        INNER JOIN store_memberships sm
          ON sm.staff_user_id = su.id
         AND sm.store_id = ?
         AND sm.status IN ('active', 'disabled')
        ORDER BY FIELD(sm.role, 'owner', 'admin', 'staff'), su.id ASC
      `,
      [storeId]
    );

    return res.json(rows.map(mapStaffRow));
  } catch (error) {
    return next(error);
  }
});

router.post("/", requireStaffManagementStoreRole, async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const storeId = getRequestStoreId(req);
    const { username, password, displayName, role, storeRole, lineUserId } = req.body;
    const normalizedUsername = normalizeText(username);
    const normalizedDisplayName = normalizeText(displayName);
    const normalizedStaffRole = normalizeStaffRole(role);
    const normalizedStoreRole = normalizeManagedStoreRole(storeRole);

    if (!normalizedUsername || !password || !normalizedDisplayName) {
      return res.status(400).json({ message: "帳號、密碼、姓名與角色為必填" });
    }

    const passwordHash = await hashPassword(password);
    await connection.beginTransaction();
    const [result] = await connection.query(
      `
        INSERT INTO staff_users (username, password_hash, display_name, role, line_user_id, is_active, store_id)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `,
      [normalizedUsername, passwordHash, normalizedDisplayName, normalizedStaffRole, lineUserId || null, storeId]
    );

    await connection.query(
      `
        INSERT INTO store_memberships (store_id, staff_user_id, role, is_default, status)
        VALUES (?, ?, ?, 1, 'active')
      `,
      [storeId, result.insertId, normalizedStoreRole]
    );

    const row = await findStoreStaff(connection, storeId, result.insertId);
    await connection.commit();

    return res.status(201).json(mapStaffRow(row));
  } catch (error) {
    try {
      await connection.rollback();
    } catch (_) {}
    if (error.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "帳號已存在";
    }
    return next(error);
  } finally {
    connection.release();
  }
});

router.patch("/:id", requireStaffManagementStoreRole, async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    const storeId = getRequestStoreId(req);
    const { username, password, displayName, role, storeRole, lineUserId, isActive } = req.body;
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(404).json({ message: "找不到員工" });
    }

    await connection.beginTransaction();
    const current = await findStoreStaff(connection, storeId, id, true);
    if (!current) {
      await connection.rollback();
      return res.status(404).json({ message: "找不到員工" });
    }

    const currentStoreRole = normalizeText(current.storeRole).toLowerCase();
    const nextIsActive = isActive === undefined ? undefined : normalizeActiveValue(isActive);
    if (Number(req.user?.id) === id && nextIsActive === false) {
      await connection.rollback();
      return res.status(409).json({ message: "不能停用目前登入中的自己" });
    }

    if (currentStoreRole === "owner" && storeRole !== undefined && normalizeText(storeRole).toLowerCase() !== "owner") {
      await connection.rollback();
      return res.status(409).json({ message: "owner 不能在員工管理中降權" });
    }

    if (currentStoreRole === "owner" && nextIsActive === false) {
      await connection.rollback();
      return res.status(409).json({ message: "owner 不能在員工管理中停用" });
    }

    const updates = [];
    const values = [];

    if (username !== undefined) {
      updates.push("username = ?");
      values.push(normalizeText(username));
    }

    if (password) {
      const passwordHash = await hashPassword(password);
      updates.push("password_hash = ?");
      values.push(passwordHash);
    }

    if (displayName !== undefined) {
      updates.push("display_name = ?");
      values.push(normalizeText(displayName));
    }

    if (role !== undefined) {
      updates.push("role = ?");
      values.push(normalizeStaffRole(role));
    }

    if (lineUserId !== undefined) {
      updates.push("line_user_id = ?");
      values.push(lineUserId || null);
    }

    if (isActive !== undefined) {
      updates.push("is_active = ?");
      values.push(Number(nextIsActive));
    }

    const membershipUpdates = [];
    const membershipValues = [];
    if (storeRole !== undefined && currentStoreRole !== "owner") {
      membershipUpdates.push("role = ?");
      membershipValues.push(normalizeManagedStoreRole(storeRole));
    }
    if (isActive !== undefined) {
      membershipUpdates.push("status = ?");
      membershipValues.push(nextIsActive ? "active" : "disabled");
    }

    if (updates.length === 0 && membershipUpdates.length === 0) {
      await connection.rollback();
      return res.status(400).json({ message: "沒有提供可更新欄位" });
    }

    if (updates.length) {
      values.push(id, storeId);
      await connection.query(
        `UPDATE staff_users SET ${updates.join(", ")} WHERE id = ? AND (store_id = ? OR store_id IS NULL)`,
        values
      );
    }

    if (membershipUpdates.length) {
      membershipValues.push(storeId, id);
      await connection.query(
        `
          UPDATE store_memberships
          SET ${membershipUpdates.join(", ")}
          WHERE store_id = ?
            AND staff_user_id = ?
        `,
        membershipValues
      );
    }

    const row = await findStoreStaff(connection, storeId, id);
    await connection.commit();

    return res.json(mapStaffRow(row));
  } catch (error) {
    try {
      await connection.rollback();
    } catch (_) {}
    if (error.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "帳號已存在";
    }
    return next(error);
  } finally {
    connection.release();
  }
});

module.exports = router;
