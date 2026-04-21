const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { pool } = require("./db");

async function ensureDefaultAdmin() {
  const username = process.env.DEFAULT_ADMIN_USERNAME || "admin";
  const password = process.env.DEFAULT_ADMIN_PASSWORD || "admin123";
  const displayName = process.env.DEFAULT_ADMIN_DISPLAY_NAME || "System Admin";

  const [rows] = await pool.query(
    `
      SELECT id
      FROM staff_users
      WHERE username = ?
      LIMIT 1
    `,
    [username]
  );

  if (rows[0]) {
    return false;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `
      INSERT INTO staff_users (username, password_hash, display_name, role)
      VALUES (?, ?, ?, 'ADMIN')
    `,
    [username, passwordHash, displayName]
  );

  return true;
}

function ensureStorageDirectories() {
  fs.mkdirSync(path.join(__dirname, "..", "storage", "pdfs"), { recursive: true });
}

module.exports = {
  ensureDefaultAdmin,
  ensureStorageDirectories
};
