const dotenv = require("dotenv");

dotenv.config();

function requireEnv(name, fallback) {
  const value = process.env[name] || fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  jwtSecret: requireEnv("JWT_SECRET", "change-me-in-production"),
  frontendBaseUrl: process.env.FRONTEND_BASE_URL || "http://localhost:5173",
  mysql: {
    host: requireEnv("MYSQL_HOST", "mysql"),
    port: Number(process.env.MYSQL_PORT || 3306),
    user: requireEnv("MYSQL_USER", "kingway"),
    password: requireEnv("MYSQL_PASSWORD", "kingway"),
    database: requireEnv("MYSQL_DATABASE", "kingway_store")
  },
  line: {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
    channelSecret: process.env.LINE_CHANNEL_SECRET || ""
  }
};
