import { useEffect, useMemo, useState } from "react";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import { API_BASE_URL, apiRequest } from "../lib/api";
import { getStoredToken, getStoredUser } from "../lib/auth";

const HQ_READ_ROLES = new Set(["company_owner", "hq_admin", "finance", "inventory_manager", "viewer"]);
const HQ_RELATIONSHIP_TYPES = new Set(["HEADQUARTERS", "WAREHOUSE"]);

function getCurrentHqCompany(companyResponse) {
  const storeId = Number(getStoredUser()?.storeId || 0);
  if (!storeId) return null;
  return (companyResponse?.companies || []).find(
    (company) =>
      HQ_READ_ROLES.has(company.role) &&
      (company.stores || []).some(
        (store) =>
          Number(store.storeId) === storeId &&
          HQ_RELATIONSHIP_TYPES.has(store.relationshipType)
      )
  ) || null;
}

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartText() {
  return `${todayText().slice(0, 7)}-01`;
}

function money(value) {
  return `NT$ ${Number(value || 0).toLocaleString()}`;
}

function dateText(value) {
  return value ? String(value).slice(0, 10) : "-";
}

function settlementLabel(status) {
  if (!status || status === "UNSETTLED") return "未月結";
  return {
    DRAFT: "草稿",
    CONFIRMED: "已確認",
    PARTIALLY_PAID: "部分付款",
    PAID: "已付款",
    CANCELED: "已取消"
  }[status] || status;
}

function settlementTone(status) {
  if (status === "PAID") return "success";
  if (status === "PARTIALLY_PAID" || status === "CONFIRMED") return "warning";
  if (status === "UNSETTLED" || !status) return "neutral";
  if (status === "CANCELED") return "danger";
  return "info";
}

function transferStatusLabel(status) {
  return {
    DRAFT: "草稿",
    SHIPPED: "已出貨",
    PARTIALLY_RECEIVED: "部分入庫",
    RECEIVED: "已完成入庫",
    DISCREPANCY: "入庫差異",
    CANCELED: "已取消"
  }[status] || status || "-";
}

export default function HqTransferReportPage() {
  const [companyInfo, setCompanyInfo] = useState(null);
  const [filters, setFilters] = useState({
    fromDate: monthStartText(),
    toDate: todayText(),
    targetStoreId: "",
    status: "ALL",
    settlementStatus: "ALL"
  });
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ totalQuantityShipped: 0, totalQuantityReceived: 0, totalAmount: 0, rowCount: 0 });
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const hqCompany = useMemo(() => getCurrentHqCompany(companyInfo), [companyInfo]);
  const targetStores = useMemo(
    () => (hqCompany?.stores || []).filter((store) => ["DIRECT_STORE", "FRANCHISE_STORE"].includes(store.relationshipType)),
    [hqCompany]
  );

  function buildParams(extra = {}) {
    const params = new URLSearchParams({
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      status: filters.status,
      settlementStatus: filters.settlementStatus,
      ...extra
    });
    if (hqCompany?.id) params.set("companyId", String(hqCompany.id));
    if (filters.targetStoreId) params.set("targetStoreId", filters.targetStoreId);
    return params;
  }

  async function loadReport(nextCompanyInfo = companyInfo) {
    setLoading(true);
    setError("");
    try {
      const company = getCurrentHqCompany(nextCompanyInfo);
      if (!company?.id) {
        setRows([]);
        setSummary({ totalQuantityShipped: 0, totalQuantityReceived: 0, totalAmount: 0, rowCount: 0 });
        setError("此帳號沒有本部出貨明細權限。");
        return;
      }
      const params = buildParams({ companyId: String(company.id) });
      const response = await apiRequest(`/company-store-settlements/transfer-report?${params.toString()}`);
      setRows(Array.isArray(response.rows) ? response.rows : []);
      setSummary(response.summary || { totalQuantityShipped: 0, totalQuantityReceived: 0, totalAmount: 0, rowCount: 0 });
    } catch (requestError) {
      setError(requestError.message || "本部出貨明細讀取失敗");
    } finally {
      setLoading(false);
    }
  }

  async function loadInitial() {
    setLoading(true);
    try {
      const nextCompanyInfo = await apiRequest("/company/me");
      setCompanyInfo(nextCompanyInfo);
      await loadReport(nextCompanyInfo);
    } catch (requestError) {
      setError(requestError.message || "本部資料讀取失敗");
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInitial();
  }, []);

  function updateFilter(event) {
    const { name, value } = event.target;
    setFilters((current) => ({ ...current, [name]: value }));
  }

  async function downloadExcel() {
    setDownloading(true);
    setError("");
    try {
      const token = getStoredToken();
      const params = buildParams({ export: "xlsx" });
      const response = await fetch(`${API_BASE_URL}/company-store-settlements/transfer-report?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Excel 下載失敗");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `kingway_hq_transfer_report_${filters.fromDate.replaceAll("-", "")}_${filters.toDate.replaceAll("-", "")}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError.message || "Excel 下載失敗");
    } finally {
      setDownloading(false);
    }
  }

  const columns = [
    { key: "shippedAt", label: "出貨日期", render: (row) => dateText(row.shippedAt) },
    { key: "receivedAt", label: "入庫日期", render: (row) => dateText(row.receivedAt) },
    { key: "transferNo", label: "出貨單號" },
    { key: "targetStoreName", label: "門市" },
    { key: "sku", label: "SKU" },
    { key: "productName", label: "商品名稱" },
    { key: "quantityShipped", label: "出貨數量" },
    { key: "quantityReceived", label: "入庫數量" },
    { key: "unitCost", label: "本部批發價", render: (row) => money(row.unitCost) },
    { key: "lineAmount", label: "小計", render: (row) => money(row.lineAmount) },
    { key: "settlementStatus", label: "月結狀態", render: (row) => <StatusBadge tone={settlementTone(row.settlementStatus)}>{settlementLabel(row.settlementStatus)}</StatusBadge> },
    { key: "settlementNo", label: "月結單號", render: (row) => row.settlementNo || "-" }
  ];

  return (
    <div>
      <PageHeader
        title="本部出貨明細"
        description="依出貨日期查詢本部供貨給各門市的商品明細，包含本部批發價、出貨數量、入庫數量與月結狀態。本部批發價也就是本部與門市月結使用的結算單價。"
      />
      {error ? <div className="empty-state">{error}</div> : null}

      <section className="content-card section-panel">
        <AdminSectionHeader eyebrow="篩選" title="出貨明細條件" description={loading ? "讀取中..." : "月結仍依既有已入庫資料產生；此報表依出貨日期查詢。"} />
        <div className="grid-form compact-grid">
          <label className="form-field"><span>開始日</span><input type="date" name="fromDate" value={filters.fromDate} onChange={updateFilter} /></label>
          <label className="form-field"><span>結束日</span><input type="date" name="toDate" value={filters.toDate} onChange={updateFilter} /></label>
          <label className="form-field"><span>門市</span><select name="targetStoreId" value={filters.targetStoreId} onChange={updateFilter}><option value="">全部門市</option>{targetStores.map((store) => <option key={store.storeId} value={store.storeId}>{store.storeName}</option>)}</select></label>
          <label className="form-field"><span>出貨狀態</span><select name="status" value={filters.status} onChange={updateFilter}><option value="ALL">全部</option><option value="DRAFT">草稿</option><option value="SHIPPED">已出貨</option><option value="PARTIALLY_RECEIVED">部分入庫</option><option value="RECEIVED">已完成入庫</option><option value="CANCELED">已取消</option></select></label>
          <label className="form-field"><span>月結狀態</span><select name="settlementStatus" value={filters.settlementStatus} onChange={updateFilter}><option value="ALL">全部</option><option value="SETTLED">已月結</option><option value="UNSETTLED">未月結</option></select></label>
          <div className="action-row form-field-wide">
            <button type="button" className="primary-button" onClick={() => loadReport()} disabled={loading}>查詢</button>
            <button type="button" className="secondary-button" onClick={downloadExcel} disabled={downloading || !rows.length}>{downloading ? "下載中..." : "Excel 下載"}</button>
          </div>
        </div>
      </section>

      <div className="admin-summary-grid dashboard-summary-grid">
        <article className="admin-summary-card"><div className="admin-summary-label">出貨總數</div><div className="admin-summary-value">{summary.totalQuantityShipped}</div></article>
        <article className="admin-summary-card"><div className="admin-summary-label">入庫總數</div><div className="admin-summary-value">{summary.totalQuantityReceived}</div></article>
        <article className="admin-summary-card"><div className="admin-summary-label">批發總額</div><div className="admin-summary-value">{money(summary.totalAmount)}</div></article>
        <article className="admin-summary-card"><div className="admin-summary-label">明細筆數</div><div className="admin-summary-value">{summary.rowCount}</div></article>
      </div>

      <section className="content-card section-panel">
        <AdminSectionHeader eyebrow="明細" title="本部出貨商品列表" description="小計以出貨數量乘以本部批發價計算；若出貨單未記錄單價，會以商品成本或售價 fallback 顯示。" />
        <DataTable
          columns={columns}
          rows={rows.map((row) => ({ ...row, transferStatusLabel: transferStatusLabel(row.transferStatus) }))}
          emptyText="目前沒有符合條件的本部出貨明細。"
          cardTitle={(row) => row.transferNo}
          cardDescription={(row) => `${row.targetStoreName} / ${row.sku} / ${transferStatusLabel(row.transferStatus)}`}
          cardBadges={(row) => <StatusBadge tone={settlementTone(row.settlementStatus)}>{settlementLabel(row.settlementStatus)}</StatusBadge>}
        />
      </section>
    </div>
  );
}
