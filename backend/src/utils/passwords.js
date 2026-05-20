const bcrypt = require("bcryptjs");

const BCRYPT_PREFIX = "$2";
const BCRYPT_ROUNDS = 10;

function isBcryptHash(value) {
  return typeof value === "string" && value.startsWith(BCRYPT_PREFIX);
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(password, storedPassword) {
  if (!storedPassword) {
    return { isMatch: false, needsRehash: false };
  }

  if (!isBcryptHash(storedPassword)) {
    const isMatch = password === storedPassword;
    return { isMatch, needsRehash: isMatch };
  }

  return {
    isMatch: await bcrypt.compare(password, storedPassword),
    needsRehash: false
  };
}

module.exports = {
  hashPassword,
  isBcryptHash,
  verifyPassword
};

