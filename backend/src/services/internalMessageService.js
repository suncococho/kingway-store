const { pool } = require("../db");

const HQ_RELATIONSHIP_TYPES = new Set(["HEADQUARTERS", "WAREHOUSE"]);
const CHAIN_RELATIONSHIP_TYPES = new Set(["DIRECT_STORE", "FRANCHISE_STORE"]);
const COMPANY_WRITE_ROLES = new Set(["company_owner", "hq_admin", "inventory_manager", "finance"]);
const PRIORITIES = new Set(["NORMAL", "IMPORTANT", "URGENT"]);

function toPositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizePriority(value) {
  const priority = String(value || "NORMAL").trim().toUpperCase();
  return PRIORITIES.has(priority) ? priority : "NORMAL";
}

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeMessage(row = {}) {
  return {
    id: Number(row.id),
    companyId: row.companyId == null ? null : Number(row.companyId),
    fromStoreId: row.fromStoreId == null ? null : Number(row.fromStoreId),
    fromStoreName: row.fromStoreName || null,
    toStoreId: row.toStoreId == null ? null : Number(row.toStoreId),
    toStoreName: row.toStoreName || null,
    toAllStores: Boolean(row.toAllStores),
    fromStaffUserId: Number(row.fromStaffUserId || 0),
    fromStaffUsername: row.fromStaffUsername || null,
    fromStaffDisplayName: row.fromStaffDisplayName || null,
    title: row.title,
    body: row.body,
    priority: row.priority,
    status: row.status,
    readAt: row.readAt || null,
    isRead: Boolean(row.readAt),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

async function resolveMessageContext(req, connection = pool) {
  const staffUserId = toPositiveInteger(req.user?.id);
  const storeId = toPositiveInteger(req.storeId ?? req.user?.storeId);
  if (!staffUserId || !storeId) throw createError("Store scope required", 403);

  const [rows] = await connection.query(
    `
      SELECT
        cs.company_id AS companyId,
        cs.store_id AS storeId,
        cs.relationship_type AS relationshipType,
        cm.role AS companyRole
      FROM company_stores cs
      LEFT JOIN company_memberships cm
        ON cm.company_id = cs.company_id
       AND cm.staff_user_id = ?
       AND cm.status = 'ACTIVE'
      WHERE cs.status = 'ACTIVE'
        AND (cs.store_id = ? OR cm.id IS NOT NULL)
    `,
    [staffUserId, storeId]
  );

  const currentRows = rows.filter((row) => Number(row.storeId) === storeId);
  const companyIds = [...new Set(rows.map((row) => toPositiveInteger(row.companyId)).filter(Boolean))];
  const currentCompanyIds = [...new Set(currentRows.map((row) => toPositiveInteger(row.companyId)).filter(Boolean))];
  const hqCompanyIds = [...new Set(currentRows
    .filter((row) => HQ_RELATIONSHIP_TYPES.has(String(row.relationshipType || "").toUpperCase()))
    .map((row) => toPositiveInteger(row.companyId))
    .filter(Boolean))];
  const writableCompanyIds = [...new Set(rows
    .filter((row) => COMPANY_WRITE_ROLES.has(String(row.companyRole || "").trim()))
    .map((row) => toPositiveInteger(row.companyId))
    .filter(Boolean))];
  const currentRelationships = currentRows.map((row) => String(row.relationshipType || "").toUpperCase());
  const isHqStore = currentRelationships.some((relationship) => HQ_RELATIONSHIP_TYPES.has(relationship));
  const isChainStore = currentRelationships.some((relationship) => CHAIN_RELATIONSHIP_TYPES.has(relationship));

  return {
    staffUserId,
    storeId,
    companyIds,
    currentCompanyIds,
    hqCompanyIds,
    writableCompanyIds,
    isHqStore,
    isChainStore,
    isIndependent: currentRelationships.length === 0,
    canSendCompanyMessages: isHqStore || writableCompanyIds.length > 0
  };
}

function selectMessageColumns(alias = "im", context = null) {
  const staffUserId = context?.staffUserId ? Number(context.staffUserId) : 0;
  return `
    ${alias}.id,
    ${alias}.company_id AS companyId,
    ${alias}.from_store_id AS fromStoreId,
    fs.name AS fromStoreName,
    ${alias}.to_store_id AS toStoreId,
    ts.name AS toStoreName,
    ${alias}.to_all_stores AS toAllStores,
    ${alias}.from_staff_user_id AS fromStaffUserId,
    su.username AS fromStaffUsername,
    su.display_name AS fromStaffDisplayName,
    ${alias}.title,
    ${alias}.body,
    ${alias}.priority,
    ${alias}.status,
    mr.read_at AS readAt,
    ${alias}.created_at AS createdAt,
    ${alias}.updated_at AS updatedAt
  `.replace("mr.staff_user_id = ?", `mr.staff_user_id = ${staffUserId}`);
}

function messageJoins(alias = "im", context = null) {
  const staffUserId = context?.staffUserId ? Number(context.staffUserId) : 0;
  return `
    LEFT JOIN stores fs ON fs.id = ${alias}.from_store_id
    LEFT JOIN stores ts ON ts.id = ${alias}.to_store_id
    LEFT JOIN staff_users su ON su.id = ${alias}.from_staff_user_id
    LEFT JOIN internal_message_reads mr
      ON mr.message_id = ${alias}.id
     AND mr.staff_user_id = ${staffUserId}
  `;
}

function buildVisibleWhere(context, alias = "im") {
  const clauses = [];
  const params = [];

  if (context.isHqStore && context.hqCompanyIds.length) {
    clauses.push(`(${alias}.company_id IN (${context.hqCompanyIds.map(() => "?").join(",")}))`);
    params.push(...context.hqCompanyIds);
  } else if (context.currentCompanyIds.length) {
    clauses.push(`(${alias}.company_id IN (${context.currentCompanyIds.map(() => "?").join(",")}) AND (${alias}.to_store_id = ? OR ${alias}.from_store_id = ? OR ${alias}.to_all_stores = 1))`);
    params.push(...context.currentCompanyIds, context.storeId, context.storeId);
  } else {
    clauses.push(`(${alias}.company_id IS NULL AND (${alias}.to_store_id = ? OR ${alias}.from_store_id = ?))`);
    params.push(context.storeId, context.storeId);
  }

  return {
    where: `(${clauses.join(" OR ")})`,
    params
  };
}

async function getCompanyStores(companyId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT s.id, s.code, s.name, cs.relationship_type AS relationshipType
      FROM company_stores cs
      JOIN stores s ON s.id = cs.store_id
      WHERE cs.company_id = ?
        AND cs.status = 'ACTIVE'
      ORDER BY FIELD(cs.relationship_type, 'HEADQUARTERS', 'WAREHOUSE', 'DIRECT_STORE', 'FRANCHISE_STORE'), s.id
    `,
    [companyId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    code: row.code,
    name: row.name,
    relationshipType: row.relationshipType
  }));
}

async function getRecipients(context, connection = pool) {
  if (!context.canSendCompanyMessages || !context.hqCompanyIds.length) {
    return {
      mode: context.isIndependent ? "INDEPENDENT" : "STORE_TO_HQ",
      canSendToStores: false,
      stores: []
    };
  }

  const stores = await getCompanyStores(context.hqCompanyIds[0], connection);
  return {
    mode: "HQ",
    canSendToStores: true,
    companyId: context.hqCompanyIds[0],
    stores
  };
}

async function findHeadquartersStore(companyId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT store_id AS storeId
      FROM company_stores
      WHERE company_id = ?
        AND status = 'ACTIVE'
        AND relationship_type IN ('HEADQUARTERS', 'WAREHOUSE')
      ORDER BY FIELD(relationship_type, 'HEADQUARTERS', 'WAREHOUSE'), store_id
      LIMIT 1
    `,
    [companyId]
  );
  return toPositiveInteger(rows[0]?.storeId);
}

async function assertStoreInCompany(storeId, companyId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT id
      FROM company_stores
      WHERE store_id = ?
        AND company_id = ?
        AND status = 'ACTIVE'
      LIMIT 1
    `,
    [storeId, companyId]
  );
  return Boolean(rows[0]);
}

async function createMessage(input = {}, context, connection = pool) {
  const title = String(input.title || "").trim();
  const body = String(input.body || "").trim();
  if (!title || !body) throw createError("請輸入訊息標題與內容", 400);

  let companyId = null;
  let toStoreId = null;
  let toAllStores = false;

  if (context.canSendCompanyMessages && context.hqCompanyIds.length) {
    companyId = context.hqCompanyIds[0];
    toAllStores = Boolean(input.toAllStores);
    if (!toAllStores) {
      toStoreId = toPositiveInteger(input.toStoreId);
      if (!toStoreId) throw createError("請選擇收件門市", 400);
      const validStore = await assertStoreInCompany(toStoreId, companyId, connection);
      if (!validStore) throw createError("收件門市不屬於此公司", 403);
    }
  } else if (context.isChainStore && context.currentCompanyIds.length) {
    if (input.toStoreId && Number(input.toStoreId) !== context.storeId) {
      throw createError("門市不可直接發送訊息給其他門市", 403);
    }
    companyId = context.currentCompanyIds[0];
    toStoreId = await findHeadquartersStore(companyId, connection);
    if (!toStoreId) throw createError("找不到本部收件門市", 400);
  } else {
    if (input.toStoreId && Number(input.toStoreId) !== context.storeId) {
      throw createError("不可發送訊息給其他門市", 403);
    }
    toStoreId = context.storeId;
  }

  const [result] = await connection.query(
    `
      INSERT INTO internal_messages (
        company_id,
        from_store_id,
        to_store_id,
        to_all_stores,
        from_staff_user_id,
        title,
        body,
        priority
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      companyId,
      context.storeId,
      toStoreId,
      toAllStores ? 1 : 0,
      context.staffUserId,
      title,
      body,
      normalizePriority(input.priority)
    ]
  );

  await connection.query(
    `
      INSERT INTO internal_message_reads (message_id, staff_user_id, store_id)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE read_at = read_at
    `,
    [result.insertId, context.staffUserId, context.storeId]
  );

  return getMessageById(result.insertId, context, connection);
}

function buildListFilters(query = {}) {
  const clauses = ["im.status = 'SENT'"];
  const params = [];
  if (String(query.unread || "") === "1") {
    clauses.push("mr.id IS NULL");
  } else if (String(query.read || "") === "1") {
    clauses.push("mr.id IS NOT NULL");
  }
  const priority = String(query.priority || "").trim().toUpperCase();
  if (PRIORITIES.has(priority)) {
    clauses.push("im.priority = ?");
    params.push(priority);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.startDate || ""))) {
    clauses.push("DATE(im.created_at) >= ?");
    params.push(query.startDate);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.endDate || ""))) {
    clauses.push("DATE(im.created_at) <= ?");
    params.push(query.endDate);
  }
  return { clauses, params };
}

async function getMessages(context, query = {}, connection = pool) {
  const visible = buildVisibleWhere(context);
  const filters = buildListFilters(query);
  const limit = Math.min(Math.max(toPositiveInteger(query.limit, 50), 1), 100);
  const offset = Math.max(toPositiveInteger(query.offset, 0) || 0, 0);
  const [rows] = await connection.query(
    `
      SELECT ${selectMessageColumns("im", context)}
      FROM internal_messages im
      ${messageJoins("im", context)}
      WHERE ${visible.where}
        AND ${filters.clauses.join(" AND ")}
      ORDER BY im.created_at DESC, im.id DESC
      LIMIT ? OFFSET ?
    `,
    [...visible.params, ...filters.params, limit, offset]
  );
  return rows.map(normalizeMessage);
}

async function getPendingMessages(context, options = {}, connection = pool) {
  const visible = buildVisibleWhere(context);
  const limit = Math.min(Math.max(toPositiveInteger(options.limit, 5), 1), 20);
  const [rows] = await connection.query(
    `
      SELECT ${selectMessageColumns("im", context)}
      FROM internal_messages im
      ${messageJoins("im", context)}
      WHERE ${visible.where}
        AND im.status = 'SENT'
        AND im.from_staff_user_id <> ?
        AND mr.id IS NULL
      ORDER BY FIELD(im.priority, 'URGENT', 'IMPORTANT', 'NORMAL'), im.created_at ASC
      LIMIT ?
    `,
    [...visible.params, context.staffUserId, limit]
  );
  return rows.map(normalizeMessage);
}

async function getUnreadSummary(context, connection = pool) {
  const visible = buildVisibleWhere(context);
  const [[summary]] = await connection.query(
    `
      SELECT
        COUNT(*) AS messages,
        SUM(CASE WHEN im.priority = 'URGENT' THEN 1 ELSE 0 END) AS urgentMessages
      FROM internal_messages im
      ${messageJoins("im", context)}
      WHERE ${visible.where}
        AND im.status = 'SENT'
        AND im.from_staff_user_id <> ?
        AND mr.id IS NULL
    `,
    [...visible.params, context.staffUserId]
  );
  return {
    messages: Number(summary?.messages || 0),
    urgentMessages: Number(summary?.urgentMessages || 0)
  };
}

async function getMessageById(messageId, context, connection = pool) {
  const id = toPositiveInteger(messageId);
  if (!id) return null;
  const visible = buildVisibleWhere(context);
  const [rows] = await connection.query(
    `
      SELECT ${selectMessageColumns("im", context)}
      FROM internal_messages im
      ${messageJoins("im", context)}
      WHERE im.id = ?
        AND ${visible.where}
      LIMIT 1
    `,
    [id, ...visible.params]
  );
  return rows[0] ? normalizeMessage(rows[0]) : null;
}

async function markRead(messageId, context, connection = pool) {
  const message = await getMessageById(messageId, context, connection);
  if (!message) throw createError("找不到訊息或沒有權限", 404);
  await connection.query(
    `
      INSERT INTO internal_message_reads (message_id, staff_user_id, store_id)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE read_at = read_at
    `,
    [message.id, context.staffUserId, context.storeId]
  );
  return getMessageById(message.id, context, connection);
}

async function archiveMessage(messageId, context, connection = pool) {
  const message = await getMessageById(messageId, context, connection);
  if (!message) throw createError("找不到訊息或沒有權限", 404);
  if (!context.canSendCompanyMessages && message.fromStaffUserId !== context.staffUserId) {
    throw createError("沒有封存此訊息的權限", 403);
  }
  await connection.query(
    "UPDATE internal_messages SET status = 'ARCHIVED' WHERE id = ?",
    [message.id]
  );
  return getMessageById(message.id, context, connection);
}

module.exports = {
  archiveMessage,
  createMessage,
  getMessages,
  getPendingMessages,
  getRecipients,
  getUnreadSummary,
  markRead,
  resolveMessageContext
};
