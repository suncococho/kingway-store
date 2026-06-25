const { pool } = require("../db");
const {
  dryRunStaffGroupNotification,
  dryRunSupplierGroupNotification
} = require("./lineGroupNotificationService");

const HQ_RELATIONSHIP_TYPES = new Set(["HEADQUARTERS", "WAREHOUSE"]);
const CHAIN_STORE_RELATIONSHIP_TYPES = new Set(["DIRECT_STORE", "FRANCHISE_STORE"]);
const MANAGER_ROLES = new Set(["ADMIN", "MANAGER"]);
const STORE_MANAGER_ROLES = new Set(["owner", "admin", "manager"]);
const CHANNEL_TYPES = new Set(["LINE", "TELEGRAM"]);
const PURPOSES = new Set(["STAFF_GROUP", "DAILY_TASK", "SYSTEM_ALERT"]);

function toPositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeRole(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeStoreRole(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeChannelType(value) {
  const normalized = String(value || "LINE").trim().toUpperCase();
  return CHANNEL_TYPES.has(normalized) ? normalized : "LINE";
}

function normalizePurpose(value) {
  const normalized = String(value || "STAFF_GROUP").trim().toUpperCase();
  return PURPOSES.has(normalized) ? normalized : "STAFF_GROUP";
}

function boolValue(value, fallback = true) {
  if (value === undefined || value === null) return fallback ? 1 : 0;
  return value ? 1 : 0;
}

async function resolveLineNotificationContext(req, connection = pool) {
  const staffUserId = toPositiveInteger(req.user?.id);
  const storeId = toPositiveInteger(req.storeId ?? req.user?.storeId);
  if (!staffUserId || !storeId) {
    const error = new Error("Store scope required");
    error.statusCode = 403;
    throw error;
  }

  const [relations] = await connection.query(
    `
      SELECT company_id AS companyId, store_id AS storeId, relationship_type AS relationshipType
      FROM company_stores
      WHERE store_id = ?
        AND status = 'ACTIVE'
    `,
    [storeId]
  );

  const companyIds = [...new Set(relations.map((row) => toPositiveInteger(row.companyId)).filter(Boolean))];
  const storeTypes = [...new Set(relations.map((row) => String(row.relationshipType || "").trim().toUpperCase()).filter(Boolean))];
  const hqCompanyIds = [...new Set(relations
    .filter((row) => HQ_RELATIONSHIP_TYPES.has(String(row.relationshipType || "").trim().toUpperCase()))
    .map((row) => toPositiveInteger(row.companyId))
    .filter(Boolean))];
  let companyStoreIds = [storeId];
  if (hqCompanyIds.length) {
    const [storeRows] = await connection.query(
      `
        SELECT DISTINCT store_id AS storeId
        FROM company_stores
        WHERE status = 'ACTIVE'
          AND company_id IN (${hqCompanyIds.map(() => "?").join(",")})
      `,
      hqCompanyIds
    );
    companyStoreIds = [...new Set(storeRows.map((row) => toPositiveInteger(row.storeId)).filter(Boolean))];
  }

  const role = normalizeRole(req.user?.role);
  const storeRole = normalizeStoreRole(req.user?.storeRole || req.user?.store_role);

  return {
    staffUserId,
    storeId,
    companyIds,
    storeTypes,
    hqCompanyIds,
    companyStoreIds,
    isHqStore: hqCompanyIds.length > 0,
    isChainStore: storeTypes.some((type) => CHAIN_STORE_RELATIONSHIP_TYPES.has(type)),
    isIndependent: companyIds.length === 0,
    canManageSettings: MANAGER_ROLES.has(role) || STORE_MANAGER_ROLES.has(storeRole)
  };
}

function assertManagePermission(context) {
  if (!context.canManageSettings) {
    const error = new Error("沒有 LINE 通知設定權限");
    error.statusCode = 403;
    throw error;
  }
}

function resolveWritableStoreId(context, requestedStoreId = null) {
  const storeId = toPositiveInteger(requestedStoreId, context.storeId);
  if (storeId === context.storeId) return storeId;
  if (context.isHqStore && context.companyStoreIds.includes(storeId)) return storeId;
  const error = new Error("無權限設定其他門市 LINE 通知");
  error.statusCode = 403;
  throw error;
}

function normalizeStoreSetting(row = {}) {
  return {
    id: Number(row.id),
    storeId: Number(row.storeId),
    channelType: row.channelType,
    purpose: row.purpose,
    targetId: row.targetId,
    enabled: Boolean(row.enabled),
    notifyOrderReservation: Boolean(row.notifyOrderReservation),
    notifyRepairReservation: Boolean(row.notifyRepairReservation),
    notifyPurchaseConfirmation: Boolean(row.notifyPurchaseConfirmation),
    notifyRepairConfirmation: Boolean(row.notifyRepairConfirmation),
    notifyReplenishment: Boolean(row.notifyReplenishment),
    notifyTransfer: Boolean(row.notifyTransfer),
    notifyInbound: Boolean(row.notifyInbound),
    notifyDailyTasks: Boolean(row.notifyDailyTasks),
    notifyInternalMessages: Boolean(row.notifyInternalMessages),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function normalizeSupplierSetting(row = {}) {
  return {
    id: row.id == null ? null : Number(row.id),
    supplierId: Number(row.supplierId),
    supplierName: row.supplierName,
    ownerType: row.ownerType,
    ownerStoreId: row.ownerStoreId == null ? null : Number(row.ownerStoreId),
    ownerCompanyId: row.ownerCompanyId == null ? null : Number(row.ownerCompanyId),
    storeId: row.settingStoreId == null ? null : Number(row.settingStoreId),
    lineGroupId: row.lineGroupId || "",
    enabled: row.enabled == null ? false : Boolean(row.enabled),
    notifyPurchaseOrder: row.notifyPurchaseOrder == null ? true : Boolean(row.notifyPurchaseOrder),
    notifyReturn: row.notifyReturn == null ? true : Boolean(row.notifyReturn),
    notifySettlement: row.notifySettlement == null ? false : Boolean(row.notifySettlement),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

async function getStoreNotificationSettings(context, connection = pool) {
  const storeIds = context.isHqStore ? context.companyStoreIds : [context.storeId];
  const [rows] = await connection.query(
    `
      SELECT id,
             store_id AS storeId,
             channel_type AS channelType,
             purpose,
             target_id AS targetId,
             enabled,
             notify_order_reservation AS notifyOrderReservation,
             notify_repair_reservation AS notifyRepairReservation,
             notify_purchase_confirmation AS notifyPurchaseConfirmation,
             notify_repair_confirmation AS notifyRepairConfirmation,
             notify_replenishment AS notifyReplenishment,
             notify_transfer AS notifyTransfer,
             notify_inbound AS notifyInbound,
             notify_daily_tasks AS notifyDailyTasks,
             notify_internal_messages AS notifyInternalMessages,
             created_at AS createdAt,
             updated_at AS updatedAt
      FROM store_notification_settings
      WHERE store_id IN (${storeIds.map(() => "?").join(",")})
      ORDER BY store_id ASC, channel_type ASC, purpose ASC
    `,
    storeIds
  );
  return rows.map(normalizeStoreSetting);
}

async function upsertStoreNotificationSetting(context, payload = {}, connection = pool) {
  assertManagePermission(context);
  const storeId = resolveWritableStoreId(context, payload.storeId);
  const targetId = String(payload.targetId || "").trim();
  if (!targetId) {
    const error = new Error("請輸入 LINE 群組 ID 或通知目標 ID");
    error.statusCode = 400;
    throw error;
  }

  const channelType = normalizeChannelType(payload.channelType);
  const purpose = normalizePurpose(payload.purpose);

  await connection.query(
    `
      INSERT INTO store_notification_settings (
        store_id,
        channel_type,
        purpose,
        target_id,
        enabled,
        notify_order_reservation,
        notify_repair_reservation,
        notify_purchase_confirmation,
        notify_repair_confirmation,
        notify_replenishment,
        notify_transfer,
        notify_inbound,
        notify_daily_tasks,
        notify_internal_messages
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        target_id = VALUES(target_id),
        enabled = VALUES(enabled),
        notify_order_reservation = VALUES(notify_order_reservation),
        notify_repair_reservation = VALUES(notify_repair_reservation),
        notify_purchase_confirmation = VALUES(notify_purchase_confirmation),
        notify_repair_confirmation = VALUES(notify_repair_confirmation),
        notify_replenishment = VALUES(notify_replenishment),
        notify_transfer = VALUES(notify_transfer),
        notify_inbound = VALUES(notify_inbound),
        notify_daily_tasks = VALUES(notify_daily_tasks),
        notify_internal_messages = VALUES(notify_internal_messages)
    `,
    [
      storeId,
      channelType,
      purpose,
      targetId,
      boolValue(payload.enabled, true),
      boolValue(payload.notifyOrderReservation, true),
      boolValue(payload.notifyRepairReservation, true),
      boolValue(payload.notifyPurchaseConfirmation, true),
      boolValue(payload.notifyRepairConfirmation, true),
      boolValue(payload.notifyReplenishment, true),
      boolValue(payload.notifyTransfer, true),
      boolValue(payload.notifyInbound, true),
      boolValue(payload.notifyDailyTasks, false),
      boolValue(payload.notifyInternalMessages, false)
    ]
  );

  const settings = await getStoreNotificationSettings(context, connection);
  return settings.find((setting) => setting.storeId === storeId && setting.channelType === channelType && setting.purpose === purpose);
}

async function disableStoreNotificationSetting(context, settingId, connection = pool) {
  assertManagePermission(context);
  const id = toPositiveInteger(settingId);
  const settings = await getStoreNotificationSettings(context, connection);
  if (!settings.some((setting) => setting.id === id)) {
    const error = new Error("找不到 LINE 通知設定或無權限");
    error.statusCode = 404;
    throw error;
  }
  await connection.query("UPDATE store_notification_settings SET enabled = 0 WHERE id = ?", [id]);
}

function buildSupplierAccessWhere(context) {
  if (context.isChainStore) {
    return { where: "1 = 0", params: [] };
  }
  const clauses = ["(s.owner_type = 'STORE' AND s.owner_store_id = ?)"];
  const params = [context.storeId];
  if (context.companyIds.length) {
    clauses.push(`(s.owner_type = 'COMPANY' AND s.owner_company_id IN (${context.companyIds.map(() => "?").join(",")}))`);
    params.push(...context.companyIds);
  }
  return { where: `(${clauses.join(" OR ")})`, params };
}

async function getSupplierNotificationSettings(context, filters = {}, connection = pool) {
  if (context.isChainStore) {
    const error = new Error("直營或加盟門市不使用供應商 LINE 設定");
    error.statusCode = 403;
    throw error;
  }
  const access = buildSupplierAccessWhere(context);
  const activeOnly = String(filters.includeInactive || "").toLowerCase() === "true" ? "" : "AND s.is_active = 1 AND s.deleted_at IS NULL";
  const [rows] = await connection.query(
    `
      SELECT s.id AS supplierId,
             s.name AS supplierName,
             s.owner_type AS ownerType,
             s.owner_store_id AS ownerStoreId,
             s.owner_company_id AS ownerCompanyId,
             sns.id,
             sns.store_id AS settingStoreId,
             sns.line_group_id AS lineGroupId,
             sns.enabled,
             sns.notify_purchase_order AS notifyPurchaseOrder,
             sns.notify_return AS notifyReturn,
             sns.notify_settlement AS notifySettlement,
             sns.created_at AS createdAt,
             sns.updated_at AS updatedAt
      FROM suppliers s
      LEFT JOIN supplier_notification_settings sns
        ON sns.supplier_id = s.id
       AND sns.store_id = ?
      WHERE ${access.where}
        ${activeOnly}
      ORDER BY s.name ASC
    `,
    [context.storeId, ...access.params]
  );
  return rows.map(normalizeSupplierSetting);
}

async function fetchAccessibleSupplier(context, supplierId, connection = pool) {
  const id = toPositiveInteger(supplierId);
  const access = buildSupplierAccessWhere(context);
  const [rows] = await connection.query(
    `
      SELECT s.id, s.name, s.owner_type AS ownerType, s.owner_store_id AS ownerStoreId, s.owner_company_id AS ownerCompanyId
      FROM suppliers s
      WHERE s.id = ?
        AND ${access.where}
        AND s.is_active = 1
        AND s.deleted_at IS NULL
      LIMIT 1
    `,
    [id, ...access.params]
  );
  return rows[0] || null;
}

async function upsertSupplierNotificationSetting(context, supplierId, payload = {}, connection = pool) {
  assertManagePermission(context);
  if (context.isChainStore) {
    const error = new Error("直營或加盟門市不使用供應商 LINE 設定");
    error.statusCode = 403;
    throw error;
  }
  const supplier = await fetchAccessibleSupplier(context, supplierId, connection);
  if (!supplier) {
    const error = new Error("找不到供應商或無權限");
    error.statusCode = 404;
    throw error;
  }
  const lineGroupId = String(payload.lineGroupId || payload.line_group_id || "").trim();
  if (!lineGroupId) {
    const error = new Error("請輸入供應商 LINE 群組 ID");
    error.statusCode = 400;
    throw error;
  }

  await connection.query(
    `
      INSERT INTO supplier_notification_settings (
        supplier_id,
        store_id,
        line_group_id,
        enabled,
        notify_purchase_order,
        notify_return,
        notify_settlement
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        line_group_id = VALUES(line_group_id),
        enabled = VALUES(enabled),
        notify_purchase_order = VALUES(notify_purchase_order),
        notify_return = VALUES(notify_return),
        notify_settlement = VALUES(notify_settlement)
    `,
    [
      supplier.id,
      context.storeId,
      lineGroupId,
      boolValue(payload.enabled, true),
      boolValue(payload.notifyPurchaseOrder, true),
      boolValue(payload.notifyReturn, true),
      boolValue(payload.notifySettlement, false)
    ]
  );

  const settings = await getSupplierNotificationSettings(context, {}, connection);
  return settings.find((setting) => setting.supplierId === Number(supplier.id));
}

async function disableSupplierNotificationSetting(context, supplierId, connection = pool) {
  assertManagePermission(context);
  const supplier = await fetchAccessibleSupplier(context, supplierId, connection);
  if (!supplier) {
    const error = new Error("找不到供應商或無權限");
    error.statusCode = 404;
    throw error;
  }
  await connection.query(
    "UPDATE supplier_notification_settings SET enabled = 0 WHERE store_id = ? AND supplier_id = ?",
    [context.storeId, supplier.id]
  );
}

async function resolveStaffLineTarget(storeId, eventType, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT *
      FROM store_notification_settings
      WHERE store_id = ?
        AND channel_type = 'LINE'
        AND purpose = 'STAFF_GROUP'
        AND enabled = 1
      LIMIT 1
    `,
    [storeId]
  );
  return rows[0] || null;
}

async function resolveSupplierLineTarget(storeId, supplierId, eventType, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT *
      FROM supplier_notification_settings
      WHERE store_id = ?
        AND supplier_id = ?
        AND enabled = 1
      LIMIT 1
    `,
    [storeId, supplierId]
  );
  return rows[0] || null;
}

async function dryRunStoreNotification(context, payload = {}, connection = pool) {
  const storeId = resolveWritableStoreId(context, payload.storeId);
  const targetId = String(payload.targetId || "").trim();
  const [stores] = await connection.query("SELECT name FROM stores WHERE id = ? LIMIT 1", [storeId]);
  return dryRunStaffGroupNotification({
    targetId,
    storeId,
    storeName: stores[0]?.name,
    eventType: payload.eventType || "SYSTEM_ALERT",
    eventLabel: payload.eventLabel || "測試通知",
    title: payload.title || "KINGWAY LINE 通知測試",
    message: payload.message || "這是 LINE 員工群組通知 dry-run，未實際發送。",
    targetUrl: payload.targetUrl || "/notifications"
  });
}

async function dryRunSupplierNotification(context, supplierId, payload = {}, connection = pool) {
  const supplier = await fetchAccessibleSupplier(context, supplierId, connection);
  if (!supplier) {
    const error = new Error("找不到供應商或無權限");
    error.statusCode = 404;
    throw error;
  }
  const [stores] = await connection.query("SELECT name FROM stores WHERE id = ? LIMIT 1", [context.storeId]);
  return dryRunSupplierGroupNotification({
    targetId: payload.lineGroupId,
    storeId: context.storeId,
    storeName: stores[0]?.name,
    supplierName: supplier.name,
    eventType: payload.eventType || "SUPPLIER_PURCHASE_ORDER",
    documentNo: payload.documentNo || "PO-DRY-RUN",
    sku: payload.sku || "SKU-TEST",
    quantity: payload.quantity || 1,
    reason: payload.reason || "dry-run"
  });
}

module.exports = {
  disableStoreNotificationSetting,
  disableSupplierNotificationSetting,
  dryRunStoreNotification,
  dryRunSupplierNotification,
  getStoreNotificationSettings,
  getSupplierNotificationSettings,
  resolveLineNotificationContext,
  resolveStaffLineTarget,
  resolveSupplierLineTarget,
  upsertStoreNotificationSetting,
  upsertSupplierNotificationSetting
};
