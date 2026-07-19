import { useEffect, useRef, useState } from "react";
import liff from "@line/liff";
import { apiRequest } from "../lib/api";
import { resolveLineContext } from "../lib/lineContext";
import {
  DEFAULT_LINE_BINDING_STORE_CODE,
  fetchLineBindingSnapshot,
  saveLineBindingCache
} from "../lib/lineBindingRecovery";
const LEGACY_STORE_CONTEXT = {
  storeId: 1,
  storeCode: "KINGWAY_TAINAN",
  storeName: "KINGWAY 台南",
  customerOaName: "KINGWAY 台南門市 LINE",
  isExplicitStore: false
};

function money(value) {
  return "NT$ " + Number(value || 0).toLocaleString();
}

function hasLineOrderPrice(product) {
  return product?.customPrice !== null && product?.customPrice !== undefined;
}

function optionUnitPrice(product) {
  return hasLineOrderPrice(product) ? Number(product.customPrice || 0) : Number(product?.basePrice ?? product?.price ?? 0);
}

function shouldShowLinePrice(product) {
  if (!hasLineOrderPrice(product)) return false;
  return Number(product.customPrice || 0) !== Number(product?.basePrice ?? 0);
}

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
  const [optionConfig, setOptionConfig] = useState({ settings: null, groups: [] });
  const [selected, setSelected] = useState("");
  const [optionSelections, setOptionSelections] = useState({});
  const [orderStep, setOrderStep] = useState("bike");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const submitLockRef = useRef(false);
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

      const resolvedStoreCode = resolvedStoreContext.isExplicitStore
        ? resolvedStoreContext.storeCode
        : DEFAULT_LINE_BINDING_STORE_CODE;
      const storeQuery = `&store=${encodeURIComponent(resolvedStoreCode)}`;

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
          saveLineBindingCache({
            lineUserId: context.lineUserId,
            customer: customerData.customer,
            storeCode: resolvedStoreCode
          });
        }

        const [productData, optionData] = await Promise.all([
          apiRequest(`/line-order/ebikes?store=${encodeURIComponent(resolvedStoreCode)}`),
          apiRequest(`/line-order/options?store=${encodeURIComponent(resolvedStoreCode)}`).catch(() => ({ settings: null, groups: [] }))
        ]);
        setProducts(Array.isArray(productData) ? productData : []);
        setOptionConfig({
          settings: optionData?.settings || null,
          groups: Array.isArray(optionData?.groups) ? optionData.groups : []
        });
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
      const resolvedStoreCode = storeContext.isExplicitStore
        ? storeContext.storeCode
        : DEFAULT_LINE_BINDING_STORE_CODE;
      const restored = await fetchLineBindingSnapshot({
        lineUserId,
        displayName: cleanName,
        endpoint: "/line-order/customer",
        storeCode: resolvedStoreCode
      });

      if (restored?.customer) {
        setName(restored.customer.name || cleanName);
        setPhone(restored.customer.phone || cleanPhone);
        saveLineBindingCache({
          lineUserId,
          customer: restored.customer,
          storeCode: resolvedStoreCode
        });
      } else {
        setName(cleanName);
        setPhone(cleanPhone);
      }

      setBindPhone("");
      setError("");
    } catch (e) {
      setError(e.message || "電話綁定失敗");
    } finally {
      setBinding(false);
    }
  }

  const selectedProduct = products.find((product) => String(product.id) === String(selected));
  const optionSettings = optionConfig.settings || {};
  const optionGroups = Array.isArray(optionConfig.groups) ? optionConfig.groups : [];
  const optionsEnabled = Boolean(optionSettings.isEnabled && optionGroups.length > 0);
  const selectedOptionItems = optionGroups.flatMap((group) => {
    const ids = optionSelections[group.id] || [];
    return ids.map((productId) => {
      const product = (group.products || []).find((item) => Number(item.productId) === Number(productId));
      return product ? { ...product, groupId: group.id, groupCode: group.code, groupLabel: group.label } : null;
    }).filter(Boolean);
  });
  const selectedOptionTotal = selectedOptionItems.reduce((sum, item) => sum + optionUnitPrice(item), 0);
  const selectedBikePrice = Number(selectedProduct?.price || 0);
  const orderTotal = selectedBikePrice + selectedOptionTotal;

  function goNextFromBike() {
    setError("");
    if (!selected) return setError("請選擇車款");
    setOrderStep(optionsEnabled ? "options" : "confirm");
  }

  function getGroupSelectedIds(groupId) {
    return optionSelections[groupId] || [];
  }

  function toggleOptionProduct(group, product) {
    if (Number(product.stock || 0) <= 0) return;
    setError("");
    setOptionSelections((current) => {
      const ids = current[group.id] || [];
      const productId = Number(product.productId);
      if (ids.includes(productId)) {
        return { ...current, [group.id]: ids.filter((id) => id !== productId) };
      }
      const maxSelect = Number(group.maxSelect || 0);
      const nextIds = maxSelect === 1 ? [productId] : [...ids, productId];
      if (maxSelect > 0 && nextIds.length > maxSelect) {
        return current;
      }
      return { ...current, [group.id]: nextIds };
    });
  }

  function validateOptionsBeforeConfirm() {
    for (const group of optionGroups) {
      const count = getGroupSelectedIds(group.id).length;
      const minSelect = group.isRequired ? Math.max(1, Number(group.minSelect || 0)) : Number(group.minSelect || 0);
      const maxSelect = Number(group.maxSelect || 0);
      if (count < minSelect) {
        setError(group.label + " 至少需選擇 " + minSelect + " 項");
        return false;
      }
      if (maxSelect > 0 && count > maxSelect) {
        setError(group.label + " 最多只能選擇 " + maxSelect + " 項");
        return false;
      }
    }
    setError("");
    return true;
  }

  function goConfirmFromOptions(skip = false) {
    if (skip) {
      setOptionSelections({});
      setError("");
      setOrderStep("confirm");
      return;
    }
    if (validateOptionsBeforeConfirm()) {
      setOrderStep("confirm");
    }
  }

  async function submitOrder() {
    if (submitLockRef.current || result) {
      return;
    }

    submitLockRef.current = true;
    setError("");

    if (!selected) {
      submitLockRef.current = false;
      return setError("請選擇車款");
    }
    if (!isBound) {
      submitLockRef.current = false;
      return setError("請先完成電話綁定");
    }

    try {
      setSubmitting(true);

      const storeQuery = storeContext.isExplicitStore
        ? `?store=${encodeURIComponent(storeContext.storeCode)}`
        : `?store=${encodeURIComponent(DEFAULT_LINE_BINDING_STORE_CODE)}`;
      const res = await fetch(`/api/line-order/create${storeQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineUserId,
          name: name || "LINE 客戶",
          phone,
          productId: Number(selected),
          optionSelections: optionGroups.map((group) => ({
            groupId: group.id,
            productIds: getGroupSelectedIds(group.id)
          })),
          storeCode: storeContext.isExplicitStore ? storeContext.storeCode : undefined
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "建立訂單失敗");

      setResult(data);
      setSelected("");
      setOptionSelections({});
      setOrderStep("bike");
    } catch (e) {
      setError(e.message || "建立訂單失敗");
      submitLockRef.current = false;
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
        ) : result ? null : (
          <>
            <div className="line-order-form">
              <div className="line-order-alert">
                已完成電話綁定：{phone}
              </div>
            </div>

            {orderStep === "bike" ? (
              <>
                <div className="line-step-indicator">步驟 1：選擇車款</div>
                <div className="line-product-list">
                  {products.map((p) => {
                    const active = selected === String(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          if (!submitting && !result) setSelected(String(p.id));
                        }}
                        className={"line-product-card " + (active ? "active" : "")}
                        disabled={submitting || Boolean(result)}
                      >
                        <div className="line-product-thumb">
                          {p.imageUrl ? <img src={p.imageUrl} alt={p.name} /> : <div style={{ fontWeight: 900, color: "#999" }}>KINGWAY</div>}
                        </div>
                        <div className="line-product-name">
                          {p.name}
                          <div className="line-product-sub">
                            {Number(p.stock || 0) > 0 ? "現貨 " + p.stock + " 台" : "缺貨可預約"}
                            {optionSettings.showPrices !== false ? " / NT$ " + Number(p.price || 0).toLocaleString() : ""}
                          </div>
                        </div>
                        <div className="line-product-check">{active ? "✓" : "＋"}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="line-order-form">
                  <button type="button" onClick={goNextFromBike} className="line-order-submit" disabled={submitting || Boolean(result)}>下一步</button>
                  {error ? <div className="line-order-alert error">{error}</div> : null}
                </div>
              </>
            ) : null}

            {orderStep === "options" ? (
              <>
                <div className="line-step-indicator">步驟 2：選擇配件</div>
                <div className="line-order-form">
                  <h2 style={{ marginTop: 0 }}>{optionSettings.pageTitle || "選擇您需要的配件"}</h2>
                  <p style={{ lineHeight: 1.7, marginTop: 8 }}>{optionSettings.pageDescription || "可依照需求選擇配件，也可以略過此步驟"}</p>
                </div>
                {optionGroups.map((group) => (
                  <section key={group.id} className="line-option-group">
                    <div className="line-option-group-head">
                      <div>
                        <strong>{(group.code ? group.code + " / " : "") + group.label}</strong>
                        <span>{group.isRequired ? "必填" : "選填"}，{group.minSelect} 到 {group.maxSelect || "不限"} 項</span>
                      </div>
                    </div>
                    {group.description ? <p className="line-option-desc">{group.description}</p> : null}
                    <div className="line-option-product-list">
                      {(group.products || []).map((product) => {
                        const active = getGroupSelectedIds(group.id).includes(Number(product.productId));
                        const outOfStock = Number(product.stock || 0) <= 0;
                        return (
                          <button
                            key={product.productId}
                            type="button"
                            className={"line-product-card line-option-product " + (active ? "active" : "")}
                            disabled={outOfStock}
                            onClick={() => toggleOptionProduct(group, product)}
                          >
                            <div className="line-product-thumb">
                              {product.imageUrl ? <img src={product.imageUrl} alt={product.displayName} /> : <div style={{ fontWeight: 900, color: "#999" }}>KINGWAY</div>}
                            </div>
                            <div className="line-product-name">
                              {product.displayName}
                              <div className="line-product-sub">
                                {outOfStock ? "缺貨" : "庫存 " + product.stock}
                                {optionSettings.showPrices !== false && !shouldShowLinePrice(product) ? " / " + money(optionUnitPrice(product)) : ""}
                              </div>
                              {optionSettings.showPrices !== false && shouldShowLinePrice(product) ? (
                                <div className="line-option-price-stack">
                                  <span className="line-option-original-price">原價 {money(product.basePrice)}</span>
                                  <strong>LINE價 {money(optionUnitPrice(product))}</strong>
                                </div>
                              ) : null}
                            </div>
                            <div className="line-product-check">{active ? "✓" : outOfStock ? "缺" : "＋"}</div>
                          </button>
                        );
                      })}
                      {!(group.products || []).length ? <div className="line-order-alert">此群組目前沒有可選商品</div> : null}
                    </div>
                  </section>
                ))}
                <div className="line-order-form line-order-actions-row">
                  <button type="button" className="line-order-secondary" onClick={() => setOrderStep("bike")}>返回車款</button>
                  {optionSettings.allowSkip ? <button type="button" className="line-order-secondary" onClick={() => goConfirmFromOptions(true)}>略過選配</button> : null}
                  <button type="button" className="line-order-submit" onClick={() => goConfirmFromOptions(false)}>確認選配</button>
                  {error ? <div className="line-order-alert error">{error}</div> : null}
                </div>
              </>
            ) : null}

            {orderStep === "confirm" ? (
              <div className="line-order-form">
                <div className="line-step-indicator">最後確認</div>
                <h2 style={{ marginTop: 0 }}>確認訂單內容</h2>
                <div className="line-confirm-row"><span>車款</span><strong>{selectedProduct?.name || "-"}</strong></div>
                {selectedOptionItems.length ? selectedOptionItems.map((item) => {
                  const unitPrice = optionUnitPrice(item);
                  return (
                    <div className="line-confirm-row line-confirm-option-row" key={item.groupId + "-" + item.productId}>
                      <span>{item.groupLabel}</span>
                      <strong>
                        {item.displayName}
                        {optionSettings.showPrices !== false ? <small>單價 {money(unitPrice)} × 1，小計 {money(unitPrice)}</small> : null}
                      </strong>
                    </div>
                  );
                }) : <div className="line-confirm-row"><span>選配</span><strong>未選擇</strong></div>}
                {optionSettings.showPrices !== false ? <div className="line-confirm-row"><span>車款小計</span><strong>{money(selectedBikePrice)}</strong></div> : null}
                {optionSettings.showPrices !== false && selectedOptionItems.length ? <div className="line-confirm-row"><span>選配小計</span><strong>{money(selectedOptionTotal)}</strong></div> : null}
                {optionSettings.showPrices !== false ? <div className="line-confirm-row total"><span>預估金額</span><strong>{money(orderTotal)}</strong></div> : null}
                <div className="line-order-actions-row">
                  <button type="button" className="line-order-secondary" onClick={() => setOrderStep(optionsEnabled ? "options" : "bike")}>返回修改</button>
                  <button type="button" onClick={submitOrder} className="line-order-submit" disabled={submitting || Boolean(result)}>
                    {submitting ? "送出中，請稍候..." : "送出預約訂單"}
                  </button>
                </div>
                {error ? <div className="line-order-alert error">{error}</div> : null}
              </div>
            ) : null}
          </>
        )}

        {result ? (
          <div className="line-order-form">
            <h2 style={{ marginTop: 0 }}>預約訂單已建立</h2>
            <p style={{ lineHeight: 1.7 }}>
              {result.duplicate || result.reusedExisting ? "預約已建立，請勿重複送出。" : "您的預約訂單已建立。"}
              <br />
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
