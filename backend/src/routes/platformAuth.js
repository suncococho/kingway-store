const express = require("express");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const config = require("../config");
const { hashPassword, verifyPassword } = require("../utils/passwords");

const router = express.Router();

router.post("/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const [rows] = await pool.query(
      `
        SELECT id, email, password_hash, display_name, role, is_active
        FROM platform_admin_users
        WHERE email = ?
        LIMIT 1
      `,
      [email]
    );

    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { isMatch, needsRehash } = await verifyPassword(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (needsRehash) {
      const passwordHash = await hashPassword(password);
      await pool.query("UPDATE platform_admin_users SET password_hash = ? WHERE id = ?", [passwordHash, user.id]);
    }

    const token = jwt.sign(
      {
        type: "platform_admin",
        scope: "platform_admin",
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role
      },
      config.jwtSecret,
      { expiresIn: "12h" }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role
      }
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
