import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

export default function SuppliersPage() {
  const [rows, setRows] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [products, setProducts] = useState([]);
  const [productSearch, setProductSearch] = useState("");
  const [form, setForm] = useState({
    supplierName: "",
    sku: "",
    quantity: 1,
    type: "發注"
  });

  async function load() {
    setRows(await apiRequest("/suppliers/requests"));
    setMonthly(await apiRequest("/suppliers/monthly"));
    setProducts(await apiRequest("/products"));
  }

  useEffect(() => {
    load();
  }, []);

  const productOptions = products
    .filter((p) => {
      const q = productSearch.trim().toLowerCase();
      if (!q) return false;
      return String(p.sku || "").toLowerCase().includes(q) || String(p.name || "").toLowerCase().includes(q);
    })
    .slice(0, 8);

  const selectedProduct = products.find((p) => p.sku === form.sku);

  async function createRequest() {
    if (!form.sku || Number(form.quantity || 0) <= 0) {
      alert("請輸入 SKU 與數量");
      return;
    }

    await apiRequest("/suppliers/requests", {
      method: "POST",
      body: JSON.stringify({
        type: form.type,
        supplierName: form.supplierName || "kingway",
        sku: form.sku,
        quantity: Number(form.quantity),
        note: "WEB ERP"
      })
    });

    setForm({
      supplierName: form.supplierName || "kingway",
      sku: "",
      quantity: 1,
      type: form.type
    });
    setProductSearch("");
    await load();
    alert("建立完成");
  }

  async function receiveRequest(id) {
    const quantity = prompt("請輸入入庫數量", "1");
    if (!quantity) return;

    await apiRequest(`/suppliers/${id}/receive`, {
      method: "POST",
      body: JSON.stringify({ quantity: Number(quantity) })
    });

    await load();
    alert("入庫");
  }

  async function complete退貨(id) {
    if (!confirm("確認退貨完成？")) return;

    await apiRequest(`/suppliers/${id}/return-done`, {
      method: "POST",
      body: JSON.stringify({})
    });

    await load();
    alert("退貨完成");
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>供應商 / 發注 / 退貨</h1>
          <p>供應商發注、入庫、退貨與月結統一管理。</p>
        </div>
        <button className="primary-button" onClick={load}>重新整理</button>
      </div>

      <section className="stack-card">
        <div className="section-title">建立發注 / 退貨</div>
        <div className="stack-list">
          <input className="form-input" placeholder="供應商名稱" value={form.supplierName} onChange={(e) => setForm({ ...form, supplierName: e.target.value })} />

          <input className="form-input" placeholder="搜尋 SKU / 商品名稱" value={productSearch || form.sku} onChange={(e) => {
            setProductSearch(e.target.value);
            setForm({ ...form, sku: e.target.value });
          }} />

          {productOptions.length ? (
            <div className="stack-list">
              {productOptions.map((p) => (
                <button type="button" key={p.id} className="secondary-button" onClick={() => {
                  setForm({ ...form, sku: p.sku });
                  setProductSearch("");
                }}>
                  {p.sku} / {p.name} / 庫存 {p.stock}
                </button>
              ))}
            </div>
          ) : null}

          {selectedProduct ? (
            <div className="muted-text">已選擇：{selectedProduct.name} / 庫存：{selectedProduct.stock}</div>
          ) : null}

          <input className="form-input" type="number" placeholder="數量" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />

          <select className="form-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="發注">發注</option>
            <option value="退貨">退貨</option>
          </select>

          <button className="primary-button" onClick={createRequest}>建立</button>
        </div>
      </section>

      <section className="stack-card">
        <div className="section-title">月結摘要</div>
        <div className="stack-list">
          {monthly.map((row) => (
            <div className="log-row" key={row.supplierName || "none"}>
              <div>
                <strong>{row.supplierName || "-"}</strong>
                <div>PO: {row.poQty || 0} / 入庫: {row.receivedQty || 0} / 退貨: {row.returnQty || 0}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="stack-card">
        <div className="section-title">發注 / 退貨紀錄</div>
        <div className="stack-list">
          {rows.map((row) => {
            const requestType = row.request_type || row.requestType;
            const canReceive = requestType === "發注" && ["APPROVED", "PARTIALLY_RECEIVED"].includes(row.status);
            const can退貨 = requestType === "退貨" && row.status !== "退貨_CONFIRMED" && row.status !== "REJECTED";

            return (
              <div className="log-row" key={row.id}>
                <div>
                  <strong>#{row.id} {row.requestType}</strong>
                  <div>{row.supplierName || "-"} / {row.status}</div>
                  <div>{row.sku} / {row.productName}</div>
                  <div className="muted-text">數量：{row.quantity} / 入庫: {row.receivedQuantity} / 庫存：{row.stock}</div>

                  {canReceive ? (
                    <button className="primary-button" style={{ marginTop: 12 }} onClick={() => receiveRequest(row.id)}>
                      確認入庫
                    </button>
                  ) : null}

                  {can退貨 ? (
                    <button className="primary-button" style={{ marginTop: 12 }} onClick={() => complete退貨(row.id)}>
                      完成退貨
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
