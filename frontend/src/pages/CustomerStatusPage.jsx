import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";

const money = (v) => `NT$ ${Number(v || 0).toLocaleString()}`;

function CustomerStatusPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  async function search(e) {
    e?.preventDefault();
    if (!q.trim()) return;
    setError("");
    try {
      const result = await apiRequest(`/customer-status?q=${encodeURIComponent(q.trim())}`);
      setData(result);
    } catch (err) {
      setError(err.message || "查詢失敗");
    }
  }

  return (
    <div className="page-shell">
      <h1>客戶狀態</h1>

      <form className="card" onSubmit={search}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="輸入電話或姓名" />
        <button className="primary-button">查詢</button>
      </form>

      {error && <div className="error-banner">{error}</div>}

      {data && !data.customer ? (
        <section className="card">
          <h2>找不到客戶資料</h2>
          <p className="muted-text">
            此電話或姓名目前沒有訂單或維修紀錄。請依照客戶需求直接建立新訂單或維修單。
          </p>
          <div className="action-row">
            <button
              type="button"
              className="primary-button"
              onClick={() => navigate(`/pos?phone=${encodeURIComponent(q.trim())}`)}
            >
              建立新訂單
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => navigate(`/repairs?phone=${encodeURIComponent(q.trim())}`)}
            >
              建立維修單
            </button>
          </div>
        </section>
      ) : null}

      {data?.customer && (
        <>
          <section className="card">
            <h2>{data.customer.name} / {data.customer.phone}</h2>
            <p>LINE：{data.customer.lineUserId ? "已綁定" : "未綁定"}</p>
          </section>

          <section className="card">
            <h2>訂單 / 購買狀態</h2>
            {(data.orders || []).map((o) => (
              <div className="card" key={o.id}>
                <h3>{o.orderNo}</h3>
                <p>狀態：{o.status}</p>
                <p>總金額：{money(o.totalAmount)}</p>
                <p>未付：{money(o.unpaidBalance)}</p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => navigate(`/orders?keyword=${encodeURIComponent(o.orderNo || "")}`)}
                >
                  查看訂單
                </button>
              </div>
            ))}
          </section>

          <section className="card">
            <h2>維修狀態</h2>
            {(data.repairs || []).length ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => navigate(`/repairs?keyword=${encodeURIComponent(data.customer.phone || data.customer.name || "")}`)}
              >
                查看維修
              </button>
            ) : null}
            {(data.repairs || []).map((r) => (
              <div className="card" key={r.id}>
                <h3>工單 #{r.id} / {r.bikeModel}</h3>
                <p>問題：{r.issueDescription}</p>
                <p>狀態：{r.status}</p>
                <p>報價：{money(r.estimateAmount)}</p>
                <button type="button" className="secondary-button" onClick={() => navigate(`/repairs/${r.id}`)}>
                  查看工單
                </button>
              </div>
            ))}
          </section>
        </>
      )}

      {data && !data.customer && <div className="empty-state">查無客戶資料</div>}
    </div>
  );
}

export default CustomerStatusPage;
