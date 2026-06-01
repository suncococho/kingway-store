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

function authorize() {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
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
    .map((role) => String(role).toLowerCase().trim());

  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });

    const storeRole = String(req.storeRole ?? req.user.storeRole ?? "").toLowerCase().trim();
    if (!storeRole) {
      return res.status(403).json({ message: "Store role required" });
    }

    if (!normalizedAllowedRoles.includes(storeRole)) {
      return res.status(403).json({ message: "Insufficient store role" });
    }

    req.storeRole = storeRole;
    req.store_role = storeRole;
    return next();
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
