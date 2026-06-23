import { useEffect, useMemo, useState } from "react";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import { apiRequest } from "../lib/api";

const HQ_WRITE_ROLES = new Set(["company_owner", "hq_admin", "inventory_manager"]);

const STATUS_LABELS = {
  DRAFT: "草稿",
  SUBMITTED: "已送出",
  PARTIALLY_FULFILLED: "部分出貨",
  FULFILLED: "已完成",
  CANCELED: "已取消",
  REQUESTED: "待處理"
};

function statusTone(status) {
  if (status === "FULFILLED") return "success";
  if (status === "PARTIALLY_FULFILLED" || status === "SUBMITTED" || status === "REQUESTED") return "warning";
  if (status === "CANCELED") return "danger";
  return "info";
}

function money(value) {
  return `NT$ ${Number(value || 0).toLocaleString()}`;
}

function formatDate(value) {
  return value ? String(value).replace("T", " ").slice(0, 16) : "-";
}

function friendlyError(error) {
  if (error?.status === 409) {
    return "此品項已建立出貨單，請勿重複處理。";
  }
  return error?.message || "處理失敗";
}

export default function HqReplenishmentRequestsPage() {
  const [companyInfo, setCompanyInfo] = useState(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [requests, setRequests] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [unitCostOverrides, setUnitCostOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const companies = Array.isArray(companyInfo?.companies) ? companyInfo.companies : [];
  const selectedCompany = useMemo(
    () => companies.find((company) => String(company.id) === String(selectedCompanyId)) || companies[0] || null,
    [companies, selectedCompanyId]
  );
  const canManage = Boolean(selectedCompany && HQ_WRITE_ROLES.has(selectedCompany.role));

  useEffect(() => {
    loadCompanies();
  }, []);

  useEffect(() => {
    if (selectedCompany?.id) {
      loadRequests();
    }
  }, [selectedCompany?.id, showAll]);

  async function loadCompanies() {
    setLoading(true);
    setError("");
    try {
      const response = await apiRequest("/company/me");
      const rows = Array.isArray(response.companies) ? response.companies : [];
      setCompanyInfo(response);
      setSelectedCompanyId(rows[0] ? String(rows[0].id) : "");
    } catch (requestError) {
      setError(requestError.message || "本部資料讀取失敗");
    } finally {
      setLoading(false);
    }
  }

  async function loadRequests() {
    if (!selectedCompany?.id) return;
    setLoading(true);
    setError("");
    try {
      const path = showAll ? "/store-replenishment-requests/company" : "/store-replenishment-requests/company/pending";
      const params = new URLSearchParams({ companyId: String(selectedCompany.id) });
      const response = await apiRequest(`${path}?${params.toString()}`);
      setRequests(Array.isArray(response.requests) ? response.requests : []);
    } catch (requestError) {
      setError(requestError.message || "本部請貨資料讀取失敗");
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(row) {
    try {
      const response = await apiRequest(`/store-replenishment-requests/${row.id}`);
      setSelectedRequest(response.request);
      setUnitCostOverrides(Object.fromEntries((response.request.items || []).map((item) => [item.id, Number(item.unitCost || 0)])));
    } catch (requestError) {
      alert(requestError.message || "請貨明細讀取失敗");
    }
  }

  function updateUnitCost(itemId, value) {
    setUnitCostOverrides((current) => ({
      ...current,
      [itemId]: Number(value)
    }));
  }

  async function processItem(item, shouldShip) {
    if (!selectedRequest) return;
    if (!canManage) {
      alert("此帳號沒有本部請貨處理權限");
      return;
    }
    const message = shouldShip
      ? "確認建立並出貨？本部庫存將立即扣除，門市需收到商品後執行門市入庫。"
      : "確認建立本部出貨單？建立後仍需確認出貨才會扣除本部庫存。";
    if (!confirm(message)) return;

    const unitCost = Number(unitCostOverrides[item.id] ?? item.unitCost ?? 0);
    const endpoint = shouldShip ? "create-and-ship-transfer" : "create-transfer";
    try {
      const response = await apiRequest(`/store-replenishment-requests/${selectedRequest.id}/items/${item.id}/${endpoint}`, {
        method: "POST",
        body: JSON.stringify({
          unitCost,
          note: `本部請貨 ${selectedRequest.requestNo}`,
          itemNote: `本部請貨品項 ${item.requestedSku}`
        }),
        processingMessage: shouldShip ? "建立並確認出貨中" : "建立本部出貨中"
      });
      setSelectedRequest(response.request);
      setUnitCostOverrides(Object.fromEntries((response.request.items || []).map((nextItem) => [nextItem.id, Number(nextItem.unitCost || 0)])));
      await loadRequests();
      alert(shouldShip ? "已建立並確認出貨，門市需至門市入庫確認實收數量。" : "已建立本部出貨單，庫存尚未扣除。");
    } catch (requestError) {
      alert(friendlyError(requestError));
    }
  }

  const requestColumns = [
    { key: "requestNo", label: "請貨單號" },
    { key: "requestingStoreName", label: "申請門市" },
    { key: "status", label: "狀態", render: (row) => <StatusBadge tone={statusTone(row.status)}>{STATUS_LABELS[row.status] || row.status}</StatusBadge> },
    { key: "itemSummary", label: "品項" },
    { key: "submittedAt", label: "送出時間", render: (row) => formatDate(row.submittedAt) },
    { key: "actions", label: "操作", render: (row) => <button type="button" className="secondary-button" onClick={() => openDetail(row)}>查看明細</button> }
  ];

  const itemColumns = [
    { key: "requestedSku", label: "SKU" },
    { key: "requestedProductName", label: "商品名稱" },
    { key: "quantityRequested", label: "申請數量" },
    { key: "quantityFulfilled", label: "已出貨數量" },
    {
      key: "unitCost",
      label: "建議結算單價",
      render: (row) => row.status === "REQUESTED" && canManage ? (
        <input
          type="number"
          min="0"
          step="1"
          value={unitCostOverrides[row.id] ?? row.unitCost ?? 0}
          onChange={(event) => updateUnitCost(row.id, event.target.value)}
        />
      ) : money(row.unitCost)
    },
    { key: "status", label: "狀態", render: (row) => <StatusBadge tone={statusTone(row.status)}>{STATUS_LABELS[row.status] || row.status}</StatusBadge> },
    {
      key: "actions",
      label: "操作",
      render: (row) => row.status === "REQUESTED" ? (
        <div className="action-row compact-actions">
          <button type="button" className="secondary-button" onClick={() => processItem(row, false)}>建立本部出貨</button>
          <button type="button" className="primary-button" onClick={() => processItem(row, true)}>建立並確認出貨</button>
        </div>
      ) : row.transferId ? <span className="muted-text">出貨單 #{row.transferId}</span> : "-"
    }
  ];

  if (!loading && !companies.length) {
    return (
      <div>
        <PageHeader title="本部請貨管理" description="本部請貨管理用於查看各門市或加盟店的補貨申請。" />
        <div className="empty-state">此帳號沒有本部請貨管理權限。</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="本部請貨管理"
        description="本部請貨管理用於查看各門市或加盟店的補貨申請。建立出貨單後，門市需於收到商品後至『門市入庫』確認實收數量。"
      />
      {error ? <div className="empty-state">{error}</div> : null}

      <section className="content-card section-panel">
        <AdminSectionHeader
          eyebrow="篩選"
          title="請貨列表"
          description={loading ? "讀取中..." : "預設顯示待處理請貨單。"}
          actions={companies.length > 1 ? (
            <select value={selectedCompanyId} onChange={(event) => setSelectedCompanyId(event.target.value)}>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          ) : null}
        />
        <div className="grid-form compact-grid">
          <label className="form-field checkbox-field"><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} /><span>顯示全部請貨單</span></label>
          <button type="button" className="secondary-button inline-submit" onClick={loadRequests}>重新整理</button>
        </div>
      </section>

      <section className="content-card section-panel">
        <AdminSectionHeader eyebrow="請貨單" title="門市請貨申請" description="建立本部出貨不會改變庫存；建立並確認出貨會立即扣除本部庫存。" />
        <DataTable
          columns={requestColumns}
          rows={requests}
          emptyText="目前沒有待處理請貨單。"
          cardTitle={(row) => row.requestNo}
          cardDescription={(row) => `${row.requestingStoreName} / ${row.itemSummary || ""}`}
          cardBadges={(row) => <StatusBadge tone={statusTone(row.status)}>{STATUS_LABELS[row.status] || row.status}</StatusBadge>}
        />
      </section>

      {selectedRequest ? (
        <section className="content-card section-panel">
          <AdminSectionHeader
            eyebrow="請貨明細"
            title={selectedRequest.requestNo}
            description={`${selectedRequest.requestingStoreName || ""} / ${formatDate(selectedRequest.submittedAt)}`}
            badges={<StatusBadge tone={statusTone(selectedRequest.status)}>{STATUS_LABELS[selectedRequest.status] || selectedRequest.status}</StatusBadge>}
          />
          {selectedRequest.note ? <div className="empty-state">{selectedRequest.note}</div> : null}
          <DataTable
            columns={itemColumns}
            rows={selectedRequest.items || []}
            emptyText="此請貨單沒有品項。"
            cardTitle={(row) => row.requestedSku}
            cardDescription={(row) => `${row.requestedProductName} / ${row.quantityRequested} 件 / ${money(row.unitCost)}`}
          />
        </section>
      ) : null}
    </div>
  );
}
