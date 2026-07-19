import { useEffect, useMemo, useState } from "react";
import PageHeader from "../components/PageHeader";
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

const EMPTY_PRODUCT_FORM = {
  productId: "",
  sortOrder: 0,
  customDisplayName: "",
  customPrice: "",
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

function money(value) {
  const amount = Number(value || 0);
  return `NT$ ${amount.toLocaleString()}`;
}

function toBooleanValue(event) {
  return event.target.type === "checkbox" ? event.target.checked : event.target.value;
}

function LineOrderOptionsPage() {
  const [settings, setSettings] = useState(null);
  const [groups, setGroups] = useState([]);
  const [products, setProducts] = useState([]);
  const [groupForm, setGroupForm] = useState(EMPTY_GROUP_FORM);
  const [productForms, setProductForms] = useState({});
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const productOptions = useMemo(() => products, [products]);

  async function load() {
    try {
      setLoading(true);
      setError("");
      const [config, productRows] = await Promise.all([
        apiRequest("/line-order-options"),
        apiRequest("/line-order-options/products")
      ]);
      setSettings(config.settings || null);
      setGroups(config.groups || []);
      setProducts(Array.isArray(productRows) ? productRows : []);
    } catch (err) {
      setError(err?.message || "LINE 訂單選配設定載入失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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

  function updateProductForm(groupId, key, value) {
    setProductForms((current) => ({
      ...current,
      [groupId]: {
        ...EMPTY_PRODUCT_FORM,
        ...(current[groupId] || {}),
        [key]: value
      }
    }));
  }

  async function saveSettings(event) {
    event.preventDefault();
    try {
      setBusy("settings");
      const config = await apiRequest("/line-order-options/settings", {
        method: "PUT",
        body: JSON.stringify(settings)
      });
      setSettings(config.settings || null);
      setGroups(config.groups || []);
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
      setSettings(config.settings || null);
      setGroups(config.groups || []);
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
      setSettings(config.settings || null);
      setGroups(config.groups || []);
      if (editingGroupId === group.id) resetGroupForm();
    } catch (err) {
      window.alert(err?.message || "刪除選配群組失敗");
    } finally {
      setBusy("");
    }
  }

  async function saveGroupProduct(groupId) {
    const form = productForms[groupId] || EMPTY_PRODUCT_FORM;
    if (!form.productId) {
      window.alert("請選擇商品");
      return;
    }
    try {
      setBusy(`product-${groupId}`);
      const config = await apiRequest(`/line-order-options/groups/${groupId}/products`, {
        method: "POST",
        body: JSON.stringify(form)
      });
      setSettings(config.settings || null);
      setGroups(config.groups || []);
      setProductForms((current) => ({ ...current, [groupId]: EMPTY_PRODUCT_FORM }));
    } catch (err) {
      window.alert(err?.message || "連結商品失敗");
    } finally {
      setBusy("");
    }
  }

  async function removeGroupProduct(groupId, linkId) {
    try {
      setBusy(`product-delete-${linkId}`);
      const config = await apiRequest(`/line-order-options/groups/${groupId}/products/${linkId}`, { method: "DELETE" });
      setSettings(config.settings || null);
      setGroups(config.groups || []);
    } catch (err) {
      window.alert(err?.message || "解除商品失敗");
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
          <label className="form-field form-field-wide"><span>說明</span><input value={groupForm.description} onChange={(event) => updateGroupForm("description", event.target.value)} /></label>
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
          {groups.map((group) => {
            const form = productForms[group.id] || EMPTY_PRODUCT_FORM;
            return (
              <article key={group.id} className="option-admin-group">
                <div className="option-admin-group-head">
                  <div>
                    <strong>{group.code} / {group.label}</strong>
                    <span>{group.isRequired ? "必填" : "選填"}，{group.minSelect} 到 {group.maxSelect || "不限"} 項</span>
                  </div>
                  <div className="compact-actions">
                    <StatusBadge tone={group.isActive ? "success" : "neutral"}>{group.isActive ? "啟用" : "停用"}</StatusBadge>
                    <button type="button" className="secondary-button" onClick={() => startEditGroup(group)}>編輯</button>
                    <button type="button" className="danger-button" onClick={() => deleteGroup(group)} disabled={busy === `group-delete-${group.id}`}>刪除</button>
                  </div>
                </div>
                <div className="form-grid option-product-form">
                  <label className="form-field">
                    <span>連結商品</span>
                    <select value={form.productId} onChange={(event) => updateProductForm(group.id, "productId", event.target.value)}>
                      <option value="">請選擇商品</option>
                      {productOptions.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.sku} / {product.name} / {CATEGORY_LABELS[product.category] || product.category} / {money(product.price)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field"><span>顯示排序</span><input type="number" value={form.sortOrder} onChange={(event) => updateProductForm(group.id, "sortOrder", Number(event.target.value))} /></label>
                  <label className="form-field"><span>自訂名稱</span><input value={form.customDisplayName} onChange={(event) => updateProductForm(group.id, "customDisplayName", event.target.value)} /></label>
                  <label className="form-field"><span>自訂價格</span><input type="number" min="0" value={form.customPrice} onChange={(event) => updateProductForm(group.id, "customPrice", event.target.value)} placeholder="空白使用商品售價" /></label>
                  <label className="checkbox-row option-active-row"><input type="checkbox" checked={form.isActive} onChange={(event) => updateProductForm(group.id, "isActive", event.target.checked)} /><span>連結啟用</span></label>
                </div>
                <button type="button" className="secondary-button" onClick={() => saveGroupProduct(group.id)} disabled={busy === `product-${group.id}`}>連結商品</button>
                <div className="option-linked-products">
                  {(group.products || []).map((product) => (
                    <div key={product.linkId} className="option-linked-product">
                      <span>{product.sortOrder}. {product.displayName}</span>
                      <span>{money(product.price ?? product.basePrice)} / 庫存 {product.stock}</span>
                      <StatusBadge tone={product.linkIsActive ? "success" : "neutral"}>{product.linkIsActive ? "啟用" : "停用"}</StatusBadge>
                      <button type="button" className="danger-button" onClick={() => removeGroupProduct(group.id, product.linkId)} disabled={busy === `product-delete-${product.linkId}`}>解除</button>
                    </div>
                  ))}
                  {!(group.products || []).length ? <div className="muted-text">尚未連結商品</div> : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default LineOrderOptionsPage;
