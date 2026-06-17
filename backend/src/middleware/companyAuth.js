const { pool } = require("../db");

const COMPANY_ROLES = new Set(["company_owner", "hq_admin", "finance", "inventory_manager", "viewer"]);

function normalizeCompanyRole(role) {
  return String(role || "").trim();
}

async function loadCompanyMembership(staffUserId, companyId) {
  if (!staffUserId || !companyId) {
    return null;
  }

  const [rows] = await pool.query(
    `
      SELECT id, company_id AS companyId, staff_user_id AS staffUserId, role, status
      FROM company_memberships
      WHERE staff_user_id = ?
        AND company_id = ?
        AND status = 'ACTIVE'
      LIMIT 1
    `,
    [staffUserId, companyId]
  );

  return rows[0] || null;
}

function requireCompanyRole(allowedRoles = []) {
  const allowed = (Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles])
    .map(normalizeCompanyRole)
    .filter((role) => COMPANY_ROLES.has(role));

  return async (req, res, next) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const companyId = Number(req.params.companyId || req.params.id || req.body?.companyId || 0);
      if (!companyId) {
        return res.status(400).json({ message: "請提供有效公司" });
      }

      const membership = await loadCompanyMembership(req.user.id, companyId);
      if (!membership) {
        return res.status(403).json({ message: "沒有總部管理權限" });
      }

      if (allowed.length && !allowed.includes(membership.role)) {
        return res.status(403).json({ message: "總部管理權限不足" });
      }

      req.companyId = companyId;
      req.companyRole = membership.role;
      req.companyMembership = membership;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  COMPANY_ROLES,
  loadCompanyMembership,
  requireCompanyRole
};
