const express = require("express");
const { pool } = require("../db");
const { authenticate } = require("../middleware/auth");
const { requireCompanyRole } = require("../middleware/companyAuth");

const router = express.Router();

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCompany(row) {
  return {
    id: toNumber(row.id),
    code: row.code || "",
    name: row.name || "",
    status: row.status || "ACTIVE",
    note: row.note || "",
    role: row.role || null
  };
}

async function loadCompanyStores(companyId) {
  const [rows] = await pool.query(
    `
      SELECT
        cs.id,
        cs.company_id AS companyId,
        cs.store_id AS storeId,
        cs.relationship_type AS relationshipType,
        cs.status,
        s.code AS storeCode,
        s.name AS storeName,
        s.status AS storeStatus,
        s.plan AS storePlan
      FROM company_stores cs
      INNER JOIN stores s ON s.id = cs.store_id
      WHERE cs.company_id = ?
        AND cs.status = 'ACTIVE'
      ORDER BY FIELD(cs.relationship_type, 'HEADQUARTERS', 'WAREHOUSE', 'DIRECT_STORE', 'FRANCHISE_STORE'), s.id ASC
    `,
    [companyId]
  );
  return rows.map((row) => ({
    id: toNumber(row.id),
    companyId: toNumber(row.companyId),
    storeId: toNumber(row.storeId),
    relationshipType: row.relationshipType,
    status: row.status,
    storeCode: row.storeCode || "",
    storeName: row.storeName || "",
    storeStatus: row.storeStatus || "",
    storePlan: row.storePlan || ""
  }));
}

router.use(authenticate);

router.get("/me", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT
          c.id,
          c.code,
          c.name,
          c.status,
          c.note,
          cm.role
        FROM company_memberships cm
        INNER JOIN companies c ON c.id = cm.company_id
        WHERE cm.staff_user_id = ?
          AND cm.status = 'ACTIVE'
          AND c.status = 'ACTIVE'
        ORDER BY c.name ASC
      `,
      [req.user.id]
    );

    const companies = [];
    for (const row of rows) {
      const company = normalizeCompany(row);
      company.stores = await loadCompanyStores(company.id);
      companies.push(company);
    }

    return res.json({
      ok: true,
      franchiseEnabled: companies.length > 0,
      companies
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:companyId/stores", requireCompanyRole(["company_owner", "hq_admin", "finance", "inventory_manager", "viewer"]), async (req, res, next) => {
  try {
    const companyId = Number(req.params.companyId);
    const [companyRows] = await pool.query(
      "SELECT id, code, name, status, note FROM companies WHERE id = ? AND status = 'ACTIVE' LIMIT 1",
      [companyId]
    );
    if (!companyRows[0]) {
      return res.status(404).json({ message: "找不到公司" });
    }

    return res.json({
      ok: true,
      company: normalizeCompany({ ...companyRows[0], role: req.companyRole }),
      stores: await loadCompanyStores(companyId)
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
