const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");

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

    const passwordHash = await bcrypt.hash(password, 10);
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

module.exports = router;
