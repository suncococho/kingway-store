const express = require("express");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const config = require("../config");
const { authenticate } = require("../middleware/auth");
const { hashPassword, verifyPassword } = require("../utils/passwords");

const router = express.Router();
const STAFF_LIMITED_PERMISSIONS = ["POS", "PRODUCTS", "REPAIRS", "INVENTORY"];

function getUserPermissions(user) {
  if (user?.username === "staff" && user?.role === "CASHIER") {
    return STAFF_LIMITED_PERMISSIONS;
  }

  return [];
}

router.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "username and password are required" });
    }

    const [rows] = await pool.query(
      `
        SELECT id, username, password_hash, role, display_name, is_active, store_id
        FROM staff_users
        WHERE username = ?
        LIMIT 1
      `,
      [username]
    );

    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const { isMatch, needsRehash } = await verifyPassword(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (needsRehash) {
      const passwordHash = await hashPassword(password);
      await pool.query("UPDATE staff_users SET password_hash = ? WHERE id = ?", [passwordHash, user.id]);
    }

    const permissions = getUserPermissions(user);
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.display_name,
        storeId: user.store_id,
        permissions
      },
      config.jwtSecret,
      { expiresIn: "12h" }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.display_name,
        storeId: user.store_id,
        permissions
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", authenticate, async (req, res) => {
  return res.json({ user: req.user });
});

module.exports = router;
