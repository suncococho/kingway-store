const express = require("express");
const { pool } = require("../db");
const {
  SOURCE,
  createPublicStoreContextMiddleware
} = require("../utils/publicStoreResolver");

const router = express.Router();
const columnExistsCache = new Map();

const resolveStorefrontContext = createPublicStoreContextMiddleware({
  db: pool,
  allowQueryStoreCode: true,
  allowQuerySlug: true,
  legacyFallbackMode: null,
  logResolved: false
});

async function columnExists(tableName, columnName) {
  const cacheKey = `${tableName}.${columnName}`;
  if (columnExistsCache.has(cacheKey)) {
    return columnExistsCache.get(cacheKey);
  }

  const [rows] = await pool.query(
    `
      SELECT COUNT(*) AS columnCount
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
    `,
    [tableName, columnName]
  );
  const exists = Number(rows[0]?.columnCount || 0) > 0;
  columnExistsCache.set(cacheKey, exists);
  return exists;
}

async function loadResolvedStoreSnapshot(storeId) {
  const hasStoreSlug = await columnExists("stores", "slug");
  const slugSelect = hasStoreSlug ? "s.slug AS slug," : "NULL AS slug,";
  const [rows] = await pool.query(
    `
      SELECT
        s.id AS storeId,
        s.code AS storeCode,
        s.name AS storeName,
        ${slugSelect}
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

async function loadStoreLineContext(storeId) {
  const [rows] = await pool.query(
    `
      SELECT
        s.id AS storeId,
        s.code AS storeCode,
        s.name AS storeName,
        slc.id AS lineChannelDbId,
        slc.line_official_account_name AS lineOfficialAccountName,
        slc.line_basic_id AS lineBasicId,
        slc.liff_id AS liffId,
        slc.enabled AS lineEnabled
      FROM stores s
      LEFT JOIN store_line_channels slc
        ON slc.store_id = s.id
       AND slc.enabled = 1
      WHERE s.id = ?
        AND s.status = 'active'
      ORDER BY slc.is_primary DESC, slc.updated_at DESC, slc.id DESC
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

router.get("/line-context", resolveStorefrontContext, async (req, res, next) => {
  try {
    const context = req.publicStoreContext;
    if (!context?.storeId) {
      return res.status(404).json({
        ok: false,
        message: "找不到有效的門市代碼",
        hasLineChannel: false,
        liffId: null
      });
    }

    const row = await loadStoreLineContext(context.storeId);
    if (!row) {
      return res.status(404).json({
        ok: false,
        message: "找不到有效的門市資料",
        hasLineChannel: false,
        liffId: null
      });
    }

    return res.json({
      ok: true,
      storeId: row.storeId,
      storeCode: row.storeCode,
      storeName: row.storeName,
      liffId: row.liffId || null,
      lineOfficialAccountName: row.lineOfficialAccountName || null,
      lineBasicId: row.lineBasicId || null,
      lineEnabled: Boolean(row.lineEnabled),
      hasLineChannel: Boolean(row.lineChannelDbId)
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
