const jwt = require("jsonwebtoken");
const config = require("../config");
const { pool } = require("../db");

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

async function authenticatePlatformAdmin(req, res, next) {
  const token = getBearerToken(req);

  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (decoded?.type !== "platform_admin" || decoded?.scope !== "platform_admin") {
      return res.status(403).json({ message: "Insufficient platform role" });
    }

    const [rows] = await pool.query(
      `
        SELECT id, email, display_name, role, is_active
        FROM platform_admin_users
        WHERE id = ? OR email = ?
        LIMIT 1
      `,
      [decoded.id || 0, decoded.email || ""]
    );

    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    req.platformAdmin = {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: String(user.role || "").toUpperCase().trim()
    };
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Unauthorized" });
  }
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

module.exports = {
  authenticatePlatformAdmin,
  requirePlatformRole
};
