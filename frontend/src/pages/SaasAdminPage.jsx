import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import { getStoredPlatformUser, platformRequest } from "../lib/platformAuth";
import { startImpersonationSession } from "../lib/auth";

const PLAN_OPTIONS = [
  { value: "ALL", label: "全部方案" },
  { value: "free", label: "免費版" },
  { value: "premium", label: "進階版" },
  { value: "trial", label: "試用版" },
  { value: "single_store", label: "單店版" }
];
const EDITABLE_PLAN_OPTIONS = PLAN_OPTIONS.filter((option) => ["free", "premium"].includes(option.value));
const STATUS_OPTIONS = [
  { value: "ALL", label: "全部狀態" },
  { value: "active", label: "啟用" },
  { value: "inactive", label: "停用" },
  { value: "suspended", label: "暫停" }
];
const EDITABLE_STATUS_OPTIONS = STATUS_OPTIONS.filter((option) => option.value !== "ALL");
const DEFAULT_CREATE_FORM = {
  code: "",
  name: "",
  slug: "",
  ownerUsername: "",
  ownerPassword: "",
  ownerName: "",
  plan: "trial"
};
const DEFAULT_SETTINGS_FORM = {
  displayName: "",
  address: "",
  phone: "",
  businessHours: "",
  timezone: "Asia/Taipei",
  defaultLanguage: "zh-TW",
  invoiceDisplayName: "",
  businessNumber: ""
};
const IMPERSONATION_TTL_LABEL = "2 小時";
const STORE_ROLE_LABEL = {
  owner: "Owner",
  admin: "Admin",
  staff: "Staff"
};
const AUDIT_ACTION_PRESETS = [
  { value: "", label: "全部" },
  { value: "store.impersonation.start", label: "store.impersonation.start（啟用模擬登入）" },
  { value: "store.impersonation.stop", label: "store.impersonation.stop（停止模擬登入）" },
  { value: "STORE_OWNER_PASSWORD_RESET", label: "STORE_OWNER_PASSWORD_RESET（Owner 密碼重設）" },
  { value: "store_settings.update", label: "store_settings.update（店家設定更新）" },
  { value: "store.update_plan_status", label: "store.update_plan_status（店家方案／狀態更新）" },
  { value: "store_features.apply_preset", label: "store_features.apply_preset（套用功能預設）" }
];
const AUDIT_TARGET_TYPE_PRESETS = [
  { value: "", label: "全部" },
  { value: "store", label: "store（店家）" },
  { value: "staff", label: "staff（員工）" },
  { value: "user", label: "user（使用者）" },
  { value: "store_settings", label: "store_settings（店家設定）" },
  { value: "store_features", label: "store_features（功能設定）" }
];
const AUDIT_LIMIT_PRESETS = [10, 20, 50, 100, 200];
const LANGUAGE_OPTIONS = [
  { value: "zh-TW", label: "繁體中文（台灣）" },
  { value: "en", label: "English" }
];
const TIMEZONE_OPTIONS = [
  { value: "Asia/Taipei", label: "Asia/Taipei" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo" },
  { value: "UTC", label: "UTC" }
];

function toNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function getStatusTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "active") return "success";
  if (normalized === "suspended") return "warning";
  return "neutral";
}

function getPlanLabel(plan) {
  const option = PLAN_OPTIONS.find((item) => item.value === String(plan || "").toLowerCase());
  return option?.label || plan || "-";
}

function getStatusLabel(status) {
  const option = STATUS_OPTIONS.find((item) => item.value === String(status || "").toLowerCase());
  return option?.label || status || "-";
}

function getSchemaGuardLabel(schemaGuard) {
  if (!schemaGuard) return "未取得";
  return schemaGuard.requireStoreIdSchema ? "嚴格模式" : "警告模式";
}

function normalizeSlugCandidate(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeSettingsForm(settings) {
  return {
    displayName: String(settings?.displayName || ""),
    address: String(settings?.address || ""),
    phone: String(settings?.phone || ""),
    businessHours: String(settings?.businessHours || ""),
    timezone: String(settings?.timezone || DEFAULT_SETTINGS_FORM.timezone),
    defaultLanguage: String(settings?.defaultLanguage || DEFAULT_SETTINGS_FORM.defaultLanguage),
    invoiceDisplayName: String(settings?.invoiceDisplayName || ""),
    businessNumber: String(settings?.businessNumber || "")
  };
}

function getStoreRoleLabel(role) {
  const normalized = String(role || "").toLowerCase();
  return STORE_ROLE_LABEL[normalized] || normalized || "staff";
}

function toAuditFilterValue(value) {
  return String(value || "").trim();
}

function buildAuditLogQuery(filters) {
  const params = new URLSearchParams();
  const normalizedTargetType = toAuditFilterValue(filters?.targetType);
  const normalizedTargetId = toAuditFilterValue(filters?.targetId);
  const normalizedAction = toAuditFilterValue(filters?.action);
  const normalizedLimit = String(Number(toAuditFilterValue(filters?.limit)) || 20);

  if (normalizedTargetType) {
    params.set("targetType", normalizedTargetType);
  }
  if (normalizedTargetId) {
    params.set("targetId", normalizedTargetId);
  }
  if (normalizedAction) {
    params.set("action", normalizedAction);
  }
  params.set("limit", normalizedLimit);

  return params.toString();
}

function formatAuditDate(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString("zh-TW", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function stringifyAuditPayload(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    const trimValue = value.trim();
    if (!trimValue) {
      return "";
    }
    if ((trimValue.startsWith("{") && trimValue.endsWith("}")) || (trimValue.startsWith("[") && trimValue.endsWith("]"))) {
      try {
        return JSON.stringify(JSON.parse(trimValue), null, 2);
      } catch {
        return trimValue;
      }
    }
    return trimValue;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function shortenAuditPayload(value, maxLength = 160) {
  if (!value) {
    return "-";
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function getAuditPayload(log, field) {
  const key = `${field}_json`;
  if (log && Object.prototype.hasOwnProperty.call(log, key)) {
    return log[key];
  }
  const camelKey = `${field}Json`;
  if (log && Object.prototype.hasOwnProperty.call(log, camelKey)) {
    return log[camelKey];
  }
  return log?.[field];
}

function renderActionButtons(store, onOpenSettings, onSelectStore, onImpersonate, onOpenAuditLog, onOpenOwnerPasswordReset) {
  return (
    <div className="compact-actions">
      <button type="button" className="secondary-button" onClick={() => onSelectStore(store)}>
        詳細
      </button>
      <button type="button" className="secondary-button" onClick={() => onOpenSettings(store)}>
        店家設定
      </button>
      {onOpenAuditLog ? (
        <button type="button" className="secondary-button" onClick={() => onOpenAuditLog(store)}>
          變更紀錄
        </button>
      ) : null}
      {onImpersonate ? (
        <button type="button" className="secondary-button" onClick={() => onImpersonate(store)}>
          模擬登入店家
        </button>
      ) : null}
      {onOpenOwnerPasswordReset ? (
        <button type="button" className="secondary-button" onClick={() => onOpenOwnerPasswordReset(store)} disabled={!store.owner}>
          Owner 密碼重設
        </button>
      ) : null}
      <Link to={"/platform-admin/stores/" + store.id + "/features"} className="secondary-button">
        功能設定
      </Link>
    </div>
  );
}

function SaasAdminPage() {
  const navigate = useNavigate();
  const currentUser = getStoredPlatformUser();
  const currentRole = String(currentUser?.role || "").trim().toUpperCase();
  const isAdmin = ["PLATFORM_OWNER", "PLATFORM_ADMIN", "SUPPORT"].includes(currentRole);
  const canCreateStore = ["PLATFORM_OWNER", "PLATFORM_ADMIN"].includes(currentRole);
  const canEditSettings = ["PLATFORM_OWNER", "PLATFORM_ADMIN"].includes(currentRole);
  const canResetOwnerPassword = ["PLATFORM_OWNER", "PLATFORM_ADMIN"].includes(currentRole);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createForm, setCreateForm] = useState(DEFAULT_CREATE_FORM);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createResult, setCreateResult] = useState(null);
  const [selectedStoreId, setSelectedStoreId] = useState(null);
  const [selectedStoreMeta, setSelectedStoreMeta] = useState(null);
  const [settingsForm, setSettingsForm] = useState(DEFAULT_SETTINGS_FORM);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsSuccess, setSettingsSuccess] = useState("");
  const [auditFilters, setAuditFilters] = useState({
    targetType: "",
    targetId: "",
    action: "",
    limit: "20"
  });
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [auditHasLoaded, setAuditHasLoaded] = useState(false);
  const [expandedAuditRows, setExpandedAuditRows] = useState({});
  const [auditHighlightedStoreId, setAuditHighlightedStoreId] = useState(null);
  const auditPanelRef = useRef(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [planFilter, setPlanFilter] = useState("ALL");
  const [selectedDetailId, setSelectedDetailId] = useState(null);
  const [storeSaving, setStoreSaving] = useState({ id: null, field: "" });
  const [storeUpdateError, setStoreUpdateError] = useState("");
  const [storeUpdateSuccess, setStoreUpdateSuccess] = useState("");
  const [impersonationState, setImpersonationState] = useState({
    open: false,
    store: null,
    loadingMembers: false,
    starting: false,
    members: [],
    targetStaffUserId: "",
    reason: "",
    error: ""
  });
  const [ownerPasswordResetState, setOwnerPasswordResetState] = useState({
    open: false,
    store: null,
    newPassword: "",
    confirmPassword: "",
    saving: false,
    error: "",
    success: ""
  });

  async function loadStores() {
    setLoading(true);
    setError("");

    try {
      const response = await platformRequest("/saas-admin/stores");
      setData(response);
    } catch (err) {
      setError(err.message || "載入 SaaS 平台管理資料失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    loadStores();
  }, [isAdmin]);

  function handleCreateFormChange(event) {
    const { name, value } = event.target;
    setCreateForm((current) => {
      const next = { ...current, [name]: value };
      if (name === "code" && !current.slug.trim()) {
        next.slug = normalizeSlugCandidate(value);
      }
      if (name === "slug") {
        next.slug = normalizeSlugCandidate(value);
      }
      return next;
    });
  }

  async function handleCreateStore(event) {
    event.preventDefault();
    setCreateLoading(true);
    setCreateError("");
    setCreateResult(null);

    try {
      const payload = {
        code: createForm.code.trim(),
        name: createForm.name.trim(),
        slug: createForm.slug.trim(),
        ownerUsername: createForm.ownerUsername.trim(),
        ownerPassword: createForm.ownerPassword.trim() || undefined,
        ownerName: createForm.ownerName.trim() || undefined,
        plan: createForm.plan.trim() || "trial"
      };

      const response = await platformRequest("/saas-admin/stores", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      setCreateResult(response);
      setCreateForm(DEFAULT_CREATE_FORM);
      await loadStores();
    } catch (submitError) {
      setCreateError(submitError.message || "建立店家失敗");
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleOpenSettings(store) {
    if (!store?.id) {
      return;
    }

    setSelectedStoreId(store.id);
    setSelectedStoreMeta(store);
    setSettingsLoading(true);
    setSettingsError("");
    setSettingsSuccess("");

    try {
      const response = await platformRequest("/saas-admin/stores/" + store.id + "/settings");
      setSelectedStoreMeta(response?.store || store);
      setSettingsForm(normalizeSettingsForm(response?.settings));
    } catch (loadError) {
      setSettingsError(loadError.message || "載入店家設定失敗");
      setSettingsForm(DEFAULT_SETTINGS_FORM);
    } finally {
      setSettingsLoading(false);
    }
  }

  function handleSettingsChange(event) {
    const { name, value } = event.target;
    setSettingsForm((current) => ({
      ...current,
      [name]: value
    }));
    setSettingsError("");
    setSettingsSuccess("");
  }

  async function handleSaveSettings(event) {
    event.preventDefault();
    if (!selectedStoreId || !canEditSettings) {
      return;
    }

    setSettingsSaving(true);
    setSettingsError("");
    setSettingsSuccess("");

    try {
      const response = await platformRequest("/saas-admin/stores/" + selectedStoreId + "/settings", {
        method: "PATCH",
        body: JSON.stringify(settingsForm)
      });
      setSelectedStoreMeta(response?.store || selectedStoreMeta);
      setSettingsForm(normalizeSettingsForm(response?.settings));
      setSettingsSuccess("門市設定已儲存。");
      await loadStores();
    } catch (saveError) {
      setSettingsError(saveError.message || "儲存店家設定失敗");
    } finally {
      setSettingsSaving(false);
    }
  }

  function handleSelectDetail(store) {
    setSelectedDetailId(store?.id || null);
    setStoreUpdateError("");
    setStoreUpdateSuccess("");
  }

  function normalizeAuditFilters(nextFilters = {}) {
    return {
      targetType: toAuditFilterValue(nextFilters.targetType || auditFilters.targetType),
      targetId: toAuditFilterValue(nextFilters.targetId || auditFilters.targetId),
      action: toAuditFilterValue(nextFilters.action || auditFilters.action),
      limit: String(Number(toAuditFilterValue(nextFilters.limit || auditFilters.limit)) || 20)
    };
  }

  async function loadAuditLogs(nextFilters = {}) {
    const filters = normalizeAuditFilters(nextFilters);
    setAuditFilters(filters);
    setAuditLoading(true);
    setAuditError("");
    try {
      const query = buildAuditLogQuery(filters);
      const response = await platformRequest(`/saas-admin/audit-logs${query ? `?${query}` : ""}`);
      const logs = Array.isArray(response?.logs) ? response.logs : Array.isArray(response?.items) ? response.items : [];
      setAuditLogs(logs);
      setAuditHasLoaded(true);
      setExpandedAuditRows({});
    } catch (auditError) {
      setAuditError(auditError.message || "載入變更紀錄失敗");
      setAuditLogs([]);
      setAuditHasLoaded(true);
    } finally {
      setAuditLoading(false);
    }
  }

  function handleAuditFilterChange(event) {
    const { name, value } = event.target;
    setAuditFilters((current) => ({
      ...current,
      [name]: value
    }));
  }

  function handleClearAuditFilters() {
    setAuditFilters({
      targetType: "",
      targetId: "",
      action: "",
      limit: "20"
    });
    setAuditLogs([]);
    setAuditHasLoaded(false);
    setExpandedAuditRows({});
  }

  function toggleAuditJsonExpand(logId, field) {
    const key = `${String(logId)}-${field}`;
    setExpandedAuditRows((current) => ({
      ...current,
      [key]: !current[key]
    }));
  }

  function handleOpenAuditLogs(store) {
    const storeId = store?.id;
    const nextFilters = {
      targetType: "store",
      targetId: storeId ? String(storeId) : ""
    };
    setAuditHighlightedStoreId(storeId || null);
    loadAuditLogs(nextFilters);
    if (auditPanelRef.current) {
      auditPanelRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function handleUpdateStore(store, field, value) {
    if (!store?.id || !canEditSettings || value === store[field]) {
      return;
    }

    setStoreSaving({ id: store.id, field });
    setStoreUpdateError("");
    setStoreUpdateSuccess("");

    try {
      const response = await platformRequest("/saas-admin/stores/" + store.id, {
        method: "PATCH",
        body: JSON.stringify({ [field]: value })
      });
      setStoreUpdateSuccess(
        `${response?.store?.name || store.name || "店家"} 已更新 ${field === "plan" ? "方案" : "狀態"}。`
      );
      await loadStores();
      setSelectedDetailId(store.id);
    } catch (updateError) {
      setStoreUpdateError(updateError.message || "更新店家資料失敗");
    } finally {
      setStoreSaving({ id: null, field: "" });
    }
  }

  function openOwnerPasswordResetModal(store) {
    if (!store?.id || !canResetOwnerPassword) {
      return;
    }

    setOwnerPasswordResetState({
      open: true,
      store,
      newPassword: "",
      confirmPassword: "",
      saving: false,
      error: "",
      success: ""
    });
  }

  function closeOwnerPasswordResetModal() {
    if (ownerPasswordResetState.saving) {
      return;
    }

    setOwnerPasswordResetState({
      open: false,
      store: null,
      newPassword: "",
      confirmPassword: "",
      saving: false,
      error: "",
      success: ""
    });
  }

  function handleOwnerPasswordResetChange(event) {
    const { name, value } = event.target;
    setOwnerPasswordResetState((current) => ({
      ...current,
      [name]: value,
      error: "",
      success: ""
    }));
  }

  async function handleOwnerPasswordResetSubmit(event) {
    event.preventDefault();
    const storeId = Number(ownerPasswordResetState.store?.id || 0);
    const newPassword = ownerPasswordResetState.newPassword;
    const confirmPassword = ownerPasswordResetState.confirmPassword;

    if (!storeId || !canResetOwnerPassword) {
      return;
    }
    if (newPassword.length < 8) {
      setOwnerPasswordResetState((current) => ({
        ...current,
        error: "Owner 密碼至少需要 8 個字元"
      }));
      return;
    }
    if (newPassword !== confirmPassword) {
      setOwnerPasswordResetState((current) => ({
        ...current,
        error: "兩次輸入的密碼不一致"
      }));
      return;
    }
    if (!window.confirm("確定要重設此門市 owner 密碼嗎？")) {
      return;
    }

    setOwnerPasswordResetState((current) => ({
      ...current,
      saving: true,
      error: "",
      success: ""
    }));

    try {
      await platformRequest("/saas-admin/stores/" + storeId + "/owner-password-reset", {
        method: "POST",
        body: JSON.stringify({ newPassword })
      });
      setOwnerPasswordResetState((current) => ({
        ...current,
        newPassword: "",
        confirmPassword: "",
        saving: false,
        success: "Owner 密碼已重設"
      }));
      setStoreUpdateSuccess("Owner 密碼已重設");
      await loadStores();
    } catch (error) {
      setOwnerPasswordResetState((current) => ({
        ...current,
        saving: false,
        error: error.message || "Owner 密碼重設失敗"
      }));
    }
  }

  function resetImpersonationState() {
    setImpersonationState({
      open: false,
      store: null,
      loadingMembers: false,
      starting: false,
      members: [],
      targetStaffUserId: "",
      reason: "",
      error: ""
    });
  }

  async function openImpersonationModal(store) {
    if (!store?.id) {
      return;
    }

    setImpersonationState({
      open: true,
      store,
      loadingMembers: true,
      starting: false,
      members: [],
      targetStaffUserId: "",
      reason: "",
      error: ""
    });

    try {
      const response = await platformRequest("/saas-admin/stores/" + store.id + "/staff-members");
      const members = Array.isArray(response?.members) ? response.members : [];
      setImpersonationState((current) => ({
        ...current,
        loadingMembers: false,
        members,
        targetStaffUserId: String(members[0]?.id || ""),
        error: members.length ? "" : "此店家沒有可登入的啟用員工。"
      }));
    } catch (error) {
      setImpersonationState((current) => ({
        ...current,
        loadingMembers: false,
        members: [],
        targetStaffUserId: "",
        error: error.message || "讀取店家員工名單失敗"
      }));
    }
  }

  function closeImpersonationModal() {
    resetImpersonationState();
  }

  function handleImpersonationInputChange(event) {
    const { name, value } = event.target;
    setImpersonationState((current) => ({
      ...current,
      [name]: value
    }));
  }

  async function handleStartImpersonation(event) {
    event.preventDefault();
    const storeId = Number(impersonationState.store?.id || 0);
    if (!storeId) {
      return;
    }

    if (!impersonationState.targetStaffUserId) {
      setImpersonationState((current) => ({
        ...current,
        error: "請先選擇要模擬登入的員工"
      }));
      return;
    }

    setImpersonationState((current) => ({
      ...current,
      starting: true,
      error: ""
    }));

    try {
      const response = await platformRequest("/saas-admin/stores/" + storeId + "/impersonate", {
        method: "POST",
        body: JSON.stringify({
          targetStaffUserId: Number(impersonationState.targetStaffUserId),
          reason: impersonationState.reason
        })
      });
      const targetStaffUserId = response?.metadata?.targetStaffUserId || Number(impersonationState.targetStaffUserId);
      const selectedStaffMember =
        impersonationState.members.find((member) => Number(member.id) === Number(targetStaffUserId)) || null;

      startImpersonationSession(
        response?.token,
        response?.user || {
          id: targetStaffUserId,
          username: response?.metadata?.targetUsername || selectedStaffMember?.username || "",
          role: response?.user?.role || selectedStaffMember?.staffRole || "",
          displayName: response?.user?.displayName || selectedStaffMember?.displayName || selectedStaffMember?.username || "",
          storeId: Number(response?.metadata?.storeId || storeId),
          storeRole: response?.user?.storeRole || response?.metadata?.targetStoreRole || selectedStaffMember?.storeRole || "",
          storeName: response?.metadata?.storeName || impersonationState.store?.name || "",
          permissions: response?.user?.permissions || []
        },
        {
        storeId,
        storeName: response?.metadata?.storeName || impersonationState.store?.name || "",
        targetStaffUserId,
        targetUsername: response?.metadata?.targetUsername || "",
        targetStoreRole: response?.metadata?.targetStoreRole || "",
        reason: response?.metadata?.reason || impersonationState.reason,
        platformAdminId: currentUser?.id,
        platformAdminEmail: currentUser?.email || ""
      });

      resetImpersonationState();
      navigate("/dashboard");
    } catch (error) {
      setImpersonationState((current) => ({
        ...current,
        starting: false,
        error: error.message || "啟動模擬登入失敗"
      }));
    }
  }

  function getAuditLogLabel() {
    const count = auditLogs.length;
    if (!auditHasLoaded) {
      return "尚未查詢變更紀錄";
    }
    if (auditLoading) {
      return `載入中（目前 ${count} 筆）`;
    }
    return `${count} 筆變更紀錄`;
  }

  function renderAuditJsonCell(log, field) {
    const rowId = String(log.__auditRowId || log.id || "no-id");
    const rawText = stringifyAuditPayload(getAuditPayload(log, field));
    const displayText = rawText || "-";
    const fieldKey = `${rowId}-${field}`;
    const isExpanded = Boolean(expandedAuditRows[fieldKey]);
    const shouldCollapse = displayText !== "-" && displayText.length > 160;
    const text = shouldCollapse && !isExpanded ? shortenAuditPayload(displayText, 160) : displayText;
    if (displayText === "-") {
      return <span>-</span>;
    }

    return (
      <div className="platform-admin-audit-json-cell">
        <pre className="platform-admin-audit-json">{text}</pre>
        {shouldCollapse ? (
          <button
            type="button"
            className="ghost-button compact-detail-button"
            onClick={() => toggleAuditJsonExpand(log.__auditRowId || log.id, field)}
          >
            {isExpanded ? "收合" : "展開"}
          </button>
        ) : null}
      </div>
    );
  }

  const auditRows = useMemo(
    () =>
      auditLogs.map((log, index) => ({
        ...log,
        __auditRowId: `${toAuditFilterValue(log?.id) || "log"}-${index}`
      })),
    [auditLogs]
  );

  const auditColumns = useMemo(
    () => [
      { key: "createdAt", label: "created_at（建立時間）", render: (row) => formatAuditDate(row.createdAt || row.created_at) },
      { key: "adminEmail", label: "admin_email（管理員）", render: (row) => row.adminEmail || "-" },
      { key: "action", label: "action（動作）", render: (row) => row.action || "-" },
      { key: "targetType", label: "target_type（目標類型）", render: (row) => row.targetType || "-" },
      { key: "targetId", label: "target_id（目標 ID）", render: (row) => row.targetId ?? "-" },
      { key: "before", label: "before_json（變更前）", render: (row) => renderAuditJsonCell(row, "before") },
      { key: "after", label: "after_json（變更後）", render: (row) => renderAuditJsonCell(row, "after") }
    ],
    [auditLogs, expandedAuditRows]
  );

  const canImpersonate = ["PLATFORM_OWNER", "PLATFORM_ADMIN"].includes(currentRole);

  const stores = Array.isArray(data?.stores) ? data.stores : [];
  const selectedStore =
    stores.find((store) => store.id === selectedStoreId) ||
    selectedStoreMeta;
  const selectedDetailStore = stores.find((store) => store.id === selectedDetailId) || null;

  const filteredStores = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    return stores.filter((store) => {
      if (statusFilter !== "ALL" && String(store.status || "").toLowerCase() !== statusFilter) {
        return false;
      }
      if (planFilter !== "ALL" && String(store.plan || "").toLowerCase() !== planFilter) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const ownerText = store.owner
        ? `${store.owner.username || ""} ${store.owner.displayName || ""} ${store.owner.email || ""}`
        : "";
      const haystack = `${store.code || ""} ${store.name || ""} ${store.slug || ""} ${ownerText}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [stores, searchTerm, statusFilter, planFilter]);

  const totals = useMemo(
    () =>
      stores.reduce(
        (acc, store) => ({
          productCount: acc.productCount + toNumber(store.productCount),
          customerCount: acc.customerCount + toNumber(store.customerCount),
          orderCount: acc.orderCount + toNumber(store.orderCount),
          repairCount: acc.repairCount + toNumber(store.repairCount)
        }),
        { productCount: 0, customerCount: 0, orderCount: 0, repairCount: 0 }
      ),
    [stores]
  );

  const summaryCards = [
    { label: "租戶店家總數", value: data?.totalStores ?? stores.length },
    { label: "目前環境", value: data?.environment || "unknown", small: true },
    { label: "SchemaGuard 狀態", value: getSchemaGuardLabel(data?.schemaGuard), small: true },
    { label: "商品總數", value: totals.productCount },
    { label: "客戶總數", value: totals.customerCount },
    { label: "訂單總數", value: totals.orderCount },
    { label: "維修總數", value: totals.repairCount },
    { label: "缺少 owner", value: stores.filter((store) => !store.hasOwner).length }
  ];

  const columns = [
    { key: "id", label: "ID" },
    { key: "code", label: "店家代碼" },
    { key: "name", label: "店家名稱" },
    { key: "slug", label: "Slug" },
    {
      key: "status",
      label: "狀態",
      render: (row) => (
        <div className="stack-meta">
          <StatusBadge tone={getStatusTone(row.status)}>{getStatusLabel(row.status)}</StatusBadge>
          {canEditSettings ? (
            <select
              value={row.status || "active"}
              disabled={storeSaving.id === row.id}
              onChange={(event) => handleUpdateStore(row, "status", event.target.value)}
            >
              {EDITABLE_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          ) : null}
        </div>
      )
    },
    {
      key: "plan",
      label: "方案",
      render: (row) => (
        <div className="stack-meta">
          <StatusBadge tone="info">{getPlanLabel(row.plan)}</StatusBadge>
          {canEditSettings ? (
            <select
              value={["free", "premium"].includes(String(row.plan || "").toLowerCase()) ? row.plan : ""}
              disabled={storeSaving.id === row.id}
              onChange={(event) => handleUpdateStore(row, "plan", event.target.value)}
            >
              <option value="" disabled>選擇方案</option>
              {EDITABLE_PLAN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          ) : null}
        </div>
      )
    },
    {
      key: "owner",
      label: "Owner",
      render: (row) => row.owner ? (
        <div className="stack-meta">
          <strong>{row.owner.displayName || "-"}</strong>
          <span>{row.owner.username || "-"}</span>
          {row.owner.email ? <span>{row.owner.email}</span> : null}
        </div>
      ) : (
        <StatusBadge tone="warning">缺少 owner</StatusBadge>
      )
    },
    {
      key: "staffCount",
      label: "員工",
      render: (row) => (
        <div className="stack-meta">
          <strong>{toNumber(row.staffCount)}</strong>
          <span>管理 {toNumber(row.ownerCount) + toNumber(row.adminCount)} / 一般 {toNumber(row.memberStaffCount)}</span>
        </div>
      )
    },
    { key: "productCount", label: "商品" },
    { key: "customerCount", label: "客戶" },
    { key: "orderCount", label: "訂單" },
    { key: "repairCount", label: "維修" },
    {
      key: "actions",
      label: "管理入口",
      render: (row) =>
        renderActionButtons(
          row,
          handleOpenSettings,
          handleSelectDetail,
          canImpersonate ? openImpersonationModal : null,
          handleOpenAuditLogs,
          canResetOwnerPassword ? openOwnerPasswordResetModal : null
        )
    }
  ];

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="SaaS 平台管理中心" description="僅限平台管理員檢視；此區不是 KINGWAY 台南門市設定。" />
        <div className="empty-state">沒有 SaaS 管理權限。</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="SaaS 平台管理中心" description="載入平台租戶店家資料中..." />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="SaaS 平台管理中心" description="平台管理所有租戶店家；此區不是 KINGWAY 台南門市設定。" />
        <div className="empty-state">{error}</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="SaaS 平台管理中心" description="平台層級檢視所有租戶店家、SchemaGuard 狀態與各店家模組入口；KINGWAY 台南是 store_id=1 租戶。" />

      <section className="admin-panel">
        <AdminSectionHeader
          eyebrow="Franchise"
          title="公司 / 品牌管理"
          description="管理 franchise company、所屬門市與總部權限；出貨、入庫與結算留待下一階段。"
          actions={<Link to="/platform-admin/companies" className="primary-button">管理公司 / 品牌</Link>}
        />
      </section>

      <div className="admin-summary-grid dashboard-summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className="admin-summary-card">
            <div className="admin-summary-label">{card.label}</div>
            <div className={`admin-summary-value ${card.small ? "admin-summary-value-small" : ""}`}>{card.value}</div>
          </article>
        ))}
      </div>

      {canCreateStore ? (
        <section className="admin-panel">
          <AdminSectionHeader
            eyebrow="平台管理"
            title="新增租戶店家"
            description="建立新店家、預設功能開關與 owner 帳號。若不輸入密碼，系統會自動產生一次性臨時密碼。"
          />

          <form className="form-grid" onSubmit={handleCreateStore}>
            <label className="form-field">
              <span>店家代碼</span>
              <input name="code" value={createForm.code} onChange={handleCreateFormChange} placeholder="KINGWAY_TAICHUNG" required />
            </label>
            <label className="form-field">
              <span>店家名稱</span>
              <input name="name" value={createForm.name} onChange={handleCreateFormChange} placeholder="KINGWAY 台中" required />
            </label>
            <label className="form-field">
              <span>Slug</span>
              <input name="slug" value={createForm.slug} onChange={handleCreateFormChange} placeholder="kingway-taichung" required />
            </label>
            <label className="form-field">
              <span>Owner 帳號</span>
              <input name="ownerUsername" value={createForm.ownerUsername} onChange={handleCreateFormChange} placeholder="taichung_owner" required />
            </label>
            <label className="form-field">
              <span>Owner 密碼</span>
              <input name="ownerPassword" type="text" value={createForm.ownerPassword} onChange={handleCreateFormChange} placeholder="留空則自動產生" />
            </label>
            <label className="form-field">
              <span>Owner 顯示名稱</span>
              <input name="ownerName" value={createForm.ownerName} onChange={handleCreateFormChange} placeholder="KINGWAY 台中 店長" />
            </label>
            <label className="form-field">
              <span>方案</span>
              <input name="plan" value={createForm.plan} onChange={handleCreateFormChange} placeholder="trial" required />
            </label>
            <div className="compact-actions">
              <button type="submit" className="primary-button" disabled={createLoading}>
                {createLoading ? "建立中..." : "建立新店家"}
              </button>
            </div>
          </form>

          {createError ? <div className="empty-state">{createError}</div> : null}

          {createResult?.store ? (
            <div className="admin-panel" style={{ marginTop: 16 }}>
              <AdminSectionHeader
                eyebrow="建立結果"
                title="建立成功"
                description="下方資訊僅顯示本次建立結果；若有臨時密碼，請立即保存。"
              />
              <div className="admin-summary-grid">
                <article className="admin-summary-card">
                  <div className="admin-summary-label">店家</div>
                  <div className="admin-summary-value admin-summary-value-small">
                    {createResult.store.code} / {createResult.store.name}
                  </div>
                </article>
                <article className="admin-summary-card">
                  <div className="admin-summary-label">Slug</div>
                  <div className="admin-summary-value admin-summary-value-small">{createResult.store.slug || "-"}</div>
                </article>
                <article className="admin-summary-card">
                  <div className="admin-summary-label">Owner 帳號</div>
                  <div className="admin-summary-value admin-summary-value-small">{createResult.owner?.username || "-"}</div>
                </article>
                <article className="admin-summary-card">
                  <div className="admin-summary-label">方案 / 狀態</div>
                  <div className="admin-summary-value admin-summary-value-small">
                    {getPlanLabel(createResult.store.plan)} / {getStatusLabel(createResult.store.status)}
                  </div>
                </article>
              </div>
              {createResult.temporaryPassword ? (
                <div className="empty-state" style={{ marginTop: 12 }}>
                  一次性臨時密碼: <strong>{createResult.temporaryPassword}</strong>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="admin-panel">
        <AdminSectionHeader
          eyebrow="SaaS 平台"
          title="租戶店家列表"
          description="平台層級檢視租戶店家，可直接開啟店家設定並儲存門市基本資料。"
          badges={
            <>
              <StatusBadge tone="info">租戶店家總數 {data?.totalStores ?? stores.length}</StatusBadge>
              <StatusBadge tone="neutral">目前顯示 {filteredStores.length}</StatusBadge>
              <StatusBadge tone={data?.schemaGuard?.requireStoreIdSchema ? "success" : "warning"}>
                SchemaGuard {data?.schemaGuard?.status || "UNKNOWN"}
              </StatusBadge>
            </>
          }
        />

        <div className="filter-bar">
          <label className="form-field">
            <span>搜尋店家</span>
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="輸入店家名稱、代碼或 owner"
            />
          </label>
          <label className="form-field">
            <span>狀態</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>方案</span>
            <select value={planFilter} onChange={(event) => setPlanFilter(event.target.value)}>
              {PLAN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        {storeUpdateError ? <div className="error-banner">{storeUpdateError}</div> : null}
        {storeUpdateSuccess ? <div className="platform-store-settings-success">{storeUpdateSuccess}</div> : null}

        <DataTable
          columns={columns}
          rows={filteredStores}
          emptyText="目前沒有符合條件的店家資料。"
          cardTitle={(row) => row.code || `店家 ${row.id}`}
          cardDescription={(row) => `${row.name || "未設定店家名稱"}${row.slug ? ` / ${row.slug}` : ""}`}
          cardBadges={(row) => (
            <>
              <StatusBadge tone={getStatusTone(row.status)}>{getStatusLabel(row.status)}</StatusBadge>
              <StatusBadge tone="info">{getPlanLabel(row.plan)}</StatusBadge>
              <StatusBadge tone="neutral">員工 {toNumber(row.staffCount)}</StatusBadge>
              {!row.hasOwner ? <StatusBadge tone="warning">缺少 owner</StatusBadge> : null}
            </>
          )}
          cardFooter={(row) =>
            renderActionButtons(
              row,
              handleOpenSettings,
              handleSelectDetail,
              canImpersonate ? openImpersonationModal : null,
              handleOpenAuditLogs,
              canResetOwnerPassword ? openOwnerPasswordResetModal : null
            )
          }
        />
      </section>

      {selectedDetailStore ? (
        <section className="admin-panel">
          <AdminSectionHeader
            eyebrow="店家詳細"
            title={selectedDetailStore.name || selectedDetailStore.code || `店家 ${selectedDetailStore.id}`}
            description="顯示店家基本資料、owner、統計數量與常用管理入口。"
            badges={
              <>
                <StatusBadge tone={getStatusTone(selectedDetailStore.status)}>{getStatusLabel(selectedDetailStore.status)}</StatusBadge>
                <StatusBadge tone="info">{getPlanLabel(selectedDetailStore.plan)}</StatusBadge>
                {!selectedDetailStore.hasOwner ? <StatusBadge tone="warning">缺少 owner</StatusBadge> : null}
              </>
            }
            actions={renderActionButtons(
              selectedDetailStore,
              handleOpenSettings,
              handleSelectDetail,
              canImpersonate ? openImpersonationModal : null,
              handleOpenAuditLogs,
              canResetOwnerPassword ? openOwnerPasswordResetModal : null
            )}
          />
          <div className="admin-summary-grid">
            <article className="admin-summary-card">
              <div className="admin-summary-label">店家代碼</div>
              <div className="admin-summary-value admin-summary-value-small">{selectedDetailStore.code || "-"}</div>
            </article>
            <article className="admin-summary-card">
              <div className="admin-summary-label">Owner</div>
              <div className="admin-summary-value admin-summary-value-small">
                {selectedDetailStore.owner?.displayName || "未設定 owner"}
              </div>
              <div className="muted-text">{selectedDetailStore.owner?.username || "-"}</div>
              {selectedDetailStore.owner?.email ? <div className="muted-text">{selectedDetailStore.owner.email}</div> : null}
            </article>
            <article className="admin-summary-card">
              <div className="admin-summary-label">員工 / 管理者</div>
              <div className="admin-summary-value admin-summary-value-small">
                {toNumber(selectedDetailStore.staffCount)} / {toNumber(selectedDetailStore.ownerCount) + toNumber(selectedDetailStore.adminCount)}
              </div>
              <div className="muted-text">
                Owner {toNumber(selectedDetailStore.ownerCount)} / 管理者 {toNumber(selectedDetailStore.adminCount)} / 一般員工 {toNumber(selectedDetailStore.memberStaffCount)}
              </div>
            </article>
            <article className="admin-summary-card">
              <div className="admin-summary-label">商品 / 客戶</div>
              <div className="admin-summary-value admin-summary-value-small">
                {selectedDetailStore.productCount} / {selectedDetailStore.customerCount}
              </div>
            </article>
            <article className="admin-summary-card">
              <div className="admin-summary-label">訂單 / 維修</div>
              <div className="admin-summary-value admin-summary-value-small">
                {selectedDetailStore.orderCount} / {selectedDetailStore.repairCount}
              </div>
            </article>
          </div>
        </section>
      ) : null}

      <section className="admin-panel platform-admin-audit-panel" ref={auditPanelRef}>
        <AdminSectionHeader
          eyebrow="稽核"
          title="平台變更紀錄"
          description="查詢 /platform admin 操作紀錄，用於追蹤店家設定或模擬登入等關鍵操作。"
          badges={
            <>
              <StatusBadge tone="info">{getAuditLogLabel()}</StatusBadge>
              {auditHighlightedStoreId ? <StatusBadge tone="warning">目標店家 {auditHighlightedStoreId}</StatusBadge> : null}
            </>
          }
        />

        <form className="platform-admin-audit-filter-bar filter-bar-compact" onSubmit={(event) => {
          event.preventDefault();
          loadAuditLogs(auditFilters);
        }}>
          <label className="form-field">
            <span>目標類型</span>
            <input
              name="targetType"
              list="platform-audit-target-type-options"
              value={auditFilters.targetType}
              onChange={handleAuditFilterChange}
              placeholder="例如 store"
            />
            <datalist id="platform-audit-target-type-options">
              {AUDIT_TARGET_TYPE_PRESETS.filter((item) => item.value).map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </datalist>
          </label>
          <label className="form-field">
            <span>目標 ID</span>
            <input
              type="text"
              name="targetId"
              value={auditFilters.targetId}
              onChange={handleAuditFilterChange}
              placeholder="例如 2"
            />
          </label>
          <label className="form-field">
            <span>行為</span>
            <input
              name="action"
              list="platform-audit-action-options"
              value={auditFilters.action}
              onChange={handleAuditFilterChange}
              placeholder="例如 store.impersonation.start"
            />
            <datalist id="platform-audit-action-options">
              {AUDIT_ACTION_PRESETS.filter((item) => item.value).map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </datalist>
          </label>
          <label className="form-field">
            <span>筆數上限</span>
            <select name="limit" value={auditFilters.limit} onChange={handleAuditFilterChange}>
              {AUDIT_LIMIT_PRESETS.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <div className="platform-admin-audit-filter-actions">
            <button type="submit" className="primary-button" disabled={auditLoading}>
              {auditLoading ? "查詢中..." : "查詢"}
            </button>
            <button type="button" className="secondary-button" onClick={handleClearAuditFilters} disabled={auditLoading}>
              清除
            </button>
          </div>
        </form>

        {auditError ? <div className="error-banner">{auditError}</div> : null}
        {auditLoading ? <div className="loading-state">載入變更紀錄中...</div> : null}
        {!auditLoading && (
          auditHasLoaded ? (
            auditRows.length ? (
              <DataTable
                columns={auditColumns}
                rows={auditRows}
                emptyText="目前條件沒有變更紀錄。"
                cardTitle={(row) => row.action || "action"}
                cardDescription={(row) => `${row.adminEmail || "-"} / ${row.targetType || "-"}`}
              />
            ) : (
              <div className="empty-state">目前沒有符合條件的變更紀錄。</div>
            )
          ) : (
            <div className="empty-state">請先設定查詢條件並點選「查詢」。</div>
          )
        )}
      </section>

      <div className="platform-store-settings-grid">
        <section className="admin-panel platform-store-settings-main-panel">
          <AdminSectionHeader
            eyebrow="平台管理"
            title="門市基本資料設定"
            description={
              selectedStore
                ? "平台管理員可直接查看或覆寫指定門市的基本資料。"
                : "請先從上方租戶店家列表點選「店家設定」載入門市資料。"
            }
            badges={
              selectedStore ? (
                <>
                  <StatusBadge tone="info">店家 {selectedStore.id}</StatusBadge>
                  <StatusBadge tone="neutral">{selectedStore.code || "UNKNOWN"}</StatusBadge>
                </>
              ) : null
            }
          />

          {!selectedStore ? (
            <div className="empty-state">請先在租戶店家列表點選「店家設定」。</div>
          ) : null}

          {selectedStore ? (
            <>
              <div className="platform-store-settings-selected">
                <div className="platform-store-settings-selected-label">目前選擇</div>
                <div className="platform-store-settings-selected-value">
                  {selectedStore.name || "未設定店家名稱"} / {selectedStore.code || "-"}
                </div>
              </div>

              {settingsError ? <div className="error-banner">{settingsError}</div> : null}
              {settingsSuccess ? <div className="platform-store-settings-success">{settingsSuccess}</div> : null}
              {settingsLoading ? <div className="loading-state">載入店家設定中...</div> : null}

              {!settingsLoading ? (
                <form className="form-grid platform-store-settings-form" onSubmit={handleSaveSettings}>
                  <label className="form-field">
                    <span>門市顯示名稱</span>
                    <input
                      name="displayName"
                      value={settingsForm.displayName}
                      onChange={handleSettingsChange}
                      placeholder="KINGWAY 台南門市"
                      disabled={settingsSaving || !canEditSettings}
                    />
                  </label>
                  <label className="form-field">
                    <span>聯絡電話</span>
                    <input
                      name="phone"
                      value={settingsForm.phone}
                      onChange={handleSettingsChange}
                      placeholder="06-000-0000"
                      disabled={settingsSaving || !canEditSettings}
                    />
                  </label>
                  <label className="form-field form-field-wide">
                    <span>地址</span>
                    <input
                      name="address"
                      value={settingsForm.address}
                      onChange={handleSettingsChange}
                      placeholder="台南市..."
                      disabled={settingsSaving || !canEditSettings}
                    />
                  </label>
                  <label className="form-field form-field-wide">
                    <span>營業時間</span>
                    <input
                      name="businessHours"
                      value={settingsForm.businessHours}
                      onChange={handleSettingsChange}
                      placeholder="每日 13:00 - 21:00"
                      disabled={settingsSaving || !canEditSettings}
                    />
                  </label>
                  <label className="form-field">
                    <span>時區</span>
                    <select name="timezone" value={settingsForm.timezone} onChange={handleSettingsChange} disabled={settingsSaving || !canEditSettings}>
                      {TIMEZONE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    <span>預設語言</span>
                    <select name="defaultLanguage" value={settingsForm.defaultLanguage} onChange={handleSettingsChange} disabled={settingsSaving || !canEditSettings}>
                      {LANGUAGE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    <span>發票 / 收據顯示名稱</span>
                    <input
                      name="invoiceDisplayName"
                      value={settingsForm.invoiceDisplayName}
                      onChange={handleSettingsChange}
                      placeholder="KINGWAY 台南門市"
                      disabled={settingsSaving || !canEditSettings}
                    />
                  </label>
                  <label className="form-field">
                    <span>統編 / 商業編號</span>
                    <input
                      name="businessNumber"
                      value={settingsForm.businessNumber}
                      onChange={handleSettingsChange}
                      placeholder="12345678"
                      disabled={settingsSaving || !canEditSettings}
                    />
                  </label>

                  <div className="compact-actions platform-store-settings-actions form-field-wide">
                    <button type="submit" className="primary-button" disabled={settingsSaving || !canEditSettings}>
                      {settingsSaving ? "儲存中..." : canEditSettings ? "儲存門市設定" : "SUPPORT 為唯讀"}
                    </button>
                  </div>
                </form>
              ) : null}
            </>
          ) : null}
        </section>

        <section className="platform-store-settings-side-column">
          <article className="admin-panel">
            <AdminSectionHeader
              eyebrow="Logo"
              title="門市 Logo"
              description="此階段不實作 logo upload，只保留平台管理入口位置。"
            />
            <div className="platform-store-settings-placeholder-card">
              <strong>後續階段</strong>
              <p>門市 Logo 上傳將在後續階段實作。</p>
            </div>
          </article>

          <article className="admin-panel">
            <AdminSectionHeader
              eyebrow="LINE"
              title="LINE 設定"
              description="此階段不實作 LINE token / secret 編輯，只保留位置。"
            />
            <div className="platform-store-settings-placeholder-card">
              <strong>後續階段</strong>
              <p>LINE 設定之後會走獨立的安全流程。</p>
            </div>
          </article>
        </section>
      </div>

      {ownerPasswordResetState.open ? (
        <div className="admin-modal-backdrop">
          <section className="admin-modal">
            <div className="admin-modal-header">
              <h2>Owner 密碼重設</h2>
              <button
                type="button"
                className="secondary-button"
                onClick={closeOwnerPasswordResetModal}
                disabled={ownerPasswordResetState.saving}
              >
                關閉
              </button>
            </div>
            <div className="admin-modal-body">
              <div className="admin-summary-grid">
                <article className="admin-summary-card">
                  <div className="admin-summary-label">目標店家</div>
                  <div className="admin-summary-value admin-summary-value-small">
                    {ownerPasswordResetState.store?.name || ownerPasswordResetState.store?.code || "-"}
                  </div>
                  <div className="muted-text">ID：{ownerPasswordResetState.store?.id || "-"}</div>
                </article>
                <article className="admin-summary-card">
                  <div className="admin-summary-label">Owner 帳號</div>
                  <div className="admin-summary-value admin-summary-value-small">
                    {ownerPasswordResetState.store?.owner?.username || "-"}
                  </div>
                  <div className="muted-text">{ownerPasswordResetState.store?.owner?.displayName || "-"}</div>
                </article>
              </div>

              <p className="admin-modal-copy">
                請輸入新的 owner 密碼。系統只會更新 owner 登入密碼，不會顯示或保存明文密碼。
              </p>

              {ownerPasswordResetState.error ? <div className="error-banner">{ownerPasswordResetState.error}</div> : null}
              {ownerPasswordResetState.success ? <div className="platform-store-settings-success">{ownerPasswordResetState.success}</div> : null}

              <form className="form-grid" onSubmit={handleOwnerPasswordResetSubmit}>
                <label className="form-field">
                  <span>新密碼</span>
                  <input
                    name="newPassword"
                    type="password"
                    value={ownerPasswordResetState.newPassword}
                    onChange={handleOwnerPasswordResetChange}
                    placeholder="至少 8 個字元"
                    disabled={ownerPasswordResetState.saving}
                    autoComplete="new-password"
                  />
                </label>
                <label className="form-field">
                  <span>再次輸入新密碼</span>
                  <input
                    name="confirmPassword"
                    type="password"
                    value={ownerPasswordResetState.confirmPassword}
                    onChange={handleOwnerPasswordResetChange}
                    placeholder="請再次輸入新密碼"
                    disabled={ownerPasswordResetState.saving}
                    autoComplete="new-password"
                  />
                </label>
                <div className="compact-actions">
                  <button type="submit" className="primary-button" disabled={ownerPasswordResetState.saving}>
                    {ownerPasswordResetState.saving ? "重設中..." : "確認重設"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={closeOwnerPasswordResetModal}
                    disabled={ownerPasswordResetState.saving}
                  >
                    取消
                  </button>
                </div>
              </form>
            </div>
          </section>
        </div>
      ) : null}

      {impersonationState.open ? (
        <div className="admin-modal-backdrop">
          <section className="admin-modal">
            <div className="admin-modal-header">
              <h2>模擬登入店家</h2>
              <button type="button" className="secondary-button" onClick={closeImpersonationModal} disabled={impersonationState.starting}>
                關閉
              </button>
            </div>
            <div className="admin-modal-body">
              <div className="admin-summary-grid">
                <article className="admin-summary-card">
                  <div className="admin-summary-label">目標店家</div>
                  <div className="admin-summary-value admin-summary-value-small">
                    {impersonationState.store?.name || impersonationState.store?.code || `店家 ${impersonationState.store?.id || ""}`}
                  </div>
                  <div className="muted-text">ID：{impersonationState.store?.id || "-"}</div>
                </article>
                <article className="admin-summary-card">
                  <div className="admin-summary-label">模擬權限有效期</div>
                  <div className="admin-summary-value admin-summary-value-small">{IMPERSONATION_TTL_LABEL}</div>
                  <div className="muted-text">自動到期後請重新申請</div>
                </article>
              </div>

              {impersonationState.error ? <div className="error-banner">{impersonationState.error}</div> : null}

              <p className="admin-modal-copy">
                模擬登入需要先選擇欲登入的店員帳號。模擬登入期間，您將以該帳號權限操作，請謹慎變更訂單、庫存與價格資料。
              </p>

              <form className="form-grid" onSubmit={handleStartImpersonation}>
                <label className="form-field">
                  <span>登入員工</span>
                  <select
                    name="targetStaffUserId"
                    value={impersonationState.targetStaffUserId}
                    onChange={handleImpersonationInputChange}
                    disabled={impersonationState.loadingMembers || impersonationState.starting}
                  >
                    {impersonationState.members.length ? (
                      impersonationState.members.map((member) => (
                        <option key={member.id} value={String(member.id)}>
                          {member.displayName || member.username}（{getStoreRoleLabel(member.storeRole)}）
                          {member.username ? ` / ${member.username}` : null}
                        </option>
                      ))
                    ) : (
                      <option value="">尚無可選員工</option>
                    )}
                  </select>
                </label>
                <label className="form-field form-field-wide">
                  <span>模擬原因（選填）</span>
                  <input
                    name="reason"
                    value={impersonationState.reason}
                    onChange={handleImpersonationInputChange}
                    placeholder="請輸入本次模擬登入原因"
                    disabled={impersonationState.starting}
                  />
                </label>
                <div className="compact-actions">
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={
                      impersonationState.loadingMembers ||
                      impersonationState.starting ||
                      !impersonationState.targetStaffUserId
                    }
                  >
                    {impersonationState.starting ? "啟動中..." : "開始模擬登入"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={closeImpersonationModal}
                    disabled={impersonationState.starting}
                  >
                    取消
                  </button>
                </div>
              </form>
            </div>
          </section>
        </div>
      ) : null}

      {impersonationState.loadingMembers ? (
        <div className="processing-overlay">
          <div className="processing-overlay-card">
            <div className="processing-spinner" aria-hidden="true"></div>
            <div>
              <div className="processing-overlay-title">讀取員工名單</div>
              <div className="processing-overlay-text">正在載入可登入帳號，請稍候...</div>
            </div>
          </div>
        </div>
      ) : null}

      {impersonationState.starting ? (
        <div className="processing-overlay">
          <div className="processing-overlay-card">
            <div className="processing-spinner" aria-hidden="true"></div>
            <div>
              <div className="processing-overlay-title">啟動模擬登入</div>
              <div className="processing-overlay-text">請稍候，系統將切換為店員權限…</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default SaasAdminPage;
