const express = require("express");
const { pool } = require("../db");
const { authenticate, requireStoreScope } = require("../middleware/auth");
const {
  MENU_CATALOG,
  isOwnerStoreRole,
  resolveMenuPermissions
} = require("../services/menuPermissionService");

const router = express.Router();

router.use(authenticate, requireStoreScope());

router.get("/menu", async (req, res, next) => {
  try {
    const storeId = Number(req.storeId || req.user?.storeId || 0);
    const staffUserId = Number(req.user?.id || 0);
    const staffRole = String(req.user?.role || "").trim().toUpperCase();
    const storeRole = String(req.storeRole || req.user?.storeRole || "").trim().toLowerCase();
    const permissions = await resolveMenuPermissions(pool, {
      storeId,
      staffUserId,
      staffRole,
      storeRole
    });

    return res.json({
      storeId,
      storeRole,
      staffRole,
      isOwner: isOwnerStoreRole(storeRole),
      catalog: MENU_CATALOG,
      menus: permissions
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
