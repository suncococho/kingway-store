import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { formatTaipeiDateTime } from "../lib/display";

function formatCurrency(value) {
  return `NT$${Number(value || 0).toLocaleString()}`;
}

function parseQuoteItemsJson(value) {
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.items)) return parsed.items;
  } catch {
    return [];
  }
  return [];
}

function normalizeQuoteItem(item = {}, index) {
  const quantity = Number(item.quantity || item.qty || 0);
  const unitPrice = Number(item.unitPrice ?? item.price ?? 0);
  return {
    key: item.itemKey || item.sku || item.productId || `item-${index}`,
    name: item.name || item.productName || item.product_name || "-",
    sku: item.sku || item.productSku || item.product_sku || "-",
    quantity,
    unitPrice,
    total: Number(item.total ?? quantity * unitPrice)
  };
}

function isVideoAttachment(item) {
  return String(item?.fileType || "").toLowerCase() === "video" || String(item?.mimeType || "").startsWith("video/");
}

function Checklist({ items }) {
  return (
    <div className="work-order-checklist">
      {items.map((item) => (
        <label key={item}>
          <span className="work-order-checkbox" />
          <span>{item}</span>
        </label>
      ))}
    </div>
  );
}

function NoteBox({ title, lines = 4 }) {
  return (
    <div className="work-order-note-box">
      <strong>{title}</strong>
      {Array.from({ length: lines }).map((_, index) => (
        <div className="work-order-note-line" key={index} />
      ))}
    </div>
  );
}

function RepairWorkOrderPrintPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setError("");
        const response = await apiRequest(`/repairs/${id}/work-order`);
        setData(response);
      } catch (loadError) {
        setError(loadError.message || "維修工作單載入失敗");
      }
    }
    load();
  }, [id]);

  const quoteItems = useMemo(
    () => parseQuoteItemsJson(data?.quoteItemsJson).map(normalizeQuoteItem),
    [data?.quoteItemsJson]
  );

  if (error) {
    return <div className="work-order-page"><div className="error-banner">{error}</div></div>;
  }

  if (!data?.repair) {
    return <div className="work-order-page"><div className="loading-state">載入維修工作單中...</div></div>;
  }

  const { repair, store, customer, mediaSummary } = data;
  const attachments = Array.isArray(data.attachments) ? data.attachments : [];
  const imageAttachments = attachments.filter((item) => !isVideoAttachment(item)).slice(0, 2);

  return (
    <main className="work-order-page">
      <div className="work-order-toolbar">
        <button type="button" className="primary-button" onClick={() => window.print()}>
          列印維修工作單
        </button>
      </div>

      <article className="work-order-sheet">
        <header className="work-order-header">
          <div>
            <div className="work-order-brand">KINGWAY</div>
            <h1>維修工作單</h1>
            <p>{store?.name || "-"} / {store?.code || "-"}</p>
          </div>
          <div className="work-order-number">
            <span>維修單號</span>
            <strong>#{repair.id}</strong>
          </div>
        </header>

        <section className="work-order-grid">
          <div><span>客戶</span><strong>{customer.name || "-"}</strong></div>
          <div><span>電話</span><strong>{customer.phone || "-"}</strong></div>
          <div><span>預約日</span><strong>{repair.reservation_date || "-"}</strong></div>
          <div><span>報價同意日</span><strong>{formatTaipeiDateTime(repair.quoteAcceptedAt)}</strong></div>
          <div><span>車款</span><strong>{repair.bike_model || "-"}</strong></div>
          <div><span>狀態</span><strong>{repair.repairStatusLabel || repair.status || "-"}</strong></div>
        </section>

        <section className="work-order-section">
          <h2>客戶需求與附件</h2>
          <div className="work-order-two-column">
            <div>
              <h3>客戶描述</h3>
              <p className="work-order-text">{repair.issue_description || "-"}</p>
            </div>
            <div>
              <h3>附件摘要</h3>
              <p>照片：{Number(mediaSummary?.images || 0) > 0 ? `有（${mediaSummary.images}）` : "無"}</p>
              <p>影片：{Number(mediaSummary?.videos || 0) > 0 ? `有（${mediaSummary.videos}）` : "無"}</p>
            </div>
          </div>
          {imageAttachments.length ? (
            <div className="work-order-thumbnails">
              {imageAttachments.map((item) => (
                <figure key={item.id || item.publicUrl}>
                  <img src={item.publicUrl} alt={item.originalName || "repair attachment"} />
                  <figcaption>{item.originalName || item.storedName || "附件"}</figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </section>

        <section className="work-order-section">
          <h2>診斷 / 報價資訊</h2>
          <div className="work-order-two-column">
            <div>
              <h3>內部診斷</h3>
              <p className="work-order-text">{repair.inspectionNotes || repair.inspection_notes || "-"}</p>
            </div>
            <div>
              <h3>報價備註</h3>
              <p className="work-order-text">{repair.quote_notes || repair.estimate_details || "-"}</p>
            </div>
          </div>
        </section>

        <section className="work-order-section">
          <h2>維修報價零件</h2>
          <table className="work-order-table">
            <thead>
              <tr>
                <th>品項</th>
                <th>SKU</th>
                <th>數量</th>
                <th>單價</th>
                <th>合計</th>
                <th>更換</th>
                <th>完成</th>
              </tr>
            </thead>
            <tbody>
              {quoteItems.length ? quoteItems.map((item) => (
                <tr key={item.key}>
                  <td>{item.name}</td>
                  <td>{item.sku}</td>
                  <td>{item.quantity}</td>
                  <td>{formatCurrency(item.unitPrice)}</td>
                  <td>{formatCurrency(item.total)}</td>
                  <td className="work-order-check-cell" />
                  <td className="work-order-check-cell" />
                </tr>
              )) : (
                <tr><td colSpan="7">無零件項目</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="work-order-section">
          <h2>現場工作確認</h2>
          <Checklist items={[
            "車輛入庫確認",
            "客戶需求確認",
            "報價同意確認",
            "零件準備確認",
            "作業完成確認",
            "測試完成確認",
            "照片確認",
            "客戶聯絡完成",
            "出庫準備完成"
          ]} />
        </section>

        <section className="work-order-section">
          <h2>技師填寫</h2>
          <div className="work-order-sign-row">
            <span>實際維修擔當：__________________</span>
            <span>交叉確認人員：__________________</span>
          </div>
          <NoteBox title="實際維修內容 memo" lines={2} />
          <NoteBox title="追加發現問題" lines={2} />
          <NoteBox title="需告知客戶事項" lines={2} />
          <div className="work-order-sign-row">
            <span>員工簽名：__________________</span>
            <span>日期：__________________</span>
          </div>
        </section>
      </article>
    </main>
  );
}

export default RepairWorkOrderPrintPage;
