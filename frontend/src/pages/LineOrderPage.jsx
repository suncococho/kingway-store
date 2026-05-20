import { useEffect, useState } from "react";
import liff from "@line/liff";
import { apiRequest } from "../lib/api";

const LIFF_ID = import.meta.env.VITE_LIFF_ID || "2010080463-s7I6a2BG";

function LineOrderPage() {
  const [loading, setLoading] = useState(true);
  const [lineUserId, setLineUserId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const [bindName, setBindName] = useState("");
  const [bindPhone, setBindPhone] = useState("");
  const [binding, setBinding] = useState(false);

  const [products, setProducts] = useState([]);
  const [selected, setSelected] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const isBound = /^09\d{8}$/.test(String(phone || ""));

  useEffect(() => {
    async function init() {
      try {
        await liff.init({ liffId: LIFF_ID });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();
        setLineUserId(profile.userId);
        if (profile.userId && profile.displayName) {
          apiRequest("/line/profile-name", {
            method: "POST",
            body: JSON.stringify({
              lineUserId: profile.userId,
              displayName: profile.displayName
            })
          }).catch(() => {});
        }
        setName(profile.displayName || "LINE 客戶");
        setBindName(profile.displayName || "LINE 客戶");

        const customerData = await apiRequest(
          `/line-order/customer?lineUserId=${encodeURIComponent(profile.userId)}&displayName=${encodeURIComponent(profile.displayName || "")}`
        );

        if (customerData?.customer) {
          setName(customerData.customer.name || profile.displayName || "LINE 客戶");
          setPhone(customerData.customer.phone || "");
          setBindName(customerData.customer.name || profile.displayName || "LINE 客戶");
        }

        const productRes = await fetch("/api/line-order/ebikes");
        const productData = await productRes.json();
        setProducts(Array.isArray(productData) ? productData : []);
      } catch (e) {
        console.error(e);
        setError(e.message || "頁面載入失敗");
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  async function submitBind() {
    setError("");

    const cleanPhone = String(bindPhone || "").replace(/\D/g, "");
    const cleanName = String(bindName || name || "LINE 客戶").trim();

    if (!lineUserId) return setError("缺少 LINE 使用者資料，請重新從 LINE 開啟。");
    if (!cleanName) return setError("請輸入姓名。");
    if (!/^09\d{8}$/.test(cleanPhone)) return setError("請輸入正確手機號碼，例如 0912345678");

    try {
      setBinding(true);

      await apiRequest("/line-bind-phone", {
        method: "POST",
        body: JSON.stringify({
          lineUserId,
          phone: cleanPhone
        })
      });

      setName(cleanName);
      setPhone(cleanPhone);
      setBindPhone("");
      setError("");
    } catch (e) {
      setError(e.message || "電話綁定失敗");
    } finally {
      setBinding(false);
    }
  }

  async function submitOrder() {
    setError("");
    setResult(null);

    if (!selected) return setError("請選擇車款");
    if (!isBound) return setError("請先完成電話綁定");

    try {
      setSubmitting(true);

      const res = await fetch("/api/line-order/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineUserId,
          name: name || "LINE 客戶",
          phone,
          productId: Number(selected)
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "建立訂單失敗");

      setResult(data);
      setSelected("");
    } catch (e) {
      setError(e.message || "建立訂單失敗");
    } finally {
      setSubmitting(false);
    }
  }

  const closePage = () => {
    try {
      if (liff.isInClient()) {
        liff.closeWindow();
        return;
      }
    } catch (e) {}
    window.location.href = "/line-customer";
  };

  if (loading) {
    return (
      <div className="line-order-page">
        <div className="line-order-wrap">
          <div className="line-order-form">資料讀取中...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="line-order-page">
      <div className="line-order-wrap">
        <div className="line-order-hero">
          <div className="line-order-brand">KINGWAY</div>
          <h1 className="line-order-title">電動自行車預約訂單</h1>
          <div className="line-order-desc">
            請先完成 LINE 電話綁定，完成後即可選擇車款預約。
          </div>
        </div>

        {!isBound ? (
          <div className="line-order-form">
            <h2 style={{ marginTop: 0 }}>請先完成電話綁定</h2>

            <input
              value={bindName}
              onChange={(e) => setBindName(e.target.value)}
              placeholder="姓名"
            />

            <input
              value={bindPhone}
              onChange={(e) => setBindPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="請輸入手機號碼，例如 0912345678"
              inputMode="tel"
            />

            <button
              type="button"
              onClick={submitBind}
              className="line-order-submit"
              disabled={binding}
            >
              {binding ? "綁定中..." : "確認綁定"}
            </button>

            {error ? <div className="line-order-alert error">{error}</div> : null}
          </div>
        ) : (
          <>
            <div className="line-order-form">
              <div className="line-order-alert">
                已完成電話綁定：{phone}
              </div>
            </div>

            <div className="line-product-list">
              {products.map((p) => {
                const active = selected === String(p.id);

                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelected(String(p.id))}
                    className={`line-product-card ${active ? "active" : ""}`}
                  >
                    <div className="line-product-thumb">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt={p.name} />
                      ) : (
                        <div style={{ fontWeight: 900, color: "#999" }}>KINGWAY</div>
                      )}
                    </div>

                    <div className="line-product-name">
                      {p.name}
                      <div className="line-product-sub">
                        {Number(p.stock || 0) > 0 ? `現貨 ${p.stock} 台` : "缺貨可預約"}
                      </div>
                    </div>

                    <div className="line-product-check">{active ? "✓" : "＋"}</div>
                  </button>
                );
              })}
            </div>

            <div className="line-order-form">
              <button
                type="button"
                onClick={submitOrder}
                className="line-order-submit"
                disabled={submitting}
              >
                {submitting ? "送出中..." : "送出預約訂單"}
              </button>

              {error ? <div className="line-order-alert error">{error}</div> : null}
            </div>
          </>
        )}

        {result ? (
          <div className="line-order-form">
            <h2 style={{ marginTop: 0 }}>預約訂單已建立</h2>
            <p style={{ lineHeight: 1.7 }}>
              訂單編號：{result.orderNo || result.orderId}
              <br />
              門市人員將確認車款、庫存與付款方式後與您聯繫。
            </p>
            <button type="button" onClick={closePage} className="line-order-submit">
              確認
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default LineOrderPage;
