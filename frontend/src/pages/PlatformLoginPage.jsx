import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import {
  clearPlatformAuth,
  getStoredPlatformToken,
  getStoredPlatformUser,
  platformLogin,
  platformRequest
} from "../lib/platformAuth";

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

function renderStoreActions(store) {
  return (
    <div className="compact-actions">
      <Link to={"/platform-admin/stores/" + store.id + "/features"} className="secondary-button">
        功能設定
      </Link>
    </div>
  );
}

function PlatformLoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      await platformLogin(form);
      navigate("/platform-admin", { replace: true });
    } catch (submitError) {
      setError(submitError.message || "登入失敗");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>平台管理員登入</h1>
        <p>請使用 SaaS 本社平台管理員帳號登入。</p>
        <label className="form-field">
          <span>電子郵件</span>
          <input
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            placeholder="請輸入平台管理員電子郵件"
            autoComplete="username"
            required
          />
        </label>
        <label className="form-field">
          <span>密碼</span>
          <input
            name="password"
            type="password"
            value={form.password}
            onChange={handleChange}
            placeholder="請輸入密碼"
            autoComplete="current-password"
            required
          />
        </label>
        {error ? <div className="error-banner">{error}</div> : null}
        <button type="submit" className="primary-button" disabled={loading}>
          {loading ? "登入中..." : "登入平台管理中心"}
        </button>
      </form>
    </div>
  );
}

export function PlatformAdminPage() {
  const navigate = useNavigate();
  const token = getStoredPlatformToken();
  const user = getStoredPlatformUser();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      return;
    }

    async function loadStores() {
      setLoading(true);
      setError("");

      try {
        const response = await platformRequest("/saas-admin/stores");
        setData(response);
      } catch (loadError) {
        setError(loadError.message || "載入 SaaS 平台管理資料失敗");
      } finally {
        setLoading(false);
      }
    }

    loadStores();
  }, [token]);

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
    { label: "執行環境", value: data?.environment || "unknown", small: true },
    { label: "SchemaGuard", value: getSchemaGuardLabel(data?.schemaGuard), small: true },
    { label: "商品總數", value: totals.productCount },
    { label: "客戶總數", value: totals.customerCount },
    { label: "訂單總數", value: totals.orderCount },
    { label: "維修總數", value: totals.repairCount }
  ];

  const columns = [
    { key: "id", label: "ID" },
    { key: "code", label: "店鋪代碼" },
    { key: "name", label: "店鋪名稱" },
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
      render: (row) => renderStoreActions(row)
    }
  ];

  function handleLogout() {
    clearPlatformAuth();
    navigate("/platform-admin/login", { replace: true });
  }

  if (!token) {
    return <Navigate to="/platform-admin/login" replace />;
  }

  return (
    <main className="page-content">
      <PageHeader
        title="SaaS 平台管理中心"
        description="KINGWAY_TAINAN 是 store_id=1 的租戶店鋪；此區為 SaaS 本社平台管理員入口。"
      />
      <div className="compact-actions">
        <span className="secondary-button">{user?.displayName || user?.email || "平台管理員"}</span>
        <button type="button" className="secondary-button" onClick={handleLogout}>登出</button>
      </div>

      {loading ? <PageHeader title="SaaS 平台管理中心" description="載入平台租戶店鋪資料中..." /> : null}
        {error ? <div className="empty-state">{error}</div> : null}

        {!loading && !error ? (
          <>
            <div className="admin-summary-grid dashboard-summary-grid">
              {summaryCards.map((card) => (
                <article key={card.label} className="admin-summary-card">
                  <div className="admin-summary-label">{card.label}</div>
                  <div className={"admin-summary-value " + (card.small ? "admin-summary-value-small" : "")}>{card.value}</div>
                </article>
              ))}
            </div>

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
                cardTitle={(row) => row.code || "店鋪 " + row.id}
                cardDescription={(row) => row.name || "未設定店鋪名稱"}
                cardBadges={(row) => <StatusBadge tone={getStatusTone(row.status)}>{row.status || "-"}</StatusBadge>}
                cardFooter={(row) => renderStoreActions(row)}
              />
            </section>
          </>
        ) : null}
    </main>
  );
}

export default PlatformLoginPage;
