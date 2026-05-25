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


function isMissingStoreMembershipsTableError(error) {
  return (
    error?.code === "ER_NO_SUCH_TABLE" &&
    (String(error?.sqlMessage || "").includes("store_memberships") ||
      String(error?.message || "").includes("store_memberships"))
  );
}

async function loadActiveStoreMemberships(staffUserId) {
  try {
    const [rows] = await pool.query(
      `
        SELECT
          sm.store_id,
          sm.role AS store_role,
          sm.is_default
        FROM store_memberships sm
        JOIN stores s ON s.id = sm.store_id
        WHERE sm.staff_user_id = ?
          AND sm.status = 'active'
          AND s.status = 'active'
        ORDER BY sm.is_default DESC, sm.store_id ASC
      `,
      [staffUserId]
    );

    return rows;
  } catch (error) {
    if (isMissingStoreMembershipsTableError(error)) {
      return [];
    }
    throw error;
  }
}

function selectStoreContext(user, memberships) {
  if (memberships.length === 1) {
    return {
      storeId: memberships[0].store_id,
      storeRole: memberships[0].store_role
    };
  }

  const defaultMemberships = memberships.filter((membership) => Number(membership.is_default) === 1);
  if (defaultMemberships.length === 1) {
    return {
      storeId: defaultMemberships[0].store_id,
      storeRole: defaultMemberships[0].store_role
    };
  }

  const legacyStoreId = user.store_id ?? null;
  if (legacyStoreId !== null && memberships.length > 0) {
    const matchingMembership = memberships.find((membership) => String(membership.store_id) === String(legacyStoreId));
    if (matchingMembership) {
      return {
        storeId: matchingMembership.store_id,
        storeRole: matchingMembership.store_role
      };
    }
  }

  return {
    storeId: legacyStoreId,
    storeRole: null
  };
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

    const memberships = await loadActiveStoreMemberships(user.id);
    const storeContext = selectStoreContext(user, memberships);
    const permissions = getUserPermissions(user);
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.display_name,
        storeId: storeContext.storeId,
        storeRole: storeContext.storeRole,
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
        storeId: storeContext.storeId,
        storeRole: storeContext.storeRole,
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
