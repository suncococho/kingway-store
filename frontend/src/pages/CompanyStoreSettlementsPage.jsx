import { useEffect, useMemo, useState } from "react";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import { apiRequest } from "../lib/api";
import { getStoredUser } from "../lib/auth";

const HQ_WRITE_ROLES = new Set(["company_owner", "hq_admin", "inventory_manager"]);
const HQ_RELATIONSHIP_TYPES = new Set(["HEADQUARTERS", "WAREHOUSE"]);

function getCurrentStoreCompany(companyResponse) {
  const storeId = Number(getStoredUser()?.storeId || 0);
  if (!storeId) return null;
  return (companyResponse?.companies || []).find((company) =>
    (company.stores || []).some((store) => Number(store.storeId) === storeId)
  ) || null;
}

function isCurrentStoreHqContext(company) {
  const storeId = Number(getStoredUser()?.storeId || 0);
  return (company?.stores || []).some(
    (store) =>
      Number(store.storeId) === storeId &&
      HQ_RELATIONSHIP_TYPES.has(store.relationshipType)
  );
}

function money(value) {
  return `NT$ ${Number(value || 0).toLocaleString()}`;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function statusLabel(status) {
  return {
    DRAFT: "草稿",
    CONFIRMED: "已確認",
    PARTIALLY_PAID: "部分付款",
    PAID: "已付款",
    CANCELED: "已取消"
  }[status] || status || "-";
}

function statusTone(status) {
  if (status === "PAID") return "success";
  if (status === "PARTIALLY_PAID") return "warning";
  if (status === "CANCELED") return "danger";
  return "info";
}

function relationshipLabel(value) {
  return value === "FRANCHISE_STORE" ? "加盟店" : value === "DIRECT_STORE" ? "直營店" : value || "-";
}

export default function CompanyStoreSettlementsPage() {
  const [companyInfo, setCompanyInfo] = useState(null);
  const [month, setMonth] = useState(currentMonth());
  const [targetStoreId, setTargetStoreId] = useState("");
  const [settlements, setSettlements] = useState([]);
  const [summary, setSummary] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [excludeDemoData, setExcludeDemoData] = useState(false);

  const currentCompany = getCurrentStoreCompany(companyInfo);
  const hqCompany = isCurrentStoreHqContext(currentCompany) ? currentCompany : null;
  const canManage = Boolean(hqCompany && HQ_WRITE_ROLES.has(hqCompany.role));
  const targetStores = useMemo(
    () => (hqCompany?.stores || []).filter((store) => ["DIRECT_STORE", "FRANCHISE_STORE"].includes(store.relationshipType)),
    [hqCompany]
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const nextCompanyInfo = await apiRequest("/company/me").catch(() => ({ franchiseEnabled: false, companies: [] }));
      setCompanyInfo(nextCompanyInfo);
      const company = getCurrentStoreCompany(nextCompanyInfo);
      const isHqContext = isCurrentStoreHqContext(company);
      const reportCompany = isHqContext ? company : null;
      const params = new URLSearchParams();
      params.set("month", month);
      if (reportCompany?.id) params.set("companyId", String(reportCompany.id));
      if (!reportCompany?.id) params.set("view", "payable");
      if (reportCompany?.id && targetStoreId) params.set("targetStoreId", targetStoreId);
      if (excludeDemoData) params.set("excludeDemo", "true");
      const list = await apiRequest(`/company-store-settlements?${params.toString()}`);
      setSettlements(Array.isArray(list.settlements) ? list.settlements : []);

      const summaryParams = new URLSearchParams();
      summaryParams.set("month", month);
      if (reportCompany?.id) summaryParams.set("companyId", String(reportCompany.id));
      if (reportCompany?.id && targetStoreId) summaryParams.set("targetStoreId", targetStoreId);
      if (excludeDemoData) summaryParams.set("excludeDemo", "true");
      const nextSummary = await apiRequest(`/company-store-settlements/monthly-summary?${summaryParams.toString()}`);
      setSummary(Array.isArray(nextSummary.summary) ? nextSummary.summary : []);
    } catch (requestError) {
      setError(requestError.message || "本部月結資料讀取失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [month, targetStoreId, excludeDemoData]);

  async function openDetail(row) {
    try {
      const response = await apiRequest(`/company-store-settlements/${row.id}`);
      setSelected(response.settlement);
    } catch (requestError) {
      alert(requestError.message || "月結明細讀取失敗");
    }
  }

  async function generateSettlement() {
    if (!hqCompany?.id || !targetStoreId) {
      alert("請選擇公司與門市");
      return;
    }
    try {
      const response = await apiRequest("/company-store-settlements/generate", {
        method: "POST",
        body: JSON.stringify({
          companyId: hqCompany.id,
          targetStoreId: Number(targetStoreId),
          month,
          note: `${month} 本部供貨月結`
        }),
        processingMessage: "產生月結中"
      });
      setSelected(response.settlement);
      await load();
      alert("月結已產生，未異動庫存");
    } catch (requestError) {
      alert(requestError.message || "產生月結失敗");
    }
  }

  async function confirmSettlement(row) {
    if (!confirm("確認月結後，明細將鎖定，請確認金額無誤。")) return;
    try {
      const response = await apiRequest(`/company-store-settlements/${row.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({}),
        processingMessage: "確認月結中"
      });
      setSelected(response.settlement);
      await load();
    } catch (requestError) {
      alert(requestError.message || "確認月結失敗");
    }
  }

  async function markPaid(row) {
    const value = prompt("請輸入累計已付款金額", String(row.totalAmount || 0));
    if (value === null) return;
    if (!confirm("標記已付款後，此月結將顯示為已付款。此操作不會改變庫存。")) return;
    try {
      const response = await apiRequest(`/company-store-settlements/${row.id}/mark-paid`, {
        method: "POST",
        body: JSON.stringify({ paidAmount: Number(value), note: "WEB ERP" }),
        processingMessage: "付款狀態更新中"
      });
      setSelected(response.settlement);
      await load();
    } catch (requestError) {
      alert(requestError.message || "付款狀態更新失敗");
    }
  }

  const settlementColumns = [
    { key: "settlementNo", label: "月結單號" },
    { key: "settlementMonth", label: "月結月份" },
    { key: "targetStoreName", label: "對象門市" },
    { key: "targetRelationshipType", label: "類型", render: (row) => relationshipLabel(row.targetRelationshipType) },
    { key: "status", label: "狀態", render: (row) => <StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge> },
    { key: "totalAmount", label: canManage ? "應收金額" : "應付金額", render: (row) => money(row.totalAmount) },
    { key: "paidAmount", label: "已付金額", render: (row) => money(row.paidAmount) },
    { key: "unpaidAmount", label: "未付金額", render: (row) => money(row.unpaidAmount) },
    {
      key: "actions",
      label: "操作",
      render: (row) => (
        <div className="action-row compact-actions">
          <button type="button" className="secondary-button" onClick={() => openDetail(row)}>查看明細</button>
          {canManage && row.status === "DRAFT" ? <button type="button" className="primary-button" onClick={() => confirmSettlement(row)}>確認月結</button> : null}
          {canManage && ["CONFIRMED", "PARTIALLY_PAID", "PAID"].includes(row.status) ? <button type="button" className="secondary-button" onClick={() => markPaid(row)}>標記已付款</button> : null}
        </div>
      )
    }
  ];

  const summaryColumns = [
    { key: "targetStoreName", label: "對象門市" },
    { key: "targetRelationshipType", label: "類型", render: (row) => relationshipLabel(row.targetRelationshipType) },
    { key: "settlementCount", label: "月結筆數" },
    { key: "totalAmount", label: canManage ? "應收金額" : "應付金額", render: (row) => money(row.totalAmount) },
    { key: "paidAmount", label: "已付金額", render: (row) => money(row.paidAmount) },
    { key: "unpaidAmount", label: "未付金額", render: (row) => money(row.unpaidAmount) }
  ];

  const itemColumns = [
    { key: "transferNo", label: "transfer no" },
    { key: "sku", label: "SKU" },
    { key: "productName", label: "商品" },
    { key: "quantityReceived", label: "入庫數量" },
    { key: "unitPrice", label: "結算單價", render: (row) => money(row.unitPrice) },
    { key: "lineAmount", label: "小計", render: (row) => money(row.lineAmount) },
    { key: "sourceReceivedAt", label: "入庫日期", render: (row) => row.sourceReceivedAt ? String(row.sourceReceivedAt).slice(0, 10) : "-" }
  ];

  return (
    <div>
      <PageHeader
        title={canManage ? "本部月結應收" : "本部應付月結"}
        description="本部月結會依門市已完成入庫的商品數量與結算單價計算。月結不會改變庫存，只用於應收/應付金額管理。"
      />
      {error ? <div className="empty-state">{error}</div> : null}
      <section className="content-card section-panel">
        <AdminSectionHeader eyebrow="篩選" title="月結條件" description={loading ? "讀取中..." : "選擇月份與門市查看月結。"} />
        <div className="grid-form compact-grid">
          <label className="form-field"><span>月份</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
          {canManage ? (
            <label className="form-field"><span>門市</span><select value={targetStoreId} onChange={(event) => setTargetStoreId(event.target.value)}><option value="">全部門市</option>{targetStores.map((store) => <option key={store.storeId} value={store.storeId}>{store.storeName} / {relationshipLabel(store.relationshipType)}</option>)}</select></label>
          ) : null}
          <label className="form-field checkbox-field"><input type="checkbox" checked={excludeDemoData} onChange={(event) => setExcludeDemoData(event.target.checked)} /><span>排除測試資料</span></label>
          <div className="form-field form-field-wide"><span className="muted-text">勾選後，PROD DEMO / 測試資料不會列入月結統計。</span></div>
          {canManage ? <button type="button" className="primary-button inline-submit" onClick={generateSettlement} disabled={!targetStoreId}>產生月結</button> : null}
        </div>
      </section>

      <section className="content-card section-panel">
        <AdminSectionHeader eyebrow="摘要" title={canManage ? "本部應收摘要" : "本部應付摘要"} description="依門市彙總應收、已付與未付金額。" />
        <DataTable columns={summaryColumns} rows={summary} emptyText="目前沒有月結摘要。" cardTitle={(row) => row.targetStoreName} cardDescription={(row) => `未付款 ${money(row.unpaidAmount)}`} />
      </section>

      <section className="content-card section-panel">
        <AdminSectionHeader eyebrow="月結列表" title={canManage ? "本部月結應收" : "本部應付月結"} description="月結金額依已入庫數量與調撥單價計算，不異動庫存。" />
        <DataTable columns={settlementColumns} rows={settlements} emptyText="目前沒有月結資料。" cardTitle={(row) => row.settlementNo} cardDescription={(row) => `${row.targetStoreName} / ${money(row.totalAmount)}`} cardBadges={(row) => <StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge>} />
      </section>

      {selected ? (
        <section className="content-card section-panel">
          <AdminSectionHeader eyebrow="明細" title={selected.settlementNo} description={`${selected.targetStoreName} / ${selected.settlementMonth}`} badges={<StatusBadge tone={statusTone(selected.status)}>{statusLabel(selected.status)}</StatusBadge>} />
          <div className="admin-summary-grid">
            <article className="admin-summary-card"><div className="admin-summary-label">{canManage ? "應收金額" : "應付金額"}</div><div className="admin-summary-value">{money(selected.totalAmount)}</div></article>
            <article className="admin-summary-card"><div className="admin-summary-label">已付金額</div><div className="admin-summary-value">{money(selected.paidAmount)}</div></article>
            <article className="admin-summary-card"><div className="admin-summary-label">未付金額</div><div className="admin-summary-value">{money(selected.unpaidAmount)}</div></article>
          </div>
          <DataTable columns={itemColumns} rows={selected.items || []} emptyText="此月結沒有明細。" cardTitle={(row) => row.sku} cardDescription={(row) => `${row.productName} / ${row.quantityReceived} x ${money(row.unitPrice)}`} />
        </section>
      ) : null}
    </div>
  );
}
