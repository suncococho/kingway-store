const { pool } = require("../db");
const { createNotification } = require("./staffNotificationService");
const { createKpiEventOnce } = require("./staffKpiService");

const HQ_RELATIONSHIP_TYPES = new Set(["HEADQUARTERS", "WAREHOUSE"]);
const MANAGER_ROLES = new Set(["ADMIN", "MANAGER"]);
const STORE_MANAGER_ROLES = new Set(["owner", "admin", "manager"]);
const VALID_PRIORITIES = new Set(["LOW", "NORMAL", "IMPORTANT", "URGENT"]);
const VALID_STATUSES = new Set(["PENDING", "DONE", "SKIPPED"]);
const VALID_CATEGORIES = new Set(["OPENING", "MIDDAY", "CLOSING", "CUSTOMER", "INVENTORY", "SAFETY", "GENERAL"]);
const DEFAULT_TASKS = [
  { title: "門市清潔與地面整理", category: "OPENING", dueTime: "13:00:00", priority: "NORMAL", sortOrder: 10 },
  { title: "展示車排列與外觀確認", category: "OPENING", dueTime: "13:00:00", priority: "NORMAL", sortOrder: 20 },
  { title: "試乘車煞車、輪胎與電源確認", category: "OPENING", dueTime: "13:00:00", priority: "IMPORTANT", sortOrder: 30 },
  { title: "電池充電狀態確認", category: "OPENING", dueTime: "13:00:00", priority: "IMPORTANT", sortOrder: 40 },
  { title: "充電器與電源線整理", category: "OPENING", dueTime: "13:00:00", priority: "NORMAL", sortOrder: 50 },
  { title: "POS / LINE / Telegram 未處理提醒確認", category: "OPENING", dueTime: "13:00:00", priority: "IMPORTANT", sortOrder: 60 },
  { title: "未處理訂單預約確認", category: "MIDDAY", dueTime: "17:00:00", priority: "IMPORTANT", sortOrder: 110 },
  { title: "未處理維修預約確認", category: "MIDDAY", dueTime: "17:00:00", priority: "IMPORTANT", sortOrder: 120 },
  { title: "門市請貨 / 本部出貨 / 門市入庫狀態確認", category: "MIDDAY", dueTime: "17:00:00", priority: "NORMAL", sortOrder: 130 },
  { title: "供應商入庫 / 退貨未處理確認", category: "MIDDAY", dueTime: "17:00:00", priority: "NORMAL", sortOrder: 140 },
  { title: "客戶聯絡漏接確認", category: "MIDDAY", dueTime: "17:00:00", priority: "IMPORTANT", sortOrder: 150 },
  { title: "當日付款與現金確認", category: "CLOSING", dueTime: "20:30:00", priority: "IMPORTANT", sortOrder: 210 },
  { title: "當日訂單與維修狀態確認", category: "CLOSING", dueTime: "20:30:00", priority: "IMPORTANT", sortOrder: 220 },
  { title: "購買確認書未完成訂單確認", category: "CLOSING", dueTime: "20:30:00", priority: "IMPORTANT", sortOrder: 230 },
  { title: "維修完成確認書未完成案件確認", category: "CLOSING", dueTime: "20:30:00", priority: "IMPORTANT", sortOrder: 240 },
  { title: "電池充電連接", category: "CLOSING", dueTime: "20:30:00", priority: "URGENT", sortOrder: 250 },
  { title: "展示區整理", category: "CLOSING", dueTime: "20:30:00", priority: "NORMAL", sortOrder: 260 },
  { title: "門鎖、電源與充電安全確認", category: "SAFETY", dueTime: "20:30:00", priority: "URGENT", sortOrder: 270 }
];

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

function normalizePriority(value) {
  const priority = String(value || "NORMAL").trim().toUpperCase();
  return VALID_PRIORITIES.has(priority) ? priority : "NORMAL";
}

function normalizeCategory(value) {
  const category = String(value || "GENERAL").trim().toUpperCase();
  return VALID_CATEGORIES.has(category) ? category : "GENERAL";
}

function normalizeTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  return `${match[1]}:${match[2]}:${match[3] || "00"}`;
}

function getTaipeiDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function normalizeDateString(value) {
  if (!value) return "";
  if (value instanceof Date) return getTaipeiDateString(value);
  return String(value).slice(0, 10);
}

function buildDueAt(taskDate, dueTime) {
  const normalizedTime = normalizeTime(dueTime);
  return normalizedTime ? `${taskDate} ${normalizedTime}` : null;
}

function assertManagePermission(context) {
  if (!context.canManageSettings) {
    const error = new Error("沒有每日任務設定權限");
    error.statusCode = 403;
    throw error;
  }
}

async function resolveDailyTaskContext(req, connection = pool) {
  const staffUserId = toPositiveInteger(req.user?.id);
  const storeId = toPositiveInteger(req.storeId ?? req.user?.storeId);
  if (!staffUserId || !storeId) {
    const error = new Error("Store scope required");
    error.statusCode = 403;
    throw error;
  }

  const [relations] = await connection.query(
    `
      SELECT company_id AS companyId, relationship_type AS relationshipType
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

  const role = normalizeRole(req.user?.role);
  const storeRole = normalizeStoreRole(req.user?.storeRole || req.user?.store_role);

  return {
    staffUserId,
    storeId,
    companyIds,
    storeTypes,
    hqCompanyIds,
    isHqStore: hqCompanyIds.length > 0,
    isIndependent: companyIds.length === 0,
    canManageSettings: MANAGER_ROLES.has(role) || STORE_MANAGER_ROLES.has(storeRole)
  };
}

function buildEligibleTaskWhere(context, alias = "dst", enabledOnly = true) {
  const clauses = [];
  const params = [];
  if (enabledOnly) {
    clauses.push(`${alias}.enabled = 1`);
  }

  const scopeClauses = [`${alias}.store_id = ?`];
  const scopeParams = [context.storeId];

  if (context.companyIds.length) {
    scopeClauses.push(`(${alias}.store_id IS NULL AND ${alias}.company_id IN (${context.companyIds.map(() => "?").join(",")}))`);
    scopeParams.push(...context.companyIds);
  }

  if (context.storeTypes.length) {
    scopeClauses.push(`(${alias}.store_id IS NULL AND ${alias}.company_id IS NULL AND ${alias}.store_type IN (${context.storeTypes.map(() => "?").join(",")}))`);
    scopeParams.push(...context.storeTypes);
  }

  scopeClauses.push(`(${alias}.store_id IS NULL AND ${alias}.company_id IS NULL AND ${alias}.store_type IS NULL)`);
  clauses.push(`(${scopeClauses.join(" OR ")})`);
  params.push(...scopeParams);

  return {
    where: clauses.join(" AND "),
    params
  };
}

function selectInstanceColumns(alias = "sti") {
  return `
    ${alias}.id,
    ${alias}.task_id AS taskId,
    ${alias}.company_id AS companyId,
    ${alias}.store_id AS storeId,
    ${alias}.task_date AS taskDate,
    ${alias}.title,
    ${alias}.description,
    ${alias}.category,
    ${alias}.due_at AS dueAt,
    ${alias}.priority,
    ${alias}.status,
    ${alias}.completed_by_staff_user_id AS completedByStaffUserId,
    ${alias}.completed_at AS completedAt,
    ${alias}.skipped_by_staff_user_id AS skippedByStaffUserId,
    ${alias}.skipped_at AS skippedAt,
    ${alias}.note,
    ${alias}.created_at AS createdAt,
    ${alias}.updated_at AS updatedAt,
    CASE WHEN ${alias}.status = 'PENDING' AND ${alias}.due_at IS NOT NULL AND ${alias}.due_at < NOW() THEN 1 ELSE 0 END AS isOverdue
  `;
}

function normalizeInstance(row) {
  return {
    id: Number(row.id),
    taskId: Number(row.taskId),
    companyId: row.companyId == null ? null : Number(row.companyId),
    storeId: Number(row.storeId),
    taskDate: row.taskDate,
    title: row.title,
    description: row.description,
    category: row.category,
    dueAt: row.dueAt,
    priority: row.priority,
    status: row.status,
    completedByStaffUserId: row.completedByStaffUserId == null ? null : Number(row.completedByStaffUserId),
    completedAt: row.completedAt,
    skippedByStaffUserId: row.skippedByStaffUserId == null ? null : Number(row.skippedByStaffUserId),
    skippedAt: row.skippedAt,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isOverdue: Boolean(row.isOverdue)
  };
}

function summarizeInstances(instances) {
  return instances.reduce((summary, task) => {
    summary.total += 1;
    if (task.status === "PENDING") summary.pending += 1;
    if (task.status === "DONE") summary.done += 1;
    if (task.status === "SKIPPED") summary.skipped += 1;
    if (task.isOverdue) summary.overdue += 1;
    return summary;
  }, { total: 0, pending: 0, done: 0, skipped: 0, overdue: 0 });
}

async function selectTodayInstances(context, taskDate = getTaipeiDateString(), connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT ${selectInstanceColumns("sti")}
      FROM staff_task_instances sti
      WHERE sti.store_id = ?
        AND sti.task_date = ?
      ORDER BY FIELD(sti.category, 'OPENING', 'MIDDAY', 'CLOSING', 'CUSTOMER', 'INVENTORY', 'SAFETY', 'GENERAL'),
               sti.due_at IS NULL,
               sti.due_at ASC,
               sti.id ASC
    `,
    [context.storeId, taskDate]
  );
  return rows.map(normalizeInstance);
}

async function ensureTodayTaskInstances(context, taskDate = getTaipeiDateString(), connection = pool) {
  const scope = buildEligibleTaskWhere(context, "dst", true);
  const [tasks] = await connection.query(
    `
      SELECT id, company_id AS companyId, title, description, category, due_time AS dueTime, priority
      FROM daily_staff_tasks dst
      WHERE ${scope.where}
      ORDER BY sort_order ASC, due_time ASC, id ASC
    `,
    scope.params
  );

  for (const task of tasks) {
    await connection.query(
      `
        INSERT IGNORE INTO staff_task_instances (
          task_id,
          company_id,
          store_id,
          task_date,
          title,
          description,
          category,
          due_at,
          priority
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        task.id,
        task.companyId || context.companyIds[0] || null,
        context.storeId,
        taskDate,
        task.title,
        task.description || null,
        normalizeCategory(task.category),
        buildDueAt(taskDate, task.dueTime),
        normalizePriority(task.priority)
      ]
    );
  }

  return selectTodayInstances(context, taskDate, connection);
}

async function createOverdueTaskNotifications(context, instances, connection = pool) {
  for (const task of instances.filter((item) => item.isOverdue)) {
    try {
      await createNotification({
        companyId: task.companyId || context.companyIds[0] || null,
        storeId: context.storeId,
        type: "DAILY_TASK_OVERDUE",
        title: "今日任務未完成",
        message: `${task.title} 尚未完成，請至今日任務確認。`,
        targetUrl: "/daily-tasks",
        refType: "STAFF_TASK_INSTANCE",
        refId: task.id,
        priority: task.priority === "URGENT" ? "URGENT" : "IMPORTANT",
        dueAt: task.dueAt || null
      }, connection);
    } catch (error) {
      console.warn("[daily-tasks] overdue notification failed", {
        taskInstanceId: task.id,
        message: error.message
      });
    }
  }
}

async function getTodayTasks(context, options = {}, connection = pool) {
  const taskDate = options.date || getTaipeiDateString();
  const tasks = await ensureTodayTaskInstances(context, taskDate, connection);
  if (options.createNotifications !== false) {
    await createOverdueTaskNotifications(context, tasks, connection);
  }
  return {
    taskDate,
    tasks,
    summary: summarizeInstances(tasks)
  };
}

async function getDailyTaskSummary(context, options = {}, connection = pool) {
  const result = await getTodayTasks(context, {
    date: options.date || getTaipeiDateString(),
    createNotifications: options.createNotifications === true
  }, connection);
  return {
    dailyTasks: result.summary.pending,
    overdueDailyTasks: result.summary.overdue
  };
}

async function getTaskInstances(context, filters = {}, connection = pool) {
  const clauses = ["sti.store_id = ?"];
  const params = [context.storeId];
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.date || "")) ? filters.date : null;
  if (date) {
    clauses.push("sti.task_date = ?");
    params.push(date);
  }
  const status = String(filters.status || "").trim().toUpperCase();
  if (VALID_STATUSES.has(status)) {
    clauses.push("sti.status = ?");
    params.push(status);
  }
  const category = normalizeCategory(filters.category || "");
  if (filters.category && category) {
    clauses.push("sti.category = ?");
    params.push(category);
  }

  const [rows] = await connection.query(
    `
      SELECT ${selectInstanceColumns("sti")}
      FROM staff_task_instances sti
      WHERE ${clauses.join(" AND ")}
      ORDER BY sti.task_date DESC, sti.due_at IS NULL, sti.due_at ASC, sti.id DESC
      LIMIT 300
    `,
    params
  );
  return rows.map(normalizeInstance);
}

async function updateInstanceStatus(instanceId, context, action, note = null, connection = pool) {
  const id = toPositiveInteger(instanceId);
  if (!id) {
    const error = new Error("任務不存在");
    error.statusCode = 404;
    throw error;
  }

  const [rows] = await connection.query(
    `SELECT id, status, task_date AS taskDate FROM staff_task_instances WHERE id = ? AND store_id = ? LIMIT 1`,
    [id, context.storeId]
  );
  if (!rows[0]) {
    const error = new Error("任務不存在或無權限");
    error.statusCode = 404;
    throw error;
  }
  if (normalizeDateString(rows[0].taskDate) !== getTaipeiDateString()) {
    const error = new Error("此每日任務已過期，請處理今日任務");
    error.statusCode = 409;
    throw error;
  }

  if (action === "done") {
    await connection.query(
      `
        UPDATE staff_task_instances
        SET status = 'DONE',
            completed_by_staff_user_id = ?,
            completed_at = NOW(),
            skipped_by_staff_user_id = NULL,
            skipped_at = NULL,
            note = ?
        WHERE id = ?
          AND store_id = ?
      `,
      [context.staffUserId, note, id, context.storeId]
    );
    await connection.query(
      `
        UPDATE staff_notifications
        SET status = 'DONE',
            done_at = NOW(),
            done_by_staff_user_id = ?
        WHERE ref_type = 'STAFF_TASK_INSTANCE'
          AND ref_id = ?
          AND store_id = ?
          AND status IN ('UNREAD', 'READ', 'SNOOZED')
      `,
      [context.staffUserId, id, context.storeId]
    );
  } else if (action === "skip") {
    await connection.query(
      `
        UPDATE staff_task_instances
        SET status = 'SKIPPED',
            skipped_by_staff_user_id = ?,
            skipped_at = NOW(),
            completed_by_staff_user_id = NULL,
            completed_at = NULL,
            note = ?
        WHERE id = ?
          AND store_id = ?
      `,
      [context.staffUserId, note, id, context.storeId]
    );
    await connection.query(
      `
        UPDATE staff_notifications
        SET status = 'DISMISSED',
            dismissed_at = NOW(),
            dismissed_by_staff_user_id = ?
        WHERE ref_type = 'STAFF_TASK_INSTANCE'
          AND ref_id = ?
          AND store_id = ?
          AND status IN ('UNREAD', 'READ', 'SNOOZED')
      `,
      [context.staffUserId, id, context.storeId]
    );
  }

  const [updated] = await connection.query(
    `SELECT ${selectInstanceColumns("sti")} FROM staff_task_instances sti WHERE sti.id = ? LIMIT 1`,
    [id]
  );
  const task = normalizeInstance(updated[0]);
  try {
    if (action === "done") {
      await createKpiEventOnce({
        companyId: task.companyId || context.companyIds[0] || null,
        storeId: task.storeId,
        staffUserId: context.staffUserId,
        eventType: "DAILY_TASK_DONE",
        refType: "STAFF_TASK_INSTANCE",
        refId: task.id,
        title: `今日任務完成：${task.title}`,
        score: task.isOverdue ? 1 : 2,
        occurredAt: task.completedAt,
        dueAt: task.dueAt,
        completedAt: task.completedAt,
        isLate: task.isOverdue,
        metadata: { category: task.category, priority: task.priority }
      }, connection);
    } else if (action === "skip") {
      await createKpiEventOnce({
        companyId: task.companyId || context.companyIds[0] || null,
        storeId: task.storeId,
        staffUserId: context.staffUserId,
        eventType: "DAILY_TASK_SKIPPED",
        refType: "STAFF_TASK_INSTANCE",
        refId: task.id,
        title: `今日任務略過：${task.title}`,
        score: 0,
        occurredAt: task.skippedAt,
        dueAt: task.dueAt,
        completedAt: task.skippedAt,
        isLate: task.isOverdue,
        metadata: { category: task.category, priority: task.priority }
      }, connection);
    }
  } catch (kpiError) {
    console.warn("[staff-kpi] daily task KPI event failed", {
      taskInstanceId: task.id,
      action,
      message: kpiError.message
    });
  }
  return task;
}

async function getTaskSettings(context, connection = pool) {
  const scope = buildEligibleTaskWhere(context, "dst", false);
  const [rows] = await connection.query(
    `
      SELECT id,
             company_id AS companyId,
             store_id AS storeId,
             store_type AS storeType,
             title,
             description,
             category,
             due_time AS dueTime,
             repeat_rule AS repeatRule,
             priority,
             is_required AS isRequired,
             enabled,
             sort_order AS sortOrder,
             created_at AS createdAt,
             updated_at AS updatedAt
      FROM daily_staff_tasks dst
      WHERE ${scope.where}
      ORDER BY enabled DESC, sort_order ASC, due_time ASC, id ASC
    `,
    scope.params
  );
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    companyId: row.companyId == null ? null : Number(row.companyId),
    storeId: row.storeId == null ? null : Number(row.storeId),
    isRequired: Boolean(row.isRequired),
    enabled: Boolean(row.enabled)
  }));
}

async function createTaskSetting(context, input = {}, connection = pool) {
  assertManagePermission(context);
  const title = String(input.title || "").trim();
  if (!title) {
    const error = new Error("請輸入任務名稱");
    error.statusCode = 400;
    throw error;
  }

  const scope = String(input.scope || "STORE").trim().toUpperCase();
  let companyId = null;
  let storeId = context.storeId;
  let storeType = null;

  if (context.isHqStore && scope === "COMPANY") {
    companyId = context.hqCompanyIds[0] || context.companyIds[0] || null;
    storeId = null;
  } else if (context.isHqStore && scope === "STORE_TYPE") {
    storeId = null;
    storeType = String(input.storeType || "").trim().toUpperCase() || null;
  }

  const [result] = await connection.query(
    `
      INSERT INTO daily_staff_tasks (
        company_id,
        store_id,
        store_type,
        title,
        description,
        category,
        due_time,
        priority,
        is_required,
        enabled,
        sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      companyId,
      storeId,
      storeType,
      title,
      input.description == null ? null : String(input.description),
      normalizeCategory(input.category),
      normalizeTime(input.dueTime),
      normalizePriority(input.priority),
      input.isRequired === false ? 0 : 1,
      input.enabled === false ? 0 : 1,
      Number.isSafeInteger(Number(input.sortOrder)) ? Number(input.sortOrder) : 0
    ]
  );

  const settings = await getTaskSettings(context, connection);
  return settings.find((item) => item.id === Number(result.insertId));
}

async function updateTaskSetting(taskId, context, input = {}, connection = pool) {
  assertManagePermission(context);
  const id = toPositiveInteger(taskId);
  const settings = await getTaskSettings(context, connection);
  if (!settings.some((item) => item.id === id)) {
    const error = new Error("每日任務不存在或無權限");
    error.statusCode = 404;
    throw error;
  }

  const fields = [];
  const params = [];
  const fieldMap = [
    ["title", "title", (value) => String(value || "").trim()],
    ["description", "description", (value) => (value == null ? null : String(value))],
    ["category", "category", normalizeCategory],
    ["dueTime", "due_time", normalizeTime],
    ["priority", "priority", normalizePriority],
    ["enabled", "enabled", (value) => (value ? 1 : 0)],
    ["isRequired", "is_required", (value) => (value ? 1 : 0)],
    ["sortOrder", "sort_order", (value) => (Number.isSafeInteger(Number(value)) ? Number(value) : 0)]
  ];

  for (const [key, column, normalizer] of fieldMap) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      const value = normalizer(input[key]);
      if (key === "title" && !value) continue;
      fields.push(`${column} = ?`);
      params.push(value);
    }
  }

  if (fields.length) {
    await connection.query(
      `UPDATE daily_staff_tasks SET ${fields.join(", ")} WHERE id = ?`,
      [...params, id]
    );
  }

  const updated = await getTaskSettings(context, connection);
  return updated.find((item) => item.id === id);
}

async function seedDefaultTasks(context, connection = pool) {
  assertManagePermission(context);
  let inserted = 0;
  for (const task of DEFAULT_TASKS) {
    const [existing] = await connection.query(
      `
        SELECT id
        FROM daily_staff_tasks
        WHERE store_id = ?
          AND title = ?
        LIMIT 1
      `,
      [context.storeId, task.title]
    );
    if (existing[0]) continue;
    await connection.query(
      `
        INSERT INTO daily_staff_tasks (
          company_id,
          store_id,
          title,
          description,
          category,
          due_time,
          priority,
          sort_order
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        context.companyIds[0] || null,
        context.storeId,
        task.title,
        task.description || null,
        task.category,
        task.dueTime,
        task.priority,
        task.sortOrder
      ]
    );
    inserted += 1;
  }
  return {
    inserted,
    settings: await getTaskSettings(context, connection)
  };
}

module.exports = {
  createTaskSetting,
  getDailyTaskSummary,
  getTaskInstances,
  getTaskSettings,
  getTodayTasks,
  resolveDailyTaskContext,
  seedDefaultTasks,
  updateInstanceStatus,
  updateTaskSetting
};
