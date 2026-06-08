import { useMemo, useState } from "react";
import ActionModal from "../components/ActionModal";
import DataTable from "../components/DataTable";
import DetailModal from "../components/DetailModal";
import FilterBar from "../components/FilterBar";
import PageHeader from "../components/PageHeader";
import ProcessingOverlay from "../components/ProcessingOverlay";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import { useFetchList } from "../hooks/useFetchList";
import { useProcessingGuard } from "../hooks/useProcessingGuard";
import { apiRequest } from "../lib/api";
import { formatTaipeiDateTime } from "../lib/display";

function getStatusLabel(row) {
  if (row.handoverConfirmedAt) {
    return "已確認交車";
  }
  if (row.status === "COMPLETED") {
    return "已提交";
  }
  return "待填寫";
}

function getStatusTone(row) {
  if (row.handoverConfirmedAt) {
    return "success";
  }
  if (row.status === "COMPLETED") {
    return "info";
  }
  return "warning";
}

function PurchaseConfirmationsPage() {
  const confirmations = useFetchList("/purchase-confirmations");
  const [customerId, setCustomerId] = useState("");
  const [tab, setTab] = useState("ALL");
  const [keyword, setKeyword] = useState("");
  const [signedFilter, setSignedFilter] = useState("ALL");
  const [detail, setDetail] = useState(null);
  const [systemInfoOpen, setSystemInfoOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const { isProcessing, pendingAction, runWithProcessing } = useProcessingGuard();

  const sectionItems = [
    { key: "ALL", label: "全部" },
    { key: "PENDING", label: "待填寫" },
    { key: "SUBMITTED", label: "已提交" },
    { key: "HANDOVER", label: "已確認交車" },
    { key: "PDF", label: "PDF 可下載" }
  ];

  const rows = useMemo(
    () =>
      confirmations.items.map((item) => ({
        ...item,
        signed: Boolean(item.signatureData || item.submittedAt),
        signedLabel: item.signatureData || item.submittedAt ? "已簽名" : "未簽名",
        statusLabel: getStatusLabel(item),
        statusTone: getStatusTone(item),
        pdfLabel: item.pdfUrl ? "可下載" : "未產生",
        pdfTone: item.pdfUrl ? "success" : "neutral"
      })),
    [confirmations.items]
  );

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const text = keyword.trim().toLowerCase();
        if (text && !`${row.customerName} ${row.customerPhone || ""} ${row.orderNo || ""}`.toLowerCase().includes(text)) {
          return false;
        }
        if (signedFilter !== "ALL" && (signedFilter === "SIGNED" ? !row.signed : row.signed)) {
          return false;
        }
        if (tab === "PENDING" && row.status !== "PENDING") {
          return false;
        }
        if (tab === "SUBMITTED" && row.status !== "COMPLETED") {
          return false;
        }
        if (tab === "HANDOVER" && !row.handoverConfirmedAt) {
          return false;
        }
        if (tab === "PDF" && !row.pdfUrl) {
          return false;
        }
        return true;
      }),
    [keyword, rows, signedFilter, tab]
  );

  async function generateLink(event) {
    event.preventDefault();

    await runWithProcessing(async () => {
      const data = await apiRequest("/purchase-confirmations/generate-link", {
        method: "POST",
        body: JSON.stringify({
          customerId: Number(customerId)
        })
      });
      setCustomerId("");
      confirmations.refetch();
      alert(`已產生連結：\n${data.link}`);
    }, { id: "purchase-confirmation-generate", label: "確認連結產生中..." }).catch((error) => {
      alert(error.message);
    });
  }

  async function resendLink(row) {
    await runWithProcessing(async () => {
      const data = await apiRequest(`/orders/${row.orderId}/purchase-confirmation`, {
        method: "POST",
        body: JSON.stringify({})
      });
      confirmations.refetch();
      alert(`購買確認書連結已送出：\n${data.link}`);
    }, { id: `purchase-confirmation-resend-${row.orderId}`, label: "確認書發送中..." }).catch((error) => {
      alert(error.message);
    });
  }

  function requestResendLink(row) {
    setConfirmModal({
      title: "發送確認書",
      message: "確認要重新發送購買確認書連結嗎？",
      confirmText: "發送確認書",
      action: () => resendLink(row)
    });
  }

  function openDetail(row) {
    setDetail(row);
    setSystemInfoOpen(false);
  }

  const columns = [
    { key: "customerName", label: "客戶" },
    { key: "orderNo", label: "訂單編號" },
    {
      key: "statusLabel",
      label: "狀態",
      render: (row) => <StatusBadge tone={row.statusTone}>{row.statusLabel}</StatusBadge>
    },
    {
      key: "signedLabel",
      label: "是否已簽名",
      render: (row) => <StatusBadge tone={row.signed ? "success" : "warning"}>{row.signedLabel}</StatusBadge>
    },
    {
      key: "pdfUrl",
      label: "PDF",
      render: (row) =>
        row.pdfUrl ? (
          <a href={row.pdfUrl} target="_blank" rel="noreferrer">
            開啟 PDF
          </a>
        ) : (
          "未產生"
        ),
      mobileHidden: true
    },
    {
      key: "actions",
      label: "操作",
        render: (row) => (
          <div className="action-row compact-actions">
            {row.orderId ? (
              <button type="button" className="secondary-button" onClick={() => requestResendLink(row)} disabled={isProcessing}>
                {pendingAction?.id === `purchase-confirmation-resend-${row.orderId}` ? "處理中..." : "發送確認書"}
              </button>
            ) : null}
            {row.pdfUrl ? (
              <a className="secondary-button" href={row.pdfUrl} target="_blank" rel="noreferrer">
                下載 PDF
            </a>
          ) : null}
          <button type="button" className="secondary-button" onClick={() => openDetail(row)}>
            詳情
          </button>
        </div>
      ),
      mobileHidden: true
    }
  ];

  return (
    <div>
      <PageHeader title="購買確認書管理" description="產生確認連結、檢視提交狀態、PDF 與交車確認，保留單一 canonical 頁面。" />
      {confirmations.error ? <div className="empty-state">{confirmations.error}</div> : null}
      <SectionTabs items={sectionItems} value={tab} onChange={setTab} label="購買確認書子功能" />
      <section className="content-card form-card">
        <div className="section-header">
          <div>
            <h2>產生確認連結</h2>
            <p className="muted-text">維持既有流程，只把入口整理成獨立區塊。</p>
          </div>
        </div>
        <form className="grid-form compact-grid" onSubmit={generateLink}>
          <label className="form-field">
            <span>客戶 ID</span>
            <input value={customerId} onChange={(event) => setCustomerId(event.target.value)} required />
          </label>
          <button type="submit" className="primary-button inline-submit" disabled={isProcessing}>
            {pendingAction?.id === "purchase-confirmation-generate" ? "處理中..." : "產生連結"}
          </button>
        </form>
      </section>
      <section className="content-card section-panel">
        <div className="section-header">
          <div>
            <h2>{sectionItems.find((item) => item.key === tab)?.label || "全部"}</h2>
            <p className="muted-text">主列表聚焦提交狀態、簽名與 PDF，細節在詳情視窗查看。</p>
          </div>
          <StatusBadge tone="info">顯示 {filteredRows.length} 筆</StatusBadge>
        </div>
        <FilterBar>
          <label className="form-field">
            <span>關鍵字搜尋</span>
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="客戶 / 訂單編號 / 電話" />
          </label>
          <label className="form-field">
            <span>是否已簽名</span>
            <select value={signedFilter} onChange={(event) => setSignedFilter(event.target.value)}>
              <option value="ALL">全部</option>
              <option value="SIGNED">已簽名</option>
              <option value="UNSIGNED">未簽名</option>
            </select>
          </label>
        </FilterBar>
        <DataTable
          columns={columns}
          rows={filteredRows}
          emptyText="目前沒有購買確認書資料。"
          cardTitle={(row) => row.orderNo}
          cardDescription={(row) => `${row.customerName} / ${row.customerPhone || "-"}`}
          cardBadges={(row) => (
            <>
              <StatusBadge tone={row.statusTone}>{row.statusLabel}</StatusBadge>
              <StatusBadge tone={row.signed ? "success" : "warning"}>{row.signedLabel}</StatusBadge>
              <StatusBadge tone={row.pdfTone}>{row.pdfLabel}</StatusBadge>
            </>
          )}
          cardFooter={(row) => (
            <div className="field-grid">
              <div className="field-item">
                <div className="field-label">送出時間</div>
                <div className="field-value">{formatTaipeiDateTime(row.submittedAt)}</div>
              </div>
              <div className="field-item">
                <div className="field-label">交車確認</div>
                <div className="field-value">{row.handoverConfirmedAt ? "已確認交車" : "未確認"}</div>
              </div>
              <div className="field-item">
                <div className="field-label">操作</div>
                <div className="field-value">
                  <button type="button" className="secondary-button" onClick={() => openDetail(row)}>
                    詳情
                  </button>
                  {row.orderId ? (
                    <button type="button" className="secondary-button" onClick={() => requestResendLink(row)} disabled={isProcessing}>
                      {pendingAction?.id === `purchase-confirmation-resend-${row.orderId}` ? "處理中..." : "發送確認書"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        />
      </section>
      <DetailModal
        open={Boolean(detail)}
        title={detail ? `購買確認書 ${detail.orderNo}` : "購買確認書詳情"}
        subtitle={detail ? `${detail.customerName} / ${detail.statusLabel}` : ""}
        onClose={() => setDetail(null)}
      >
        {detail ? (
          <div className="admin-detail-layout">
            <div className="admin-split-grid">
              <section className="stack-card">
                <div className="section-title">基本資料</div>
                <div className="field-grid">
                  <div className="field-item"><div className="field-label">客戶</div><div className="field-value">{detail.customerName}</div></div>
                  <div className="field-item"><div className="field-label">電話</div><div className="field-value">{detail.customerPhone || "-"}</div></div>
                  <div className="field-item"><div className="field-label">訂單編號</div><div className="field-value">{detail.orderNo}</div></div>
                  <div className="field-item"><div className="field-label">狀態</div><div className="field-value">{detail.statusLabel}</div></div>
                </div>
              </section>
              <section className="stack-card">
                <div className="section-title">簽名與 PDF</div>
                <div className="field-grid">
                  <div className="field-item"><div className="field-label">是否已簽名</div><div className="field-value">{detail.signed ? "已簽名" : "未簽名"}</div></div>
                  <div className="field-item"><div className="field-label">已提交時間</div><div className="field-value">{formatTaipeiDateTime(detail.submittedAt)}</div></div>
                  <div className="field-item"><div className="field-label">交車確認</div><div className="field-value">{detail.handoverConfirmedAt ? "已確認交車" : "未確認"}</div></div>
                  <div className="field-item"><div className="field-label">PDF</div><div className="field-value">{detail.pdfUrl ? <a href={detail.pdfUrl} target="_blank" rel="noreferrer">開啟 PDF</a> : "未產生"}</div></div>
                </div>
              </section>
            </div>

            <div className="action-row">
              {detail.orderId ? (
                <button type="button" className="secondary-button" onClick={() => requestResendLink(detail)} disabled={isProcessing}>
                  {pendingAction?.id === `purchase-confirmation-resend-${detail.orderId}` ? "處理中..." : "發送確認書"}
                </button>
              ) : null}
              {detail.pdfUrl ? (
                <a className="secondary-button" href={detail.pdfUrl} target="_blank" rel="noreferrer">
                  下載 PDF
                </a>
              ) : null}
              <button type="button" className="secondary-button" onClick={() => setSystemInfoOpen((current) => !current)}>
                系統資訊
              </button>
              <button type="button" className="secondary-button" onClick={() => setDetail(null)}>
                關閉
              </button>
            </div>
            {systemInfoOpen ? (
              <section className="stack-card">
                <div className="section-title">系統資訊</div>
                <div className="field-grid">
                  <div className="field-item"><div className="field-label">簽名檔</div><div className="field-value">{detail.signatureData ? "已保存" : "未保存"}</div></div>
                  <div className="field-item"><div className="field-label">條款確認</div><div className="field-value">{detail.termsAccepted ? "已確認" : "未確認"}</div></div>
                  <div className="field-item"><div className="field-label">最終確認</div><div className="field-value">{detail.finalConfirmationAccepted ? "已確認" : "未確認"}</div></div>
                </div>
                {detail.htmlSnapshot ? (
                  <pre className="system-pre">{detail.htmlSnapshot}</pre>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : null}
      </DetailModal>
      <ActionModal
        open={Boolean(confirmModal)}
        title={confirmModal?.title}
        message={confirmModal?.message}
        confirmText={confirmModal?.confirmText || "確認"}
        cancelText="取消"
        onCancel={() => setConfirmModal(null)}
        onConfirm={() => {
          if (isProcessing) {
            return;
          }
          const action = confirmModal?.action;
          setConfirmModal(null);
          action?.();
        }}
      />
      <ProcessingOverlay active={isProcessing} message={pendingAction?.label || "處理中，請稍候..."} />
    </div>
  );
}

export default PurchaseConfirmationsPage;
