const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");
const { hashPassword } = require("../utils/passwords");

const router = express.Router();

router.use(authenticate, authorize("ADMIN"));

router.get("/", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT id, username, display_name AS displayName, line_user_id AS lineUserId, role, is_active AS isActive, created_at AS createdAt
        FROM staff_users
        ORDER BY id ASC
      `
    );

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { username, password, displayName, role, lineUserId } = req.body;

    if (!username || !password || !displayName || !role) {
      return res.status(400).json({ message: "username, password, displayName, and role are required" });
    }

    const passwordHash = await hashPassword(password);
    const [result] = await pool.query(
      `
        INSERT INTO staff_users (username, password_hash, display_name, role, line_user_id)
        VALUES (?, ?, ?, ?, ?)
      `,
      [username, passwordHash, displayName, role, lineUserId || null]
    );

    return res.status(201).json({
      id: result.insertId,
      username,
      displayName,
      role,
      lineUserId: lineUserId || null
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "username already exists";
    }
    return next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { username, password, displayName, role, lineUserId, isActive } = req.body;

    const updates = [];
    const values = [];

    if (username !== undefined) {
      updates.push("username = ?");
      values.push(username);
    }

    if (password) {
      const passwordHash = await hashPassword(password);
      updates.push("password_hash = ?");
      values.push(passwordHash);
    }

    if (displayName !== undefined) {
      updates.push("display_name = ?");
      values.push(displayName);
    }

    if (role !== undefined) {
      updates.push("role = ?");
      values.push(role);
    }

    if (lineUserId !== undefined) {
      updates.push("line_user_id = ?");
      values.push(lineUserId || null);
    }

    if (isActive !== undefined) {
      updates.push("is_active = ?");
      values.push(Number(Boolean(isActive)));
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: "沒有提供可更新欄位" });
    }

    values.push(id);
    await pool.query(`UPDATE staff_users SET ${updates.join(", ")} WHERE id = ?`, values);

    const [rows] = await pool.query(
      `
        SELECT id, username, display_name AS displayName, line_user_id AS lineUserId, role, is_active AS isActive, created_at AS createdAt
        FROM staff_users
        WHERE id = ?
      `,
      [id]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: "找不到員工" });
    }

    return res.json(rows[0]);
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "username already exists";
    }
    return next(error);
  }
});

module.exports = router;
