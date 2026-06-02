const express = require("express");
const fs = require("fs");
const path = require("path");
const { authenticate, requireStoreScope } = require("../middleware/auth");
const {
  getStoreProfileSettings,
  normalizeStoreProfilePayload,
  saveStoreProfileSettings
} = require("../services/storeProfileSettingsService");

const router = express.Router();
const storeLogoRootDir = path.join(__dirname, "..", "..", "storage", "store-logos");
const allowedLogoTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/svg+xml", ".svg"]
]);

function requireStoreProfileWriteRole(req, res, next) {
  const role = String(req.user?.role || "").toUpperCase().trim();
  if (!["ADMIN", "MANAGER"].includes(role)) {
    return res.status(403).json({ message: "Insufficient store role" });
  }
  return next();
}

router.use(authenticate, requireStoreScope());

router.get("/settings", async (req, res, next) => {
  try {
    const store = await getStoreProfileSettings(req.storeId);
    return res.json({ store });
  } catch (error) {
    return next(error);
  }
});

router.patch("/settings", requireStoreProfileWriteRole, async (req, res, next) => {
  try {
    const store = await saveStoreProfileSettings(req.storeId, req.body || {}, req.user?.id || null);
    return res.json({ store });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/settings/logo",
  requireStoreProfileWriteRole,
  express.raw({ type: Array.from(allowedLogoTypes.keys()), limit: "4mb" }),
  async (req, res, next) => {
    try {
      const contentType = String(req.headers["content-type"] || "").split(";")[0].toLowerCase();
      const extension = allowedLogoTypes.get(contentType);

      if (!extension || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ message: "請上傳 JPG、PNG、WEBP、GIF 或 SVG 格式的 Logo" });
      }

      const storeId = Number(req.storeId);
      if (!Number.isFinite(storeId) || storeId <= 0) {
        return res.status(400).json({ message: "門市識別失敗，無法上傳 Logo" });
      }

      const originalName = String(req.headers["x-file-name"] || "store-logo")
        .normalize("NFKD")
        .replace(/[^\w.-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      const safeName = originalName || "store-logo";
      const safeBaseName = safeName.toLowerCase().endsWith(extension)
        ? safeName.slice(0, -extension.length)
        : safeName;

      const storeDir = path.join(storeLogoRootDir, `store-${storeId}`);
      await fs.promises.mkdir(storeDir, { recursive: true });

      const existingFiles = await fs.promises.readdir(storeDir, { withFileTypes: true }).catch(() => []);
      for (const entry of existingFiles) {
        if (!entry.isFile()) {
          continue;
        }

        if (!entry.name.startsWith("logo-")) {
          continue;
        }

        await fs.promises.unlink(path.join(storeDir, entry.name)).catch(() => null);
      }

      const fileName = `logo-${Date.now()}-${safeBaseName}${extension}`;
      const filePath = path.join(storeDir, fileName);
      await fs.promises.writeFile(filePath, req.body);

      const logoUrl = `/files/store-logos/store-${storeId}/${fileName}`;
      const current = await getStoreProfileSettings(storeId);
      const store = await saveStoreProfileSettings(
        storeId,
        normalizeStoreProfilePayload({
          ...current,
          logoUrl
        }),
        req.user?.id || null
      );

      return res.status(201).json({
        message: "門市 Logo 已上傳",
        logoUrl,
        store
      });
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;
