const express = require("express");
const { pool, withTransaction } = require("../db");
const {
  authenticate,
  authorize,
  requireStoreScope
} = require("../middleware/auth");
const {
  normalizeMonth,
  assertIncentiveTablesReady,
  getSelfDashboard,
  getPlanForStaff,
  getAdminOverview,
  loadIncentiveEvents,
  listAdminAgreements,
  createDispute,
  listAdminDisputes,
  updateAdminDispute,
  listAdminAdjustments,
  listAdminPayouts
} = require("../services/staffIncentiveDashboardService");

const router = express.Router();
const ALL_STAFF_ROLES = [
  "ADMIN",
  "MANAGER",
  "CASHIER",
  "REPAIR",
  "INVENTORY",
  "STAFF"
];

router.use(
  authenticate,
  requireStoreScope(),
  authorize(ALL_STAFF_ROLES)
);

function requestStoreId(req) {
  return Number(req.storeId || req.user?.storeId || req.user?.store_id || 0);
}

function requestStaffId(req) {
  return Number(req.user?.id || 0);
}

router.get("/me", async (req, res, next) => {
  try {
    return res.json(
      await getSelfDashboard(pool, {
        storeId: requestStoreId(req),
        staffUserId: requestStaffId(req),
        month: normalizeMonth(req.query.month)
      })
    );
  } catch (error) {
    return next(error);
  }
});

router.get("/plan", async (req, res, next) => {
  try {
    return res.json(
      await getPlanForStaff(pool, {
        storeId: requestStoreId(req),
        staffUserId: requestStaffId(req),
        month: normalizeMonth(req.query.month)
      })
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/events/:eventId/disputes", async (req, res, next) => {
  try {
    const dispute = await withTransaction((connection) =>
      createDispute(connection, {
        storeId: requestStoreId(req),
        staffUserId: requestStaffId(req),
        eventId: req.params.eventId,
        reason: req.body?.reason
      })
    );
    return res.status(201).json({ dispute });
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/admin/overview",
  authorize(["ADMIN"]),
  async (req, res, next) => {
    try {
      return res.json(
        await getAdminOverview(pool, {
          storeId: requestStoreId(req),
          month: normalizeMonth(req.query.month)
        })
      );
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/admin/events",
  authorize(["ADMIN"]),
  async (req, res, next) => {
    try {
      await assertIncentiveTablesReady(pool);
      return res.json({
        month: normalizeMonth(req.query.month),
        events: await loadIncentiveEvents(pool, {
          storeId: requestStoreId(req),
          month: normalizeMonth(req.query.month),
          staffUserId: req.query.staffUserId || null,
          status: req.query.status || null,
          type: req.query.type || null,
          limit: 500
        })
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/admin/agreements",
  authorize(["ADMIN"]),
  async (req, res, next) => {
    try {
      return res.json({
        agreements: await listAdminAgreements(pool, {
          storeId: requestStoreId(req)
        })
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/admin/disputes",
  authorize(["ADMIN"]),
  async (req, res, next) => {
    try {
      return res.json({
        disputes: await listAdminDisputes(pool, {
          storeId: requestStoreId(req),
          status: req.query.status || null
        })
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/admin/disputes/:id",
  authorize(["ADMIN"]),
  async (req, res, next) => {
    try {
      const dispute = await withTransaction((connection) =>
        updateAdminDispute(connection, {
          storeId: requestStoreId(req),
          disputeId: req.params.id,
          adminStaffUserId: requestStaffId(req),
          status: req.body?.status,
          adminResponse: req.body?.adminResponse
        })
      );
      return res.json({ dispute });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/admin/adjustments",
  authorize(["ADMIN"]),
  async (req, res, next) => {
    try {
      return res.json({
        adjustments: await listAdminAdjustments(pool, {
          storeId: requestStoreId(req)
        })
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/admin/payouts",
  authorize(["ADMIN"]),
  async (req, res, next) => {
    try {
      return res.json({
        month: normalizeMonth(req.query.month),
        payouts: await listAdminPayouts(pool, {
          storeId: requestStoreId(req),
          month: normalizeMonth(req.query.month)
        })
      });
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;
