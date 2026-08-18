import { useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "../components/PageHeader";
import ProductImage from "../components/ProductImage";
import StatusBadge from "../components/StatusBadge";
import { apiRequest } from "../lib/api";

const EMPTY_GROUP_FORM = {
  code: "",
  label: "",
  description: "",
  isRequired: false,
  minSelect: 0,
  maxSelect: 1,
  sortOrder: 0,
  isActive: true
};

const CATEGORY_LABELS = {
  EB: "電動自行車",
  EBIKE: "電動自行車",
  PT: "配件",
  ACCESSORY: "配件",
  RP: "維修",
  REPAIR: "維修",
  OTHER: "其他"
};

const PRODUCT_SEARCH_LIMIT = 30;

function money(value) {
  const amount = Number(value || 0);
  return `NT$ ${amount.toLocaleString()}`;
}

function toBooleanValue(event) {
  return event.target.type === "checkbox" ? event.target.checked : event.target.value;
}

function categoryLabel(category, fallback) {
  return fallback || CATEGORY_LABELS[category] || category || "其他";
}

function nextSortOrder(products = []) {
  const maxSort = products.reduce((max, product) => Math.max(max, Number(product.sortOrder || 0)), 0);
  return maxSort + 10;
}

function hasCustomPrice(product) {
  return product.customPrice !== null && product.customPrice !== undefined;
}

function effectiveProductPrice(product) {
  return hasCustomPrice(product) ? Number(product.customPrice || 0) : Number(product.basePrice ?? product.price ?? 0);
}

function formatPriceInput(value) {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  return String(value);
}

function parseLineOrderPrice(value) {
  const text = String(value || "").trim();
  if (!text) return { ok: true, customPrice: null };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return { ok: false, message: "LINE訂購價只能輸入 0 以上數字，且最多 2 位小數" };
  }
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0 || amount > 9999999999.99) {
    return { ok: false, message: "LINE訂購價超出可儲存範圍" };
  }
  return { ok: true, customPrice: amount };
}

function buildProductSearchPath({ q, category, inStock, hideLinked, groupId, offset }) {
  const params = new URLSearchParams();
  const query = String(q || "").trim();
  if (query) params.set("q", query);
  if (category) params.set("category", category);
  params.set("inStock", inStock ? "true" : "false");
  if (hideLinked) params.set("excludeGroupId", String(groupId));
  params.set("limit", String(PRODUCT_SEARCH_LIMIT));
  params.set("offset", String(offset || 0));
  return `/line-order-options/products?${params.toString()}`;
}

function OptionGroupEditor({ group, busy, onEdit, onDelete, onLinkProduct, onUpdateProduct, onRemoveProduct }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [inStock, setInStock] = useState(true);
  const [hideLinked, setHideLinked] = useState(true);
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState({ items: [], total: 0, limit: PRODUCT_SEARCH_LIMIT, offset: 0, categories: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [priceInputs, setPriceInputs] = useState({});
  const [priceMessages, setPriceMessages] = useState({});
  const requestIdRef = useRef(0);

  const linkedProducts = useMemo(
    () => [...(group.products || [])].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || Number(a.linkId || 0) - Number(b.linkId || 0)),
    [group.products]
  );
  const linkedProductIds = useMemo(() => new Set(linkedProducts.map((product) => Number(product.productId))), [linkedProducts]);
  const canLoadMore = Number(result.offset || 0) + Number(result.items?.length || 0) < Number(result.total || 0);

  useEffect(() => {
    setPriceInputs((current) => {
      const next = {};
      linkedProducts.forEach((product) => {
        const key = String(product.linkId);
        next[key] = Object.prototype.hasOwnProperty.call(current, key)
          ? current[key]
          : formatPriceInput(product.customPrice);
      });
      return next;
    });
  }, [linkedProducts]);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const timer = window.setTimeout(async () => {
      try {
        setLoading(true);
        setError("");
        const response = await apiRequest(buildProductSearchPath({ q: query, category, inStock, hideLinked, groupId: group.id, offset }), {
          signal: controller.signal
        });
        if (requestIdRef.current !== requestId) return;
        setResult((current) => {
          const nextItems = Array.isArray(response.items) ? response.items : [];
          const nextOffset = Number(response.offset || 0);
          return {
            items: nextOffset > 0 ? [...(current.items || []), ...nextItems] : nextItems,
            total: Number(response.total || 0),
            limit: Number(response.limit || PRODUCT_SEARCH_LIMIT),
            offset: nextOffset,
            categories: Array.isArray(response.categories) ? response.categories : []
          };
        });
      } catch (err) {
        if (err?.name === "AbortError" || requestIdRef.current !== requestId) return;
        setError(err?.message || "商品搜尋失敗");
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    }, 320);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, category, inStock, hideLinked, offset, group.id, refreshKey]);

  function resetOffsetAnd(action) {
    setOffset(0);
    action();
  }

  async function linkProduct(product) {
    await onLinkProduct(group, product);
    setRefreshKey((current) => current + 1);
  }

  async function removeProduct(product) {
    await onRemoveProduct(group.id, product.linkId);
    setRefreshKey((current) => current + 1);
  }

  function getPriceInput(product) {
    const key = String(product.linkId);
    return Object.prototype.hasOwnProperty.call(priceInputs, key) ? priceInputs[key] : formatPriceInput(product.customPrice);
  }

  function updatePriceInput(product, value) {
    const key = String(product.linkId);
    setPriceInputs((current) => ({ ...current, [key]: value }));
    setPriceMessages((current) => ({ ...current, [key]: "" }));
  }

  async function saveProductPrice(product, customPrice, successMessage) {
    const key = String(product.linkId);
    try {
      setPriceMessages((current) => ({ ...current, [key]: "" }));
      await onUpdateProduct(group.id, product, customPrice);
      setPriceInputs((current) => ({ ...current, [key]: formatPriceInput(customPrice) }));
      setPriceMessages((current) => ({ ...current, [key]: successMessage }));
    } catch (err) {
      setPriceMessages((current) => ({ ...current, [key]: err?.message || "LINE訂購價儲存失敗" }));
    }
  }

  async function savePriceFromInput(product) {
    const parsed = parseLineOrderPrice(getPriceInput(product));
    if (!parsed.ok) {
      setPriceMessages((current) => ({ ...current, [String(product.linkId)]: parsed.message }));
      return;
    }
    await saveProductPrice(product, parsed.customPrice, "LINE訂購價已更新");
  }

  async function resetProductPrice(product) {
    await saveProductPrice(product, null, "已恢復使用商品售價");
  }

  return (
    <article className="option-admin-group">
      <div className="option-admin-group-head">
        <div>
          <strong>{group.code} / {group.label}</strong>
          <span>{group.isRequired ? "必填" : "選填"}，{group.minSelect} 到 {group.maxSelect || "不限"} 項</span>
        </div>
        <div className="compact-actions">
          <StatusBadge tone={group.isActive ? "success" : "neutral"}>{group.isActive ? "啟用" : "停用"}</StatusBadge>
          <button type="button" className="secondary-button" onClick={() => onEdit(group)}>編輯</button>
          <button type="button" className="danger-button" onClick={() => onDelete(group)} disabled={busy === `group-delete-${group.id}`}>刪除</button>
        </div>
      </div>

      <div className="option-product-search-panel">
        <div className="option-product-search-head">
          <div>
            <h3>搜尋商品</h3>
            <span>連結到：{group.label}</span>
          </div>
          <StatusBadge tone="neutral">最多顯示 {PRODUCT_SEARCH_LIMIT} 筆</StatusBadge>
        </div>
        <div className="option-product-search-controls">
          <label className="form-field option-product-search-input">
            <span>商品搜尋</span>
            <div className="option-search-input-row">
              <input
                value={query}
                onChange={(event) => resetOffsetAnd(() => setQuery(event.target.value))}
                placeholder="搜尋商品名稱或 SKU"
              />
              {query ? <button type="button" className="secondary-button" onClick={() => resetOffsetAnd(() => setQuery(""))}>清除</button> : null}
            </div>
          </label>
          <label className="form-field">
            <span>分類</span>
            <select value={category} onChange={(event) => resetOffsetAnd(() => setCategory(event.target.value))}>
              <option value="">全部分類</option>
              {result.categories.map((item) => (
                <option key={item.value} value={item.value}>{categoryLabel(item.value, item.label)}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="option-product-filter-row">
          <label className="checkbox-row">
            <input type="checkbox" checked={inStock} onChange={(event) => resetOffsetAnd(() => setInStock(event.target.checked))} />
            <span>只顯示有庫存</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={hideLinked} onChange={(event) => resetOffsetAnd(() => setHideLinked(event.target.checked))} />
            <span>隱藏已連結商品</span>
          </label>
        </div>
        {error ? <div className="notice-card danger">{error}</div> : null}
        {loading ? <div className="muted-text">商品搜尋中...</div> : null}
        {!loading && !error && result.items.length === 0 ? <div className="empty-state">找不到符合條件的商品</div> : null}
        <div className="option-product-result-list">
          {result.items.map((product) => {
            const isLinked = product.isLinkedToGroup || linkedProductIds.has(Number(product.productId || product.id));
            const outOfStock = Number(product.stock || 0) <= 0;
            return (
              <div key={product.id} className="option-product-result-card">
                <ProductImage src={product.imageUrl} alt={product.name} className="option-product-thumb" fallbackLabel="無圖" />
                <div className="option-product-result-body">
                  <div className="option-product-result-title">
                    <strong>{product.name}</strong>
                    <span>{product.sku || "無 SKU"}</span>
                  </div>
                  <div className="option-product-meta-row">
                    <span>{categoryLabel(product.category, product.categoryLabel)}</span>
                    <span>{money(product.price)}</span>
                    <span>庫存 {Number(product.stock || 0)}</span>
                    {outOfStock ? <StatusBadge tone="warning">缺貨</StatusBadge> : null}
                  </div>
                  <div className="muted-text">連結到：{group.label}</div>
                </div>
                {isLinked ? (
                  <button type="button" className="secondary-button" disabled>已連結</button>
                ) : (
                  <button type="button" className="primary-button" onClick={() => linkProduct(product)} disabled={outOfStock || busy === `product-${group.id}-${product.id}`}>
                    連結
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {canLoadMore ? (
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={() => setOffset(Number(result.offset || 0) + PRODUCT_SEARCH_LIMIT)} disabled={loading}>更多</button>
          </div>
        ) : null}
      </div>

      <div className="option-linked-products-section">
        <h3>已連結商品（{linkedProducts.length}）</h3>
        <div className="option-linked-products">
          {linkedProducts.map((product) => {
            const customPriceSet = hasCustomPrice(product);
            const parsedPreview = parseLineOrderPrice(getPriceInput(product));
            const effectivePrice = parsedPreview.ok
              ? parsedPreview.customPrice !== null ? parsedPreview.customPrice : Number(product.basePrice ?? product.price ?? 0)
              : effectiveProductPrice(product);
            const priceBusy = busy === `product-price-${product.linkId}`;
            const message = priceMessages[String(product.linkId)] || "";
            return (
              <div key={product.linkId} className="option-linked-product">
                <div className="option-linked-product-main">
                  <span className="option-linked-sort">{product.sortOrder}</span>
                  <ProductImage src={product.imageUrl} alt={product.displayName} className="option-linked-thumb" fallbackLabel="無圖" />
                  <div>
                    <strong>{product.displayName}</strong>
                    <span>{product.sku || "無 SKU"} / 庫存 {product.stock}</span>
                    {product.customDisplayName ? <span>自訂名稱：{product.customDisplayName}</span> : <span>自訂名稱：使用商品名稱</span>}
                  </div>
                </div>
                <div className="option-linked-product-price-panel">
                  <div className="option-price-summary">
                    <span>商品售價：<strong>{money(product.basePrice)}</strong></span>
                    <span>LINE訂購價：<strong>{customPriceSet ? money(product.customPrice) : "使用商品售價"}</strong></span>
                    <span>實際顯示價格：<strong>{money(effectivePrice)}</strong></span>
                  </div>
                  <label className="form-field option-price-input">
                    <span>LINE訂購價</span>
                    <input
                      value={getPriceInput(product)}
                      onChange={(event) => updatePriceInput(product, event.target.value)}
                      placeholder="空白表示使用商品售價"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      disabled={priceBusy}
                    />
                  </label>
                  <div className="muted-text">此價格只套用於 LINE 訂單，不會修改商品管理中的售價。</div>
                  {message ? <div className={message.includes("已") ? "option-price-message success" : "option-price-message danger"}>{message}</div> : null}
                  <div className="option-linked-product-actions">
                    <StatusBadge tone={product.linkIsActive ? "success" : "neutral"}>{product.linkIsActive ? "啟用" : "停用"}</StatusBadge>
                    <button type="button" className="primary-button" onClick={() => savePriceFromInput(product)} disabled={priceBusy}>
                      {priceBusy ? "儲存中..." : "儲存價格"}
                    </button>
                    {customPriceSet ? (
                      <button type="button" className="secondary-button" onClick={() => resetProductPrice(product)} disabled={priceBusy}>恢復商品售價</button>
                    ) : null}
                    <button type="button" className="danger-button" onClick={() => removeProduct(product)} disabled={busy === `product-delete-${product.linkId}`}>解除</button>
                  </div>
                </div>
              </div>
            );
          })}
          {!linkedProducts.length ? <div className="muted-text">尚未連結商品</div> : null}
        </div>
      </div>
    </article>
  );
}

function LineOrderOptionsPage() {
  const [settings, setSettings] = useState(null);
  const [groups, setGroups] = useState([]);
  const [groupForm, setGroupForm] = useState(EMPTY_GROUP_FORM);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");


  useEffect(() => {
    let active = true;
    async function loadInitial() {
      try {
        setLoading(true);
        setError("");
        const config = await apiRequest("/line-order-options");
        if (!active) return;
        setSettings(config.settings || null);
        setGroups(config.groups || []);
      } catch (err) {
        if (active) setError(err?.message || "LINE 訂單選配設定載入失敗");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadInitial();
    return () => { active = false; };
  }, []);

  function applyConfig(config) {
    setSettings(config.settings || null);
    setGroups(config.groups || []);
  }

  function updateSettings(key, value) {
    setSettings((current) => ({ ...(current || {}), [key]: value }));
  }

  function updateGroupForm(key, value) {
    setGroupForm((current) => ({ ...current, [key]: value }));
  }

  function startEditGroup(group) {
    setEditingGroupId(group.id);
    setGroupForm({
      code: group.code || "",
      label: group.label || "",
      description: group.description || "",
      isRequired: Boolean(group.isRequired),
      minSelect: Number(group.minSelect || 0),
      maxSelect: Number(group.maxSelect || 1),
      sortOrder: Number(group.sortOrder || 0),
      isActive: Boolean(group.isActive)
    });
  }

  function resetGroupForm() {
    setEditingGroupId(null);
    setGroupForm(EMPTY_GROUP_FORM);
  }

  async function saveSettings(event) {
    event.preventDefault();
    try {
      setBusy("settings");
      const config = await apiRequest("/line-order-options/settings", {
        method: "PUT",
        body: JSON.stringify(settings)
      });
      applyConfig(config);
      window.alert("整體設定已儲存");
    } catch (err) {
      window.alert(err?.message || "整體設定儲存失敗");
    } finally {
      setBusy("");
    }
  }

  async function saveGroup(event) {
    event.preventDefault();
    try {
      setBusy("group");
      const path = editingGroupId ? `/line-order-options/groups/${editingGroupId}` : "/line-order-options/groups";
      const config = await apiRequest(path, {
        method: editingGroupId ? "PUT" : "POST",
        body: JSON.stringify(groupForm)
      });
      applyConfig(config);
      resetGroupForm();
    } catch (err) {
      window.alert(err?.message || "選配群組儲存失敗");
    } finally {
      setBusy("");
    }
  }

  async function deleteGroup(group) {
    if (!window.confirm(`確定刪除「${group.label}」？`)) return;
    try {
      setBusy(`group-delete-${group.id}`);
      const config = await apiRequest(`/line-order-options/groups/${group.id}`, { method: "DELETE" });
      applyConfig(config);
      if (editingGroupId === group.id) resetGroupForm();
    } catch (err) {
      window.alert(err?.message || "刪除選配群組失敗");
    } finally {
      setBusy("");
    }
  }

  async function linkGroupProduct(group, product) {
    try {
      setBusy(`product-${group.id}-${product.id}`);
      const config = await apiRequest(`/line-order-options/groups/${group.id}/products`, {
        method: "POST",
        body: JSON.stringify({
          productId: product.productId || product.id,
          sortOrder: nextSortOrder(group.products),
          customDisplayName: null,
          customPrice: null,
          isActive: true
        })
      });
      applyConfig(config);
      window.alert("商品已連結");
    } catch (err) {
      window.alert(err?.message || "連結商品失敗");
      throw err;
    } finally {
      setBusy("");
    }
  }

  async function updateGroupProductPrice(groupId, product, customPrice) {
    try {
      setBusy(`product-price-${product.linkId}`);
      const config = await apiRequest(`/line-order-options/groups/${groupId}/products/${product.linkId}`, {
        method: "PUT",
        body: JSON.stringify({
          productId: product.productId,
          sortOrder: product.sortOrder,
          customDisplayName: product.customDisplayName || null,
          customPrice,
          isActive: Boolean(product.linkIsActive)
        })
      });
      applyConfig(config);
    } catch (err) {
      throw err;
    } finally {
      setBusy("");
    }
  }

  async function removeGroupProduct(groupId, linkId) {
    try {
      setBusy(`product-delete-${linkId}`);
      const config = await apiRequest(`/line-order-options/groups/${groupId}/products/${linkId}`, { method: "DELETE" });
      applyConfig(config);
    } catch (err) {
      window.alert(err?.message || "解除商品失敗");
      throw err;
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return <div className="page"><PageHeader title="LINE訂單選配管理" /><div className="notice-card">資料讀取中...</div></div>;
  }

  return (
    <div className="page">
      <PageHeader title="LINE訂單選配管理" subtitle="設定 LINE 客戶訂車流程中的配件選配群組與商品" />
      {error ? <div className="notice-card danger">{error}</div> : null}

      <form className="operation-section-card" onSubmit={saveSettings}>
        <div className="admin-section-header">
          <div>
            <div className="admin-section-eyebrow">整體設定</div>
            <h2>LINE 訂單選配頁面</h2>
          </div>
          <StatusBadge tone={settings?.isEnabled ? "success" : "neutral"}>
            功能狀態：{settings?.isEnabled ? "啟用" : "停用"}
          </StatusBadge>
        </div>
        <div className="form-grid">
          <label className="form-field">
            <span>頁面標題</span>
            <input value={settings?.pageTitle || ""} onChange={(event) => updateSettings("pageTitle", event.target.value)} />
          </label>
          <label className="form-field">
            <span>頁面說明</span>
            <input value={settings?.pageDescription || ""} onChange={(event) => updateSettings("pageDescription", event.target.value)} />
          </label>
        </div>
        <div className="checkbox-grid">
          {[
            ["isEnabled", "啟用選配功能"],
            ["allowSkip", "允許略過選配"],
            ["showOutOfStock", "顯示缺貨商品"],
            ["showPrices", "顯示商品價格"]
          ].map(([key, label]) => (
            <label key={key} className="checkbox-row">
              <input type="checkbox" checked={Boolean(settings?.[key])} onChange={(event) => updateSettings(key, event.target.checked)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={busy === "settings"}>儲存整體設定</button>
        </div>
      </form>

      <form className="operation-section-card" onSubmit={saveGroup}>
        <div className="admin-section-header">
          <div>
            <div className="admin-section-eyebrow">選配群組</div>
            <h2>{editingGroupId ? "編輯群組" : "新增群組"}</h2>
          </div>
          {editingGroupId ? <button type="button" className="secondary-button" onClick={resetGroupForm}>取消編輯</button> : null}
        </div>
        <div className="form-grid">
          <label className="form-field"><span>群組代碼</span><input value={groupForm.code} onChange={(event) => updateGroupForm("code", event.target.value)} placeholder="A" /></label>
          <label className="form-field"><span>群組名稱</span><input value={groupForm.label} onChange={(event) => updateGroupForm("label", event.target.value)} placeholder="菜籃" /></label>
          <label className="form-field"><span>排序</span><input type="number" value={groupForm.sortOrder} onChange={(event) => updateGroupForm("sortOrder", Number(event.target.value))} /></label>
          <label className="form-field"><span>最少選擇</span><input type="number" min="0" value={groupForm.minSelect} onChange={(event) => updateGroupForm("minSelect", Number(event.target.value))} /></label>
          <label className="form-field"><span>最多選擇</span><input type="number" min="0" value={groupForm.maxSelect} onChange={(event) => updateGroupForm("maxSelect", Number(event.target.value))} /></label>
          <label className="form-field form-field-wide"><span>說明</span><input value={groupForm.description || ""} onChange={(event) => updateGroupForm("description", event.target.value)} /></label>
        </div>
        <div className="checkbox-grid">
          <label className="checkbox-row"><input type="checkbox" checked={groupForm.isRequired} onChange={(event) => updateGroupForm("isRequired", toBooleanValue(event))} /><span>必填群組</span></label>
          <label className="checkbox-row"><input type="checkbox" checked={groupForm.isActive} onChange={(event) => updateGroupForm("isActive", toBooleanValue(event))} /><span>群組啟用</span></label>
        </div>
        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={busy === "group"}>{editingGroupId ? "更新群組" : "新增群組"}</button>
        </div>
      </form>

      <section className="operation-section-card">
        <div className="admin-section-header">
          <div>
            <div className="admin-section-eyebrow">群組商品</div>
            <h2>商品連結與排序</h2>
          </div>
        </div>
        {groups.length === 0 ? <div className="empty-state">尚未建立選配群組</div> : null}
        <div className="option-admin-group-list">
          {groups.map((group) => (
            <OptionGroupEditor
              key={group.id}
              group={group}
              busy={busy}
              onEdit={startEditGroup}
              onDelete={deleteGroup}
              onLinkProduct={linkGroupProduct}
              onUpdateProduct={updateGroupProductPrice}
              onRemoveProduct={removeGroupProduct}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

export default LineOrderOptionsPage;
