import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import { getStoredPlatformUser, platformRequest } from "../lib/platformAuth";

const ACTION_LABELS = ["店鋪設定", "功能設定", "LINE 設定", "Telegram 設定", "POS 設定", "權限設定"];
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
  return String(status || "").toLowerCase() === "active" ? "success" : "neutral";
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

function renderActionButtons(store, onOpenSettings) {
  return (
    <div className="compact-actions">
      {ACTION_LABELS.map((label) => {
        if (label === "店鋪設定" && store?.id) {
          return (
          <button key={label} type="button" className="secondary-button" onClick={() => onOpenSettings(store)}>
            設定
          </button>
          );
        }

        if (label === "功能設定" && store?.id) {
          return (
          <Link key={label} to={"/platform-admin/stores/" + store.id + "/features"} className="secondary-button">
            {label}
          </Link>
          );
        }

        return (
          <button key={label} type="button" className="secondary-button" disabled>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function SaasAdminPage() {
  const currentUser = getStoredPlatformUser();
  const currentRole = String(currentUser?.role || "").trim().toUpperCase();
  const isAdmin = ["PLATFORM_OWNER", "PLATFORM_ADMIN", "SUPPORT"].includes(currentRole);
  const canCreateStore = ["PLATFORM_OWNER", "PLATFORM_ADMIN"].includes(currentRole);
  const canEditSettings = ["PLATFORM_OWNER", "PLATFORM_ADMIN"].includes(currentRole);
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
      setCreateError(submitError.message || "建立店鋪失敗");
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
      setSettingsError(loadError.message || "載入店鋪設定失敗");
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
      setSettingsError(saveError.message || "儲存店鋪設定失敗");
    } finally {
      setSettingsSaving(false);
    }
  }

  const stores = Array.isArray(data?.stores) ? data.stores : [];
  const selectedStore =
    stores.find((store) => store.id === selectedStoreId) ||
    selectedStoreMeta;

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
    { label: "租戶店鋪總數", value: data?.totalStores ?? stores.length },
    { label: "環境 Environment", value: data?.environment || "unknown", small: true },
    { label: "SchemaGuard 狀態", value: getSchemaGuardLabel(data?.schemaGuard), small: true },
    { label: "商品總數", value: totals.productCount },
    { label: "客戶總數", value: totals.customerCount },
    { label: "訂單總數", value: totals.orderCount },
    { label: "維修總數", value: totals.repairCount }
  ];

  const columns = [
    { key: "id", label: "ID" },
    { key: "code", label: "店鋪代碼" },
    { key: "name", label: "店鋪名稱" },
    { key: "slug", label: "Slug" },
    {
      key: "status",
      label: "狀態",
      render: (row) => <StatusBadge tone={getStatusTone(row.status)}>{row.status || "-"}</StatusBadge>
    },
    { key: "plan", label: "方案" },
    { key: "productCount", label: "商品" },
    { key: "customerCount", label: "客戶" },
    { key: "orderCount", label: "訂單" },
    { key: "repairCount", label: "維修" },
    {
      key: "actions",
      label: "管理入口",
      render: (row) => renderActionButtons(row, handleOpenSettings)
    }
  ];

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="SaaS 平台管理中心" description="僅限平台管理員檢視；此區不是 KINGWAY_TAINAN 門市設定。" />
        <div className="empty-state">沒有 SaaS 管理權限。</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="SaaS 平台管理中心" description="載入平台租戶店鋪資料中..." />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="SaaS 平台管理中心" description="平台管理所有租戶店鋪；此區不是 KINGWAY_TAINAN 門市設定。" />
        <div className="empty-state">{error}</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="SaaS 平台管理中心" description="平台層級檢視所有租戶店鋪、SchemaGuard 狀態與各店鋪模組入口；KINGWAY_TAINAN 只是 store_id=1 租戶。" />

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
            eyebrow="Platform Admin"
            title="新增租戶店鋪"
            description="建立新店鋪、預設功能開關與 owner 帳號。若不輸入密碼，系統會自動產生一次性臨時密碼。"
          />

          <form className="form-grid" onSubmit={handleCreateStore}>
            <label className="form-field">
              <span>店鋪代碼 code</span>
              <input name="code" value={createForm.code} onChange={handleCreateFormChange} placeholder="KINGWAY_TAICHUNG" required />
            </label>
            <label className="form-field">
              <span>店鋪名稱 name</span>
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
              <span>方案 plan</span>
              <input name="plan" value={createForm.plan} onChange={handleCreateFormChange} placeholder="trial" required />
            </label>
            <div className="compact-actions">
              <button type="submit" className="primary-button" disabled={createLoading}>
                {createLoading ? "建立中..." : "建立新店鋪"}
              </button>
            </div>
          </form>

          {createError ? <div className="empty-state">{createError}</div> : null}

          {createResult?.store ? (
            <div className="admin-panel" style={{ marginTop: 16 }}>
              <AdminSectionHeader
                eyebrow="Provisioning Result"
                title="建立成功"
                description="下方資訊僅顯示本次建立結果；若有臨時密碼，請立即保存。"
              />
              <div className="admin-summary-grid">
                <article className="admin-summary-card">
                  <div className="admin-summary-label">Store</div>
                  <div className="admin-summary-value admin-summary-value-small">
                    {createResult.store.code} / {createResult.store.name}
                  </div>
                </article>
                <article className="admin-summary-card">
                  <div className="admin-summary-label">Slug</div>
                  <div className="admin-summary-value admin-summary-value-small">{createResult.store.slug || "-"}</div>
                </article>
                <article className="admin-summary-card">
                  <div className="admin-summary-label">Owner</div>
                  <div className="admin-summary-value admin-summary-value-small">{createResult.owner?.username || "-"}</div>
                </article>
                <article className="admin-summary-card">
                  <div className="admin-summary-label">Plan / Status</div>
                  <div className="admin-summary-value admin-summary-value-small">
                    {createResult.store.plan || "-"} / {createResult.store.status || "-"}
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
          title="租戶店鋪列表"
          description="平台層級檢視租戶店鋪，可直接開啟店鋪設定並儲存 STORE_PROFILE 欄位。"
          badges={
            <>
              <StatusBadge tone="info">租戶店鋪總數 {data?.totalStores ?? stores.length}</StatusBadge>
              <StatusBadge tone={data?.schemaGuard?.requireStoreIdSchema ? "success" : "warning"}>
                SchemaGuard {data?.schemaGuard?.status || "UNKNOWN"}
              </StatusBadge>
            </>
          }
        />

        <DataTable
          columns={columns}
          rows={stores}
          emptyText="目前沒有店鋪資料。"
          cardTitle={(row) => row.code || `Store ${row.id}`}
          cardDescription={(row) => `${row.name || "未設定店鋪名稱"}${row.slug ? ` / ${row.slug}` : ""}`}
          cardBadges={(row) => <StatusBadge tone={getStatusTone(row.status)}>{row.status || "-"}</StatusBadge>}
          cardFooter={(row) => renderActionButtons(row, handleOpenSettings)}
        />
      </section>

      <div className="platform-store-settings-grid">
        <section className="admin-panel platform-store-settings-main-panel">
          <AdminSectionHeader
            eyebrow="Platform Admin"
            title="STORE_PROFILE 設定"
            description={
              selectedStore
                ? "平台管理員可直接查看或覆寫指定門市的 STORE_PROFILE 設定。"
                : "請先從上方租戶店鋪列表點選「設定」載入門市資料。"
            }
            badges={
              selectedStore ? (
                <>
                  <StatusBadge tone="info">Store {selectedStore.id}</StatusBadge>
                  <StatusBadge tone="neutral">{selectedStore.code || "UNKNOWN"}</StatusBadge>
                </>
              ) : null
            }
          />

          {!selectedStore ? (
            <div className="empty-state">請先在租戶店鋪列表點選「設定」。</div>
          ) : null}

          {selectedStore ? (
            <>
              <div className="platform-store-settings-selected">
                <div className="platform-store-settings-selected-label">目前選擇</div>
                <div className="platform-store-settings-selected-value">
                  {selectedStore.name || "未設定店鋪名稱"} / {selectedStore.code || "-"}
                </div>
              </div>

              {settingsError ? <div className="error-banner">{settingsError}</div> : null}
              {settingsSuccess ? <div className="platform-store-settings-success">{settingsSuccess}</div> : null}
              {settingsLoading ? <div className="loading-state">載入店鋪設定中...</div> : null}

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
              <strong>Coming Soon</strong>
              <p>Logo upload 將在後續階段實作。</p>
            </div>
          </article>

          <article className="admin-panel">
            <AdminSectionHeader
              eyebrow="LINE"
              title="LINE 設定"
              description="此階段不實作 LINE token / secret 編輯，只保留位置。"
            />
            <div className="platform-store-settings-placeholder-card">
              <strong>Coming Soon</strong>
              <p>LINE settings 之後會走獨立的安全流程。</p>
            </div>
          </article>
        </section>
      </div>
    </div>
  );
}

export default SaasAdminPage;
