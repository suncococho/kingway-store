import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { formatTaipeiDate, formatTaipeiDateTime } from "../lib/display";

function CheckCell({ checked }) {
  return <span className={checked ? "install-check-box checked" : "install-check-box"} />;
}

function Checklist({ items }) {
  return (
    <div className="install-check-list">
      {items.map((item) => (
        <label key={item}>
          <span className="install-check-box" />
          <span>{item}</span>
        </label>
      ))}
    </div>
  );
}

function NoteBox({ title, lines = 4 }) {
  return (
    <div className="install-check-note-box">
      <strong>{title}</strong>
      {Array.from({ length: lines }).map((_, index) => (
        <div className="install-check-note-line" key={index} />
      ))}
    </div>
  );
}

function OrderInstallCheckPrintPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setError("");
        const response = await apiRequest(`/orders/${id}/install-check`);
        setData(response);
      } catch (loadError) {
        setError(loadError.message || "安裝品項確認單載入失敗");
      }
    }
    load();
  }, [id]);

  if (error) {
    return <div className="install-check-page"><div className="error-banner">{error}</div></div>;
  }

  if (!data?.order) {
    return <div className="install-check-page"><div className="loading-state">載入安裝品項確認單中...</div></div>;
  }

  const { order, customer, store, vehicle } = data;
  const installItems = Array.isArray(data.installItems) ? data.installItems : [];

  return (
    <main className="install-check-page">
      <div className="install-check-toolbar">
        <button type="button" className="primary-button" onClick={() => window.print()}>
          列印安裝品項確認單
        </button>
      </div>

      <article className="install-check-sheet">
        <header className="install-check-header">
          <div>
            <div className="install-check-brand">KINGWAY</div>
            <h1>訂單安裝品項確認單</h1>
            <p>{store?.name || "-"} / {store?.code || "-"}</p>
          </div>
          <div className="install-check-number">
            <span>訂單號碼</span>
            <strong>{order.orderNumber || `#${order.id}`}</strong>
          </div>
        </header>

        {order.repairQuote ? (
          <div className="install-check-warning">維修報價訂單不適用此安裝品項確認單。</div>
        ) : null}

        <section className="install-check-grid">
          <div><span>客戶</span><strong>{customer?.name || "-"}</strong></div>
          <div><span>電話</span><strong>{customer?.phone || "-"}</strong></div>
          <div><span>訂單日期</span><strong>{formatTaipeiDate(order.businessDate || order.createdAt)}</strong></div>
          <div><span>交車狀態</span><strong>{order.handoverStatus === "confirmed" ? "已交車" : "未交車"}</strong></div>
          <div><span>車款</span><strong>{vehicle?.name || "-"}</strong></div>
          <div><span>門市</span><strong>{store?.name || "-"}</strong></div>
        </section>

        <section className="install-check-section">
          <h2>需安裝品項</h2>
          <table className="install-check-table">
            <thead>
              <tr>
                <th>品項</th>
                <th>SKU</th>
                <th>數量</th>
                <th>安裝</th>
                <th>測試</th>
                <th>照片</th>
                <th>完成</th>
                <th>備註</th>
              </tr>
            </thead>
            <tbody>
              {installItems.length ? installItems.map((item, index) => {
                const confirmation = item.confirmation || {};
                return (
                  <tr key={`${item.sku || item.name}-${index}`}>
                    <td>{item.name || "-"}</td>
                    <td>{item.sku || "-"}</td>
                    <td>{item.quantity || 0}</td>
                    <td><CheckCell checked={confirmation.isInstalled} /></td>
                    <td><CheckCell checked={confirmation.isTested} /></td>
                    <td><CheckCell checked={confirmation.isPhotoConfirmed} /></td>
                    <td><CheckCell checked={confirmation.completed} /></td>
                    <td>{item.note || ""}</td>
                  </tr>
                );
              }) : (
                <tr><td colSpan="8">目前沒有需要安裝確認的品項。</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="install-check-section">
          <h2>現場確認</h2>
          <Checklist items={[
            "車體外觀確認",
            "配件/零件安裝完成",
            "電系/燈具測試",
            "煞車/輪胎測試",
            "螺絲固定確認",
            "拍照留存",
            "交車前清潔",
            "客戶交付前最終確認"
          ]} />
        </section>

        <section className="install-check-section">
          <h2>員工填寫</h2>
          <div className="install-check-sign-row">
            <span>實際安裝人員：__________________</span>
            <span>交叉確認人員：__________________</span>
          </div>
          <NoteBox title="備註 memo" lines={2} />
          <NoteBox title="追加發現問題" lines={2} />
          <NoteBox title="需告知客戶事項" lines={2} />
          <div className="install-check-sign-row">
            <span>員工簽名：__________________</span>
            <span>日期：__________________</span>
          </div>
        </section>

        <footer className="install-check-footer">
          <span>列印時間：{formatTaipeiDateTime(new Date())}</span>
        </footer>
      </article>
    </main>
  );
}

export default OrderInstallCheckPrintPage;
