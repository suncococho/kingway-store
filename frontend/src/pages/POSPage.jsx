import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AdminSectionHeader from "../components/AdminSectionHeader";
import ActionModal from "../components/ActionModal";
import DetailModal from "../components/DetailModal";
import FilterBar from "../components/FilterBar";
import PageHeader from "../components/PageHeader";
import ProductImage from "../components/ProductImage";
import StatusBadge from "../components/StatusBadge";
import { apiRequest } from "../lib/api";
import { getCategoryLabel } from "../lib/display";
import { PRODUCT_CATEGORY_OPTIONS } from "../lib/productCategories";

function getStockTone(stock, reorderLevel) {
  if (Number(stock) <= 0) {
    return "danger";
  }
  if (Number(stock) <= Number(reorderLevel || 0)) {
    return "warning";
  }
  return "success";
}

function getStockLabel(stock, reorderLevel) {
  if (Number(stock) <= 0) {
    return "無庫存";
  }
  if (Number(stock) <= Number(reorderLevel || 0)) {
    return "低庫存";
  }
  return "有庫存";
}

function formatCurrency(value) {
  return `NT$${Number(value || 0).toFixed(0)}`;
}

const POS_CART_STORAGE_KEY = "kingway-pos-cart-sessions-v1";
const POS_ACTIVE_CART_STORAGE_KEY = "kingway-pos-active-cart-v1";
const CUSTOMER_TYPE_LABELS = {
  LINE: "LINE",
  OFFLINE_WITH_PHONE: "一般",
  OFFLINE_NO_PHONE: "一般"
};

function normalizeCustomerType(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "OFFLINE_WITH_PHONE" || normalized === "OFFLINE_NO_PHONE") {
    return normalized;
  }
  if (normalized === "OFFLINE") {
    return "OFFLINE_WITH_PHONE";
  }
  return "LINE";
}

function isPhoneRequiredCustomerType(value) {
  return normalizeCustomerType(value) !== "OFFLINE_NO_PHONE";
}

function isOfflineCustomerType(value) {
  return normalizeCustomerType(value) !== "LINE";
}

function createCartDraft(index = 1, overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: `cart_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    name: `購物車 ${index}`,
    createdAt: now,
    updatedAt: now,
    customerId: "",
    customerType: "LINE",
    customerName: "",
    customerPhone: "",
    notes: "",
    customAmount: "",
    shippingFee: "",
    couponCode: "",
    couponAmount: "",
    paymentMethod: "CASH",
    isReservationOrder: false,
    depositAmount: "",
    unpaidBalance: "",
    finalPaymentStatus: "PAID",
    items: [],
    ...overrides
  };
}

function normalizeCartDraft(cart, index) {
  const draft = createCartDraft(index, cart || {});
  return {
    ...draft,
    items: Array.isArray(draft.items)
      ? draft.items.map((item) => ({
          ...item,
          qty: Math.max(1, Number(item.qty || 1))
        }))
      : []
  };
}

function loadStoredCarts() {
  if (typeof window === "undefined") {
    return [createCartDraft(1)];
  }

  try {
    const raw = window.localStorage.getItem(POS_CART_STORAGE_KEY);
    if (!raw) {
      return [createCartDraft(1)];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [createCartDraft(1)];
    }

    return parsed.map((cart, index) => normalizeCartDraft(cart, index + 1));
  } catch {
    return [createCartDraft(1)];
  }
}

function loadStoredActiveCartId(carts) {
  if (typeof window === "undefined") {
    return carts[0]?.id || "";
  }

  try {
    const raw = window.localStorage.getItem(POS_ACTIVE_CART_STORAGE_KEY);
    if (raw && carts.some((cart) => cart.id === raw)) {
      return raw;
    }
  } catch {
    // ignore storage errors
  }

  return carts[0]?.id || "";
}

function loadInitialCartState() {
  const carts = loadStoredCarts();
  return {
    carts,
    activeCartId: loadStoredActiveCartId(carts)
  };
}

function POSPage() {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [cartState, setCartState] = useState(() => loadInitialCartState());
  const [cartManagerOpen, setCartManagerOpen] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [warningModal, setWarningModal] = useState(null);
  const [successModal, setSuccessModal] = useState(null);
  const [posStep, setPosStep] = useState(1);
  const [customers, setCustomers] = useState([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerForm, setCustomerForm] = useState({ name: "", phone: "" });
  const [customerCoupons, setCustomerCoupons] = useState([]);
  const [couponLookupMessage, setCouponLookupMessage] = useState("");
  const [customerCreating, setCustomerCreating] = useState(false);
  const searchInputRef = useRef(null);
  const customerNameRef = useRef(null);
  const notesRef = useRef(null);
  const checkoutRef = useRef(null);

  useEffect(() => {
    async function loadProducts() {
      setLoading(true);
      try {
        const data = await apiRequest("/products");
        setProducts(data);
        setError("");
      } catch (requestError) {
        setError(requestError.message || "無法載入商品");
      } finally {
        setLoading(false);
      }
    }

    loadProducts();
  }, []);

  useEffect(() => {
    if (posStep !== 2) {
      return;
    }

    async function loadCustomers() {
      setCustomersLoading(true);
      setCustomersError("");
      try {
        const data = await apiRequest("/customers");
        setCustomers(Array.isArray(data) ? data : []);
      } catch (requestError) {
        setCustomersError(requestError.message || "無法載入客戶資料");
      } finally {
        setCustomersLoading(false);
      }
    }

    loadCustomers();
  }, [posStep]);

  useEffect(() => {
    if (!cartState.carts.length) {
      const defaultCart = createCartDraft(1);
      setCartState({ carts: [defaultCart], activeCartId: defaultCart.id });
      return;
    }

    if (!cartState.carts.some((cart) => cart.id === cartState.activeCartId)) {
      setCartState((current) => ({
        ...current,
        activeCartId: current.carts[0].id
      }));
    }
  }, [cartState.activeCartId, cartState.carts]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(POS_CART_STORAGE_KEY, JSON.stringify(cartState.carts));
      if (cartState.activeCartId) {
        window.localStorage.setItem(POS_ACTIVE_CART_STORAGE_KEY, cartState.activeCartId);
      }
    } catch {
      // ignore storage failures
    }
  }, [cartState.activeCartId, cartState.carts]);

  const productRows = useMemo(
    () =>
      products.map((item) => ({
        ...item,
        categoryLabel: item.categoryLabel || getCategoryLabel(item.category),
        stockTone: getStockTone(item.stock, item.reorderLevel),
        stockLabel: getStockLabel(item.stock, item.reorderLevel)
      })),
    [products]
  );

  const filteredProducts = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    return productRows.filter((item) => {
      if (categoryFilter !== "ALL" && item.category !== categoryFilter) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return `${item.name} ${item.sku} ${item.categoryLabel}`.toLowerCase().includes(keyword);
    });
  }, [categoryFilter, productRows, searchTerm]);

  const cartSessions = cartState.carts;
  const activeCartId = cartState.activeCartId;
  const activeCart = useMemo(
    () => cartSessions.find((cart) => cart.id === activeCartId) || cartSessions[0] || null,
    [activeCartId, cartSessions]
  );
  const filteredCustomers = useMemo(() => {
    const keyword = customerSearch.trim().toLowerCase();
    if (!keyword) {
      return customers;
    }

    return customers.filter((customer) =>
      `${customer.name || ""} ${customer.phone || ""}`.toLowerCase().includes(keyword)
    );
  }, [customerSearch, customers]);

  useEffect(() => {
    const normalizedSearch = customerSearch.trim();
    if (!normalizedSearch || activeCart?.customerId) {
      return;
    }

    const matchedCustomer = customers.find((customer) => customer.phone && customer.phone === normalizedSearch);
    if (matchedCustomer) {
      selectCustomer(matchedCustomer);
    }
  }, [activeCart?.customerId, customerSearch, customers]);

  useEffect(() => {
    const phone = String(activeCart?.customerPhone || "").trim();

    if (!phone || activeCart?.customerId) {
      return;
    }

    const matchedCustomer = customers.find((customer) => customer.phone && customer.phone === phone);

    if (matchedCustomer) {
      selectCustomer(matchedCustomer);
    }
  }, [activeCart?.customerPhone, activeCart?.customerId, customers]);

  useEffect(() => {
    const phone = String(activeCart?.customerPhone || "").trim();
    setCustomerCoupons([]);
    setCouponLookupMessage("");

    if (!phone || phone.length < 6) return;

    let active = true;

    fetch(`/api/coupons/by-phone/${encodeURIComponent(phone)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!active) return;

        const coupons = Array.isArray(data?.coupons) ? data.coupons : [];
        const usableCoupons = coupons.filter((coupon) =>
          !Number(coupon.isUsed || 0) &&
          ["issued", "approved"].includes(String(coupon.status || ""))
        );

        setCustomerCoupons(usableCoupons);

        if (data?.customer && !usableCoupons.length) {
          setCouponLookupMessage("此客戶目前沒有可使用優惠券");
        }
      })
      .catch(() => {
        if (active) setCouponLookupMessage("");
      });

    return () => {
      active = false;
    };
  }, [activeCart?.customerPhone]);


  function updateCartById(cartId, updater) {
    const now = new Date().toISOString();
    setCartState((current) => ({
      ...current,
      carts: current.carts.map((cart) => {
        if (cart.id !== cartId) {
          return cart;
        }

        const nextCart = typeof updater === "function" ? updater(cart) : { ...cart, ...updater };
        return {
          ...nextCart,
          updatedAt: now
        };
      })
    }));
  }

  function updateActiveCart(updater) {
    if (!activeCart) {
      return;
    }

    updateCartById(activeCart.id, updater);
  }

  function setActiveCartId(cartId) {
    setCartState((current) => ({
      ...current,
      activeCartId: cartId
    }));
  }

  function setActiveCartField(field, value) {
    updateActiveCart((cart) => ({
      ...cart,
      [field]: value
    }));
  }

  function addToCart(product) {
    updateActiveCart((cart) => {
      const existing = cart.items.find((item) => item.id === product.id);
      const items = existing
        ? cart.items.map((item) =>
            item.id === product.id ? { ...item, qty: Number(item.qty) + 1 } : item
          )
        : [...cart.items, { ...product, qty: 1 }];

      return {
        ...cart,
        items
      };
    });
  }

  function changeCartQty(productId, delta) {
    updateActiveCart((cart) => ({
      ...cart,
      items: cart.items
        .map((item) =>
          item.id === productId ? { ...item, qty: Math.max(1, Number(item.qty) + delta) } : item
        )
        .filter(Boolean)
    }));
  }

  function removeFromCart(productId) {
    updateActiveCart((cart) => ({
      ...cart,
      items: cart.items.filter((item) => item.id !== productId)
    }));
  }

  function selectCustomer(customer) {
    updateActiveCart((cart) => ({
      ...cart,
      customerId: customer.id || "",
      customerType: normalizeCustomerType(customer.customerType || (customer.lineUserId ? "LINE" : customer.phone ? "OFFLINE_WITH_PHONE" : "OFFLINE_NO_PHONE")),
      customerName: customer.name || "",
      customerPhone: customer.phone || ""
    }));
    setCustomerSearch(customer.phone || customer.name || "");
  }

  async function createCustomer(event) {
    event.preventDefault();
    const name = customerForm.name.trim();
    const phone = customerForm.phone.trim();
    const nextCustomerType = normalizeCustomerType(activeCart?.customerType);

    if (!name) {
      setWarningModal({
        title: "請填寫客戶資料",
        message: "新增客戶需要姓名，電話可選填但建議留下。"
      });
      return;
    }
    if (isPhoneRequiredCustomerType(nextCustomerType) && !phone) {
      setWarningModal({
        title: "請填寫客戶資料",
        message: "此客戶類型需要電話。"
      });
      return;
    }

    setCustomerCreating(true);
    try {
      const customer = await apiRequest("/customers", {
        method: "POST",
        body: JSON.stringify({
          name,
          phone: nextCustomerType === "OFFLINE_NO_PHONE" ? null : phone,
          customerType: nextCustomerType
        })
      });
      setCustomers((current) => {
        if (current.some((item) => Number(item.id) === Number(customer.id))) {
          return current;
        }
        return [customer, ...current];
      });
      setCustomerForm({ name: "", phone: "" });
      selectCustomer(customer);
    } catch (requestError) {
      setWarningModal({
        title: "新增客戶失敗",
        message: requestError.message || "請稍後再試。"
      });
    } finally {
      setCustomerCreating(false);
    }
  }

  function createNewCart() {
    setCartState((current) => {
      const nextCart = createCartDraft(current.carts.length + 1);
      return {
        ...current,
        carts: [...current.carts, nextCart],
        activeCartId: nextCart.id
      };
    });
    setCartManagerOpen(false);
  }

  function renameCart(cartId, value) {
    const cartIndex = cartSessions.findIndex((cart) => cart.id === cartId);
    const fallbackName = `購物車 ${cartIndex >= 0 ? cartIndex + 1 : cartSessions.length + 1}`;
    updateCartById(cartId, (cart) => ({
      ...cart,
      name: value || fallbackName
    }));
  }

  function deleteCart(cartId) {
    const shouldReset = cartSessions.length <= 1;
    const nextCarts = cartSessions.filter((cart) => cart.id !== cartId);
    const normalized = shouldReset ? [createCartDraft(1)] : nextCarts;

    setCartState((current) => ({
      carts: normalized,
      activeCartId: normalized.some((cart) => cart.id === current.activeCartId)
        ? current.activeCartId
        : normalized[0].id
    }));
    setCartManagerOpen(false);
  }

  async function submitOrder() {
    if (!activeCart || !activeCart.items.length) {
      setWarningModal({
        title: "無法完成訂單",
        message: "請先選擇商品，再完成訂單。"
      });
      return;
    }

    const activeCustomerType = normalizeCustomerType(activeCart.customerType);
    if (!activeCart.customerName.trim()) {
      setWarningModal({
        title: "請填寫客戶資料",
        message: "請先填寫客戶姓名。"
      });
      return;
    }
    if (isPhoneRequiredCustomerType(activeCustomerType) && !activeCart.customerPhone.trim()) {
      setWarningModal({
        title: "請填寫客戶資料",
        message: "此客戶類型需要電話。"
      });
      return;
    }
    const hasEbike = activeCart.items.some((item) => item.category === "EB");
    if (activeCustomerType === "LINE" && hasEbike && (!activeCart.customerPhone.trim() || !activeCart.items.length)) {
      setWarningModal({
        title: "請先完成必要確認",
        message: "請先確認客戶電話與訂單內容，再完成訂單。"
      });
      return;
    }

    try {
      const data = await apiRequest("/orders", {
        method: "POST",
        body: JSON.stringify({
          customer_name: activeCart.customerName,
          customer_phone: activeCustomerType === "OFFLINE_NO_PHONE" ? null : activeCart.customerPhone,
          customerId: activeCart.customerId || undefined,
          customerType: activeCustomerType,
          paymentMethod: activeCart.paymentMethod,
          isReservationOrder: Boolean(activeCart.isReservationOrder),
          depositAmount: activeCart.depositAmount === "" ? 0 : Number(activeCart.depositAmount || 0),
          unpaidBalance: activeCart.unpaidBalance === "" ? undefined : Number(activeCart.unpaidBalance || 0),
          finalPaymentStatus: activeCart.finalPaymentStatus || "PAID",
          couponCode: activeCart.couponCode || "",
          couponAmount: Number(activeCart.couponAmount || 0),
          notes: activeCart.notes,
          items: activeCart.items.map((item) => ({
            product_id: item.id,
            qty: item.qty
          }))
        })
      });

      updateActiveCart((cart) => ({
        ...cart,
        items: [],
        customerType: "LINE",
        customerName: "",
        customerPhone: "",
        customerId: "",
        notes: "",
        customAmount: "",
        shippingFee: "",
        couponCode: "",
        couponAmount: "",
        paymentMethod: "CASH",
        isReservationOrder: false,
        depositAmount: "",
        unpaidBalance: "",
        finalPaymentStatus: "PAID"
      }));
      setSuccessModal(data);
      setPosStep(1);
    } catch (requestError) {
      alert(requestError.message || "建立訂單失敗");
    }
  }

  const subtotalPrice = (activeCart?.items || []).reduce(
    (sum, item) => sum + Number(item.price) * Number(item.qty),
    0
  );
  const shippingFee = Number(activeCart?.shippingFee || 0);
  const customAmount = Number(activeCart?.customAmount || 0);
  const couponAmount = Number(activeCart?.couponAmount || 0);
  const totalPrice = Math.max(0, subtotalPrice + shippingFee + customAmount - couponAmount);
  const cartQty = (activeCart?.items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const hasEbikeInCart = (activeCart?.items || []).some((item) => item.category === "EB");
  const posSteps = [
    { number: 1, title: "商品", tone: activeCart?.items.length ? "green" : "blue" },
    { number: 2, title: "客戶", tone: activeCart?.customerName && (!isPhoneRequiredCustomerType(activeCart?.customerType) || activeCart?.customerPhone) ? "green" : posStep === 2 ? "blue" : "yellow" },
    { number: 3, title: "付款", tone: posStep === 3 ? "blue" : posStep > 3 ? "green" : "yellow" },
    { number: 4, title: "確認", tone: posStep === 4 ? "blue" : "yellow" }
  ];

  function showStepRequired(stepName) {
    setWarningModal({
      title: "請依照 POS 步驟",
      message: `請先完成上一個步驟：${stepName}`
    });
  }

  function goToPosStep(nextStep) {
    if (nextStep > 1 && !(activeCart?.items.length)) {
      showStepRequired("選擇商品");
      return;
    }
    if (nextStep > 2 && !activeCart?.customerName?.trim()) {
      showStepRequired("客戶資料");
      return;
    }
    if (nextStep > 2 && isPhoneRequiredCustomerType(activeCart?.customerType) && !activeCart?.customerPhone?.trim()) {
      showStepRequired("客戶電話");
      return;
    }
    setPosStep(nextStep);
    setMobileCartOpen(false);
  }

  const wizardProgress = (
    <div className="wizard-progress">
      {posSteps.map((step) => (
        <button
          key={step.number}
          type="button"
          className={`wizard-step-card wizard-step-${step.tone}${posStep === step.number ? " wizard-step-active" : ""}`}
          onClick={() => goToPosStep(step.number)}
        >
          <span>Step {step.number}</span>
          <strong>{step.title}</strong>
        </button>
      ))}
    </div>
  );

  function focusSearch() {
    searchInputRef.current?.focus();
  }

  function focusCustomer() {
    customerNameRef.current?.focus();
  }

  function focusCheckout() {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches) {
      setMobileCartOpen(true);
      return;
    }

    checkoutRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const cartHeader = (
    <div className="pos-cart-switcher-shell">
      <AdminSectionHeader
        eyebrow="購物車"
        title="訂單內容"
        description="右側固定顯示顧客資訊、購物車內容與結帳操作。"
      />
      <div className="pos-cart-switcher-row">
        <div className="pos-cart-switcher-track" aria-label="購物車切換">
          {cartSessions.map((cart, index) => {
            const isActive = cart.id === activeCartId;
            return (
              <button
                key={cart.id}
                type="button"
                className={`pos-cart-switcher-pill ${isActive ? "pos-cart-switcher-pill-active" : ""}`}
                onClick={() => setActiveCartId(cart.id)}
              >
                <span className="pos-cart-switcher-pill-name">{cart.name || `購物車 ${index + 1}`}</span>
                <span className="pos-cart-switcher-pill-count">{cart.items.length} 項</span>
              </button>
            );
          })}
          <button type="button" className="pos-cart-switcher-pill pos-cart-switcher-pill-add" onClick={createNewCart}>
            + 新增
          </button>
        </div>
        <button type="button" className="secondary-button pos-cart-manager-button" onClick={() => setCartManagerOpen(true)}>
          管理
        </button>
      </div>
    </div>
  );

  const cartItemsContent = (
    <>
      <div className="pos-cart-body">
        <div className="pos-cart-scroll">
          <div className="pos-cart-content-scroll">
            {activeCart?.items.length === 0 ? <div className="empty-state">請先從左側選擇商品。</div> : null}
            {activeCart?.items.length > 0 ? (
              <div className="cart-list">
                {activeCart.items.map((item) => (
                  <div key={item.id} className="cart-row">
                    <div className="cart-row-copy">
                      <div className="identity-title">{item.name}</div>
                      <div className="identity-subtitle">{item.sku}</div>
                    </div>
                    <div className="cart-row-actions">
                      <div className="cart-row-price">
                        <strong>{formatCurrency(Number(item.price) * Number(item.qty))}</strong>
                        <span className="muted-text">{item.qty} 件</span>
                      </div>
                      <div className="cart-stepper">
                        <button type="button" className="secondary-button" onClick={() => changeCartQty(item.id, -1)}>
                          -
                        </button>
                        <button type="button" className="secondary-button" onClick={() => changeCartQty(item.id, 1)}>
                          +
                        </button>
                        <button type="button" className="secondary-button" onClick={() => removeFromCart(item.id)}>
                          移除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );

  const cartTotals = (
      <div className="pos-cart-footer">
        <div className="pos-cart-total pos-cart-total-stack">
          <div className="pos-cart-total-row">
            <span>小計</span>
            <strong>{formatCurrency(subtotalPrice)}</strong>
          </div>
          <div className="pos-cart-total-row">
            <span>總計</span>
            <strong>{formatCurrency(totalPrice)}</strong>
          </div>
        </div>
        {posStep === 1 ? (
          <div className="pos-floating-next">
            <button
              type="button"
              className="primary-button inline-submit"
              onClick={() => goToPosStep(2)}
              disabled={!activeCart?.items.length}
              style={{ width: "100%" }}
            >
              下一步
            </button>
          </div>
        ) : null}
      </div>
  );

  const cartOnlyContent = (
    <>
      {cartItemsContent}
      {cartTotals}
    </>
  );

  const posMainStepContent = (
    <>
      {posStep === 2 ? (
        <section className="admin-panel pos-main-step wizard-panel wizard-panel-blue">
          <AdminSectionHeader eyebrow="Step 2" title="客戶資料" description="選擇 LINE 客戶或一般客戶。一般客戶姓名必填，電話可選填但建議留下。" />
          <label className="form-field">
            <span>客戶類型</span>
            <select
              value={normalizeCustomerType(activeCart?.customerType)}
              onChange={(event) => updateActiveCart((cart) => ({
                ...cart,
                customerType: event.target.value,
                customerPhone: event.target.value === "OFFLINE_NO_PHONE" ? "" : cart.customerPhone
              }))}
            >
              <option value="LINE">LINE 客戶</option>
              <option value="OFFLINE_WITH_PHONE">一般客戶（有電話）</option>
              <option value="OFFLINE_NO_PHONE">一般客戶（無電話）</option>
            </select>
          </label>
          <div className="grid-form compact-grid">
            <label className="form-field">
              <span>顧客姓名</span>
              <input
                ref={customerNameRef}
                value={activeCart?.customerName || ""}
                onChange={(event) => setActiveCartField("customerName", event.target.value)}
                placeholder="請輸入姓名"
              />
            </label>
            {normalizeCustomerType(activeCart?.customerType) !== "OFFLINE_NO_PHONE" ? (
            <label className="form-field">
              <span>{isOfflineCustomerType(activeCart?.customerType) ? "顧客電話" : "顧客電話"}</span>
              <input
                value={activeCart?.customerPhone || ""}
                onChange={(event) => setActiveCartField("customerPhone", event.target.value)}
                placeholder="請輸入電話"
              />
            </label>
            ) : null}
          </div>
          <label className="form-field">
            <span>電話 / 姓名搜尋</span>
            <input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="輸入電話可自動帶入既有客戶" />
          </label>
          {customersLoading ? <div className="loading-state">載入客戶資料中...</div> : null}
          {customersError ? <div className="error-banner">{customersError}</div> : null}
          {!customersLoading && !customersError ? (
            filteredCustomers.length ? (
              <div className="pos-customer-list">
                {filteredCustomers.map((customer) => (
                  <article key={customer.id} className="pos-customer-card">
                    <div className="pos-customer-copy">
                      <strong>{customer.name || "未命名客戶"}</strong>
                      <span>{customer.phone || "未留電話"}</span>
                      <StatusBadge tone={isOfflineCustomerType(customer.customerType || (customer.lineUserId ? "LINE" : customer.phone ? "OFFLINE_WITH_PHONE" : "OFFLINE_NO_PHONE")) ? "neutral" : "info"}>
                        {CUSTOMER_TYPE_LABELS[normalizeCustomerType(customer.customerType || (customer.lineUserId ? "LINE" : customer.phone ? "OFFLINE_WITH_PHONE" : "OFFLINE_NO_PHONE"))]}
                      </StatusBadge>
                      {Number(customer.visitCount || 0) >= 5 ? <StatusBadge tone="success">VIP</StatusBadge> : Number(customer.visitCount || 0) >= 3 ? <StatusBadge tone="warning">常客</StatusBadge> : null}
                    </div>
                    <button type="button" className="secondary-button compact-detail-button" onClick={() => selectCustomer(customer)}>
                      選擇
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">尚無客戶資料</div>
            )
          ) : null}
          <form className="pos-customer-create" onSubmit={createCustomer}>
            <div className="section-title">
  新增一般客戶（相同電話將自動合併）
</div>
            <div className="grid-form compact-grid">
              <label className="form-field">
                <span>姓名</span>
                <input value={customerForm.name} onChange={(event) => setCustomerForm((current) => ({ ...current, name: event.target.value }))} placeholder="請輸入姓名" />
              </label>
              {normalizeCustomerType(activeCart?.customerType) !== "OFFLINE_NO_PHONE" ? (
              <label className="form-field">
                <span>電話</span>
                <input value={customerForm.phone} onChange={(event) => setCustomerForm((current) => ({ ...current, phone: event.target.value }))} placeholder="請輸入電話" />
              </label>
              ) : null}
            </div>
            <button type="submit" className="primary-button inline-submit" disabled={customerCreating}>
              {customerCreating ? "新增中..." : "新增客戶"}
            </button>
          </form>
          <label className="form-field">
            <span>備註</span>
            <textarea value={activeCart?.notes || ""} onChange={(event) => setActiveCartField("notes", event.target.value)} rows="3" placeholder="選填" />
          </label>
          <div className="wizard-actions">
            <button type="button" className="secondary-button" onClick={() => setPosStep(1)}>上一步</button>
            <button ref={checkoutRef} type="button" className="primary-button inline-submit" onClick={() => goToPosStep(3)} disabled={!activeCart?.customerName?.trim() || (isPhoneRequiredCustomerType(activeCart?.customerType) && !activeCart?.customerPhone?.trim())}>下一步</button>
          </div>
        </section>
      ) : null}

      {posStep === 3 ? (
        <section className="admin-panel pos-main-step wizard-panel wizard-panel-blue">
          <AdminSectionHeader eyebrow="Step 3" title="付款" description="確認付款方式、訂金、尾款與完款狀態。" />
          <div className="grid-form compact-grid">
            <label className="form-field">
              <span>訂單類型</span>
              <select value={activeCart?.isReservationOrder ? "1" : "0"} onChange={(event) => setActiveCartField("isReservationOrder", event.target.value === "1")}>
                <option value="0">一般訂單</option>
                <option value="1">預約單</option>
              </select>
            </label>
            <label className="form-field">
              <span>付款方式</span>
              <select value={activeCart?.paymentMethod || "CASH"} onChange={(event) => setActiveCartField("paymentMethod", event.target.value)}>
                <option value="CASH">現金</option>
                <option value="CARD">信用卡</option>
                <option value="LINE_PAY">LINE Pay</option>
                <option value="TRANSFER">轉帳</option>
                <option value="OTHER">其他</option>
              </select>
            </label>
            <label className="form-field">
              <span>訂金</span>
              <input type="number" min="0" value={activeCart?.depositAmount || ""} onChange={(event) => setActiveCartField("depositAmount", event.target.value)} placeholder="0" />
            </label>
            <label className="form-field">
              <span>未付款金額</span>
              <input type="number" min="0" value={activeCart?.unpaidBalance || ""} onChange={(event) => setActiveCartField("unpaidBalance", event.target.value)} placeholder="留空由系統計算" />
            </label>
            {customerCoupons.length ? (
              <div className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span>可使用優惠券</span>
                <div style={{ display: "grid", gap: 10 }}>
                  {customerCoupons.map((coupon) => (
                    <button
                      key={coupon.id}
                      type="button"
                      className="secondary-button"
                      style={{
                        border: String(activeCart?.couponCode || "").split(",").map((v) => v.trim()).includes(coupon.code)
                          ? "2px solid #16a34a"
                          : undefined,
                        background: String(activeCart?.couponCode || "").split(",").map((v) => v.trim()).includes(coupon.code)
                          ? "#dcfce7"
                          : undefined,
                        color: String(activeCart?.couponCode || "").split(",").map((v) => v.trim()).includes(coupon.code)
                          ? "#166534"
                          : undefined,
                        fontWeight: 900
                      }}
                      onClick={() => {
                        const currentCodes = String(activeCart?.couponCode || "")
                          .split(",")
                          .map((v) => v.trim())
                          .filter(Boolean);

                        const exists = currentCodes.includes(coupon.code);

                        const nextCodes = exists
                          ? currentCodes.filter((code) => code !== coupon.code)
                          : [...currentCodes, coupon.code];

                        const totalAmount = customerCoupons
                          .filter((item) => nextCodes.includes(item.code))
                          .reduce((sum, item) => sum + Number(item.amount || 0), 0);

                        setActiveCartField("couponCode", nextCodes.join(","));
                        setActiveCartField("couponAmount", totalAmount);
                      }}
                    >
                      {coupon.couponType === "google_review" ? "Google 評論優惠" : "新朋友優惠"}
                      {" / "}
                      {coupon.code}
                      {" / NT$ "}
                      {Number(coupon.amount || 0).toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>
            ) : couponLookupMessage ? (
              <div className="muted-text" style={{ gridColumn: "1 / -1" }}>
                {couponLookupMessage}
              </div>
            ) : null}

            <label className="form-field">
              <span>優惠券</span>
              <input
                value={activeCart?.couponCode || ""}
                onChange={(event) => setActiveCartField("couponCode", event.target.value)}
                placeholder="選填"
              />
            </label>

            <label className="form-field">
              <span>優惠金額</span>
              <input
                type="number"
                min="0"
                step="1"
                value={activeCart?.couponAmount || ""}
                onChange={(event) => setActiveCartField("couponAmount", event.target.value)}
                placeholder="選填"
              />
            </label>

            <label className="form-field">
              <span>完款狀態</span>
              <select value={activeCart?.finalPaymentStatus || "PAID"} onChange={(event) => setActiveCartField("finalPaymentStatus", event.target.value)}>
                <option value="PAID">已完款</option>
                <option value="PARTIAL">部分付款</option>
                <option value="UNPAID">未付款</option>
              </select>
            </label>
          </div>
          <div className="wizard-actions">
            <button type="button" className="secondary-button" onClick={() => setPosStep(2)}>上一步</button>
            <button ref={checkoutRef} type="button" className="primary-button inline-submit" onClick={() => goToPosStep(4)}>下一步</button>
          </div>
        </section>
      ) : null}

      {posStep === 4 ? (
        <section className="admin-panel pos-main-step wizard-panel wizard-panel-green">
          <AdminSectionHeader eyebrow="Step 4" title="確認訂單" description="最後確認商品、客戶與付款狀態後建立訂單。" />
          <div className="sop-summary-box">
            <div><strong>客戶類型</strong><span>{CUSTOMER_TYPE_LABELS[normalizeCustomerType(activeCart?.customerType)]}</span></div>
            <div><strong>客戶</strong><span>{activeCart?.customerName || "未填"} / {activeCart?.customerPhone || "未留電話"}</span></div>
            <div><strong>商品</strong><span>{activeCart?.items.length || 0} 項 / {cartQty} 件</span></div>
            <div><strong>金額</strong><span>{formatCurrency(totalPrice)}</span></div>
            <div><strong>付款狀態</strong><span>{activeCart?.finalPaymentStatus === "PAID" ? "已完款" : activeCart?.finalPaymentStatus === "PARTIAL" ? "部分付款" : "未付款"}</span></div>
            <div><strong>購買確認書</strong><span>{hasEbikeInCart ? (isOfflineCustomerType(activeCart?.customerType) ? "一般客戶不自動發送 LINE" : "購買確認書將於完成付款後發送") : "不需要"}</span></div>
          </div>
          <button type="button" className="secondary-button inline-submit" onClick={() => setDetailsOpen(true)}>
            查看詳情
          </button>
          <div className="wizard-actions">
            <button type="button" className="secondary-button" onClick={() => setPosStep(3)}>上一步</button>
            <button ref={checkoutRef} type="button" className="primary-button inline-submit" onClick={submitOrder}>
              {activeCart?.finalPaymentStatus === "PAID" ? "完成付款" : "建立訂單"}
            </button>
          </div>
        </section>
      ) : null}
    </>
  );

  return (
    <div>
      <PageHeader
        title="POS"
        description="Step 1 到 Step 4 一次只處理一件事，依序完成商品、客戶、付款與確認。"
      />

      <div className="pos-fullscreen-header">
        {new URLSearchParams(window.location.search).get("fullscreen") === "1" ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => window.location.href = "/pos"}
          >
            返回一般模式
          </button>
        ) : (
          <button
            type="button"
            className="primary-button"
            onClick={() => window.location.href = "/pos?fullscreen=1"}
          >
            POS專用頁面
          </button>
        )}
      </div>

      <div className="pos-page-shell">
        {wizardProgress}

        <div className="pos-layout">
          {posStep === 1 ? (
          <section className="admin-panel pos-browser wizard-panel wizard-panel-blue">
          <AdminSectionHeader
            eyebrow="Step 1"
            title="選擇商品"
            description="搜尋商品、確認價格與庫存，加入購物車後才能進入下一步。"
          />
          <div className="pos-browser-scroll">
            <FilterBar compact>
              <label className="form-field">
                <span>搜尋商品</span>
                <input
                  ref={searchInputRef}
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="商品名稱 / SKU / 類別"
                />
              </label>
              <label className="form-field">
                <span>類別</span>
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                  <option value="ALL">全部類別</option>
                  {PRODUCT_CATEGORY_OPTIONS.map(({ key, label }) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </FilterBar>

            {loading ? <div className="loading-state">載入商品中...</div> : null}
            {error ? <div className="error-banner">{error}</div> : null}

            {!loading && !error ? (
              filteredProducts.length ? (
                <div className="pos-product-grid">
                  {filteredProducts.map((product) => (
                    <article key={product.id} className="pos-product-card">
                      <div className="pos-product-media">
                        <ProductImage src={product.imageUrl} alt={product.name} />
                        <div className="identity-copy">
                          <div className="identity-title">{product.name}</div>
                          <div className="identity-subtitle">
                            {product.sku} / {product.categoryLabel}
                          </div>
                        </div>
                      </div>
                      <div className="pos-product-meta">
                        <StatusBadge tone={product.stockTone}>{product.stockLabel}</StatusBadge>
                        <div className="pos-product-price">{formatCurrency(product.price)}</div>
                        <div className="muted-text">庫存 {Number(product.stock || 0)}</div>
                      </div>
                      <button type="button" className="primary-button pos-add-button" onClick={() => addToCart(product)}>
                        加入購物車
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">沒有符合條件的商品。</div>
              )
            ) : null}

          </div>
          </section>
          ) : null}
          {posMainStepContent}

          <aside className={`admin-panel pos-cart-panel ${posStep === 1 ? "pos-cart-panel-step-one" : ""}`}>
          <div className="pos-desktop-cart-shell">
            {cartHeader}
            {cartOnlyContent}
          </div>
          <div className="pos-mobile-cart-summary">
            <div className="pos-mobile-cart-summary-copy">
              <div className="pos-mobile-cart-summary-title">{activeCart?.name || "目前購物車"}</div>
              <div className="pos-mobile-cart-summary-subtitle">
                {activeCart?.items.length || 0} 項 / {formatCurrency(totalPrice)}
              </div>
            </div>
            <button type="button" className="primary-button pos-mobile-cart-open-button" onClick={() => setMobileCartOpen(true)}>
              查看購物車 / 結帳
            </button>
          </div>
          </aside>
        </div>
      </div>

      <DetailModal
        open={detailsOpen}
        title="訂單詳情"
        subtitle="非必要欄位集中在這裡，避免影響結帳 SOP。"
        onClose={() => setDetailsOpen(false)}
      >
        <div className="grid-form compact-grid">
          <label className="form-field">
            <span>備註</span>
            <textarea
              ref={notesRef}
              value={activeCart?.notes || ""}
              onChange={(event) => setActiveCartField("notes", event.target.value)}
              rows="3"
              placeholder="選填"
            />
          </label>
          <label className="form-field">
            <span>自訂金額</span>
            <input
              type="number"
              min="0"
              step="1"
              value={activeCart?.customAmount || ""}
              onChange={(event) => setActiveCartField("customAmount", event.target.value)}
              placeholder="選填"
            />
          </label>
          <label className="form-field">
            <span>運費</span>
            <input
              type="number"
              min="0"
              step="1"
              value={activeCart?.shippingFee || ""}
              onChange={(event) => setActiveCartField("shippingFee", event.target.value)}
              placeholder="選填"
            />
          </label>
          <label className="form-field">
            <span>優惠券</span>
            <input
              value={activeCart?.couponCode || ""}
              onChange={(event) => setActiveCartField("couponCode", event.target.value)}
              placeholder="選填"
            />
          </label>
          <label className="form-field">
            <span>優惠金額</span>
            <input
              type="number"
              min="0"
              step="1"
              value={activeCart?.couponAmount || ""}
              onChange={(event) => setActiveCartField("couponAmount", event.target.value)}
              placeholder="選填"
            />
          </label>
        </div>
      </DetailModal>

      <ActionModal
        open={Boolean(warningModal)}
        tone="warning"
        title={warningModal?.title}
        message={warningModal?.message}
        onConfirm={() => setWarningModal(null)}
      />
      <ActionModal
        open={Boolean(successModal)}
        tone="success"
        title="訂單已建立"
        message={successModal ? `訂單 ${successModal.orderNo || ""} 已完成建立。` : ""}
        confirmText="新增下一筆"
        cancelText="查看訂單"
        onCancel={() => {
          setSuccessModal(null);
          navigate("/orders");
        }}
        onConfirm={() => {
          setSuccessModal(null);
          setPosStep(1);
        }}
      />

      <DetailModal
        open={cartManagerOpen}
        title="切換購物車"
        subtitle="可新增、切換、重新命名或刪除購物車。"
        onClose={() => setCartManagerOpen(false)}
      >
        <div className="cart-manager-list">
          {cartSessions.map((cart, index) => {
            const isActive = cart.id === activeCartId;
            return (
              <div key={cart.id} className={`cart-manager-item ${isActive ? "cart-manager-item-active" : ""}`}>
                <div className="cart-manager-item-header">
                  <button type="button" className="secondary-button" onClick={() => setActiveCartId(cart.id)}>
                    {isActive ? "目前使用中" : "切換到這個"}
                  </button>
                  <div className="cart-manager-item-meta">
                    <span>{cart.items.length} 項</span>
                    <span>{formatCurrency(cart.items.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0))}</span>
                  </div>
                </div>
                <label className="form-field">
                  <span>購物車名稱</span>
                  <input
                    value={cart.name || `購物車 ${index + 1}`}
                    onChange={(event) => renameCart(cart.id, event.target.value)}
                  />
                </label>
                <div className="cart-manager-item-summary muted-text">
                  顧客：{cart.customerName || "未填"} / {cart.customerPhone || "未填"}
                </div>
                <div className="cart-manager-item-actions">
                  <button type="button" className="secondary-button" onClick={() => setActiveCartId(cart.id)}>
                    設為目前購物車
                  </button>
                  <button type="button" className="secondary-button" onClick={() => deleteCart(cart.id)}>
                    刪除
                  </button>
                </div>
              </div>
            );
          })}
          <button type="button" className="primary-button" onClick={createNewCart}>
            + 新增購物車
          </button>
        </div>
      </DetailModal>

      <DetailModal
        open={mobileCartOpen}
        title="購物車 / 結帳"
        subtitle="確認商品與金額，下一步回到 POS 主畫面填寫客戶。"
        onClose={() => setMobileCartOpen(false)}
      >
        <div className="pos-mobile-cart-sheet">
          {cartOnlyContent}
          <div className="wizard-actions">
            <button type="button" className="secondary-button" onClick={() => setMobileCartOpen(false)}>
              關閉
            </button>
            <button type="button" className="primary-button" onClick={() => goToPosStep(2)} disabled={!activeCart?.items.length}>
              前往下一步
            </button>
          </div>
        </div>
      </DetailModal>
    </div>
  );
}

export default POSPage;
