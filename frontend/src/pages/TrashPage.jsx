import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import { apiRequest } from "../lib/api";

function TrashPage() {
  const [orders, setOrders] = useState([]);
  const [repairs, setRepairs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("ORDERS");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [orderRows, repairRows] = await Promise.all([
        apiRequest("/orders/trash/list"),
        apiRequest("/repairs/trash/list")
      ]);
      setOrders(Array.isArray(orderRows) ? orderRows : []);
      setRepairs(Array.isArray(repairRows) ? repairRows : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function restore(type, id) {
    await apiRequest(type === "order" ? `/orders/${id}/restore` : `/repairs/${id}/restore`, {
      method: "POST"
    });
    setMessage("已復原");
    await load();
  }

  async function permanentDelete(type, id) {
    if (!window.confirm("確定永久刪除？此操作無法復原。")) return;

    await apiRequest(type === "order" ? `/orders/${id}/permanent` : `/repairs/${id}/permanent`, {
      method: "DELETE"
    });
    setMessage("已永久刪除");
    await load();
  }

  return (
    <div className="page-stack">
      <PageHeader title="已刪除資料" description="可復原或永久刪除已刪除訂單與維修單。" />

      {message ? <div className="success-banner">{message}</div> : null}
      {loading ? <div className="loading-state">讀取中...</div> : null}

      <div className="trash-tabs">
        <button
          type="button"
          className={tab === "ORDERS" ? "trash-tab active" : "trash-tab"}
          onClick={() => setTab("ORDERS")}
        >
          已刪除訂單
        </button>
        <button
          type="button"
          className={tab === "REPAIRS" ? "trash-tab active" : "trash-tab"}
          onClick={() => setTab("REPAIRS")}
        >
          已刪除維修單
        </button>
      </div>

      {tab === "ORDERS" ? <><h2>已刪除訂單</h2>
      <div className="trash-card-list">
        {orders.map((row) => (
          <div key={`order-${row.id}`} className="trash-card">
            <div>
              <div className="trash-title">{row.orderNo || `#${row.id}`}</div>
              <div className="trash-meta">客戶：{row.customerNameSnapshot || "-"}</div>
              <div className="trash-meta">金額：NT${row.totalAmount}</div>
              <div className="trash-meta">刪除時間：{row.deletedAt || "-"}</div>
            </div>

            <div className="trash-actions">
              <button type="button" className="secondary-button" onClick={() => restore("order", row.id)}>
                復原
              </button>
              <button type="button" className="danger-button" onClick={() => permanentDelete("order", row.id)}>
                永久刪除
              </button>
            </div>
          </div>
        ))}

        {!orders.length && !loading ? <div className="empty-state">目前沒有已刪除訂單。</div> : null}
      </div></> : null}

      {tab === "REPAIRS" ? <><h2>已刪除維修單</h2>
      <div className="trash-card-list">
        {repairs.map((row) => (
          <div key={`repair-${row.id}`} className="trash-card">
            <div>
              <div className="trash-title">維修單 #{row.id}</div>
              <div className="trash-meta">客戶：{row.customerName || "-"}</div>
              <div className="trash-meta">電話：{row.customerPhone || "-"}</div>
              <div className="trash-meta">車款：{row.bikeModel || "-"}</div>
              <div className="trash-meta">刪除時間：{row.deletedAt || "-"}</div>
            </div>

            <div className="trash-actions">
              <button type="button" className="secondary-button" onClick={() => restore("repair", row.id)}>
                復原
              </button>
              <button type="button" className="danger-button" onClick={() => permanentDelete("repair", row.id)}>
                永久刪除
              </button>
            </div>
          </div>
        ))}

        {!repairs.length && !loading ? <div className="empty-state">目前沒有已刪除維修單。</div> : null}
      </div></> : null}
    </div>
  );
}

export default TrashPage;
