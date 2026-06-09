const jwt = require("jsonwebtoken");
const config = require("../config");

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

function authenticate(req, res, next) {
  const token = getBearerToken(req);

  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (decoded?.type === "platform_admin") {
      return res.status(401).json({ message: "Unauthorized" });
    }

    req.user = decoded;
    req.user.role = String(req.user.role || "").toUpperCase().trim();
    req.storeId = req.user.storeId ?? null;
    req.store_id = req.storeId;
    req.storeRole = req.user.storeRole ?? null;
    req.store_role = req.storeRole;
    return next();
  } catch (err) {
    return res.status(401).json({ message: "Unauthorized" });
  }
}

function authenticatePlatformAdmin(req, res, next) {
  const token = getBearerToken(req);

  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (decoded?.type !== "platform_admin" || decoded?.scope !== "platform_admin") {
      return res.status(401).json({ message: "Unauthorized" });
    }

    req.platformAdmin = {
      id: decoded.id,
      email: decoded.email,
      displayName: decoded.displayName,
      role: String(decoded.role || "").toUpperCase().trim()
    };
    return next();
  } catch (err) {
    return res.status(401).json({ message: "Unauthorized" });
  }
}

function normalizeRole(role) {
  return String(role || "").toUpperCase().trim();
}

function normalizeStoreRole(role) {
  return String(role || "").toLowerCase().trim();
}

function isMissingStoreMembershipsTableError(error) {
  return (
    error?.code === "ER_NO_SUCH_TABLE" &&
    (String(error?.sqlMessage || "").includes("store_memberships") ||
      String(error?.message || "").includes("store_memberships"))
  );
}

async function loadActiveStaffRole(staffUserId) {
  if (!staffUserId) {
    return "";
  }

  const { pool } = require("../db");
  const [rows] = await pool.query(
    "SELECT role FROM staff_users WHERE id = ? AND is_active = 1 LIMIT 1",
    [staffUserId]
  );

  return normalizeRole(rows[0]?.role);
}

async function loadActiveStoreRole(staffUserId, storeId) {
  if (!staffUserId || !storeId) {
    return "";
  }

  try {
    const { pool } = require("../db");
    const [rows] = await pool.query(
      `
        SELECT role
        FROM store_memberships
        WHERE staff_user_id = ?
          AND store_id = ?
          AND status = 'active'
        LIMIT 1
      `,
      [staffUserId, storeId]
    );

    return normalizeStoreRole(rows[0]?.role);
  } catch (error) {
    if (isMissingStoreMembershipsTableError(error)) {
      return "";
    }
    throw error;
  }
}

function authorize(roles = []) {
  const normalizedAllowedRoles = (Array.isArray(roles) ? roles : [roles])
    .filter(Boolean)
    .map(normalizeRole);

  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });

    if (!normalizedAllowedRoles.length) {
      return next();
    }

    let userRole = normalizeRole(req.user.role);
    if (normalizedAllowedRoles.includes(userRole)) {
      return next();
    }

    if (req.user.id) {
      try {
        userRole = await loadActiveStaffRole(req.user.id);
        if (userRole) {
          req.user.role = userRole;
        }
      } catch (error) {
        return next(error);
      }
    }

    if (!normalizedAllowedRoles.includes(userRole)) {
      return res.status(403).json({ message: "Insufficient role" });
    }

    return next();
  };
}

function requirePlatformRole(allowedRoles) {
  const normalizedAllowedRoles = (Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles])
    .filter(Boolean)
    .map((role) => String(role).toUpperCase().trim());

  return (req, res, next) => {
    if (!req.platformAdmin) return res.status(401).json({ message: "Unauthorized" });

    if (normalizedAllowedRoles.length && !normalizedAllowedRoles.includes(req.platformAdmin.role)) {
      return res.status(403).json({ message: "Insufficient platform role" });
    }

    return next();
  };
}

function requireStoreScope() {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });

    const storeId = req.storeId ?? req.user.storeId ?? null;
    if (!storeId) {
      return res.status(403).json({ message: "Store scope required" });
    }

    req.storeId = storeId;
    req.store_id = storeId;
    req.storeRole = req.user.storeRole ?? null;
    req.store_role = req.storeRole;
    return next();
  };
}

function requireStoreRole(allowedRoles) {
  const normalizedAllowedRoles = (Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles])
    .filter(Boolean)
    .map(normalizeStoreRole);

  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });

    let storeRole = normalizeStoreRole(req.storeRole ?? req.user.storeRole);
    if (!storeRole) {
      try {
        storeRole = await loadActiveStoreRole(req.user.id, req.storeId ?? req.user.storeId);
      } catch (error) {
        return next(error);
      }
    }

    if (storeRole) {
      if (!normalizedAllowedRoles.includes(storeRole)) {
        return res.status(403).json({ message: "Insufficient store role" });
      }

      req.storeRole = storeRole;
      req.store_role = storeRole;
      if (req.user) {
        req.user.storeRole = storeRole;
      }
      return next();
    }

    const allowsStoreAdmin = normalizedAllowedRoles.includes("owner") || normalizedAllowedRoles.includes("admin");
    let legacyRole = normalizeRole(req.user.role);
    if (!legacyRole && req.user.id) {
      try {
        legacyRole = await loadActiveStaffRole(req.user.id);
      } catch (error) {
        return next(error);
      }
    }

    if (allowsStoreAdmin && ["ADMIN", "MANAGER"].includes(legacyRole)) {
      return next();
    }

    return res.status(403).json({ message: "Store role required" });
  };
}

module.exports = {
  authenticate,
  authenticatePlatformAdmin,
  authorize,
  requirePlatformRole,
  requireStoreScope,
  requireStoreRole
};
