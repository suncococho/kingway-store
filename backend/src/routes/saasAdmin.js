const express = require("express");
const { pool } = require("../db");

const router = express.Router();

const DEFAULT_STORE_FEATURES = [
  {
    key: "pos_enabled",
    label: "POS",
    enabled: true,
    description: "門市結帳、新訂單建立與購物車流程。"
  },
  {
    key: "orders_enabled",
    label: "訂單管理",
    enabled: true,
    description: "一般訂單、預約單、訂金與尾款狀態管理。"
  },
  {
    key: "repairs_enabled",
    label: "維修管理",
    enabled: true,
    description: "維修預約、報價、完修、取車與問卷流程。"
  },
  {
    key: "inventory_enabled",
    label: "庫存管理",
    enabled: true,
    description: "商品庫存、庫位、警戒值與庫存異動。"
  },
  {
    key: "suppliers_enabled",
    label: "發注 / 退貨",
    enabled: true,
    description: "供應商發注、入庫、退貨與月結追蹤。"
  },
  {
    key: "coupons_enabled",
    label: "優惠券",
    enabled: true,
    description: "新好友優惠券與 Google 評論優惠券管理。"
  },
  {
    key: "purchase_confirmations_enabled",
    label: "購買確認書",
    enabled: true,
    description: "EBIKE 購買確認、簽名、PDF 與交車前確認。"
  },
  {
    key: "line_enabled",
    label: "LINE",
    enabled: true,
    description: "客戶 LINE 流程、LINE 綁定與門市通知入口。"
  },
  {
    key: "telegram_enabled",
    label: "Telegram",
    enabled: true,
    description: "既有 Telegram 通知橋接狀態，占位供後續逐店設定。"
  },
  {
    key: "sales_dashboard_enabled",
    label: "銷售儀表板",
    enabled: true,
    description: "銷售摘要、營業重點與管理者儀表板。"
  },
  {
    key: "staff_management_enabled",
    label: "員工管理",
    enabled: true,
    description: "員工資料、出勤、KPI 與薪資摘要。"
  }
];

function n(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function t(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

router.get("/stores", async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        CAST(s.id AS UNSIGNED) AS id,
        s.code,
        s.status,
        s.plan,
        CAST((SELECT COUNT(*) FROM products p WHERE p.store_id = s.id) AS UNSIGNED) AS productCount,
        CAST((SELECT COUNT(*) FROM customers c WHERE c.store_id = s.id) AS UNSIGNED) AS customerCount,
        CAST((SELECT COUNT(*) FROM orders o WHERE o.store_id = s.id) AS UNSIGNED) AS orderCount,
        CAST((SELECT COUNT(*) FROM repair_orders r WHERE r.store_id = s.id) AS UNSIGNED) AS repairCount
      FROM stores s
      ORDER BY s.id ASC
    `);

    const stores = rows.map((row) => ({
      id: n(row.id),
      code: t(row.code, "UNKNOWN"),
      name: t(row.code, "UNKNOWN"),
      status: t(row.status, "unknown"),
      plan: t(row.plan, "unknown"),
      productCount: n(row.productCount),
      customerCount: n(row.customerCount),
      orderCount: n(row.orderCount),
      repairCount: n(row.repairCount)
    }));

    return res.json({
      ok: true,
      environment: t(process.env.APP_ENV || process.env.NODE_ENV, "unknown"),
      schemaGuard: {
        requireStoreIdSchema: String(process.env.REQUIRE_STORE_ID_SCHEMA || "").toLowerCase() === "true",
        status: String(process.env.REQUIRE_STORE_ID_SCHEMA || "").toLowerCase() === "true" ? "STRICT_ON" : "WARN_ONLY"
      },
      totalStores: stores.length,
      totals: stores.reduce((acc, store) => {
        acc.productCount += store.productCount;
        acc.customerCount += store.customerCount;
        acc.orderCount += store.orderCount;
        acc.repairCount += store.repairCount;
        return acc;
      }, { productCount: 0, customerCount: 0, orderCount: 0, repairCount: 0 }),
      stores
    });
  } catch (error) {
    console.error("[saasAdmin/stores] failed", error);
    return next(error);
  }
});

router.get("/stores/:id/features", async (req, res, next) => {
  try {
    const storeId = n(req.params.id);

    const [[storeRow]] = await pool.query(
      `
        SELECT
          CAST(id AS UNSIGNED) AS id,
          code,
          name,
          status,
          plan
        FROM stores
        WHERE id = ?
        LIMIT 1
      `,
      [storeId]
    );

    if (!storeRow) {
      return res.status(404).json({ message: "找不到店鋪" });
    }

    const store = {
      id: n(storeRow.id),
      code: t(storeRow.code, "UNKNOWN"),
      name: t(storeRow.name, t(storeRow.code, "UNKNOWN")),
      status: t(storeRow.status, "unknown"),
      plan: t(storeRow.plan, "unknown")
    };

    return res.json({
      ok: true,
      store,
      features: DEFAULT_STORE_FEATURES.map((feature) => ({
        key: feature.key,
        label: feature.label,
        enabled: store.code === "KINGWAY_TAINAN" ? true : Boolean(feature.enabled),
        description: feature.description
      }))
    });
  } catch (error) {
    console.error("[saasAdmin/store/features] failed", error);
    return next(error);
  }
});

module.exports = router;
