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

function renderActionButtons(store) {
  return (
    <div className="compact-actions">
      {ACTION_LABELS.map((label) => (
        label === "功能設定" && store?.id ? (
          <Link key={label} to={"/platform-admin/stores/" + store.id + "/features"} className="secondary-button">
            {label}
          </Link>
        ) : (
          <button key={label} type="button" className="secondary-button" disabled>
            {label}
          </button>
        )
      ))}
    </div>
  );
}

function SaasAdminPage() {
  const currentUser = getStoredPlatformUser();
  const currentRole = String(currentUser?.role || "").trim().toUpperCase();
  const isAdmin = ["PLATFORM_OWNER", "PLATFORM_ADMIN", "SUPPORT"].includes(currentRole);
  const canCreateStore = ["PLATFORM_OWNER", "PLATFORM_ADMIN"].includes(currentRole);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createForm, setCreateForm] = useState(DEFAULT_CREATE_FORM);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createResult, setCreateResult] = useState(null);

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

  const stores = Array.isArray(data?.stores) ? data.stores : [];

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
      render: (row) => renderActionButtons(row)
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
          description="平台層級檢視租戶店鋪，並可進入功能設定調整各店鋪模組開關。"
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
          cardFooter={(row) => renderActionButtons(row)}
        />
      </section>
    </div>
  );
}

export default SaasAdminPage;
