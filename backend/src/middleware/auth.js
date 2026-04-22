const jwt = require("jsonwebtoken");
const config = require("../config");

function normalizeRole(role) {
  return String(role || "").trim().toUpperCase();
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Missing bearer token" });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = {
      ...decoded,
      role: normalizeRole(decoded.role)
    };
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

function authorize(roles) {
  const allowedRoles = (Array.isArray(roles) ? roles : [roles]).map(normalizeRole);

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthenticated" });
    }

    if (!allowedRoles.includes(normalizeRole(req.user.role))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    return next();
  };
}

module.exports = {
  authenticate,
  authorize
};
