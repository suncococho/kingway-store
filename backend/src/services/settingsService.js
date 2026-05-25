const { pool } = require("../db");
const config = require("../config");
const backendPackage = require("../../package.json");

const STORE_DEFAULTS = {
  storeName: "KINGWAY 台南門市",
  storeShortName: "KINGWAY",
  address: "台南市東區東門路二段245號",
  googleMapUrl: "https://www.google.com/maps/search/?api=1&query=%E5%8F%B0%E5%8D%97%E5%B8%82%E6%9D%B1%E5%8D%80%E6%9D%B1%E9%96%80%E8%B7%AF%E4%BA%8C%E6%AE%B5245%E8%99%9F",
  lineAddFriendUrl: "",
  businessHours: "每日 13:00 - 21:00",
  contactPhone: "",
  customerServiceNote: "歡迎透過 LINE 與門市聯繫，確認庫存、維修與交車流程。",
  holidayText: "週一公休",
  lineOaDisplayName: "KINGWAY 台南門市",
  lineOaDisplayInfo: "歡迎透過 KINGWAY LINE 官方帳號聯絡門市。",
  storeDescription: "歡迎透過 LINE 與門市聯繫，確認庫存、維修與交車流程。",
  navigationNote: "到店前建議先透過 LINE 確認營業與現場狀況。",
  bulletinCopy: "最新公告請以 LINE 官方帳號與門市現場公告為準。",
  receiptDisplayInfo: "購買確認與收據內容以現場說明與 LINE 訊息為準。",
  purchaseConfirmationCopy: "請依照購買確認書內容完成簽名與確認。",
  repairReservationCopy: "送出維修預約後，請等候門市回覆確認。",
  surveyFollowUpCopy: "完修或交車後，請協助填寫回饋問卷。",
  taxRate: 0.05,
  currency: "TWD",
  amountDisplayMode: "INCLUDE_TAX",
  orderNoPrefix: "ORD",
  repairNoPrefix: "REP",
  purchaseConfirmationNoRule: "PC-{YYYY}{MM}{SEQ}",
  repairReservationWeekdays: ["TUE", "WED", "SUN"],
  basicInspectionFee: 400,
  storageFeeRule: "完修後逾期保管依門市現場規則另計。",
  depositRule: "預約單可依門市規則收取訂金，尾款以完款流程為準。",
  ebikePurchaseRule: "電動自行車購買需完成購車確認與交車說明。",
  phoneBindingRequired: true
};

const SYSTEM_DEFAULTS = {
  line: {
    clientOaEnabled: true,
    staffGroupModeEnabled: true,
    quickReplyEnabled: true,
    launcherEnabled: true
  },
  notifications: {
    repairReservation: true,
    repairEstimate: true,
    purchaseConfirmation: true,
    survey: true,
    lowStock: true,
    dailyReportSendTime: "21:00",
    pendingSummarySendTime: "09:00"
  },
  pos: {
    saveToServerRule: true,
    multipleCartEnabled: true,
    customerInfoRequiredBeforeCheckout: true,
    phoneBindingRequired: true,
    ebikeSpecialRulesSummary: "電動自行車訂單需保留購買確認、交車與優惠券規則。",
    repairSpecialRulesSummary: "維修類型需走維修預約、估價與完修流程。"
  },
  display: {
    dashboardFocusNote: "今日待確認、今日待處理、訂金未清與購買確認待處理優先顯示。",
    adminNotice: ""
  },
  permissions: {
    roles: [
      { role: "ADMIN", label: "管理員", summary: "全部功能與設定管理" },
      { role: "MANAGER", label: "經理", summary: "營運、審核、報表" },
      { role: "CASHIER", label: "收銀", summary: "POS、客戶、訂單" },
      { role: "REPAIR", label: "維修", summary: "維修預約、估價、完修" },
      { role: "INVENTORY", label: "庫存", summary: "商品、庫存、發注、退貨" }
    ],
    adminApprovalItems: ["Google 評論優惠券", "維修予約審核", "供應商退貨確認"],
    staffLineLinkSummary: "員工 LINE userId 綁定由員工資料管理頁維護。"
  },
  status: {
    deployedAt: process.env.DEPLOYED_AT || process.env.LAST_DEPLOY_AT || ""
  }
};

function safeParseJson(value, fallback) {
  if (!value) {
    return fallback;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : value ? String(value).trim() : "";
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(lowered)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(lowered)) {
      return false;
    }
  }

  return fallback;
}

function normalizeStringArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }

  return Array.isArray(fallback) ? [...fallback] : [];
}

function mergeSettings(defaults, payload) {
  const base = Array.isArray(defaults) ? [] : { ...defaults };
  if (!payload || typeof payload !== "object") {
    return base;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(payload)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = mergeSettings(merged[key], value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function normalizeStorePayload(input = {}) {
  const googleMapUrl = normalizeText(input.googleMapUrl) || normalizeText(input.mapUrl) || STORE_DEFAULTS.googleMapUrl;
  return {
    storeName: normalizeText(input.storeName) || STORE_DEFAULTS.storeName,
    storeShortName: normalizeText(input.storeShortName) || STORE_DEFAULTS.storeShortName,
    address: normalizeText(input.address) || STORE_DEFAULTS.address,
    googleMapUrl,
    mapUrl: googleMapUrl,
    businessHours: normalizeText(input.businessHours) || STORE_DEFAULTS.businessHours,
    contactPhone: normalizeText(input.contactPhone),
    customerServiceNote: normalizeText(input.customerServiceNote) || STORE_DEFAULTS.customerServiceNote,
    holidayText: normalizeText(input.holidayText) || STORE_DEFAULTS.holidayText,
    lineOaDisplayName: normalizeText(input.lineOaDisplayName) || STORE_DEFAULTS.lineOaDisplayName,
    lineAddFriendUrl: normalizeText(input.lineAddFriendUrl) || STORE_DEFAULTS.lineAddFriendUrl,
    lineOaDisplayInfo: normalizeText(input.lineOaDisplayInfo) || STORE_DEFAULTS.lineOaDisplayInfo,
    storeDescription: normalizeText(input.storeDescription) || STORE_DEFAULTS.storeDescription,
    navigationNote: normalizeText(input.navigationNote) || STORE_DEFAULTS.navigationNote,
    bulletinCopy: normalizeText(input.bulletinCopy) || STORE_DEFAULTS.bulletinCopy,
    receiptDisplayInfo: normalizeText(input.receiptDisplayInfo) || STORE_DEFAULTS.receiptDisplayInfo,
    purchaseConfirmationCopy: normalizeText(input.purchaseConfirmationCopy) || STORE_DEFAULTS.purchaseConfirmationCopy,
    repairReservationCopy: normalizeText(input.repairReservationCopy) || STORE_DEFAULTS.repairReservationCopy,
    surveyFollowUpCopy: normalizeText(input.surveyFollowUpCopy) || STORE_DEFAULTS.surveyFollowUpCopy,
    taxRate: normalizeNumber(input.taxRate, STORE_DEFAULTS.taxRate),
    currency: normalizeText(input.currency) || STORE_DEFAULTS.currency,
    amountDisplayMode: normalizeText(input.amountDisplayMode) || STORE_DEFAULTS.amountDisplayMode,
    orderNoPrefix: normalizeText(input.orderNoPrefix) || STORE_DEFAULTS.orderNoPrefix,
    repairNoPrefix: normalizeText(input.repairNoPrefix) || STORE_DEFAULTS.repairNoPrefix,
    purchaseConfirmationNoRule: normalizeText(input.purchaseConfirmationNoRule) || STORE_DEFAULTS.purchaseConfirmationNoRule,
    repairReservationWeekdays: normalizeStringArray(input.repairReservationWeekdays, STORE_DEFAULTS.repairReservationWeekdays),
    basicInspectionFee: normalizeNumber(input.basicInspectionFee, STORE_DEFAULTS.basicInspectionFee),
    storageFeeRule: normalizeText(input.storageFeeRule) || STORE_DEFAULTS.storageFeeRule,
    depositRule: normalizeText(input.depositRule) || STORE_DEFAULTS.depositRule,
    ebikePurchaseRule: normalizeText(input.ebikePurchaseRule) || STORE_DEFAULTS.ebikePurchaseRule,
    phoneBindingRequired: normalizeBoolean(input.phoneBindingRequired, STORE_DEFAULTS.phoneBindingRequired)
  };
}

function normalizeSystemPayload(input = {}) {
  const line = input.line && typeof input.line === "object" ? input.line : {};
  const notifications = input.notifications && typeof input.notifications === "object" ? input.notifications : {};
  const pos = input.pos && typeof input.pos === "object" ? input.pos : {};
  const display = input.display && typeof input.display === "object" ? input.display : {};
  const permissions = input.permissions && typeof input.permissions === "object" ? input.permissions : {};
  const status = input.status && typeof input.status === "object" ? input.status : {};

  return {
    line: {
      clientOaEnabled: normalizeBoolean(line.clientOaEnabled, SYSTEM_DEFAULTS.line.clientOaEnabled),
      staffGroupModeEnabled: normalizeBoolean(line.staffGroupModeEnabled, SYSTEM_DEFAULTS.line.staffGroupModeEnabled),
      quickReplyEnabled: normalizeBoolean(line.quickReplyEnabled, SYSTEM_DEFAULTS.line.quickReplyEnabled),
      launcherEnabled: normalizeBoolean(line.launcherEnabled, SYSTEM_DEFAULTS.line.launcherEnabled)
    },
    notifications: {
      repairReservation: normalizeBoolean(notifications.repairReservation, SYSTEM_DEFAULTS.notifications.repairReservation),
      repairEstimate: normalizeBoolean(notifications.repairEstimate, SYSTEM_DEFAULTS.notifications.repairEstimate),
      purchaseConfirmation: normalizeBoolean(
        notifications.purchaseConfirmation,
        SYSTEM_DEFAULTS.notifications.purchaseConfirmation
      ),
      survey: normalizeBoolean(notifications.survey, SYSTEM_DEFAULTS.notifications.survey),
      lowStock: normalizeBoolean(notifications.lowStock, SYSTEM_DEFAULTS.notifications.lowStock),
      dailyReportSendTime: normalizeText(notifications.dailyReportSendTime) || SYSTEM_DEFAULTS.notifications.dailyReportSendTime,
      pendingSummarySendTime:
        normalizeText(notifications.pendingSummarySendTime) || SYSTEM_DEFAULTS.notifications.pendingSummarySendTime
    },
    pos: {
      saveToServerRule: normalizeBoolean(pos.saveToServerRule, SYSTEM_DEFAULTS.pos.saveToServerRule),
      multipleCartEnabled: normalizeBoolean(pos.multipleCartEnabled, SYSTEM_DEFAULTS.pos.multipleCartEnabled),
      customerInfoRequiredBeforeCheckout: normalizeBoolean(
        pos.customerInfoRequiredBeforeCheckout,
        SYSTEM_DEFAULTS.pos.customerInfoRequiredBeforeCheckout
      ),
      phoneBindingRequired: normalizeBoolean(pos.phoneBindingRequired, SYSTEM_DEFAULTS.pos.phoneBindingRequired),
      ebikeSpecialRulesSummary:
        normalizeText(pos.ebikeSpecialRulesSummary) || SYSTEM_DEFAULTS.pos.ebikeSpecialRulesSummary,
      repairSpecialRulesSummary:
        normalizeText(pos.repairSpecialRulesSummary) || SYSTEM_DEFAULTS.pos.repairSpecialRulesSummary
    },
    display: {
      dashboardFocusNote: normalizeText(display.dashboardFocusNote) || SYSTEM_DEFAULTS.display.dashboardFocusNote,
      adminNotice: normalizeText(display.adminNotice)
    },
    permissions: {
      roles: Array.isArray(permissions.roles) ? permissions.roles : SYSTEM_DEFAULTS.permissions.roles,
      adminApprovalItems: normalizeStringArray(
        permissions.adminApprovalItems,
        SYSTEM_DEFAULTS.permissions.adminApprovalItems
      ),
      staffLineLinkSummary:
        normalizeText(permissions.staffLineLinkSummary) || SYSTEM_DEFAULTS.permissions.staffLineLinkSummary
    },
    status: {
      deployedAt: normalizeText(status.deployedAt) || SYSTEM_DEFAULTS.status.deployedAt
    }
  };
}

function scopeFromRow(scope, row) {
  const payload = safeParseJson(row?.payloadJson, null);
  if (scope === "STORE") {
    return normalizeStorePayload(mergeSettings(STORE_DEFAULTS, payload));
  }
  return normalizeSystemPayload(mergeSettings(SYSTEM_DEFAULTS, payload));
}

let appSettingsStoreIdColumnExists = null;

async function appSettingsHasStoreIdColumn() {
  if (appSettingsStoreIdColumnExists !== null) {
    return appSettingsStoreIdColumnExists;
  }

  const [rows] = await pool.query(
    `
      SELECT COUNT(*) AS columnCount
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'app_settings'
        AND COLUMN_NAME = 'store_id'
    `
  );

  appSettingsStoreIdColumnExists = Number(rows[0]?.columnCount || 0) > 0;
  return appSettingsStoreIdColumnExists;
}

async function loadSettingsRows(storeId = null) {
  if (storeId !== null && (await appSettingsHasStoreIdColumn())) {
    const [rows] = await pool.query(
      `
        SELECT setting_scope AS settingScope, payload_json AS payloadJson
        FROM app_settings
        WHERE store_id = ?
          AND setting_scope IN ('STORE', 'SYSTEM')
      `,
      [storeId]
    );
    return rows;
  }

  const [rows] = await pool.query(
    `
      SELECT setting_scope AS settingScope, payload_json AS payloadJson
      FROM app_settings
      WHERE setting_scope IN ('STORE', 'SYSTEM')
    `
  );
  return rows;
}

async function saveSettingsScope(storeId, scope, payload, updatedByStaffId = null) {
  const normalized = scope === "STORE" ? normalizeStorePayload(payload) : normalizeSystemPayload(payload);
  const payloadJson = JSON.stringify(normalized);

  if (storeId !== null && (await appSettingsHasStoreIdColumn())) {
    const [updateResult] = await pool.query(
      `
        UPDATE app_settings
        SET payload_json = ?, updated_by_staff_id = ?
        WHERE store_id = ?
          AND setting_scope = ?
      `,
      [payloadJson, updatedByStaffId, storeId, scope]
    );

    if (Number(updateResult.affectedRows || 0) === 0) {
      const [[existingRow]] = await pool.query(
        `
          SELECT COUNT(*) AS rowCount
          FROM app_settings
          WHERE store_id = ?
            AND setting_scope = ?
        `,
        [storeId, scope]
      );

      if (Number(existingRow?.rowCount || 0) === 0) {
        await pool.query(
          `
            INSERT INTO app_settings (store_id, setting_scope, payload_json, updated_by_staff_id)
            VALUES (?, ?, ?, ?)
          `,
          [storeId, scope, payloadJson, updatedByStaffId]
        );
      }
    }

    return normalized;
  }

  await pool.query(
    `
      INSERT INTO app_settings (setting_scope, payload_json, updated_by_staff_id)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        payload_json = VALUES(payload_json),
        updated_by_staff_id = VALUES(updated_by_staff_id)
    `,
    [scope, payloadJson, updatedByStaffId]
  );
  return normalized;
}

async function seedDefaultSettings(storeId = 1) {
  if (storeId !== null && (await appSettingsHasStoreIdColumn())) {
    await saveSettingsScope(storeId, "STORE", STORE_DEFAULTS, null);
    await saveSettingsScope(storeId, "SYSTEM", SYSTEM_DEFAULTS, null);
    return;
  }

  await pool.query(
    `
      INSERT INTO app_settings (setting_scope, payload_json)
      VALUES (?, ?), (?, ?)
      ON DUPLICATE KEY UPDATE
        payload_json = payload_json
    `,
    [
      "STORE",
      JSON.stringify(STORE_DEFAULTS),
      "SYSTEM",
      JSON.stringify(SYSTEM_DEFAULTS)
    ]
  );
}

async function getSettingsSnapshot(storeId) {
  const rows = await loadSettingsRows(storeId);
  const storeRow = rows.find((row) => row.settingScope === "STORE") || null;
  const systemRow = rows.find((row) => row.settingScope === "SYSTEM") || null;
  const store = scopeFromRow("STORE", storeRow);
  const system = scopeFromRow("SYSTEM", systemRow);

  const [[staffLinkSummary]] = await pool.query(
    `
      SELECT
        COUNT(*) AS totalStaff,
        SUM(CASE WHEN line_user_id IS NOT NULL AND line_user_id <> '' THEN 1 ELSE 0 END) AS linkedStaff,
        SUM(CASE WHEN line_user_id IS NULL OR line_user_id = '' THEN 1 ELSE 0 END) AS unlinkedStaff
      FROM staff_users
    `
  );

  const [[webhookSummary]] = await pool.query(
    `
      SELECT
        MAX(CASE WHEN event_type = 'line_webhook_received' THEN created_at END) AS latestWebhookReceivedAt,
        MAX(CASE WHEN event_type = 'daily_report_sent' THEN created_at END) AS latestDailyReportSentAt,
        MAX(CASE WHEN event_type = 'system_error' THEN created_at END) AS latestErrorAt
      FROM v2_workflow_events
    `
  );

  const [latestErrorRows] = await pool.query(
    `
      SELECT payload, created_at AS createdAt
      FROM v2_workflow_events
      WHERE event_type = 'system_error'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `
  );

  const [groupRows] = await pool.query(
    `
      SELECT
        id,
        line_group_id AS lineGroupId,
        source_type AS sourceType,
        registration_type AS registrationType,
        group_name AS groupName,
        is_active AS isActive,
        updated_at AS updatedAt
      FROM line_group_registrations
      ORDER BY updated_at DESC, id DESC
    `
  );

  return {
    store,
    system,
    summary: {
      store: {
        storeName: store.storeName,
        storeShortName: store.storeShortName,
        address: store.address,
        googleMapUrl: store.googleMapUrl,
        mapUrl: store.googleMapUrl,
        businessHours: store.businessHours,
        contactPhone: store.contactPhone || "-",
        customerServiceNote: store.customerServiceNote,
        holidayText: store.holidayText,
        lineOaDisplayName: store.lineOaDisplayName,
        lineAddFriendUrl: store.lineAddFriendUrl,
        lineOaDisplayInfo: store.lineOaDisplayInfo,
        storeDescription: store.storeDescription,
        navigationNote: store.navigationNote,
        bulletinCopy: store.bulletinCopy,
        receiptDisplayInfo: store.receiptDisplayInfo
      },
      line: {
        webhookStatus: config.line.channelSecret ? "已啟用" : "未啟用",
        channelAccessTokenStatus: config.line.channelAccessToken ? "已設定" : "未設定",
        channelSecretStatus: config.line.channelSecret ? "已設定" : "未設定",
        clientOaEnabledStatus: system.line.clientOaEnabled ? "已啟用" : "未啟用",
        staffGroupModeStatus: system.line.staffGroupModeEnabled ? "已啟用" : "未啟用",
        webhookPath: "/api/line/webhook",
        webhookSignatureStatus: config.line.channelSecret ? "已啟用" : "未啟用",
        unifiedQaGroupMode: config.line.unifiedQaGroupMode,
        qaGroupIdStatus: config.line.qaGroupId ? "已設定" : "未設定",
        quickReplyStatus: system.line.quickReplyEnabled ? "已啟用" : "未啟用",
        launcherStatus: system.line.launcherEnabled ? "已啟用" : "未啟用"
      },
      groups: {
        total: groupRows.length,
        staff: groupRows.filter((row) => row.registrationType === "staff"),
        admin: groupRows.filter((row) => row.registrationType === "admin"),
        repair: groupRows.filter((row) => row.registrationType === "repair"),
        inventory: groupRows.filter((row) => row.registrationType === "inventory"),
        daily: groupRows.filter((row) => row.registrationType === "daily")
      },
      notifications: system.notifications,
      permissions: {
        ...system.permissions,
        staffLinkSummary,
        staffLinkedStatus: `${Number(staffLinkSummary.linkedStaff || 0)} / ${Number(staffLinkSummary.totalStaff || 0)} 已綁定`
      },
      pos: {
        ...system.pos,
        saveToServerStatus: system.pos.saveToServerRule ? "已啟用" : "未啟用",
        multipleCartStatus: system.pos.multipleCartEnabled ? "已啟用" : "未啟用",
        customerInfoRequiredStatus: system.pos.customerInfoRequiredBeforeCheckout ? "必填" : "非必填",
        phoneBindingRequiredStatus: system.pos.phoneBindingRequired ? "必填" : "非必填"
      },
      systemStatus: {
        dbStatus: "已連線",
        lineStatus: config.line.channelAccessToken ? "已連線" : "未連線",
        latestWebhookReceivedAt: webhookSummary.latestWebhookReceivedAt || null,
        latestDailyReportSentAt: webhookSummary.latestDailyReportSentAt || null,
        latestErrorSummary:
          latestErrorRows[0]?.payload
            ? safeParseJson(latestErrorRows[0].payload, null)?.message ||
              safeParseJson(latestErrorRows[0].payload, null)?.error ||
              "系統錯誤已記錄"
            : "目前無錯誤紀錄",
        version: backendPackage.version,
        deployedAt: system.status.deployedAt || "",
        pendingSummarySendTime: system.notifications.pendingSummarySendTime,
        dailyReportSendTime: system.notifications.dailyReportSendTime
      }
    }
  };
}

async function getPublicStoreSettings(storeId = 1) {
  const rows = await loadSettingsRows(storeId);
  const storeRow = rows.find((row) => row.settingScope === "STORE") || null;
  return scopeFromRow("STORE", storeRow);
}

module.exports = {
  STORE_DEFAULTS,
  SYSTEM_DEFAULTS,
  getSettingsSnapshot,
  getPublicStoreSettings,
  normalizeStorePayload,
  normalizeSystemPayload,
  saveSettingsScope,
  seedDefaultSettings
};
