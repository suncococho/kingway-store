import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import { getStoredPlatformUser, platformRequest } from "../lib/platformAuth";

const ACTION_LABELS = ["店鋪設定", "功能設定", "LINE 設定", "Telegram 設定", "POS 設定", "權限設定"];

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

function renderActionButtons(store) {
  return (
    <div className="compact-actions">
      {ACTION_LABELS.map((label) => (
        label === "功能設定" && store?.id ? (
          <Link key={label} to={`/saas-admin/stores/${store.id}/features`} className="secondary-button">
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
  const isAdmin = ["PLATFORM_OWNER", "PLATFORM_ADMIN", "SUPPORT"].includes(
    String(currentUser?.role || "").trim().toUpperCase()
  );
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

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

    loadStores();
  }, [isAdmin]);

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

      <section className="admin-panel">
        <AdminSectionHeader
          eyebrow="SaaS 平台"
          title="租戶店鋪列表"
          description="第一版為唯讀總覽；KINGWAY_TAINAN 顯示為租戶店鋪，不代表平台本身。設定按鈕先作為後續平台管理頁面的入口占位。"
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
          cardDescription={(row) => row.name || "未設定店鋪名稱"}
          cardBadges={(row) => <StatusBadge tone={getStatusTone(row.status)}>{row.status || "-"}</StatusBadge>}
          cardFooter={(row) => renderActionButtons(row)}
        />
      </section>
    </div>
  );
}

export default SaasAdminPage;
