import { useEffect, useState } from "react";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import PageHelpButton from "../components/PageHelpButton";
import StatusBadge from "../components/StatusBadge";
import { apiRequest } from "../lib/api";
import { PAGE_HELP } from "../lib/pageHelpContent";

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

function toSafeQuantity(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getInboundQuantities(item) {
  const shipped = toSafeQuantity(item.quantityShipped);
  const received = toSafeQuantity(item.quantityReceived);
  const remaining = Math.max(shipped - received, 0);
  return {
    shipped,
    received,
    remaining,
    fullyReceived: remaining <= 0
  };
}

function isTransferFullyReceived(transfer) {
  const items = Array.isArray(transfer?.items) ? transfer.items : [];
  return items.length > 0 && items.every((item) => getInboundQuantities(item).fullyReceived);
}

function hasReceivableIncrease(transfer, receiveForm) {
  const items = Array.isArray(transfer?.items) ? transfer.items : [];
  return items.some((item) => {
    const { shipped, received, remaining } = getInboundQuantities(item);
    const nextReceived = toSafeQuantity(receiveForm[item.id] ?? received);
    return remaining > 0 && nextReceived > received && nextReceived <= shipped;
  });
}

function getInboundErrorMessage(error) {
  if (error?.data?.code === "INBOUND_ALREADY_FULLY_RECEIVED") {
    return "此商品已全數入庫，無需再次確認。";
  }
  if (error?.data?.code === "INBOUND_CUMULATIVE_NOT_INCREASED") {
    return "新的累計入庫數量必須大於目前已入庫數量。";
  }
  if (error?.data?.code === "INBOUND_CUMULATIVE_EXCEEDS_SHIPPED") {
    return "累計入庫數量不可超過出貨數量。";
  }
  if (error?.data?.code === "INBOUND_CUMULATIVE_BELOW_RECEIVED") {
    return "新的累計入庫數量不可小於目前已入庫數量。";
  }
  return error?.message || "入庫確認失敗";
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
    if (isTransferFullyReceived(selectedTransfer)) {
      alert("此出貨單已全數入庫，無需再次確認。");
      return;
    }

    let hasIncrease = false;
    for (const item of selectedTransfer.items || []) {
      const nextReceived = toSafeQuantity(receiveForm[item.id] ?? item.quantityReceived);
      const { shipped, received, remaining } = getInboundQuantities(item);
      if (nextReceived > shipped) {
        alert("累計入庫數量不可超過出貨數量。");
        return;
      }
      if (nextReceived < received) {
        alert("新的累計入庫數量不可小於目前已入庫數量。");
        return;
      }
      if (remaining > 0 && nextReceived > received) {
        hasIncrease = true;
      }
    }

    if (!hasIncrease && !discrepancyConfirmed) {
      alert("新的累計入庫數量必須大於目前已入庫數量。");
      return;
    }
    const items = (selectedTransfer.items || [])
      .map((item) => ({ itemId: item.id, quantityReceived: toSafeQuantity(receiveForm[item.id] ?? item.quantityReceived) }));
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
      alert(getInboundErrorMessage(requestError));
    }
  }

  const selectedTransferFullyReceived = isTransferFullyReceived(selectedTransfer);
  const canConfirmReceive = hasReceivableIncrease(selectedTransfer, receiveForm) || (!selectedTransferFullyReceived && discrepancyConfirmed);

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
      <PageHelpButton help={PAGE_HELP.inboundTransfers} />
      {error ? <div className="empty-state">{error}</div> : null}
      <section className="content-card section-panel">
        <AdminSectionHeader eyebrow="待入庫" title="入庫單列表" description={loading ? "讀取中..." : "只顯示已出貨且尚未完全入庫的資料。"} />
        <DataTable columns={columns} rows={transfers} emptyText="目前沒有待入庫資料。" cardTitle={(row) => row.transferNo} cardDescription={(row) => `${row.fromStoreName} / ${row.itemSummary || ""}`} cardBadges={(row) => <StatusBadge tone={getStatusTone(row.status)}>{STATUS_LABELS[row.status] || row.status}</StatusBadge>} />
      </section>

      {selectedTransfer ? (
        <section className="content-card section-panel">
          <AdminSectionHeader
            eyebrow="確認入庫"
            title={selectedTransfer.transferNo}
            description={`${selectedTransfer.fromStoreName} -> ${selectedTransfer.toStoreName}`}
            badges={(
              <>
                <StatusBadge tone={getStatusTone(selectedTransfer.status)}>{STATUS_LABELS[selectedTransfer.status] || selectedTransfer.status}</StatusBadge>
                {selectedTransferFullyReceived ? <StatusBadge tone="success">已完成入庫</StatusBadge> : null}
              </>
            )}
          />
          {selectedTransferFullyReceived ? <div className="empty-state">此出貨單已全數入庫。</div> : null}
          <form onSubmit={confirmReceive}>
            <div className="stack-list">
              {(selectedTransfer.items || []).map((item) => {
                const { shipped, received, remaining, fullyReceived } = getInboundQuantities(item);
                return (
                  <div className="field-item" key={item.id}>
                    <div className="field-label">
                      {item.sku} / {item.productName}
                      {fullyReceived ? <StatusBadge tone="success">已全數入庫</StatusBadge> : null}
                    </div>
                    <div className="field-value">出貨數量 {shipped} / 已入庫數量 {received} / 尚待 {remaining}</div>
                    <div className="field-label">{fullyReceived ? "此商品已全數入庫，無需再次確認。" : "本次確認後累計入庫數量，不可超過出貨數量。"}</div>
                    <input
                      type="number"
                      min={received}
                      max={shipped}
                      value={receiveForm[item.id] ?? received}
                      disabled={fullyReceived}
                      onChange={(event) => updateReceiveQuantity(item.id, event.target.value)}
                    />
                  </div>
                );
              })}
            </div>
            <div className="grid-form compact-grid">
              <label className="form-field form-field-wide"><span>差異備註</span><input value={note} disabled={selectedTransferFullyReceived} onChange={(event) => setNote(event.target.value)} /></label>
              <label className="checkbox-field form-field-wide"><input type="checkbox" checked={discrepancyConfirmed} disabled={selectedTransferFullyReceived} onChange={(event) => setDiscrepancyConfirmed(event.target.checked)} /> 確認差異，不再等待剩餘數量</label>
            </div>
            <div className="action-row">
              <button type="submit" className="primary-button" disabled={selectedTransferFullyReceived || !canConfirmReceive}>{selectedTransferFullyReceived ? "已完成入庫" : "確認入庫"}</button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}

export default InboundTransfersPage;
