const jwt = require("jsonwebtoken");
const config = require("../config");

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    req.user = jwt.verify(token, config.jwtSecret);
    req.user.role = String(req.user.role || "").toUpperCase().trim();
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

module.exports = { authenticate, authorize };
