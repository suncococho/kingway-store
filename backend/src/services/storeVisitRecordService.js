const { pool } = require("../db");
const { createKpiEventOnce } = require("./staffKpiService");
const { createNotification } = require("./staffNotificationService");

const HQ_RELATIONSHIP_TYPES = new Set(["HEADQUARTERS", "WAREHOUSE"]);
const VISIT_RECORD_REF_TYPE = "STORE_VISIT_RECORD";
const FOLLOW_UP_NOTIFICATION_TYPE = "STORE_VISIT_FOLLOW_UP_REQUIRED";
const VISIT_RESULTS = new Set([
  "INTERESTED",
  "TEST_RIDE",
  "QUOTE_REQUESTED",
  "RESERVED",
  "PURCHASED",
  "NEED_FOLLOW_UP",
  "NO_PURCHASE",
  "OTHER"
]);

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

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

function normalizeDate(value, fieldName = "visitDate") {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw createError(`${fieldName} 格式需為 YYYY-MM-DD`, 400);
  }
  return text;
}

function normalizeTime(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(text)) {
    throw createError("visitTime 格式需為 HH:mm", 400);
  }
  return text.length === 5 ? `${text}:00` : text;
}

function normalizeDateTime(value, fieldName = "followUpAt") {
  const text = String(value || "").trim();
  if (!text) return null;
  const normalized = text.replace("T", " ");
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(normalized)) {
    throw createError(`${fieldName} 格式需為 YYYY-MM-DD HH:mm`, 400);
  }
  return normalized.length === 16 ? `${normalized}:00` : normalized;
}

function formatDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function formatTimeValue(value) {
  if (!value) return "";
  return String(value).slice(0, 8);
}

function formatDateTimeValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().replace("T", " ").slice(0, 19);
  return String(value).replace("T", " ").slice(0, 19);
}

function normalizeBoolean(value) {
  if (value === true || value === 1 || value === "1") return true;
  if (String(value || "").toLowerCase() === "true") return true;
  return false;
}

function normalizeOptionalText(value, maxLength) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function maskLineIdentifier(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 4) return `${text.slice(0, 1)}***`;
  if (text.length <= 10) return `${text.slice(0, 3)}***${text.slice(-2)}`;
  return `${text.slice(0, 6)}***${text.slice(-4)}`;
}

function maskPhone(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const compact = text.replace(/[\s-]/g, "");
  if (compact.length <= 4) return `${compact.slice(0, 1)}***`;
  return `${compact.slice(0, 4)}***${compact.slice(-3)}`;
}

function previewText(value, maxLength = 80) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function getRecordValue(record = {}, camelKey, snakeKey) {
  return record[camelKey] ?? record[snakeKey];
}

function getRecordBoolean(record = {}, camelKey, snakeKey) {
  const value = getRecordValue(record, camelKey, snakeKey);
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
}

function shouldRequireFollowUp(record = {}) {
  return String(getRecordValue(record, "visitResult", "visit_result") || "").toUpperCase() === "NEED_FOLLOW_UP" || getRecordBoolean(record, "followUpRequired", "follow_up_required");
}

function buildVisitRecordMetadata(record = {}) {
  return {
    visitResult: getRecordValue(record, "visitResult", "visit_result") || null,
    lineFriendAdded: getRecordBoolean(record, "lineFriendAdded", "line_friend_added"),
    followUpRequired: shouldRequireFollowUp(record),
    interestedVehicle: getRecordValue(record, "interestedVehicle", "interested_vehicle") || null,
    visitDate: formatDateValue(getRecordValue(record, "visitDate", "visit_date")),
    visitTime: formatTimeValue(getRecordValue(record, "visitTime", "visit_time")) || null
  };
}

function buildFollowUpNotificationMessage(record = {}) {
  const customerName = getRecordValue(record, "customerName", "customer_name") || "來店客戶";
  const vehicle = getRecordValue(record, "interestedVehicle", "interested_vehicle") || "感興趣車款";
  const parts = [`來店客戶 ${customerName} 對 ${vehicle} 有興趣，請安排後續聯繫。`];
  const phone = maskPhone(getRecordValue(record, "customerPhone", "customer_phone"));
  if (phone) parts.push(`電話：${phone}`);
  const followUpAt = formatDateTimeValue(getRecordValue(record, "followUpAt", "follow_up_at"));
  if (followUpAt) parts.push(`預計追蹤時間：${followUpAt}`);
  const note = previewText(getRecordValue(record, "note", "note"));
  if (note) parts.push(`備註：${note}`);
  return parts.join("\n");
}

async function logVisitKpiEvent(record = {}, eventType, title, score, connection = pool) {
  const staffUserId = toPositiveInteger(getRecordValue(record, "updatedByStaffUserId", "updated_by_staff_user_id")) || toPositiveInteger(getRecordValue(record, "createdByStaffUserId", "created_by_staff_user_id"));
  const refId = toPositiveInteger(getRecordValue(record, "id", "id"));
  if (!staffUserId || !refId) return null;

  return createKpiEventOnce({
    companyId: toPositiveInteger(getRecordValue(record, "companyId", "company_id")),
    storeId: toPositiveInteger(getRecordValue(record, "storeId", "store_id")),
    staffUserId,
    eventType,
    refType: VISIT_RECORD_REF_TYPE,
    refId,
    title,
    score,
    metadata: buildVisitRecordMetadata(record)
  }, connection);
}

async function logVisitKpiEventsForCreate(record = {}, connection = pool) {
  await logVisitKpiEvent(record, "STORE_VISIT_CREATED", "建立來店紀錄", 0.5, connection);
  if (getRecordBoolean(record, "lineFriendAdded", "line_friend_added")) {
    await logVisitKpiEvent(record, "STORE_VISIT_LINE_FRIEND_ADDED", "來店客戶加入 LINE", 1, connection);
  }
  if (shouldRequireFollowUp(record)) {
    await logVisitKpiEvent(record, "STORE_VISIT_FOLLOW_UP_REQUIRED", "來店客戶需追蹤", 0.5, connection);
  }
}

async function logVisitKpiEventsForUpdate(existing = {}, updated = {}, connection = pool) {
  await logVisitKpiEvent(updated, "STORE_VISIT_UPDATED", "更新來店紀錄", 0.2, connection);
  if (!getRecordBoolean(existing, "lineFriendAdded", "line_friend_added") && getRecordBoolean(updated, "lineFriendAdded", "line_friend_added")) {
    await logVisitKpiEvent(updated, "STORE_VISIT_LINE_FRIEND_ADDED", "來店客戶加入 LINE", 1, connection);
  }
  if (!shouldRequireFollowUp(existing) && shouldRequireFollowUp(updated)) {
    await logVisitKpiEvent(updated, "STORE_VISIT_FOLLOW_UP_REQUIRED", "來店客戶需追蹤", 0.5, connection);
  }
}

async function createFollowUpNotification(record = {}, connection = pool) {
  if (!shouldRequireFollowUp(record)) return null;
  const refId = toPositiveInteger(getRecordValue(record, "id", "id"));
  const storeId = toPositiveInteger(getRecordValue(record, "storeId", "store_id"));
  if (!refId || !storeId) return null;

  return createNotification({
    companyId: toPositiveInteger(getRecordValue(record, "companyId", "company_id")),
    storeId,
    type: FOLLOW_UP_NOTIFICATION_TYPE,
    title: "來店客戶需追蹤",
    message: buildFollowUpNotificationMessage(record),
    targetUrl: "/store-visit-records",
    refType: VISIT_RECORD_REF_TYPE,
    refId,
    priority: "IMPORTANT",
    dueAt: formatDateTimeValue(getRecordValue(record, "followUpAt", "follow_up_at"))
  }, connection);
}

function normalizeVisitResult(value) {
  const result = String(value || "INTERESTED").trim().toUpperCase();
  if (!VISIT_RESULTS.has(result)) {
    throw createError("visitResult 不正確", 400);
  }
  return result;
}

function validateVisitRecordPayload(payload = {}) {
  const visitDate = normalizeDate(payload.visitDate || payload.visit_date);
  const visitTime = normalizeTime(payload.visitTime || payload.visit_time);
  const visitorCount = Number(payload.visitorCount ?? payload.visitor_count ?? 1);
  if (!Number.isSafeInteger(visitorCount) || visitorCount < 1) {
    throw createError("visitorCount 必須為 1 以上整數", 400);
  }

  const lineIdentifier = normalizeOptionalText(payload.lineIdentifier || payload.line_identifier, 255);
  const visitResult = normalizeVisitResult(payload.visitResult || payload.visit_result);
  const followUpRequired = normalizeBoolean(payload.followUpRequired ?? payload.follow_up_required) || visitResult === "NEED_FOLLOW_UP";
  const followUpAt = normalizeDateTime(payload.followUpAt || payload.follow_up_at);

  return {
    visitDate,
    visitTime,
    visitedAt: visitTime ? `${visitDate} ${visitTime}` : null,
    visitorCount,
    customerName: normalizeOptionalText(payload.customerName || payload.customer_name, 120),
    customerPhone: normalizeOptionalText(payload.customerPhone || payload.customer_phone, 40),
    lineFriendAdded: normalizeBoolean(payload.lineFriendAdded ?? payload.line_friend_added) ? 1 : 0,
    lineIdentifier,
    lineDisplayName: normalizeOptionalText(payload.lineDisplayName || payload.line_display_name, 255),
    interestedVehicle: normalizeOptionalText(payload.interestedVehicle || payload.interested_vehicle, 255),
    interestedProductId: toPositiveInteger(payload.interestedProductId || payload.interested_product_id),
    interestedProductSku: normalizeOptionalText(payload.interestedProductSku || payload.interested_product_sku, 120),
    visitResult,
    followUpRequired: followUpRequired ? 1 : 0,
    followUpAt,
    note: normalizeOptionalText(payload.note, 5000)
  };
}

async function resolveVisitRecordContext(req, connection = pool) {
  const staffUserId = toPositiveInteger(req.user?.id);
  const storeId = toPositiveInteger(req.storeId ?? req.user?.storeId);
  if (!staffUserId || !storeId) {
    throw createError("Store scope required", 403);
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

  const hqCompanyIds = [...new Set(relations
    .filter((row) => HQ_RELATIONSHIP_TYPES.has(normalizeRole(row.relationshipType)))
    .map((row) => toPositiveInteger(row.companyId))
    .filter(Boolean))];

  let accessibleStoreIds = [storeId];
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
    accessibleStoreIds = [...new Set(storeRows.map((row) => toPositiveInteger(row.storeId)).filter(Boolean))];
  }

  const role = normalizeRole(req.user?.role);
  const storeRole = normalizeStoreRole(req.user?.storeRole || req.user?.store_role);
  const canViewAllStores = hqCompanyIds.length > 0 && (["ADMIN", "MANAGER"].includes(role) || ["owner", "admin", "manager"].includes(storeRole));

  return {
    staffUserId,
    storeId,
    role,
    storeRole,
    hqCompanyIds,
    accessibleStoreIds: canViewAllStores ? accessibleStoreIds : [storeId],
    canViewAllStores
  };
}

function resolveReadableStoreId(context, requestedStoreId = null) {
  const requested = toPositiveInteger(requestedStoreId);
  if (!requested) return null;
  if (requested === context.storeId) return requested;
  if (context.canViewAllStores && context.accessibleStoreIds.includes(requested)) return requested;
  throw createError("無權限查看其他門市來店紀錄", 403);
}

function resolveWritableStoreId(context, requestedStoreId = null) {
  const requested = toPositiveInteger(requestedStoreId, context.storeId);
  if (requested === context.storeId) return requested;
  if (context.canViewAllStores && context.accessibleStoreIds.includes(requested)) return requested;
  throw createError("無權限修改其他門市來店紀錄", 403);
}

async function getCompanyIdForStore(storeId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT company_id AS companyId
      FROM company_stores
      WHERE store_id = ?
        AND status = 'ACTIVE'
      ORDER BY FIELD(relationship_type, 'HEADQUARTERS', 'WAREHOUSE', 'DIRECT_STORE', 'FRANCHISE_STORE') ASC, company_id ASC
      LIMIT 1
    `,
    [storeId]
  );
  return rows[0]?.companyId || null;
}

async function getAccessibleStores(context, connection = pool) {
  const storeIds = context.canViewAllStores ? context.accessibleStoreIds : [context.storeId];
  if (!storeIds.length) return [];
  const [rows] = await connection.query(
    `
      SELECT id, name, code
      FROM stores
      WHERE id IN (${storeIds.map(() => "?").join(",")})
      ORDER BY id ASC
    `,
    storeIds
  );
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    code: row.code || null
  }));
}

function normalizeVisitRecord(row = {}, options = {}) {
  const includeSensitive = Boolean(options.includeSensitive);
  const rawLineIdentifier = row.lineIdentifier || row.line_identifier || "";
  return {
    id: Number(row.id),
    companyId: row.companyId == null && row.company_id == null ? null : Number(row.companyId ?? row.company_id),
    storeId: Number(row.storeId ?? row.store_id),
    storeName: row.storeName || row.store_name || "",
    storeCode: row.storeCode || row.store_code || "",
    visitDate: formatDateValue(row.visitDate || row.visit_date),
    visitTime: formatTimeValue(row.visitTime || row.visit_time),
    visitedAt: formatDateTimeValue(row.visitedAt || row.visited_at),
    visitorCount: Number(row.visitorCount ?? row.visitor_count ?? 1),
    customerName: row.customerName || row.customer_name || "",
    customerPhone: row.customerPhone || row.customer_phone || "",
    lineFriendAdded: Boolean(row.lineFriendAdded ?? row.line_friend_added),
    lineIdentifier: includeSensitive ? rawLineIdentifier : "",
    lineIdentifierMasked: maskLineIdentifier(rawLineIdentifier),
    lineDisplayName: row.lineDisplayName || row.line_display_name || "",
    interestedVehicle: row.interestedVehicle || row.interested_vehicle || "",
    interestedProductId: row.interestedProductId == null && row.interested_product_id == null ? null : Number(row.interestedProductId ?? row.interested_product_id),
    interestedProductSku: row.interestedProductSku || row.interested_product_sku || "",
    visitResult: row.visitResult || row.visit_result || "INTERESTED",
    followUpRequired: Boolean(row.followUpRequired ?? row.follow_up_required),
    followUpAt: formatDateTimeValue(row.followUpAt || row.follow_up_at),
    note: row.note || "",
    createdByStaffUserId: row.createdByStaffUserId == null && row.created_by_staff_user_id == null ? null : Number(row.createdByStaffUserId ?? row.created_by_staff_user_id),
    updatedByStaffUserId: row.updatedByStaffUserId == null && row.updated_by_staff_user_id == null ? null : Number(row.updatedByStaffUserId ?? row.updated_by_staff_user_id),
    createdAt: formatDateTimeValue(row.createdAt || row.created_at),
    updatedAt: formatDateTimeValue(row.updatedAt || row.updated_at),
    createdByName: row.createdByName || row.created_by_name || row.createdByUsername || row.created_by_username || "",
    updatedByName: row.updatedByName || row.updated_by_name || row.updatedByUsername || row.updated_by_username || ""
  };
}

function selectVisitRecordSql(whereClause) {
  return `
    SELECT r.id,
           r.company_id AS companyId,
           r.store_id AS storeId,
           s.name AS storeName,
           s.code AS storeCode,
           r.visit_date AS visitDate,
           r.visit_time AS visitTime,
           r.visited_at AS visitedAt,
           r.visitor_count AS visitorCount,
           r.customer_name AS customerName,
           r.customer_phone AS customerPhone,
           r.line_friend_added AS lineFriendAdded,
           r.line_identifier AS lineIdentifier,
           r.line_display_name AS lineDisplayName,
           r.interested_vehicle AS interestedVehicle,
           r.interested_product_id AS interestedProductId,
           r.interested_product_sku AS interestedProductSku,
           r.visit_result AS visitResult,
           r.follow_up_required AS followUpRequired,
           r.follow_up_at AS followUpAt,
           r.note,
           r.created_by_staff_user_id AS createdByStaffUserId,
           r.updated_by_staff_user_id AS updatedByStaffUserId,
           r.created_at AS createdAt,
           r.updated_at AS updatedAt,
           created_staff.username AS createdByUsername,
           created_staff.display_name AS createdByName,
           updated_staff.username AS updatedByUsername,
           updated_staff.display_name AS updatedByName
    FROM store_visit_records r
    LEFT JOIN stores s ON s.id = r.store_id
    LEFT JOIN staff_users created_staff ON created_staff.id = r.created_by_staff_user_id
    LEFT JOIN staff_users updated_staff ON updated_staff.id = r.updated_by_staff_user_id
    ${whereClause}
  `;
}

async function fetchVisitRecordById(connection, id, forUpdate = false) {
  const [rows] = await connection.query(
    `${selectVisitRecordSql("WHERE r.id = ?")} ${forUpdate ? "FOR UPDATE" : ""}`,
    [id]
  );
  return rows[0] || null;
}

async function createVisitRecord(context, payload = {}) {
  const normalized = validateVisitRecordPayload(payload);
  const targetStoreId = resolveWritableStoreId(context, payload.storeId || payload.store_id);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const companyId = await getCompanyIdForStore(targetStoreId, connection);
    const [result] = await connection.query(
      `
        INSERT INTO store_visit_records (
          company_id,
          store_id,
          visit_date,
          visit_time,
          visited_at,
          visitor_count,
          customer_name,
          customer_phone,
          line_friend_added,
          line_identifier,
          line_display_name,
          interested_vehicle,
          interested_product_id,
          interested_product_sku,
          visit_result,
          follow_up_required,
          follow_up_at,
          note,
          created_by_staff_user_id,
          updated_by_staff_user_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        companyId,
        targetStoreId,
        normalized.visitDate,
        normalized.visitTime,
        normalized.visitedAt,
        normalized.visitorCount,
        normalized.customerName,
        normalized.customerPhone,
        normalized.lineFriendAdded,
        normalized.lineIdentifier,
        normalized.lineDisplayName,
        normalized.interestedVehicle,
        normalized.interestedProductId,
        normalized.interestedProductSku,
        normalized.visitResult,
        normalized.followUpRequired,
        normalized.followUpAt,
        normalized.note,
        context.staffUserId,
        context.staffUserId
      ]
    );
    const row = await fetchVisitRecordById(connection, result.insertId);
    await logVisitKpiEventsForCreate(row, connection);
    if (shouldRequireFollowUp(row)) {
      await createFollowUpNotification(row, connection);
    }
    await connection.commit();
    return { record: normalizeVisitRecord(row, { includeSensitive: true }), created: true, id: Number(result.insertId) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
async function updateVisitRecord(context, id, payload = {}) {
  const recordId = toPositiveInteger(id);
  if (!recordId) throw createError("找不到來店紀錄", 404);
  const normalized = validateVisitRecordPayload(payload);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const existing = await fetchVisitRecordById(connection, recordId, true);
    if (!existing) {
      throw createError("找不到來店紀錄", 404);
    }
    const existingStoreId = Number(existing.storeId || existing.store_id);
    resolveWritableStoreId(context, existingStoreId);
    const requestedStoreId = toPositiveInteger(payload.storeId || payload.store_id);
    if (requestedStoreId && requestedStoreId !== existingStoreId) {
      throw createError("來店紀錄不可改變門市", 400);
    }
    const companyId = await getCompanyIdForStore(existingStoreId, connection);

    await connection.query(
      `
        UPDATE store_visit_records
        SET company_id = ?,
            visit_date = ?,
            visit_time = ?,
            visited_at = ?,
            visitor_count = ?,
            customer_name = ?,
            customer_phone = ?,
            line_friend_added = ?,
            line_identifier = ?,
            line_display_name = ?,
            interested_vehicle = ?,
            interested_product_id = ?,
            interested_product_sku = ?,
            visit_result = ?,
            follow_up_required = ?,
            follow_up_at = ?,
            note = ?,
            updated_by_staff_user_id = ?
        WHERE id = ?
      `,
      [
        companyId,
        normalized.visitDate,
        normalized.visitTime,
        normalized.visitedAt,
        normalized.visitorCount,
        normalized.customerName,
        normalized.customerPhone,
        normalized.lineFriendAdded,
        normalized.lineIdentifier,
        normalized.lineDisplayName,
        normalized.interestedVehicle,
        normalized.interestedProductId,
        normalized.interestedProductSku,
        normalized.visitResult,
        normalized.followUpRequired,
        normalized.followUpAt,
        normalized.note,
        context.staffUserId,
        recordId
      ]
    );

    const updated = await fetchVisitRecordById(connection, recordId);
    await logVisitKpiEventsForUpdate(existing, updated, connection);
    if (!shouldRequireFollowUp(existing) && shouldRequireFollowUp(updated)) {
      await createFollowUpNotification(updated, connection);
    }
    await connection.commit();
    return { record: normalizeVisitRecord(updated, { includeSensitive: true }), updated: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getVisitRecord(context, id) {
  const recordId = toPositiveInteger(id);
  if (!recordId) throw createError("找不到來店紀錄", 404);
  const row = await fetchVisitRecordById(pool, recordId);
  if (!row) throw createError("找不到來店紀錄", 404);
  resolveReadableStoreId(context, row.storeId || row.store_id);
  return { record: normalizeVisitRecord(row, { includeSensitive: true }) };
}

function appendDateFilters(clauses, params, filters = {}) {
  if (filters.startDate) {
    clauses.push("r.visit_date >= ?");
    params.push(normalizeDate(filters.startDate, "startDate"));
  }
  if (filters.endDate) {
    clauses.push("r.visit_date <= ?");
    params.push(normalizeDate(filters.endDate, "endDate"));
  }
}

async function getVisitRecords(context, filters = {}) {
  const requestedStoreId = resolveReadableStoreId(context, filters.storeId);
  const storeIds = requestedStoreId ? [requestedStoreId] : context.accessibleStoreIds;
  const limit = Math.min(toPositiveInteger(filters.limit, 80), 200);
  const offset = Math.max(Number(filters.offset || 0), 0);
  const clauses = [`r.store_id IN (${storeIds.map(() => "?").join(",")})`];
  const params = [...storeIds];
  appendDateFilters(clauses, params, filters);

  if (filters.visitResult) {
    clauses.push("r.visit_result = ?");
    params.push(normalizeVisitResult(filters.visitResult));
  }
  if (filters.lineFriendAdded !== undefined && filters.lineFriendAdded !== "") {
    clauses.push("r.line_friend_added = ?");
    params.push(normalizeBoolean(filters.lineFriendAdded) ? 1 : 0);
  }
  const keyword = String(filters.keyword || "").trim();
  if (keyword) {
    clauses.push("(r.customer_name LIKE ? OR r.customer_phone LIKE ? OR r.line_display_name LIKE ? OR r.interested_vehicle LIKE ? OR r.note LIKE ?)");
    const like = `%${keyword.slice(0, 80)}%`;
    params.push(like, like, like, like, like);
  }

  const [rows] = await pool.query(
    `${selectVisitRecordSql(`WHERE ${clauses.join(" AND ")}`)}
     ORDER BY r.visit_date DESC, r.visit_time DESC, r.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    records: rows.map((row) => normalizeVisitRecord(row)),
    stores: await getAccessibleStores(context),
    canViewAllStores: context.canViewAllStores,
    currentStoreId: context.storeId
  };
}

async function getVisitRecordSummary(context, filters = {}) {
  const requestedStoreId = resolveReadableStoreId(context, filters.storeId);
  const storeIds = requestedStoreId ? [requestedStoreId] : context.accessibleStoreIds;
  const clauses = [`r.store_id IN (${storeIds.map(() => "?").join(",")})`];
  const params = [...storeIds];
  appendDateFilters(clauses, params, filters);

  const [summaryRows] = await pool.query(
    `
      SELECT COUNT(*) AS totalVisits,
             COALESCE(SUM(visitor_count), 0) AS totalVisitorCount,
             COALESCE(SUM(CASE WHEN line_friend_added = 1 THEN 1 ELSE 0 END), 0) AS lineFriendAddedCount,
             COALESCE(SUM(CASE WHEN follow_up_required = 1 THEN 1 ELSE 0 END), 0) AS followUpRequiredCount
      FROM store_visit_records r
      WHERE ${clauses.join(" AND ")}
    `,
    params
  );
  const [resultRows] = await pool.query(
    `
      SELECT visit_result AS visitResult, COUNT(*) AS count
      FROM store_visit_records r
      WHERE ${clauses.join(" AND ")}
      GROUP BY visit_result
    `,
    params
  );
  const [vehicleRows] = await pool.query(
    `
      SELECT interested_vehicle AS interestedVehicle, COUNT(*) AS count
      FROM store_visit_records r
      WHERE ${clauses.join(" AND ")}
        AND interested_vehicle IS NOT NULL
        AND interested_vehicle <> ''
      GROUP BY interested_vehicle
      ORDER BY count DESC, interested_vehicle ASC
      LIMIT 5
    `,
    params
  );

  return {
    totalVisits: Number(summaryRows[0]?.totalVisits || 0),
    totalVisitorCount: Number(summaryRows[0]?.totalVisitorCount || 0),
    lineFriendAddedCount: Number(summaryRows[0]?.lineFriendAddedCount || 0),
    followUpRequiredCount: Number(summaryRows[0]?.followUpRequiredCount || 0),
    resultCounts: resultRows.reduce((map, row) => {
      map[row.visitResult] = Number(row.count || 0);
      return map;
    }, {}),
    topVehicles: vehicleRows.map((row) => ({
      interestedVehicle: row.interestedVehicle,
      count: Number(row.count || 0)
    }))
  };
}

module.exports = {
  createVisitRecord,
  getVisitRecord,
  getVisitRecords,
  getVisitRecordSummary,
  maskLineIdentifier,
  resolveVisitRecordContext,
  updateVisitRecord,
  validateVisitRecordPayload
};
