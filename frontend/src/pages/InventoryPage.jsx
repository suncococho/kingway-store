import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import DetailModal from "../components/DetailModal";
import FilterBar from "../components/FilterBar";
import FilterChips from "../components/FilterChips";
import PageHeader from "../components/PageHeader";
import ProductImage from "../components/ProductImage";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import { useFetchList } from "../hooks/useFetchList";
import { apiRequest } from "../lib/api";
import { formatTaipeiDateTime, getCategoryLabel } from "../lib/display";
import { PRODUCT_CATEGORY_OPTIONS } from "../lib/productCategories";

const movementColumns = [
  { key: "productName", label: "商品" },
  { key: "sku", label: "SKU" },
  { key: "movementType", label: "異動類型" },
  { key: "quantity", label: "數量" },
  { key: "notes", label: "備註" },
  { key: "createdAtLabel", label: "建立時間" }
];

const supplierColumns = [
  { key: "id", label: "單號" },
  { key: "requestTypeLabel", label: "類型" },
  { key: "statusLabel", label: "狀態" },
  { key: "supplierName", label: "供應商" },
  { key: "itemSummary", label: "品項" },
  { key: "createdAtLabel", label: "建立時間" }
];

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

function InventoryPage() {
  const location = useLocation();
  const movements = useFetchList("/inventory/movements");
  const products = useFetchList("/products");
  const supplierRequests = useFetchList("/inventory/supplier-requests");
  const [form, setForm] = useState({
    productId: "",
    type: "IN",
    qty: "",
    note: ""
  });
  const [supplierForm, setSupplierForm] = useState({
    requestType: "PURCHASE_ORDER",
    supplierName: "",
    productId: "",
    quantity: "",
    note: ""
  });
  const [movementFilter, setMovementFilter] = useState("ALL");
  const [inventoryKeyword, setInventoryKeyword] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [stockFilter, setStockFilter] = useState("ALL");
  const [detailProductId, setDetailProductId] = useState(null);
  const [section, setSection] = useState("OVERVIEW");

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextSection = params.get("section");
    if (nextSection && ["OVERVIEW", "IN", "OUT", "ADJUST", "PO", "RETURN"].includes(nextSection)) {
      setSection(nextSection);
      if (["IN", "OUT", "ADJUST"].includes(nextSection)) {
        setForm((current) => ({ ...current, type: nextSection }));
      }
      if (nextSection === "PO") {
        setSupplierForm((current) => ({ ...current, requestType: "PURCHASE_ORDER" }));
      }
      if (nextSection === "RETURN") {
        setSupplierForm((current) => ({ ...current, requestType: "RETURN" }));
      }
    }
  }, [location.search]);

  const inventoryRows = useMemo(
    () =>
      products.items.map((item) => ({
        ...item,
        categoryLabel: item.categoryLabel || getCategoryLabel(item.category),
        stockTone: getStockTone(item.stock, item.reorderLevel),
        stockLabel: getStockLabel(item.stock, item.reorderLevel)
      })),
    [products.items]
  );

  const lowStockRows = useMemo(
    () => inventoryRows.filter((item) => Number(item.stock) <= Number(item.reorderLevel || 0)),
    [inventoryRows]
  );

  const filteredInventoryRows = useMemo(() => {
    const keyword = inventoryKeyword.trim().toLowerCase();
    return inventoryRows.filter((item) => {
      if (categoryFilter !== "ALL" && item.category !== categoryFilter) {
        return false;
      }
      if (stockFilter === "LOW" && item.stockLabel !== "低庫存") {
        return false;
      }
      if (stockFilter === "IN" && item.stockLabel !== "有庫存") {
        return false;
      }
      if (stockFilter === "EMPTY" && item.stockLabel !== "無庫存") {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return `${item.name} ${item.sku} ${item.location || ""}`.toLowerCase().includes(keyword);
    });
  }, [categoryFilter, inventoryKeyword, inventoryRows, stockFilter]);

  const movementRows = movements.items
    .map((item) => ({ ...item, createdAtLabel: formatTaipeiDateTime(item.createdAt) }))
    .filter((item) => movementFilter === "ALL" || item.movementType === movementFilter);
  const supplierRequestRows = supplierRequests.items.map((item) => ({
    ...item,
    createdAtLabel: formatTaipeiDateTime(item.createdAt)
  }));
  const selectedProduct = products.items.find((item) => String(item.id) === String(form.productId));
  const detailProduct = inventoryRows.find((item) => item.id === detailProductId) || null;
  const featureError = movements.error || supplierRequests.error;

  const sectionItems = [
    { key: "OVERVIEW", label: "庫存總覽" },
    { key: "IN", label: "入庫" },
    { key: "OUT", label: "出庫" },
    { key: "ADJUST", label: "調整" },
    { key: "PO", label: "發注" },
    { key: "RETURN", label: "退貨" }
  ];

  const overviewColumns = [
    {
      key: "identity",
      label: "商品",
      render: (row) => (
        <div className="product-identity">
          <ProductImage src={row.imageUrl} alt={row.name} />
          <div className="identity-copy">
            <div className="identity-title">{row.name}</div>
            <div className="identity-subtitle">{row.categoryLabel}</div>
          </div>
        </div>
      )
    },
    { key: "sku", label: "SKU" },
    {
      key: "stockStatus",
      label: "庫存狀態",
      render: (row) => <StatusBadge tone={row.stockTone}>{row.stockLabel}</StatusBadge>
    },
    { key: "stock", label: "現有庫存" },
    { key: "reorderLevel", label: "警戒值" },
    { key: "location", label: "庫位", render: (row) => row.location || "-" },
    {
      key: "actions",
      label: "操作",
      render: (row) => (
        <button type="button" className="secondary-button" onClick={() => setDetailProductId(row.id)}>
          查看詳情
        </button>
      ),
      mobileHidden: true
    }
  ];

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value
    }));
  }

  function handleSupplierChange(event) {
    const { name, value } = event.target;
    setSupplierForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    try {
      await apiRequest("/inventory/movements", {
        method: "POST",
        body: JSON.stringify({
          productId: Number(form.productId),
          type: form.type,
          qty: Number(form.qty),
          note: form.note
        })
      });
      setForm({
        productId: "",
        type: "IN",
        qty: "",
        note: ""
      });
      movements.refetch();
      products.refetch();
      alert("庫存已更新");
    } catch (error) {
      alert(error.message);
    }
  }

  async function createSupplierRequest(event) {
    event.preventDefault();
    try {
      await apiRequest("/inventory/supplier-requests", {
        method: "POST",
        body: JSON.stringify({
          requestType: supplierForm.requestType,
          supplierName: supplierForm.supplierName,
          note: supplierForm.note,
          items: [
            {
              productId: Number(supplierForm.productId),
              quantity: Number(supplierForm.quantity),
              reason: supplierForm.requestType === "RETURN" ? supplierForm.note : null
            }
          ]
        })
      });
      setSupplierForm({
        requestType: "PURCHASE_ORDER",
        supplierName: "",
        productId: "",
        quantity: "",
        note: ""
      });
      supplierRequests.refetch();
      alert("供應商流程已建立");
    } catch (error) {
      alert(error.message);
    }
  }

  async function respondSupplierRequest(row, approved) {
    try {
      const body = approved
        ? { approved: true, note: "後台人工確認" }
        : { approved: false, note: window.prompt("請輸入拒絕原因", "後台人工拒絕") || "後台人工拒絕" };
      await apiRequest(`/inventory/supplier-requests/${row.id}/respond`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      supplierRequests.refetch();
      alert(approved ? "已確認供應商單" : "已拒絕供應商單");
    } catch (error) {
      alert(error.message);
    }
  }

  return (
    <div>
      <PageHeader title="庫存管理" description="庫存總覽、異動與供應商流程統一使用 POS 同一套視覺語言與資訊架構。" />
      {featureError ? <div className="empty-state">{featureError}</div> : null}
      <SectionTabs
        items={sectionItems}
        value={section}
        onChange={(next) => {
          setSection(next);
          if (["IN", "OUT", "ADJUST"].includes(next)) {
            setForm((current) => ({ ...current, type: next }));
          }
          if (next === "PO") {
            setSupplierForm((current) => ({ ...current, requestType: "PURCHASE_ORDER" }));
          }
          if (next === "RETURN") {
            setSupplierForm((current) => ({ ...current, requestType: "RETURN" }));
          }
        }}
        label="庫存子功能"
      />

      <div className="section-panel">
        {section === "OVERVIEW" ? (
          <section className="admin-panel">
            <AdminSectionHeader
              eyebrow="庫存總覽"
              title="庫存主畫面"
              description="用 POS 同風格整理商品、庫位、庫存狀態與近期重點，不再只是一張資料表。"
              badges={
                <>
                  <StatusBadge tone="warning">低庫存 {lowStockRows.length}</StatusBadge>
                  <StatusBadge tone="info">異動紀錄 {movements.items.length}</StatusBadge>
                  <StatusBadge tone="success">有庫存 {inventoryRows.filter((item) => item.stockLabel === "有庫存").length}</StatusBadge>
                </>
              }
            />

            <div className="admin-summary-grid">
              <article className="admin-summary-card">
                <div className="admin-summary-label">總商品數</div>
                <div className="admin-summary-value">{inventoryRows.length}</div>
              </article>
              <article className="admin-summary-card">
                <div className="admin-summary-label">低庫存</div>
                <div className="admin-summary-value">{lowStockRows.length}</div>
              </article>
              <article className="admin-summary-card">
                <div className="admin-summary-label">待供應商確認</div>
                <div className="admin-summary-value">
                  {supplierRequests.items.filter((item) => item.status === "PENDING_SUPPLIER").length}
                </div>
              </article>
            </div>

            <FilterBar>
              <label className="form-field">
                <span>搜尋商品 / SKU / 庫位</span>
                <input type="text" value={inventoryKeyword} onChange={(event) => setInventoryKeyword(event.target.value)} placeholder="輸入商品、SKU 或庫位" />
              </label>
            </FilterBar>

            <div className="admin-filter-stack">
              <div>
                <div className="admin-filter-label">分類</div>
                <FilterChips
                  items={[
                    { key: "ALL", label: "全部分類" },
                    ...PRODUCT_CATEGORY_OPTIONS
                  ]}
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                />
              </div>
              <div>
                <div className="admin-filter-label">庫存狀態</div>
                <FilterChips
                  items={[
                    { key: "ALL", label: "全部庫存" },
                    { key: "IN", label: "有庫存" },
                    { key: "LOW", label: "低庫存" },
                    { key: "EMPTY", label: "無庫存" }
                  ]}
                  value={stockFilter}
                  onChange={setStockFilter}
                />
              </div>
            </div>

            <DataTable
              columns={overviewColumns}
              rows={filteredInventoryRows}
              emptyText="目前沒有符合條件的庫存資料。"
              cardTitle={(row) => (
                <div className="product-identity">
                  <ProductImage src={row.imageUrl} alt={row.name} />
                  <div className="identity-copy">
                    <div className="identity-title">{row.name}</div>
                    <div className="identity-subtitle">{row.categoryLabel}</div>
                  </div>
                </div>
              )}
              cardDescription={(row) => `SKU：${row.sku} / 庫位：${row.location || "-"}`}
              cardBadges={(row) => <StatusBadge tone={row.stockTone}>{row.stockLabel}</StatusBadge>}
              cardFooter={(row) => (
                <div className="field-grid">
                  <div className="field-item">
                    <div className="field-label">現有庫存</div>
                    <div className="field-value">{row.stock}</div>
                  </div>
                  <div className="field-item">
                    <div className="field-label">警戒值</div>
                    <div className="field-value">{row.reorderLevel ?? 0}</div>
                  </div>
                  <div className="field-item">
                    <button type="button" className="secondary-button" onClick={() => setDetailProductId(row.id)}>
                      查看詳情
                    </button>
                  </div>
                </div>
              )}
            />

            <div className="admin-split-grid">
              <div className="admin-subpanel">
                <div className="section-title">低庫存商品</div>
                <DataTable
                  columns={[
                    { key: "name", label: "商品名稱" },
                    { key: "sku", label: "SKU" },
                    { key: "stock", label: "庫存" },
                    { key: "reorderLevel", label: "警戒值" }
                  ]}
                  rows={lowStockRows}
                  emptyText="目前沒有低庫存商品。"
                  cardTitle={(row) => row.name}
                  cardDescription={(row) => `${row.categoryLabel} / SKU：${row.sku}`}
                  cardBadges={(row) => <StatusBadge tone={row.stockTone}>{row.stockLabel}</StatusBadge>}
                />
              </div>

              <div className="admin-subpanel">
                <AdminSectionHeader eyebrow="異動紀錄" title="近期異動" description="可依異動類型快速切換。" />
                <FilterChips
                  items={[
                    { key: "ALL", label: "全部" },
                    { key: "IN", label: "入庫" },
                    { key: "OUT", label: "出庫" },
                    { key: "ADJUST", label: "調整" }
                  ]}
                  value={movementFilter}
                  onChange={setMovementFilter}
                />
                <DataTable
                  columns={movementColumns}
                  rows={movementRows.slice(0, 8)}
                  emptyText="目前沒有庫存異動紀錄。"
                  cardTitle={(row) => row.productName}
                  cardDescription={(row) => `${row.sku} / ${row.movementType}`}
                />
              </div>
            </div>
          </section>
        ) : null}

        {["IN", "OUT", "ADJUST"].includes(section) ? (
          <section className="admin-panel">
            <AdminSectionHeader
              eyebrow={section === "IN" ? "入庫" : section === "OUT" ? "出庫" : "調整"}
              title={section === "IN" ? "建立入庫紀錄" : section === "OUT" ? "建立出庫紀錄" : "直接調整庫存"}
              description="先選商品，再執行異動；下方保留近期相關異動紀錄，方便門市人員確認結果。"
            />

            <div className="admin-split-grid">
              <div className="admin-subpanel">
                <form className="grid-form" onSubmit={handleSubmit}>
                  <label className="form-field">
                    <span>商品</span>

                    <input
                      list="inventory-product-list"
                      name="productId"
                      value={form.productId}
                      onChange={handleChange}
                      placeholder="搜尋商品名稱 / SKU"
                      required
                    />

                    <datalist id="inventory-product-list">
                      {products.items.map((product) => (
                        <option
                          key={product.id}
                          value={product.id}
                          label={`${product.name} (${product.sku}) 庫存=${product.stock}`}
                        />
                      ))}
                    </datalist>
                  </label>
                  <label className="form-field">
                    <span>異動類型</span>
                    <select name="type" value={form.type} onChange={handleChange}>
                      <option value="IN">入庫</option>
                      <option value="OUT">出庫</option>
                      <option value="ADJUST">直接調整</option>
                    </select>
                  </label>
                  <label className="form-field">
                    <span>{form.type === "ADJUST" ? "調整後庫存" : "數量"}</span>
                    <input name="qty" type="number" min="0" value={form.qty} onChange={handleChange} required />
                  </label>
                  <label className="form-field">
                    <span>備註</span>
                    <input name="note" type="text" value={form.note} onChange={handleChange} />
                  </label>
                  <button type="submit" className="primary-button inline-submit">
                    儲存異動
                  </button>
                </form>

                {selectedProduct ? (
                  <div className="inventory-summary-card">
                    <div className="inventory-summary-value">{selectedProduct.name}</div>
                    <div className="muted-text">SKU：{selectedProduct.sku} / 目前庫存：{selectedProduct.stock}</div>
                  </div>
                ) : null}
              </div>

              <div className="admin-subpanel">
                <div className="section-title">最近異動</div>
                <DataTable
                  columns={movementColumns}
                  rows={movementRows.slice(0, 10)}
                  emptyText="目前沒有庫存異動紀錄。"
                  cardTitle={(row) => row.productName}
                  cardDescription={(row) => `${row.sku} / ${row.movementType}`}
                  cardFooter={(row) => (
                    <div className="field-grid">
                      <div className="field-item">
                        <div className="field-label">數量</div>
                        <div className="field-value">{row.quantity}</div>
                      </div>
                      <div className="field-item">
                        <div className="field-label">備註</div>
                        <div className="field-value">{row.notes || "-"}</div>
                      </div>
                    </div>
                  )}
                />
              </div>
            </div>
          </section>
        ) : null}

        {["PO", "RETURN"].includes(section) ? (
          <section className="admin-panel">
            <AdminSectionHeader
              eyebrow={section === "PO" ? "發注" : "退貨"}
              title={section === "PO" ? "供應商發注" : "供應商退貨"}
              description="保留既有供應商確認流程，統一成與庫存主頁一致的表單、列表與狀態樣式。"
            />

            <div className="admin-split-grid">
              <div className="admin-subpanel">
                <form className="grid-form" onSubmit={createSupplierRequest}>
                  <label className="form-field">
                    <span>類型</span>
                    <select name="requestType" value={supplierForm.requestType} onChange={handleSupplierChange}>
                      <option value="PURCHASE_ORDER">發注</option>
                      <option value="RETURN">退貨</option>
                    </select>
                  </label>
                  <label className="form-field">
                    <span>供應商</span>
                    <input name="supplierName" value={supplierForm.supplierName} onChange={handleSupplierChange} />
                  </label>
                  <label className="form-field">
                    <span>商品</span>

                    <input
                      list="supplier-product-list"
                      name="productId"
                      value={supplierForm.productId}
                      onChange={handleSupplierChange}
                      placeholder="搜尋商品名稱 / SKU"
                      required
                    />

                    <datalist id="supplier-product-list">
                      {products.items.map((product) => (
                        <option
                          key={product.id}
                          value={product.id}
                          label={`${product.name} (${product.sku})`}
                        />
                      ))}
                    </datalist>
                  </label>
                  <label className="form-field">
                    <span>數量</span>
                    <input name="quantity" type="number" min="1" value={supplierForm.quantity} onChange={handleSupplierChange} required />
                  </label>
                  <label className="form-field form-field-wide">
                    <span>備註 / 退貨原因</span>
                    <input name="note" value={supplierForm.note} onChange={handleSupplierChange} />
                  </label>
                  <button type="submit" className="primary-button inline-submit">
                    送出供應商確認
                  </button>
                </form>
              </div>

              <div className="admin-subpanel">
                <div className="section-title">{section === "PO" ? "發注列表" : "退貨列表"}</div>
                <DataTable
                  columns={supplierColumns}
                  rows={supplierRequestRows.filter((item) =>
                    section === "PO" ? item.requestType === "PURCHASE_ORDER" : item.requestType === "RETURN"
                  )}
                  emptyText={section === "PO" ? "目前沒有發注資料。" : "目前沒有退貨資料。"}
                  cardTitle={(row) => `${row.requestTypeLabel} #${row.id}`}
                  cardDescription={(row) => `${row.supplierName || "未填供應商"} / ${row.statusLabel}`}
                  cardBadges={(row) => (
                    <StatusBadge tone={row.status === "REJECTED" ? "danger" : row.status === "PENDING_SUPPLIER" ? "warning" : "info"}>
                      {row.statusLabel}
                    </StatusBadge>
                  )}
                  cardFooter={(row) => (
                    <div className="field-grid">
                      <div className="field-item">
                        <div className="field-label">品項</div>
                        <div className="field-value">{row.itemSummary || "-"}</div>
                      </div>
                      <div className="field-item">
                        <div className="field-label">建立時間</div>
                        <div className="field-value">{row.createdAtLabel}</div>
                      </div>
                      <div className="field-item">
                        <div className="field-label">操作</div>
                        <div className="field-value">
                          {row.status === "PENDING_SUPPLIER" ? (
                            <div className="action-row compact-actions">
                              <button type="button" className="secondary-button" onClick={() => respondSupplierRequest(row, true)}>
                                確認
                              </button>
                              <button type="button" className="secondary-button" onClick={() => respondSupplierRequest(row, false)}>
                                拒絕
                              </button>
                            </div>
                          ) : (
                            "-"
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                />
              </div>
            </div>
          </section>
        ) : null}
      </div>

      <DetailModal
        open={Boolean(detailProduct)}
        title={detailProduct?.name || "庫存詳情"}
        subtitle={detailProduct ? `${detailProduct.categoryLabel} / SKU：${detailProduct.sku}` : ""}
        onClose={() => setDetailProductId(null)}
      >
        {detailProduct ? (
          <div className="admin-detail-layout">
            <div className="admin-detail-media">
              <ProductImage src={detailProduct.imageUrl} alt={detailProduct.name} className="admin-detail-image" />
            </div>
            <div className="field-grid">
              <div className="field-item">
                <div className="field-label">現有庫存</div>
                <div className="field-value">{detailProduct.stock}</div>
              </div>
              <div className="field-item">
                <div className="field-label">庫存狀態</div>
                <div className="field-value">
                  <StatusBadge tone={detailProduct.stockTone}>{detailProduct.stockLabel}</StatusBadge>
                </div>
              </div>
              <div className="field-item">
                <div className="field-label">警戒值</div>
                <div className="field-value">{detailProduct.reorderLevel ?? 0}</div>
              </div>
              <div className="field-item">
                <div className="field-label">庫位</div>
                <div className="field-value">{detailProduct.location || "-"}</div>
              </div>
              <div className="field-item">
                <div className="field-label">分類</div>
                <div className="field-value">{detailProduct.categoryLabel}</div>
              </div>
              <div className="field-item">
                <div className="field-label">狀態</div>
                <div className="field-value">{detailProduct.isActive ? "上架中" : "未上架"}</div>
              </div>
            </div>
          </div>
        ) : null}
      </DetailModal>
    </div>
  );
}

export default InventoryPage;
