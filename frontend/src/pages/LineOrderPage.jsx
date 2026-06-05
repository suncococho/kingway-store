import { useEffect, useState } from "react";
import liff from "@line/liff";
import { apiRequest } from "../lib/api";
import { resolveLineContext } from "../lib/lineContext";
const LEGACY_STORE_CONTEXT = {
  storeId: 1,
  storeCode: "KINGWAY_TAINAN",
  storeName: "KINGWAY 台南",
  customerOaName: "KINGWAY 台南門市 LINE",
  isExplicitStore: false
};

function buildCustomerOaName(response, fallbackStoreName) {
  const configured = String(response?.lineSettings?.customerOaName || "").trim();
  if (configured) {
    return configured;
  }

  const baseName = String(response?.store?.storeName || fallbackStoreName || LEGACY_STORE_CONTEXT.storeName).trim();
  return baseName ? `${baseName} LINE` : LEGACY_STORE_CONTEXT.customerOaName;
}

function LineOrderPage() {
  const [loading, setLoading] = useState(true);
  const [storeLoading, setStoreLoading] = useState(true);
  const [storeContext, setStoreContext] = useState(LEGACY_STORE_CONTEXT);
  const [storeError, setStoreError] = useState("");
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
  const [lineContextFailureReason, setLineContextFailureReason] = useState("");
  const [lineInClient, setLineInClient] = useState(false);

  const isBound = /^09\d{8}$/.test(String(phone || ""));

  useEffect(() => {
    async function loadStoreContext() {
      const params = new URLSearchParams(window.location.search);
      const storeCode = String(params.get("store") || "").trim();

      if (!storeCode) {
        setStoreContext(LEGACY_STORE_CONTEXT);
        setStoreError("");
        setStoreLoading(false);
        return LEGACY_STORE_CONTEXT;
      }

      try {
        const response = await apiRequest(`/storefront/resolve-store?store=${encodeURIComponent(storeCode)}`);
        const nextStoreContext = {
          storeId: Number(response?.store?.storeId || 0) || LEGACY_STORE_CONTEXT.storeId,
          storeCode: response?.store?.storeCode || storeCode,
          storeName: response?.store?.storeName || LEGACY_STORE_CONTEXT.storeName,
          customerOaName: buildCustomerOaName(response, response?.store?.storeName),
          isExplicitStore: true
        };
        setStoreContext(nextStoreContext);
        setStoreError("");
        return nextStoreContext;
      } catch (resolveError) {
        setStoreError(resolveError.message || "找不到有效的門市資訊");
        return null;
      } finally {
        setStoreLoading(false);
      }
    }

    async function init() {
      const resolvedStoreContext = await loadStoreContext();
      if (!resolvedStoreContext) {
        setLoading(false);
        return;
      }

      const storeQuery = resolvedStoreContext.isExplicitStore
        ? `&store=${encodeURIComponent(resolvedStoreContext.storeCode)}`
        : "";

      try {
        const context = await resolveLineContext();
        setLineContextFailureReason(context.failureReason || "");
        setLineInClient(Boolean(context.inClient));

        if (!context.isLoggedIn || context.shouldLogin) {
          return;
        }

        setLineUserId(context.lineUserId || "");
        if (context.lineUserId && context.displayName) {
          apiRequest("/line/profile-name", {
            method: "POST",
            body: JSON.stringify({
              lineUserId: context.lineUserId,
              displayName: context.displayName
            })
          }).catch(() => {});
        }
        setName(context.displayName || "LINE 客戶");
        setBindName(context.displayName || "LINE 客戶");

        if (!context.lineUserId) {
          return;
        }

        const customerData = await apiRequest(
          `/line-order/customer?lineUserId=${encodeURIComponent(context.lineUserId)}&displayName=${encodeURIComponent(context.displayName || "")}${storeQuery}`
        );

        if (customerData?.customer) {
          setName(customerData.customer.name || context.displayName || "LINE 客戶");
          setPhone(customerData.customer.phone || "");
          setBindName(customerData.customer.name || context.displayName || "LINE 客戶");
        }

        const productData = await apiRequest(`/line-order/ebikes${resolvedStoreContext.isExplicitStore ? `?store=${encodeURIComponent(resolvedStoreContext.storeCode)}` : ""}`);
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

  function getLineUserUnavailableMessage() {
    const base = "無法取得 LINE 使用者資料。\n請回到 KINGWAY LINE 官方帳號，從選單重新開啟此頁面。";
    return lineInClient && lineContextFailureReason
      ? `${base}\n原因：${lineContextFailureReason}`
      : base;
  }

  async function submitBind() {
    setError("");

    const cleanPhone = String(bindPhone || "").replace(/\D/g, "");
    const cleanName = String(bindName || name || "LINE 客戶").trim();

    if (!lineUserId) return setError(getLineUserUnavailableMessage());
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

      const storeQuery = storeContext.isExplicitStore
        ? `?store=${encodeURIComponent(storeContext.storeCode)}`
        : "";
      const res = await fetch(`/api/line-order/create${storeQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineUserId,
          name: name || "LINE 客戶",
          phone,
          productId: Number(selected),
          storeCode: storeContext.isExplicitStore ? storeContext.storeCode : undefined
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
          {storeLoading ? null : (
            <div className={`line-order-alert ${storeError ? "error" : ""}`}>
              {storeError ? storeError : `${storeContext.storeName} / ${storeContext.customerOaName}`}
            </div>
          )}
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

        {storeLoading ? null : (
          <div className={`line-order-alert ${storeError ? "error" : ""}`}>
            {storeError ? storeError : `目前門市：${storeContext.storeName} / ${storeContext.customerOaName}`}
          </div>
        )}

        {storeError ? null : !isBound ? (
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
