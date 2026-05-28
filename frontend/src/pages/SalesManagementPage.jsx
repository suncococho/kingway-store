import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

const money = (v) => `NT$ ${Number(v || 0).toLocaleString()}`;

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

export default function SalesManagementPage() {
  const [startDate, setStartDate] = useState(monthStart());
  const [endDate, setEndDate] = useState(dateText(new Date()));
  const [data, setData] = useState({
    summary: {
      orderCount: 0,
      totalQuantity: 0,
      totalSales: 0,
      averageOrderAmount: 0,
    },
    orders: [],
    products: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadSales() {
    setLoading(true);
    setError("");

    try {
      const result = await apiRequest(
        `/sales/summary?startDate=${startDate}&endDate=${endDate}`
      );
      setData(result);
    } catch (err) {
      setError(err?.message || "銷售資料讀取失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = data.summary || {};

  return (
    <div className="page">
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>銷售管理</h1>
        <p style={{ marginTop: 6, color: "#667085" }}>
          依日期區間查看訂單數、銷售數量、總營收、訂單商品明細與商品銷售排行。
        </p>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <label>
            <div>開始日期</div>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>

          <label>
            <div>結束日期</div>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>

          <button onClick={loadSales} disabled={loading}>
            {loading ? "查詢中..." : "查詢"}
          </button>
        </div>

        {error ? (
          <div style={{ color: "#b42318", marginTop: 12 }}>{error}</div>
        ) : null}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div className="card" style={{ padding: 16 }}>
          <div style={{ color: "#667085" }}>訂單數</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>
            {Number(summary.orderCount || 0).toLocaleString()}
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ color: "#667085" }}>銷售總數量</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>
            {Number(summary.totalQuantity || 0).toLocaleString()}
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ color: "#667085" }}>總營收</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>
            {money(summary.totalSales)}
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ color: "#667085" }}>平均訂單金額</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>
            {money(summary.averageOrderAmount)}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>訂單銷售明細</h2>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th>日期</th>
                <th>訂單編號</th>
                <th>客戶</th>
                <th>商品列表</th>
                <th>數量</th>
                <th>金額</th>
                <th>付款</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {(data.orders || []).map((order) => (
                <tr key={order.orderId}>
                  <td>{order.createdAt ? String(order.createdAt).slice(0, 10) : ""}</td>
                  <td>{order.orderNo || order.orderId}</td>
                  <td>
                    <div>{order.customerName || "-"}</div>
                    <small>{order.customerPhone || ""}</small>
                  </td>
                  <td>{order.itemSummary || "-"}</td>
                  <td>{Number(order.totalQuantity || 0).toLocaleString()}</td>
                  <td>{money(order.totalAmount)}</td>
                  <td>{order.finalPaymentStatus || order.paymentMethod || "-"}</td>
                  <td>{order.status || "-"}</td>
                </tr>
              ))}

              {!loading && (!data.orders || data.orders.length === 0) ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: "center", padding: 24 }}>
                    此期間沒有訂單資料
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>商品銷售排行</h2>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th>商品</th>
                <th>SKU</th>
                <th>銷售數量</th>
                <th>銷售金額</th>
              </tr>
            </thead>
            <tbody>
              {(data.products || []).map((product, index) => (
                <tr key={`${product.productId}-${product.sku}-${index}`}>
                  <td>{product.productName}</td>
                  <td>{product.sku || "-"}</td>
                  <td>{Number(product.quantity || 0).toLocaleString()}</td>
                  <td>{money(product.totalSales)}</td>
                </tr>
              ))}

              {!loading && (!data.products || data.products.length === 0) ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: "center", padding: 24 }}>
                    此期間沒有商品銷售資料
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
