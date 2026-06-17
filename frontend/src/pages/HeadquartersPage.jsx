import { useEffect, useState } from "react";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import { apiRequest } from "../lib/api";

function getRelationshipLabel(value) {
  const labels = {
    HEADQUARTERS: "總部",
    WAREHOUSE: "本部倉庫",
    DIRECT_STORE: "直營門市",
    FRANCHISE_STORE: "加盟門市"
  };
  return labels[value] || value || "-";
}

function HeadquartersPage() {
  const [data, setData] = useState(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadCompanies() {
      setLoading(true);
      setError("");
      try {
        const response = await apiRequest("/company/me");
        if (!active) return;
        setData(response);
        const firstCompany = Array.isArray(response.companies) ? response.companies[0] : null;
        setSelectedCompanyId(firstCompany ? String(firstCompany.id) : "");
      } catch (requestError) {
        if (active) setError(requestError.message || "讀取總部資料失敗");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadCompanies();
    return () => {
      active = false;
    };
  }, []);

  const companies = Array.isArray(data?.companies) ? data.companies : [];
  const selectedCompany = companies.find((company) => String(company.id) === String(selectedCompanyId)) || companies[0] || null;
  const storeColumns = [
    { key: "storeCode", label: "門市代碼" },
    { key: "storeName", label: "門市名稱" },
    { key: "relationshipType", label: "關係", render: (row) => getRelationshipLabel(row.relationshipType) },
    { key: "storeStatus", label: "門市狀態" }
  ];

  if (loading) {
    return <PageHeader title="總部管理" description="載入總部資料中..." />;
  }

  if (error) {
    return (
      <div>
        <PageHeader title="總部管理" description="公司 / 品牌與所屬門市。" />
        <div className="empty-state">{error}</div>
      </div>
    );
  }

  if (!companies.length) {
    return (
      <div>
        <PageHeader title="總部管理" description="公司 / 品牌與所屬門市。" />
        <div className="empty-state">此帳號沒有總部管理權限。</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="總部管理" description="公司資料、所屬門市與總部功能入口。本部出貨、門市入庫與加盟店結算將於下一階段開放。" />

      <section className="content-card section-panel">
        <AdminSectionHeader
          eyebrow="公司資料"
          title={selectedCompany?.name || "總部"}
          description="目前只顯示公司與門市基礎結構，不處理庫存轉移或結算。"
          badges={<StatusBadge tone="info">{selectedCompany?.role || "viewer"}</StatusBadge>}
          actions={
            companies.length > 1 ? (
              <select value={selectedCompanyId} onChange={(event) => setSelectedCompanyId(event.target.value)}>
                {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            ) : null
          }
        />
        <div className="admin-summary-grid dashboard-summary-grid">
          <article className="admin-summary-card"><div className="admin-summary-label">公司代碼</div><div className="admin-summary-value admin-summary-value-small">{selectedCompany?.code || "-"}</div></article>
          <article className="admin-summary-card"><div className="admin-summary-label">公司狀態</div><div className="admin-summary-value admin-summary-value-small">{selectedCompany?.status || "-"}</div></article>
          <article className="admin-summary-card"><div className="admin-summary-label">所屬門市</div><div className="admin-summary-value">{selectedCompany?.stores?.length || 0}</div></article>
        </div>
      </section>

      <section className="content-card section-panel">
        <AdminSectionHeader eyebrow="所屬門市" title="門市列表" description="總部帳號可查看所屬門市；門市員工仍只看自己的店別。" />
        <DataTable columns={storeColumns} rows={selectedCompany?.stores || []} emptyText="尚未連結門市。" />
      </section>

      <section className="content-card section-panel">
        <AdminSectionHeader eyebrow="下一階段" title="總部營運功能" description="以下功能保留入口但尚未啟用。" />
        <div className="admin-highlight-list">
          <div className="metric-row"><span>本部出貨</span><strong>下一階段</strong></div>
          <div className="metric-row"><span>門市入庫確認</span><strong>下一階段</strong></div>
          <div className="metric-row"><span>跨店庫存</span><strong>下一階段</strong></div>
          <div className="metric-row"><span>加盟店結算</span><strong>下一階段</strong></div>
        </div>
      </section>
    </div>
  );
}

export default HeadquartersPage;
