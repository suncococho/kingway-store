import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL, apiRequest } from "../lib/api";
import { getStoredToken } from "../lib/auth";

const money = (v) =>
  `NT$ ${Number(v || 0).toLocaleString("zh-TW", {
    maximumFractionDigits: 0,
  })}`;

function dateText(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function monthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function formatDate(value) {
  if (!value) return "-";
  return String(value).slice(0, 10);
}

function statusText(status) {
  const map = {
    COMPLETED: "已完成",
    PENDING: "待處理",
    PENDING_PAYMENT: "待付款",
    PENDING_CONFIRM: "待確認",
    REPAIRING: "維修中",
    CANCELED: "已取消",
    CANCELLED: "已取消",
  };
  return map[status] || status || "-";
}

function paymentText(status, method) {
  const map = {
    PAID: "已收款",
    DEPOSIT_ONLY: "訂金已收",
    PARTIAL: "訂金已收",
    UNPAID: "未收款",
    REFUNDED: "已退款",
  };
  return map[status] || method || "-";
}

function badgeTone(value) {
  const text = String(value || "").toUpperCase();
  if (["PAID", "COMPLETED"].includes(text)) return "success";
  if (["DEPOSIT_ONLY", "PARTIAL", "PENDING_CONFIRM", "PENDING_PAYMENT", "REPAIRING"].includes(text)) return "warning";
  if (["UNPAID", "CANCELED", "CANCELLED"].includes(text)) return "danger";
  return "neutral";
}

function dateBasisText(value) {
  return value === "orderCreated" ? "依訂單建立日" : "依付款完成日";
}

function Badge({ children, tone = "neutral" }) {
  return <span className={`sales-badge sales-badge-${tone}`}>{children}</span>;
}

function splitItems(summary) {
  if (!summary) return [];
  return String(summary)
    .split(" / ")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function SalesManagementPage() {
  const [startDate, setStartDate] = useState(monthStart());
  const [endDate, setEndDate] = useState(dateText(new Date()));
  const [dateBasis, setDateBasis] = useState("paymentCompleted");
  const [data, setData] = useState({
    summary: {
      orderCount: 0,
      totalQuantity: 0,
      totalOrderAmount: 0,
      paidOrderAmount: 0,
      actualReceivedAmount: 0,
      unpaidAmount: 0,
      depositOnlyAmount: 0,
      paidOrderCount: 0,
      unpaidOrderCount: 0,
      depositOnlyOrderCount: 0,
      totalOrderCount: 0,
      averageOrderAmount: 0,
    },
    orders: [],
    products: [],
  });
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const rangeLabel = useMemo(() => `${startDate} ～ ${endDate} / ${dateBasisText(dateBasis)}`, [startDate, endDate, dateBasis]);

  async function loadSales() {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({ startDate, endDate, dateBasis });
      const result = await apiRequest(`/sales/summary?${params.toString()}`);
      setData(result);
    } catch (err) {
      setError(err?.message || "銷售資料讀取失敗");
    } finally {
      setLoading(false);
    }
  }

  async function downloadSalesExport() {
    setDownloading(true);
    setError("");

    try {
      const token = getStoredToken();
      const response = await fetch(
        `${API_BASE_URL}/sales/export-sales?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&dateBasis=${encodeURIComponent(dateBasis)}`,
        {
          method: "GET",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        }
      );

      if (!response.ok) {
        const text = await response.text();
        const message = text || "匯出失敗";
        let parsed = message;
        try {
          parsed = JSON.parse(text).message || message;
        } catch (error) {
          // ignored
        }
        throw new Error(parsed);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get("Content-Disposition");
      const filenameMatch = contentDisposition?.match(/filename=\"?([^\";]+)\"?/);
      const filename = filenameMatch?.[1] || `KINGWAY_sales_${startDate}_${endDate}.xlsx`;

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err?.message || "匯出 Excel 失敗");
    } finally {
      setDownloading(false);
    }
  }

  useEffect(() => {
    loadSales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = data.summary || {};
  const orders = data.orders || [];
  const products = data.products || [];

  return (
    <div className="page sales-page">
      <style>{`
        .sales-page {
          display: flex;
          flex-direction: column;
          gap: 18px;
          color: #101828;
        }

        .sales-hero {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          padding: 22px 24px;
          border-radius: 22px;
          background: linear-gradient(135deg, #101828, #1d4f73);
          color: #fff;
          box-shadow: 0 16px 40px rgba(16, 24, 40, 0.18);
        }

        .sales-hero h1 {
          margin: 0;
          font-size: 30px;
          font-weight: 900;
          letter-spacing: 0.02em;
        }

        .sales-hero p {
          margin: 10px 0 0;
          color: rgba(255,255,255,0.78);
          line-height: 1.7;
          font-size: 15px;
        }

        .sales-range-pill {
          white-space: nowrap;
          padding: 9px 14px;
          border-radius: 999px;
          background: rgba(255,255,255,0.13);
          color: rgba(255,255,255,0.92);
          font-size: 13px;
          font-weight: 700;
        }

        .sales-panel {
          background: #fff;
          border: 1px solid #eaecf0;
          border-radius: 20px;
          box-shadow: 0 10px 26px rgba(16, 24, 40, 0.06);
        }

        .sales-filter {
          padding: 16px;
        }

        .sales-filter-row {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          align-items: end;
        }

        .sales-filter-row label {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 13px;
          color: #475467;
          font-weight: 700;
        }

        .sales-filter-row input,
        .sales-filter-row select {
          min-width: 180px;
          border: 1px solid #d0d5dd;
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 14px;
          background: #fff;
        }

        .sales-filter-row button {
          border: none;
          border-radius: 12px;
          padding: 11px 20px;
          background: #101828;
          color: white;
          font-weight: 800;
          cursor: pointer;
        }

        .sales-filter-row button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .sales-error {
          margin-top: 12px;
          color: #b42318;
          background: #fef3f2;
          border: 1px solid #fecdca;
          border-radius: 12px;
          padding: 10px 12px;
        }

        .sales-summary-grid {
          display: grid;
          grid-template-columns: repeat(6, minmax(140px, 1fr));
          gap: 14px;
        }

        .sales-summary-card {
          padding: 18px;
          border-radius: 20px;
          background: #fff;
          border: 1px solid #eaecf0;
          box-shadow: 0 10px 26px rgba(16, 24, 40, 0.06);
        }

        .sales-summary-label {
          color: #667085;
          font-size: 13px;
          margin-bottom: 9px;
          font-weight: 700;
        }

        .sales-summary-value {
          font-size: 28px;
          font-weight: 900;
          color: #101828;
          white-space: nowrap;
        }

        .sales-discount-text {
          color: #b42318;
        }

        .sales-section {
          padding: 18px;
        }

        .sales-section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-bottom: 14px;
        }

        .sales-section-header h2 {
          margin: 0;
          font-size: 22px;
          font-weight: 900;
        }

        .sales-muted {
          color: #667085;
          font-size: 13px;
        }

        .sales-order-list {
          display: grid;
          gap: 12px;
        }

        .sales-order-card {
          border: 1px solid #eaecf0;
          border-radius: 18px;
          padding: 16px;
          background: #fcfcfd;
        }

        .sales-order-top {
          display: grid;
          grid-template-columns: minmax(150px, 1.1fr) minmax(150px, 1fr) minmax(120px, 0.7fr) minmax(130px, 0.7fr);
          gap: 14px;
          align-items: start;
          margin-bottom: 12px;
        }

        .sales-order-label {
          font-size: 12px;
          color: #667085;
          margin-bottom: 4px;
          font-weight: 700;
        }

        .sales-order-main {
          font-size: 15px;
          font-weight: 900;
          color: #101828;
          line-height: 1.45;
          word-break: break-word;
        }

        .sales-order-sub {
          color: #667085;
          font-size: 13px;
          margin-top: 2px;
        }

        .sales-order-amount {
          font-size: 18px;
          font-weight: 900;
          color: #101828;
          white-space: nowrap;
        }

        .sales-price-stack {
          display: grid;
          gap: 4px;
          margin-top: 4px;
          font-size: 12px;
          min-width: 128px;
        }

        .sales-price-stack div {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          color: #667085;
        }

        .sales-price-stack strong {
          color: #101828;
          font-size: 13px;
          white-space: nowrap;
        }

        .sales-discount-row strong {
          color: #b42318;
        }

        .sales-final-row {
          padding-top: 5px;
          border-top: 1px dashed #d0d5dd;
        }

        .sales-final-row span,
        .sales-final-row strong {
          color: #101828;
          font-weight: 900;
        }

        .sales-order-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 6px;
        }

        .sales-items {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px dashed #d0d5dd;
        }

        .sales-item-chip {
          display: inline-flex;
          max-width: 100%;
          padding: 6px 9px;
          border-radius: 999px;
          background: #eef4ff;
          color: #344054;
          font-size: 12px;
          line-height: 1.4;
          word-break: break-word;
        }

        .sales-badge {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 5px 10px;
          font-size: 12px;
          font-weight: 800;
          white-space: nowrap;
        }

        .sales-badge-success {
          color: #027a48;
          background: #ecfdf3;
        }

        .sales-badge-warning {
          color: #b54708;
          background: #fffaeb;
        }

        .sales-badge-danger {
          color: #b42318;
          background: #fef3f2;
        }

        .sales-badge-neutral {
          color: #344054;
          background: #f2f4f7;
        }

        .sales-rank-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 10px;
        }

        .sales-product-card {
          display: grid;
          grid-template-columns: 42px 1fr auto;
          gap: 10px;
          align-items: center;
          padding: 12px;
          border-radius: 16px;
          border: 1px solid #eaecf0;
          background: #fcfcfd;
        }

        .sales-rank {
          width: 34px;
          height: 34px;
          border-radius: 12px;
          background: #101828;
          color: white;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          font-size: 13px;
        }

        .sales-product-name {
          font-weight: 900;
          color: #101828;
          line-height: 1.35;
        }

        .sales-product-sub {
          color: #667085;
          font-size: 12px;
          margin-top: 2px;
        }

        .sales-product-amount {
          text-align: right;
          font-weight: 900;
          color: #101828;
          white-space: nowrap;
        }

        .sales-product-qty {
          color: #667085;
          font-size: 12px;
          margin-top: 2px;
        }

        .sales-empty {
          text-align: center;
          padding: 28px;
          color: #667085;
          border: 1px dashed #d0d5dd;
          border-radius: 16px;
          background: #fcfcfd;
        }

        @media (max-width: 1000px) {
          .sales-summary-grid {
            grid-template-columns: repeat(2, minmax(140px, 1fr));
          }

          .sales-order-top {
            grid-template-columns: 1fr 1fr;
          }
        }

        @media (max-width: 640px) {
          .sales-hero {
            flex-direction: column;
            padding: 18px;
          }

          .sales-summary-grid {
            grid-template-columns: 1fr;
          }

          .sales-order-top {
            grid-template-columns: 1fr;
          }

          .sales-filter-row input,
          .sales-filter-row select,
          .sales-filter-row button {
            width: 100%;
          }

          .sales-product-card {
            grid-template-columns: 36px 1fr;
          }

          .sales-product-amount {
            grid-column: 2;
            text-align: left;
          }
        }
      `}</style>

      <section className="sales-hero">
        <div>
          <h1>銷售管理</h1>
          <p>銷售管理預設以實際付款完成日計算，避免未收款訂單被列入實收營收。</p>
        </div>
        <div className="sales-range-pill">{rangeLabel}</div>
      </section>

      <section className="sales-panel sales-filter">
        <div className="sales-filter-row">
          <label>
            <span>開始日期</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>

          <label>
            <span>結束日期</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>

          <label>
            <span>統計基準</span>
            <select value={dateBasis} onChange={(event) => setDateBasis(event.target.value)}>
              <option value="paymentCompleted">依付款完成日</option>
              <option value="orderCreated">依訂單建立日</option>
            </select>
          </label>

          <button type="button" onClick={loadSales} disabled={loading}>
            {loading ? "查詢中..." : "查詢"}
          </button>
          <button type="button" onClick={downloadSalesExport} disabled={loading || downloading}>
            {downloading ? "匯出中..." : "匯出Excel"}
          </button>
        </div>

        {error ? <div className="sales-error">{error}</div> : null}
      </section>

      <section className="sales-summary-grid">
        <div className="sales-summary-card">
          <div className="sales-summary-label">實際已收款</div>
          <div className="sales-summary-value">{money(summary.actualReceivedAmount)}</div>
          <div className="sales-muted">已收款訂單 {Number(summary.paidOrderCount || 0).toLocaleString()} 筆</div>
        </div>

        <div className="sales-summary-card">
          <div className="sales-summary-label">未收款</div>
          <div className="sales-summary-value sales-discount-text">{money(summary.unpaidAmount)}</div>
          <div className="sales-muted">未結清訂單 {Number(summary.unpaidOrderCount || 0).toLocaleString()} 筆</div>
        </div>

        <div className="sales-summary-card">
          <div className="sales-summary-label">訂金已收</div>
          <div className="sales-summary-value">{money(summary.depositOnlyAmount)}</div>
          <div className="sales-muted">訂金/部分付款 {Number(summary.depositOnlyOrderCount || 0).toLocaleString()} 筆</div>
        </div>

        <div className="sales-summary-card">
          <div className="sales-summary-label">全部訂單金額</div>
          <div className="sales-summary-value">{money(summary.totalOrderAmount)}</div>
          <div className="sales-muted">全部訂單 {Number(summary.totalOrderCount || summary.orderCount || 0).toLocaleString()} 筆</div>
        </div>
      </section>

      <section className="sales-panel sales-section">
        <div className="sales-section-header">
          <h2>訂單銷售明細</h2>
          <span className="sales-muted">共 {orders.length} 筆</span>
        </div>

        <div className="sales-order-list">
          {orders.map((order) => {
            const itemList = splitItems(order.itemSummary);
            const receivableAmount = Number(order.totalAmount || 0);
            const couponDiscountAmount = Number(order.couponDiscountAmount || 0);
            const otherDiscountAmount = Number(order.otherDiscountAmount || 0);
            const discountAmount = Number(order.discountAmount || (couponDiscountAmount + otherDiscountAmount));
            const originalAmount = Number(order.originalAmount || (receivableAmount + discountAmount));
            const depositAmount = Number(order.depositAmount || 0);
            const actualReceivedAmount = Number(order.actualReceivedAmount || 0);
            const unpaidBalance = Number(order.unpaidAmount ?? order.unpaidBalance ?? Math.max(receivableAmount - actualReceivedAmount, 0));
            return (
              <article className="sales-order-card" key={order.orderId}>
                <div className="sales-order-top">
                  <div>
                    <div className="sales-order-label">訂單</div>
                    <div className="sales-order-main">{order.orderNo || order.orderId}</div>
                    <div className="sales-order-sub">{formatDate(order.createdAt)}</div>
                  </div>

                  <div>
                    <div className="sales-order-label">客戶</div>
                    <div className="sales-order-main">{order.customerName || "-"}</div>
                    <div className="sales-order-sub">{order.customerPhone || ""}</div>
                  </div>

                  <div>
                    <div className="sales-order-label">數量 / 金額</div>
                    <div className="sales-order-main">{Number(order.totalQuantity || 0).toLocaleString()} 件</div>
                    <div className="sales-price-stack">
                      <div><span>商品總額</span><strong>{money(originalAmount)}</strong></div>
                      <div className="sales-discount-row"><span>會員服務</span><strong>- {money(couponDiscountAmount)}</strong></div>
                      <div className="sales-discount-row"><span>其他折扣</span><strong>- {money(otherDiscountAmount)}</strong></div>
                      <div className="sales-final-row"><span>全部訂單金額</span><strong>{money(receivableAmount)}</strong></div>
                      <div><span>實際已收款</span><strong>{money(actualReceivedAmount)}</strong></div>
                      <div><span>訂金已收</span><strong>{money(order.depositOnlyAmount || depositAmount)}</strong></div>
                      <div><span>未收款</span><strong>{money(unpaidBalance)}</strong></div>
                    </div>
                  </div>

                  <div>
                    <div className="sales-order-label">付款 / 狀態</div>
                    <div className="sales-order-meta">
                      <Badge tone={badgeTone(order.paymentStatusCode || order.finalPaymentStatus)}>
                        {order.paymentStatusLabel || paymentText(order.paymentStatusCode || order.finalPaymentStatus, order.paymentMethod)}
                      </Badge>
                      <Badge tone={badgeTone(order.status)}>
                        {statusText(order.status)}
                      </Badge>
                      {order.finalPaymentCompletedAt || order.paymentBasisAt ? (
                        <span className="sales-order-sub">
                          付款日：{formatDate(order.finalPaymentCompletedAt || order.paymentBasisAt)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="sales-items">
                  {itemList.length > 0 ? (
                    itemList.map((item, index) => (
                      <span className="sales-item-chip" key={`${order.orderId}-${index}`}>
                        {item}
                      </span>
                    ))
                  ) : (
                    <span className="sales-muted">無商品明細</span>
                  )}
                </div>
              </article>
            );
          })}

          {!loading && orders.length === 0 ? (
            <div className="sales-empty">此期間沒有訂單資料</div>
          ) : null}
        </div>
      </section>

      <section className="sales-panel sales-section">
        <div className="sales-section-header">
          <h2>商品銷售排行</h2>
          <span className="sales-muted">依銷售金額排序</span>
        </div>

        <div className="sales-rank-grid">
          {products.map((product, index) => (
            <article className="sales-product-card" key={`${product.productId}-${product.sku}-${index}`}>
              <span className="sales-rank">{index + 1}</span>

              <div>
                <div className="sales-product-name">{product.productName}</div>
                <div className="sales-product-sub">SKU：{product.sku || "-"} / 數量：{Number(product.quantity || 0).toLocaleString()}</div>
              </div>

              <div className="sales-product-amount">
                {money(product.totalSales)}
                <div className="sales-product-qty">{Number(product.quantity || 0).toLocaleString()} 件</div>
              </div>
            </article>
          ))}

          {!loading && products.length === 0 ? (
            <div className="sales-empty">此期間沒有商品銷售資料</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
