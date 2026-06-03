const express = require("express");
const { pool } = require("../db");
const {
  SOURCE,
  createPublicStoreContextMiddleware
} = require("../utils/publicStoreResolver");

const router = express.Router();

const resolveStorefrontContext = createPublicStoreContextMiddleware({
  db: pool,
  allowQueryStoreCode: true,
  allowQuerySlug: true,
  legacyFallbackMode: null,
  logResolved: false
});

async function loadResolvedStoreSnapshot(storeId) {
  const [rows] = await pool.query(
    `
      SELECT
        s.id AS storeId,
        s.code AS storeCode,
        s.name AS storeName,
        s.slug,
        s.status AS storeStatus,
        sls.line_enabled AS lineEnabled,
        sls.channel_id AS channelId,
        sls.liff_url AS liffUrl,
        sls.login_auth_url AS loginAuthUrl,
        sls.webhook_path AS webhookPath,
        sls.customer_oa_name AS customerOaName,
        sls.staff_group_enabled AS staffGroupEnabled,
        sls.updated_at AS lineSettingsUpdatedAt
      FROM stores s
      LEFT JOIN store_line_settings sls ON sls.store_id = s.id
      WHERE s.id = ?
        AND s.status = 'active'
      LIMIT 1
    `,
    [storeId]
  );

  return rows[0] || null;
}

router.get("/resolve-store", resolveStorefrontContext, async (req, res, next) => {
  try {
    const context = req.publicStoreContext;
    if (!context?.storeId) {
      return res.status(404).json({
        ok: false,
        message: "找不到有效的門市代碼",
        resolver: {
          source: context?.source || SOURCE.UNRESOLVED,
          sourceResolved: Boolean(context?.sourceResolved),
          confidence: context?.confidence || "none"
        }
      });
    }

    const store = await loadResolvedStoreSnapshot(context.storeId);
    if (!store) {
      return res.status(404).json({
        ok: false,
        message: "找不到有效的門市資料",
        resolver: {
          source: context?.source || SOURCE.UNRESOLVED,
          sourceResolved: Boolean(context?.sourceResolved),
          confidence: context?.confidence || "none"
        }
      });
    }

    return res.json({
      ok: true,
      store: {
        storeId: store.storeId,
        storeCode: store.storeCode,
        storeName: store.storeName,
        slug: store.slug || null,
        status: store.storeStatus
      },
      resolver: {
        source: context.source,
        sourceResolved: Boolean(context.sourceResolved),
        confidence: context.confidence,
        trustedStoreId: context.storeId,
        trustedStoreCode: store.storeCode,
        queryStoreHint: String(req.query?.store || req.query?.storeCode || req.query?.store_code || ""),
        querySlugHint: String(req.query?.slug || req.query?.storeSlug || ""),
        tokenVerificationPending: true,
        liffVerificationPending: true
      },
      lineSettings: {
        lineEnabled: Boolean(store.lineEnabled),
        channelIdPresent: Boolean(store.channelId),
        liffUrlConfigured: Boolean(store.liffUrl),
        loginAuthUrlConfigured: Boolean(store.loginAuthUrl),
        webhookConfigured: Boolean(store.webhookPath),
        customerOaNameConfigured: Boolean(store.customerOaName),
        staffGroupEnabled: Boolean(store.staffGroupEnabled),
        updatedAt: store.lineSettingsUpdatedAt || null
      }
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
