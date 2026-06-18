import { useEffect, useState } from "react";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import { apiRequest } from "../lib/api";

const STATUS_LABELS = {
  SHIPPED: "已出貨",
  PARTIALLY_RECEIVED: "部分入庫",
  RECEIVED: "已入庫",
  DISCREPANCY: "差異"
};

function getStatusTone(status) {
  if (status === "RECEIVED") return "success";
  if (status === "DISCREPANCY") return "danger";
  return "warning";
}

function InboundTransfersPage() {
  const [transfers, setTransfers] = useState([]);
  const [selectedTransfer, setSelectedTransfer] = useState(null);
  const [receiveForm, setReceiveForm] = useState({});
  const [note, setNote] = useState("");
  const [discrepancyConfirmed, setDiscrepancyConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadInbound();
  }, []);

  async function loadInbound() {
    setLoading(true);
    setError("");
    try {
      const response = await apiRequest("/store-transfers/inbound");
      setTransfers(Array.isArray(response.transfers) ? response.transfers : []);
    } catch (requestError) {
      setError(requestError.message || "入庫資料讀取失敗");
    } finally {
      setLoading(false);
    }
  }

  async function openTransfer(row) {
    try {
      const response = await apiRequest(`/store-transfers/company/${row.companyId}/${row.id}`);
      const transfer = response.transfer;
      setSelectedTransfer(transfer);
      setReceiveForm(Object.fromEntries((transfer.items || []).map((item) => [item.id, 0])));
      setNote("");
      setDiscrepancyConfirmed(false);
    } catch (requestError) {
      alert(requestError.message || "出貨單讀取失敗");
    }
  }

  function updateReceiveQuantity(itemId, value) {
    setReceiveForm((current) => ({
      ...current,
      [itemId]: Number(value)
    }));
  }

  async function confirmReceive(event) {
    event.preventDefault();
    if (!selectedTransfer) return;
    const items = (selectedTransfer.items || [])
      .map((item) => ({ itemId: item.id, receiveQuantity: Number(receiveForm[item.id] || 0) }))
      .filter((item) => item.receiveQuantity > 0);
    if (!items.length) {
      alert("請輸入本次入庫數量");
      return;
    }

    try {
      const response = await apiRequest(`/store-transfers/${selectedTransfer.id}/receive`, {
        method: "POST",
        body: JSON.stringify({ items, note: note || null, discrepancyConfirmed }),
        processingMessage: "入庫確認中"
      });
      setSelectedTransfer(response.transfer);
      setReceiveForm(Object.fromEntries((response.transfer.items || []).map((item) => [item.id, 0])));
      await loadInbound();
    } catch (requestError) {
      alert(requestError.message || "入庫確認失敗");
    }
  }

  const columns = [
    { key: "transferNo", label: "出貨單號" },
    { key: "status", label: "狀態", render: (row) => <StatusBadge tone={getStatusTone(row.status)}>{STATUS_LABELS[row.status] || row.status}</StatusBadge> },
    { key: "fromStoreName", label: "出貨門市" },
    { key: "itemSummary", label: "商品" },
    { key: "actions", label: "操作", render: (row) => <button type="button" className="primary-button" onClick={() => openTransfer(row)}>入庫確認</button> }
  ];

  return (
    <div>
      <PageHeader title="門市入庫確認" description="確認總部出貨到本門市的實收數量。" />
      {error ? <div className="empty-state">{error}</div> : null}
      <section className="content-card section-panel">
        <AdminSectionHeader eyebrow="待入庫" title="入庫單列表" description={loading ? "讀取中..." : "只顯示已出貨且尚未完全入庫的資料。"} />
        <DataTable columns={columns} rows={transfers} emptyText="目前沒有待入庫資料。" cardTitle={(row) => row.transferNo} cardDescription={(row) => `${row.fromStoreName} / ${row.itemSummary || ""}`} cardBadges={(row) => <StatusBadge tone={getStatusTone(row.status)}>{STATUS_LABELS[row.status] || row.status}</StatusBadge>} />
      </section>

      {selectedTransfer ? (
        <section className="content-card section-panel">
          <AdminSectionHeader eyebrow="確認入庫" title={selectedTransfer.transferNo} description={`${selectedTransfer.fromStoreName} -> ${selectedTransfer.toStoreName}`} badges={<StatusBadge tone={getStatusTone(selectedTransfer.status)}>{STATUS_LABELS[selectedTransfer.status] || selectedTransfer.status}</StatusBadge>} />
          <form onSubmit={confirmReceive}>
            <div className="stack-list">
              {(selectedTransfer.items || []).map((item) => {
                const remaining = Math.max(Number(item.quantityShipped || 0) - Number(item.quantityReceived || 0), 0);
                return (
                  <div className="field-item" key={item.id}>
                    <div className="field-label">{item.sku} / {item.productName}</div>
                    <div className="field-value">出貨 {item.quantityShipped} / 已入庫 {item.quantityReceived} / 尚待 {remaining}</div>
                    <input type="number" min="0" max={remaining} value={receiveForm[item.id] || 0} onChange={(event) => updateReceiveQuantity(item.id, event.target.value)} />
                  </div>
                );
              })}
            </div>
            <div className="grid-form compact-grid">
              <label className="form-field form-field-wide"><span>差異備註</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label>
              <label className="checkbox-field form-field-wide"><input type="checkbox" checked={discrepancyConfirmed} onChange={(event) => setDiscrepancyConfirmed(event.target.checked)} /> 確認差異，不再等待剩餘數量</label>
            </div>
            <div className="action-row"><button type="submit" className="primary-button">確認入庫</button></div>
          </form>
        </section>
      ) : null}
    </div>
  );
}

export default InboundTransfersPage;
