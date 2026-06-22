import { useEffect, useState } from "react";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import { apiRequest } from "../lib/api";

const STATUS_LABELS = {
  SHIPPED: "待入庫",
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
      setReceiveForm(Object.fromEntries((transfer.items || []).map((item) => [item.id, Number(item.quantityReceived || 0)])));
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
    for (const item of selectedTransfer.items || []) {
      const nextReceived = Number(receiveForm[item.id] || 0);
      const currentReceived = Number(item.quantityReceived || 0);
      const shipped = Number(item.quantityShipped || 0);
      if (nextReceived > shipped) {
        alert("入庫數量不可超過出貨數量");
        return;
      }
      if (nextReceived < currentReceived) {
        alert("入庫累計數量不可小於已入庫數量");
        return;
      }
    }
    const items = (selectedTransfer.items || [])
      .map((item) => ({ itemId: item.id, quantityReceived: Number(receiveForm[item.id] || 0) }));
    const hasIncrease = (selectedTransfer.items || []).some((item) => Number(receiveForm[item.id] || 0) > Number(item.quantityReceived || 0));
    if (!hasIncrease) {
      alert("請輸入新的累計入庫數量");
      return;
    }
    if (!confirm("確認入庫後，門市庫存將增加，請確認實收數量正確。")) return;

    try {
      const response = await apiRequest(`/store-transfers/${selectedTransfer.id}/receive`, {
        method: "POST",
        body: JSON.stringify({ items, note: note || null, discrepancyConfirmed }),
        processingMessage: "入庫確認中"
      });
      setSelectedTransfer(response.transfer);
      setReceiveForm(Object.fromEntries((response.transfer.items || []).map((item) => [item.id, Number(item.quantityReceived || 0)])));
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
    { key: "actions", label: "操作", render: (row) => <button type="button" className="primary-button" onClick={() => openTransfer(row)}>查看出貨內容</button> }
  ];

  return (
    <div>
      <PageHeader title="門市入庫確認" description="門市入庫確認用於確認實際收到的本部出貨商品。確認後門市庫存才會增加。" />
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
                const currentReceived = Number(item.quantityReceived || 0);
                const remaining = Math.max(Number(item.quantityShipped || 0) - currentReceived, 0);
                return (
                  <div className="field-item" key={item.id}>
                    <div className="field-label">{item.sku} / {item.productName}</div>
                    <div className="field-value">出貨數量 {item.quantityShipped} / 已入庫數量 {item.quantityReceived} / 尚待 {remaining}</div>
                    <div className="field-label">本次確認後累計入庫數量，不可超過出貨數量。</div>
                    <input type="number" min={currentReceived} max={item.quantityShipped} value={receiveForm[item.id] ?? currentReceived} onChange={(event) => updateReceiveQuantity(item.id, event.target.value)} />
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
