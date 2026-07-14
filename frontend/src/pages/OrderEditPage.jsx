import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiRequest } from "../lib/api";

const money = (v) => `NT$ ${Number(v || 0).toLocaleString()}`;
const categoryLabel = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "EB" || normalized === "EBIKE") return "電動自行車";
  if (normalized === "RP" || normalized === "REPAIR") return "維修";
  if (["AC", "ACCESSORY", "PT", "FP", "LC", "HG", "BG", "CL", "TN"].includes(normalized)) return "配件";
  return "其他";
};

const DEFAULT_WARRANTY_TERMS_VERSION = "KINGWAY_WARRANTY_REPAIR_TERMS_2026_07";

function getWarrantySuggestion(amount) {
  const price = Number(amount || 0);
  if (price <= 50000) return { months: 6, mileageLimitKm: 800 };
  if (price <= 60000) return { months: 9, mileageLimitKm: 1200 };
  if (price <= 70000) return { months: 12, mileageLimitKm: 1500 };
  if (price <= 90000) return { months: 12, mileageLimitKm: 2000 };
  return { months: 12, mileageLimitKm: 2500 };
}

function toDateInputValue(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function addMonthsToDate(dateText, months) {
  if (!dateText || !Number.isInteger(Number(months))) return "";
  const date = new Date(`${dateText}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setMonth(date.getMonth() + Number(months));
  return date.toISOString().slice(0, 10);
}

function buildWarrantyFormValues(order) {
  const suggestion = getWarrantySuggestion(order?.displayFinalAmount || order?.totalAmount);
  const defaultStartDate = toDateInputValue(order?.handoverConfirmedAt || order?.finalPaymentCompletedAt || order?.finalPaidAt || "");
  return {
    warrantyStartDate: toDateInputValue(order?.warrantyStartDate) || defaultStartDate,
    warrantyMonths: order?.warrantyMonths === null || order?.warrantyMonths === undefined || order?.warrantyMonths === "" ? String(suggestion.months) : String(order.warrantyMonths),
    warrantyMileageLimitKm: order?.warrantyMileageLimitKm === null || order?.warrantyMileageLimitKm === undefined || order?.warrantyMileageLimitKm === "" ? String(suggestion.mileageLimitKm) : String(order.warrantyMileageLimitKm),
    warrantyNote: order?.warrantyNote || "",
    warrantyTermsVersion: order?.warrantyTermsVersion || DEFAULT_WARRANTY_TERMS_VERSION,
    warrantySchemaReady: Boolean(Number(order?.warrantySchemaReady || 0))
  };
}

function formatWarrantyDisplay(form) {
  const start = toDateInputValue(form?.warrantyStartDate);
  const months = form?.warrantyMonths;
  const mileage = form?.warrantyMileageLimitKm;
  if (!start && !months && !mileage) return "未設定";
  const endDate = start && months ? addMonthsToDate(start, Number(months)) : "";
  const mileageText = mileage ? `${Number(mileage).toLocaleString()} km` : "未設定里程";
  return endDate ? `保固至：${endDate} 或 ${mileageText}，以先屆至者為準` : `保固期間：${months || "未設定"} 個月 / ${mileageText}`;
}

function OrderEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [products, setProducts] = useState([]);
  const [addProductSearch, setAddProductSearch] = useState("");
  const [selectedProductForAdd, setSelectedProductForAdd] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest(`/orders/${id}`)
      .then((o) => {
        setForm({
          customerId: o.customerId,
          orderId: o.id,
          totalAmount: Number(o.totalAmount || 0),
          customerName: o.customerNameSnapshot || o.customerName || "",
          customerPhone: o.customerPhoneSnapshot || o.customerPhone || "",
          paymentMethod: o.paymentMethod || "OTHER",
          depositAmount: Number(o.depositAmount || 0),
          otherDiscount: Number(o.otherDiscount || 0),
          unpaidBalance: Number(o.unpaidBalance || 0),
          finalPaymentStatus: o.finalPaymentStatus || "UNPAID",
          orderType: o.orderType || o.order_type || "",
          source: o.source || "",
          notes: o.notes || "",
          ...buildWarrantyFormValues(o)
        });

        setItems((o.items || []).map((x) => ({
          productId: Number(x.productId),
          sku: x.sku || x.skuSnapshot || "",
          productName: x.productName,
          quantity: Number(x.quantity || 1),
          unitPrice: Number(x.unitPrice || 0)
        })));
      })
      .catch((e) => setError(e.message || "讀取失敗"));

    apiRequest("/products")
      .then((rows) => setProducts(Array.isArray(rows) ? rows : []))
      .catch(() => setProducts([]));
  }, [id]);

  function update(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function updateItem(index, key, value) {
    setItems((list) => list.map((item, i) => {
      if (i !== index) return item;
      return { ...item, [key]: value };
    }));
  }

  function addSelectedProductToOrder() {
    const p = selectedProductForAdd;
    if (!p) return;
    setItems((list) => [...list, {
      productId: Number(p.id),
      sku: p.sku || "",
      productName: p.name,
      quantity: 1,
      unitPrice: Number(p.price || 0)
    }]);
    setAddProductSearch("");
    setSelectedProductForAdd(null);
  }

  function removeItem(index) {
    setItems((list) => list.filter((_, i) => i !== index));
  }

  const addProductKeyword = addProductSearch.trim().toLowerCase();
  const filteredAddProducts = addProductKeyword
    ? products
        .filter((p) => `${p.name || ""} ${p.sku || ""} ${p.categoryName || ""} ${p.categoryLabel || ""}`.toLowerCase().includes(addProductKeyword))
        .slice(0, 12)
    : [];

  const itemTotal = items.reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0),
    0
  );

  const otherDiscount = Number(form?.otherDiscount || 0);
  const depositAmount = Number(form?.depositAmount || 0);
  const hasNewFriendCoupon =
    String(form?.notes || "").includes("新朋友折扣");
  const couponDiscount = hasNewFriendCoupon ? 500 : Math.max(itemTotal - Number(form?.totalAmount || 0) - otherDiscount, 0);
  const payableAmount = Math.max(itemTotal - couponDiscount - otherDiscount, 0);
  const unpaidBalance = Math.max(payableAmount - depositAmount, 0);
  const showRepairQuoteItemsWarning =
    form?.orderType === "REPAIR" && form?.source === "repair_quote" && items.length === 0;

async function requestGoogleReviewCoupon() {
    if (!form?.customerId) {
      setError("找不到客戶資料，無法確認 Google 評論");
      return;
    }

    setError("");
    try {
      await apiRequest(`/coupons/approve-google-review-for-order/${id}`, {
        method: "POST"
      });
      alert("Google 評論已確認。");
    } catch (e) {
      setError(e.message || "Google 評論確認失敗");
    }
  }

  async function save(e) {
    e.preventDefault();
    setError("");

    try {
      await apiRequest(`/orders/${id}/items`, {
        method: "PUT",
        body: JSON.stringify({ items })
      });

      const payload = {
        ...form,
        unpaidBalance,
        otherDiscount,
        depositAmount,
        finalPaymentStatus: unpaidBalance <= 0 ? "PAID" : depositAmount > 0 ? "PARTIAL" : form.finalPaymentStatus
      };
      if (form.warrantySchemaReady) {
        Object.assign(payload, {
          warrantyStartDate: form.warrantyStartDate || null,
          warrantyMonths: form.warrantyMonths === "" ? null : Number(form.warrantyMonths),
          warrantyMileageLimitKm: form.warrantyMileageLimitKm === "" ? null : Number(form.warrantyMileageLimitKm),
          warrantyNote: form.warrantyNote || null,
          warrantyTermsVersion: form.warrantyTermsVersion || DEFAULT_WARRANTY_TERMS_VERSION
        });
      } else {
        delete payload.warrantyStartDate;
        delete payload.warrantyMonths;
        delete payload.warrantyMileageLimitKm;
        delete payload.warrantyNote;
        delete payload.warrantyTermsVersion;
        delete payload.warrantySchemaReady;
      }
      await apiRequest(`/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });

      navigate("/orders");
    } catch (e) {
      setError(e.message || "儲存失敗");
    }
  }

  if (!form) return <div className="kw-order-page">讀取中...</div>;

  return (
    <div className="kw-order-page">
      <style>{`
        .kw-order-page {
          background: #f6f8fb;
          color: #172033;
          min-height: 100vh;
          padding: 28px;
        }
        .kw-order-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          margin-bottom: 22px;
        }
        .kw-order-title {
          font-size: 34px;
          font-weight: 900;
          margin: 0;
          letter-spacing: -0.5px;
        }
        .kw-order-layout {
          display: grid;
          grid-template-columns: 360px 1fr;
          gap: 24px;
          align-items: start;
        }
        .kw-card {
          background: #fff;
          border: 1px solid #e4e9f2;
          border-radius: 18px;
          box-shadow: 0 10px 30px rgba(15,23,42,0.05);
          padding: 20px;
          margin-bottom: 18px;
        }
        .kw-card-title {
          font-size: 20px;
          font-weight: 900;
          margin: 0 0 18px;
        }
        .kw-field {
          display: grid;
          grid-template-columns: 92px 1fr;
          gap: 12px;
          align-items: center;
          margin-bottom: 14px;
        }
        .kw-field label {
          font-weight: 800;
          color: #59657a;
        }
        .kw-field input,
        .kw-field select,
        .kw-field textarea,
        .kw-product-search {
          width: 100%;
          border: 1px solid #d8dfeb;
          border-radius: 12px;
          padding: 12px 14px;
          font-size: 16px;
          background: #fff;
          color: #172033;
          box-sizing: border-box;
        }
        .kw-field textarea {
          min-height: 150px;
          resize: vertical;
        }
        .kw-summary-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 0;
          font-size: 17px;
          border-bottom: 1px dashed #e4e9f2;
        }
        .kw-summary-row strong {
          font-weight: 900;
        }
        .kw-minus {
          color: #dc2626;
          font-weight: 900;
        }
        .kw-blue {
          color: #1d4ed8;
          font-weight: 900;
        }
        .kw-final {
          margin-top: 14px;
          padding: 16px;
          border-radius: 14px;
          background: #ecfdf3;
          border: 1px solid #bbf7d0;
          display: flex;
          justify-content: space-between;
          font-size: 22px;
          font-weight: 900;
          color: #15803d;
        }
        .kw-product-toolbar {
          display: flex;
          justify-content: flex-start;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
        }
        .kw-product-list {
          display: grid;
          gap: 14px;
        }
        .kw-product-card {
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          background: #fff;
          overflow: hidden;
        }
        .kw-product-main {
          display: grid;
          grid-template-columns: 1.4fr 90px 140px 140px 72px;
          gap: 12px;
          align-items: center;
          padding: 16px;
        }
        .kw-product-name {
          font-weight: 900;
          font-size: 18px;
        }
        .kw-product-meta {
          color: #64748b;
          font-size: 14px;
          margin-top: 4px;
        }
        .kw-readonly-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border-radius: 999px;
          background: #eef2ff;
          color: #3730a3;
          font-size: 13px;
          font-weight: 900;
          padding: 5px 10px;
          margin-top: 8px;
        }
        .kw-product-card input,
        .kw-product-card select {
          width: 100%;
          border: 1px solid #d8dfeb;
          border-radius: 10px;
          padding: 10px;
          font-size: 15px;
          box-sizing: border-box;
        }
        .kw-product-edit {
          background: #f8fafc;
          border-top: 1px solid #e2e8f0;
          padding: 14px 16px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .kw-edit-field {
          display: grid;
          gap: 6px;
        }
        .kw-edit-field span {
          color: #64748b;
          font-size: 13px;
          font-weight: 900;
        }
        .kw-add-card {
          border: 2px solid #bbf7d0;
          background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 72%);
        }
        .kw-add-description {
          margin: -8px 0 16px;
          color: #166534;
          font-weight: 700;
          line-height: 1.6;
        }
        .kw-product-search {
          margin-bottom: 14px;
        }
        .kw-search-results {
          display: grid;
          gap: 10px;
          margin-bottom: 14px;
        }
        .kw-search-result {
          width: 100%;
          border: 1px solid #dbeafe;
          border-radius: 16px;
          padding: 14px;
          background: #fff;
          color: #172033;
          text-align: left;
          cursor: pointer;
        }
        .kw-search-result.selected {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
        }
        .kw-search-result-title {
          font-size: 16px;
          font-weight: 900;
          margin-bottom: 8px;
        }
        .kw-search-result-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          color: #475569;
          font-size: 14px;
          font-weight: 700;
        }
        .kw-selected-product {
          border: 1px solid #86efac;
          border-radius: 16px;
          background: #f7fee7;
          padding: 14px;
          margin-bottom: 14px;
        }
        .kw-selected-label {
          color: #166534;
          font-size: 13px;
          font-weight: 900;
          margin-bottom: 6px;
        }
        .kw-btn:disabled {
          cursor: not-allowed;
          opacity: 0.45;
        }
        .kw-empty-state {
          border: 1px dashed #cbd5e1;
          border-radius: 16px;
          color: #64748b;
          padding: 18px;
          text-align: center;
          font-weight: 800;
        }
        .kw-total-box {
          margin-top: 16px;
          padding: 18px;
          border-radius: 16px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 24px;
          font-weight: 900;
        }
        .kw-actions {
          display: grid;
          gap: 12px;
        }
        .kw-btn {
          border: 1px solid #d8dfeb;
          border-radius: 12px;
          padding: 13px 16px;
          background: #fff;
          font-size: 16px;
          font-weight: 900;
          cursor: pointer;
        }
        .kw-btn.primary {
          background: #2563eb;
          color: #fff;
          border-color: #2563eb;
        }
        .kw-btn.green {
          color: #15803d;
          border-color: #86efac;
          background: #f0fdf4;
        }
        .kw-btn.red {
          color: #dc2626;
          border-color: #fecaca;
          background: #fff7f7;
        }
        .kw-warning {
          background: #fff7ed;
          color: #9a3412;
          border: 1px solid #fed7aa;
          border-radius: 12px;
          padding: 12px 16px;
          margin-bottom: 16px;
          font-weight: 900;
          line-height: 1.6;
        }
        .kw-error {
          background: #fee2e2;
          color: #b91c1c;
          border-radius: 12px;
          padding: 12px 16px;
          margin-bottom: 16px;
          font-weight: 800;
        }
        .kw-help {
          background: #effaf4;
          border: 1px solid #d1fae5;
          color: #166534;
          border-radius: 18px;
          padding: 18px 22px;
          line-height: 1.8;
        }

        @media (max-width: 800px) {
          .kw-order-page {
            padding: 18px 14px 100px;
          }
          .kw-order-header {
            display: block;
          }
          .kw-order-title {
            font-size: 30px;
            margin-bottom: 12px;
          }
          .kw-order-layout {
            display: flex;
            flex-direction: column;
            gap: 14px;
          }
          .kw-card {
            border-radius: 16px;
            padding: 16px;
            margin-bottom: 14px;
          }
          .kw-field {
            grid-template-columns: 1fr;
            gap: 6px;
          }
          .kw-field label {
            font-size: 14px;
          }
          .kw-summary-row {
            font-size: 16px;
          }
          .kw-final {
            font-size: 20px;
          }
          .kw-product-toolbar {
            display: grid;
          }
          .kw-product-main {
            grid-template-columns: 1fr auto;
            gap: 8px;
          }
          .kw-product-main > div:nth-child(2),
          .kw-product-main > div:nth-child(3),
          .kw-product-main > div:nth-child(4) {
            grid-column: 1 / -1;
          }
          .kw-product-edit {
            grid-template-columns: 1fr;
          }
          .kw-search-result {
            padding: 16px;
          }
          .kw-search-result-meta {
            display: grid;
            gap: 6px;
          }
          .kw-total-box {
            font-size: 22px;
          }
        }
      `}</style>

      <div className="kw-order-header">
        <h1 className="kw-order-title">編輯訂單 #{id}</h1>
        <button className="kw-btn" type="button" onClick={() => navigate("/orders")}>← 返回訂單列表</button>
      </div>

      {error && <div className="kw-error">{error}</div>}

      <form onSubmit={save} className="kw-order-layout">
        <aside>
          <section className="kw-card">
            <h2 className="kw-card-title">訂單資訊</h2>

            <div className="kw-field">
              <label>客戶姓名</label>
              <input value={form.customerName} onChange={(e) => update("customerName", e.target.value)} />
            </div>

            <div className="kw-field">
              <label>電話</label>
              <input value={form.customerPhone} onChange={(e) => update("customerPhone", e.target.value)} />
            </div>

            <div className="kw-field">
              <label>付款方式</label>
              <select value={form.paymentMethod} onChange={(e) => update("paymentMethod", e.target.value)}>
                <option value="CASH">現金</option>
                <option value="CARD">刷卡</option>
                <option value="TRANSFER">匯款</option>
                <option value="LINE_PAY">LINE Pay</option>
                <option value="OTHER">無卡分期</option>
              </select>
            </div>

            <div className="kw-field">
              <label>已收訂金</label>
              <input type="number" value={form.depositAmount} onChange={(e) => update("depositAmount", Number(e.target.value))} />
            </div>

            <div className="kw-field">
              <label>其他折扣</label>
              <input type="number" value={form.otherDiscount} onChange={(e) => update("otherDiscount", Number(e.target.value))} />
            </div>

            <div className="kw-field">
              <label>付款狀態</label>
              <select value={form.finalPaymentStatus} onChange={(e) => update("finalPaymentStatus", e.target.value)}>
                <option value="UNPAID">未付款</option>
                <option value="PARTIAL">部分付款</option>
                <option value="PAID">已付清</option>
              </select>
            </div>
          </section>

          <section className="kw-card">
            <h2 className="kw-card-title">訂單摘要</h2>

            <div className="kw-summary-row"><span>商品總額</span><strong>{money(itemTotal)}</strong></div>
            <div className="kw-summary-row"><span>會員服務</span><strong className="kw-minus">-{money(couponDiscount)}</strong></div>
            <div className="kw-summary-row"><span>其他折扣</span><strong className="kw-minus">-{money(otherDiscount)}</strong></div>
            <div className="kw-summary-row"><span>訂單應收</span><strong className="kw-blue">{money(payableAmount)}</strong></div>
            <div className="kw-summary-row"><span>已收訂金</span><strong>{money(depositAmount)}</strong></div>

            <div className="kw-final">
              <span>剩餘尾款</span>
              <span>{money(unpaidBalance)}</span>
            </div>
          </section>

          <section className="kw-card">
            <h2 className="kw-card-title">備註</h2>
            <div className="kw-field" style={{ display: "block" }}>
              <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} />
            </div>
          </section>

          <section className="kw-card">
            <h2 className="kw-card-title">保固資訊</h2>
            <div className="kw-help" style={{ marginBottom: 14 }}>{form.warrantySchemaReady ? "" : "保固欄位 migration 尚未套用，暫不可儲存。"}{formatWarrantyDisplay(form)}</div>
            <div className="kw-field">
              <label>保固起算日</label>
              <input type="date" disabled={!form.warrantySchemaReady} value={form.warrantyStartDate} onChange={(e) => update("warrantyStartDate", e.target.value)} />
            </div>
            <div className="kw-field">
              <label>保固期間</label>
              <input type="number" min="0" step="1" disabled={!form.warrantySchemaReady} value={form.warrantyMonths} onChange={(e) => update("warrantyMonths", e.target.value)} />
            </div>
            <div className="kw-field">
              <label>里程上限</label>
              <input type="number" min="0" step="1" disabled={!form.warrantySchemaReady} value={form.warrantyMileageLimitKm} onChange={(e) => update("warrantyMileageLimitKm", e.target.value)} />
            </div>
            <div className="kw-field">
              <label>保固備註</label>
              <textarea disabled={!form.warrantySchemaReady} value={form.warrantyNote} placeholder="特別保固、展示車、二手車、零件另計、客製條件" onChange={(e) => update("warrantyNote", e.target.value)} />
            </div>
            <div className="kw-summary-row"><span>保固版本</span><strong>{form.warrantyTermsVersion || DEFAULT_WARRANTY_TERMS_VERSION}</strong></div>
          </section>

          <section className="kw-card kw-actions">
            
            <button type="submit" className="kw-btn primary">儲存訂單</button>
            <button type="button" className="kw-btn" onClick={() => navigate("/orders")}>返回</button>
          </section>
        </aside>

        <main>
          <section className="kw-card">
            <div className="kw-product-toolbar">
              <h2 className="kw-card-title" style={{ margin: 0 }}>商品項目</h2>
            </div>

            {showRepairQuoteItemsWarning && (
              <div className="kw-warning">此維修訂單尚未同步品項，請先完成維修品項同步後再收款。</div>
            )}


            <div className="kw-product-list">
              {items.map((item, index) => (
                <div className="kw-product-card" key={index}>
                  <div className="kw-product-main">
                    <div>
                      <div className="kw-product-name">{item.productName || "商品"}</div>
                      <div className="kw-product-meta">
                        SKU：{item.sku || "-"} / 小計：{money(Number(item.quantity || 0) * Number(item.unitPrice || 0))}
                      </div>
                      <span className="kw-readonly-chip">商品名稱不可在此搜尋變更</span>
                    </div>
                    <div><strong>{Number(item.quantity || 0)}</strong></div>
                    <div>{money(item.unitPrice)}</div>
                    <div><strong>{money(Number(item.quantity || 0) * Number(item.unitPrice || 0))}</strong></div>
                    <button type="button" className="kw-btn red" onClick={() => removeItem(index)}>刪除</button>
                  </div>

                  <div className="kw-product-edit">
                    <label className="kw-edit-field">
                      <span>數量</span>
                      <input type="number" min="1" value={item.quantity} onChange={(e) => updateItem(index, "quantity", Number(e.target.value))} />
                    </label>
                    <label className="kw-edit-field">
                      <span>單價</span>
                      <input type="number" min="0" value={item.unitPrice} onChange={(e) => updateItem(index, "unitPrice", Number(e.target.value))} />
                    </label>
                  </div>
                </div>
              ))}
              {!items.length && <div className="kw-empty-state">目前沒有商品項目，請在下方「新增商品到訂單」選擇商品後加入。</div>}
            </div>

            <div className="kw-total-box">
              <span>商品總額</span>
              <span>{money(itemTotal)}</span>
            </div>
          </section>

          <section className="kw-card kw-add-card">
            <h2 className="kw-card-title">新增商品到訂單</h2>
            <p className="kw-add-description">請先搜尋並選擇商品，確認「已選擇商品」後再按「加入訂單」。搜尋不會改動上方既有商品。</p>

            <input
              className="kw-product-search"
              value={addProductSearch}
              onChange={(e) => {
                setAddProductSearch(e.target.value);
                setSelectedProductForAdd(null);
              }}
              placeholder="搜尋商品名稱或 SKU"
            />

            {filteredAddProducts.length ? (
              <div className="kw-search-results">
                {filteredAddProducts.map((product) => (
                  <button
                    type="button"
                    key={product.id}
                    className={`kw-search-result${selectedProductForAdd?.id === product.id ? " selected" : ""}`}
                    onClick={() => setSelectedProductForAdd(product)}
                  >
                    <div className="kw-search-result-title">{product.name || "商品"}</div>
                    <div className="kw-search-result-meta">
                      <span>SKU：{product.sku || "-"}</span>
                      <span>價格：{money(product.price)}</span>
                      <span>庫存：{Number(product.stock || 0).toLocaleString()}</span>
                      <span>分類：{product.categoryName || product.categoryLabel || categoryLabel(product.categoryCode || product.category)}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="kw-empty-state">{addProductKeyword ? "找不到符合的商品。" : "輸入商品名稱或 SKU 後會顯示搜尋結果。"}</div>
            )}

            {selectedProductForAdd && (
              <div className="kw-selected-product">
                <div className="kw-selected-label">已選擇商品</div>
                <div className="kw-product-name">{selectedProductForAdd.name || "商品"}</div>
                <div className="kw-product-meta">
                  SKU：{selectedProductForAdd.sku || "-"} / 價格：{money(selectedProductForAdd.price)} / 庫存：{Number(selectedProductForAdd.stock || 0).toLocaleString()} / 分類：{selectedProductForAdd.categoryName || selectedProductForAdd.categoryLabel || categoryLabel(selectedProductForAdd.categoryCode || selectedProductForAdd.category)}
                </div>
              </div>
            )}

            <button type="button" className="kw-btn green" onClick={addSelectedProductToOrder} disabled={!selectedProductForAdd}>
              ＋ 加入訂單
            </button>
          </section>

          <section className="kw-help">
            <strong>金額說明</strong>
            <ul>
              <li>商品總額：所有商品小計加總</li>
              <li>會員服務：既有折扣紀錄</li>
              <li>其他折扣：門市手動折扣</li>
              <li>訂單應收：商品總額 - 折扣 - 其他折扣</li>
              <li>剩餘尾款：訂單應收 - 已收訂金</li>
            </ul>
          </section>
        </main>
      </form>
    </div>
  );
}

export default OrderEditPage;
