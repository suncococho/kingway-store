const express = require("express");
const { ProvisioningError, provisionStore } = require("../services/storeProvisioningService");

const router = express.Router();

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : value ? String(value).trim() : "";
}

function normalizeOwnerUsername(body) {
  return normalizeText(body.username || body.email).toLowerCase();
}

function normalizePhone(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function buildStoreCode() {
  const timestampPart = Date.now().toString(36).toUpperCase().slice(-6);
  const randomPart = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  return `KW${timestampPart}${randomPart}`;
}

function mapProvisioningErrorMessage(message) {
  const normalized = String(message || "");
  const messages = new Map([
    ["Invalid store code", "店家代碼建立失敗，請再試一次"],
    ["Store code already exists", "店家代碼已存在，請再試一次"],
    ["Store slug already exists", "店家網址代碼已存在，請再試一次"],
    ["Store name is required", "請輸入店家名稱"],
    ["Store name is too long", "店家名稱過長"],
    ["Invalid owner username", "登入帳號需為 3-100 字元，可使用 Email、英數、底線、句點或連字號"],
    ["Owner username already exists", "此登入帳號或 Email 已被使用"],
    ["Owner name is too long", "負責人姓名過長"],
    ["Invalid owner role", "帳號角色設定失敗"],
    ["Owner password must be at least 8 characters", "密碼至少需要 8 個字元"]
  ]);
  return messages.get(normalized) || "店家帳號建立失敗，請稍後再試";
}

function validateSignupPayload(body) {
  const storeName = normalizeText(body.storeName);
  const ownerName = normalizeText(body.ownerName);
  const phone = normalizePhone(body.phone);
  const username = normalizeOwnerUsername(body);
  const password = typeof body.password === "string" ? body.password : "";

  if (!storeName) {
    return { error: "請輸入店家名稱" };
  }
  if (!ownerName) {
    return { error: "請輸入負責人姓名" };
  }
  if (!phone) {
    return { error: "請輸入電話" };
  }
  if (!username) {
    return { error: "請輸入登入帳號或 Email" };
  }
  if (password.length < 8) {
    return { error: "密碼至少需要 8 個字元" };
  }

  return { storeName, ownerName, phone, username, password };
}

async function createStoreSignup(req, res, next) {
  try {
    const payload = validateSignupPayload(req.body || {});
    if (payload.error) {
      return res.status(400).json({ message: payload.error });
    }

    let lastConflict = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const result = await provisionStore({
          code: buildStoreCode(),
          name: payload.storeName,
          ownerName: payload.ownerName,
          ownerUsername: payload.username,
          ownerPassword: payload.password,
          ownerRole: "ADMIN",
          plan: "trial",
          profileSettings: {
            displayName: payload.storeName,
            phone: payload.phone
          }
        });

        return res.status(201).json({
          ok: true,
          storeId: result.store.id,
          username: result.owner.username,
          message: "店家帳號已建立，請使用新帳號登入"
        });
      } catch (error) {
        if (
          error instanceof ProvisioningError &&
          error.status === 409 &&
          String(error.message || "") === "Store code already exists"
        ) {
          lastConflict = error;
          continue;
        }
        throw error;
      }
    }

    throw lastConflict || new ProvisioningError(409, "Store code already exists");
  } catch (error) {
    if (error instanceof ProvisioningError) {
      return res.status(error.status).json({ message: mapProvisioningErrorMessage(error.message) });
    }
    return next(error);
  }
}

router.post("/store-signup", createStoreSignup);
router.post("/public/store-signup", createStoreSignup);

module.exports = router;
