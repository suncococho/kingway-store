const jwt = require("jsonwebtoken");
const config = require("../config");

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    req.user = jwt.verify(token, config.jwtSecret);
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

function authorize() {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
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

module.exports = { authenticate, authorize, requireStoreScope };
