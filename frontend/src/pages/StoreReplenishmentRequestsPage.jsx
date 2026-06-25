import { useEffect, useMemo, useState } from "react";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import PageHelpButton from "../components/PageHelpButton";
import StatusBadge from "../components/StatusBadge";
import { apiRequest } from "../lib/api";
import { PAGE_HELP } from "../lib/pageHelpContent";

const STATUS_LABELS = {
  DRAFT: "草稿",
  SUBMITTED: "已送出",
  PARTIALLY_FULFILLED: "部分出貨",
  FULFILLED: "已完成",
  CANCELED: "已取消"
};

const EMPTY_FORM = {
  productQuery: "",
  selectedProductId: "",
  quantity: 1,
  note: "",
  itemNote: ""
};

const PRODUCT_CANDIDATE_STEP = 10;
const PRODUCT_API_LIMIT = 50;

function statusTone(status) {
  if (status === "FULFILLED") return "success";
  if (status === "PARTIALLY_FULFILLED" || status === "SUBMITTED") return "warning";
  if (status === "CANCELED") return "danger";
  return "info";
}

function money(value) {
  return `NT$ ${Number(value || 0).toLocaleString()}`;
}

function formatDate(value) {
  return value ? String(value).replace("T", " ").slice(0, 16) : "-";
}

export default function StoreReplenishmentRequestsPage() {
  const [requests, setRequests] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(false);
  const [error, setError] = useState("");
  const [visibleProductCount, setVisibleProductCount] = useState(PRODUCT_CANDIDATE_STEP);

  const selectedProduct = useMemo(
    () => products.find((product) => String(product.hqProductId) === String(form.selectedProductId)) || null,
    [products, form.selectedProductId]
  );
  const visibleProducts = useMemo(
    () => products.slice(0, visibleProductCount),
    [products, visibleProductCount]
  );
  const productQueryText = form.productQuery.trim();
  const hasMoreProducts = visibleProductCount < products.length;

  useEffect(() => {
    loadRequests();
  }, []);

  useEffect(() => {
    setVisibleProductCount(PRODUCT_CANDIDATE_STEP);
    const timer = setTimeout(() => {
      loadProducts();
    }, 250);
    return () => clearTimeout(timer);
  }, [form.productQuery]);

  async function loadRequests() {
    setLoading(true);
    setError("");
    try {
      const response = await apiRequest("/store-replenishment-requests");
      setRequests(Array.isArray(response.requests) ? response.requests : []);
    } catch (requestError) {
      setError(requestError.message || "請貨資料讀取失敗");
    } finally {
      setLoading(false);
    }
  }

  async function loadProducts() {
    setProductsLoading(true);
    try {
      const params = new URLSearchParams();
      if (form.productQuery) params.set("q", form.productQuery);
      const response = await apiRequest(`/store-replenishment-requests/hq-products?${params.toString()}`);
      const rows = Array.isArray(response.products) ? response.products : [];
      setProducts(rows);
      if (form.selectedProductId && !rows.some((row) => String(row.hqProductId) === String(form.selectedProductId))) {
        setForm((current) => ({ ...current, selectedProductId: "" }));
      }
    } catch (requestError) {
      setProducts([]);
      setError(requestError.message || "本部商品讀取失敗");
    } finally {
      setProductsLoading(false);
    }
  }

  async function openDetail(row) {
    try {
      const response = await apiRequest(`/store-replenishment-requests/${row.id}`);
      setSelectedRequest(response.request);
    } catch (requestError) {
      alert(requestError.message || "請貨明細讀取失敗");
    }
  }

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: name === "quantity" ? Number(value) : value
    }));
  }

  async function createRequest(event) {
    event.preventDefault();
    const quantity = Number(form.quantity || 0);
    if (!selectedProduct) {
      alert("請先選擇本部商品");
      return;
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      alert("請輸入正確申請數量");
      return;
    }

    try {
      const response = await apiRequest("/store-replenishment-requests", {
        method: "POST",
        body: JSON.stringify({
          note: form.note || null,
          items: [{
            hqProductId: Number(selectedProduct.hqProductId),
            quantityRequested: quantity,
            note: form.itemNote || null
          }]
        }),
        processingMessage: "建立請貨單中"
      });
      setForm(EMPTY_FORM);
      setSelectedRequest(response.request);
      await loadRequests();
    } catch (requestError) {
      alert(requestError.message || "建立請貨單失敗");
    }
  }

  async function submitRequest(row) {
    if (!confirm("送出後，本部將收到請貨通知並確認是否出貨。是否送出？")) return;
    try {
      const response = await apiRequest(`/store-replenishment-requests/${row.id}/submit`, {
        method: "POST",
        processingMessage: "送出請貨中"
      });
      setSelectedRequest(response.request);
      await loadRequests();
    } catch (requestError) {
      alert(requestError.message || "送出請貨失敗");
    }
  }

  async function cancelRequest(row) {
    if (!confirm("確認取消此請貨單？")) return;
    try {
      const response = await apiRequest(`/store-replenishment-requests/${row.id}/cancel`, {
        method: "POST",
        processingMessage: "取消請貨中"
      });
      setSelectedRequest(response.request);
      await loadRequests();
    } catch (requestError) {
      alert(requestError.message || "取消請貨失敗");
    }
  }

  const requestColumns = [
    { key: "requestNo", label: "請貨單號" },
    { key: "status", label: "狀態", render: (row) => <StatusBadge tone={statusTone(row.status)}>{STATUS_LABELS[row.status] || row.status}</StatusBadge> },
    { key: "itemSummary", label: "品項" },
    { key: "submittedAt", label: "送出時間", render: (row) => formatDate(row.submittedAt) },
    {
      key: "actions",
      label: "操作",
      render: (row) => (
        <div className="action-row compact-actions">
          <button type="button" className="secondary-button" onClick={() => openDetail(row)}>查看明細</button>
          {row.status === "DRAFT" ? <button type="button" className="primary-button" onClick={() => submitRequest(row)}>送出請貨</button> : null}
          {row.status === "DRAFT" || row.status === "SUBMITTED" ? <button type="button" className="secondary-button" onClick={() => cancelRequest(row)}>取消請貨</button> : null}
        </div>
      )
    }
  ];

  const itemColumns = [
    { key: "requestedSku", label: "SKU" },
    { key: "requestedProductName", label: "商品名稱" },
    { key: "quantityRequested", label: "申請數量" },
    { key: "quantityFulfilled", label: "已出貨數量" },
    { key: "unitCost", label: "建議結算單價", render: (row) => money(row.unitCost) },
    { key: "status", label: "狀態", render: (row) => <StatusBadge tone={statusTone(row.status)}>{STATUS_LABELS[row.status] || row.status}</StatusBadge> }
  ];

  return (
    <div>
      <PageHeader
        title="門市請貨"
        description="門市請貨用於向本部申請補貨。送出後，本部會確認庫存並建立出貨單；門市收到商品後，請至『門市入庫』確認實收數量。"
      />
      <PageHelpButton help={PAGE_HELP.storeReplenishment} />
      {error ? <div className="empty-state">{error}</div> : null}

      <section className="content-card section-panel">
        <AdminSectionHeader eyebrow="新增請貨單" title="選擇本部商品" description="請貨單建立後為草稿，送出後才會通知本部處理。" />
        <form className="grid-form compact-grid" onSubmit={createRequest}>
          <label className="form-field"><span>商品搜尋</span><input name="productQuery" value={form.productQuery} onChange={updateForm} placeholder="SKU / 商品名稱" /></label>
          <label className="form-field"><span>申請數量</span><input name="quantity" type="number" min="1" value={form.quantity} onChange={updateForm} /></label>
          <label className="form-field form-field-wide"><span>請貨備註</span><input name="note" value={form.note} onChange={updateForm} /></label>
          <label className="form-field form-field-wide"><span>品項備註</span><input name="itemNote" value={form.itemNote} onChange={updateForm} /></label>

          <div className="form-field-wide stack-list">
            <div className="empty-state">
              請輸入 SKU 或商品名稱搜尋本部商品。下方僅顯示符合條件的前幾筆商品，並非全部商品。
              {productQueryText
                ? ` 搜尋結果：${products.length} 筆，目前顯示 ${visibleProducts.length} 筆。`
                : ` 目前顯示本部庫存較高的前 ${Math.min(visibleProductCount, products.length || PRODUCT_CANDIDATE_STEP)} 筆商品。若找不到商品，請輸入 SKU 或商品名稱搜尋。`}
              {products.length >= PRODUCT_API_LIMIT ? ` API 目前最多回傳前 ${PRODUCT_API_LIMIT} 筆候選，請輸入更完整的 SKU 或商品名稱縮小範圍。` : ""}
            </div>
            {products.length ? (
              <div className="compact-actions">
                <StatusBadge tone="info">
                  {productQueryText ? `搜尋結果：${products.length} 筆` : `顯示 ${visibleProducts.length} 筆本部商品候選`}
                </StatusBadge>
                {products.length > visibleProducts.length ? (
                  <StatusBadge tone="warning">僅顯示前 {visibleProducts.length} 筆結果</StatusBadge>
                ) : (
                  <StatusBadge tone="success">已顯示全部目前結果</StatusBadge>
                )}
              </div>
            ) : null}
            {productsLoading ? <div className="empty-state">本部商品讀取中...</div> : null}
            {!productsLoading && !products.length ? <div className="empty-state">找不到本部商品，請確認 SKU 或商品名稱。</div> : null}
            {visibleProducts.map((product) => (
              <button
                type="button"
                key={product.hqProductId}
                className={String(product.hqProductId) === String(form.selectedProductId) ? "primary-button" : "secondary-button"}
                onClick={() => setForm((current) => ({ ...current, selectedProductId: String(product.hqProductId) }))}
              >
                {product.sku} / {product.name} / 本部庫存 {product.hqStock} / 建議結算單價 {money(product.unitCost)} {product.mapped ? "" : " / 門市尚未建立此 SKU"}
              </button>
            ))}
            {hasMoreProducts ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setVisibleProductCount((current) => current + PRODUCT_CANDIDATE_STEP)}
              >
                顯示更多
              </button>
            ) : products.length ? (
              <div className="muted-text">已顯示全部目前結果。</div>
            ) : null}
          </div>

          {selectedProduct ? (
            <div className="field-grid form-field-wide">
              <div className="field-item"><div className="field-label">狀態</div><div className="field-value">已選擇本部商品</div></div>
              <div className="field-item"><div className="field-label">SKU</div><div className="field-value">{selectedProduct.sku}</div></div>
              <div className="field-item"><div className="field-label">商品名稱</div><div className="field-value">{selectedProduct.name}</div></div>
              <div className="field-item"><div className="field-label">本部庫存</div><div className="field-value">{selectedProduct.hqStock}</div></div>
              <div className="field-item"><div className="field-label">建議結算單價</div><div className="field-value">{money(selectedProduct.unitCost)}</div></div>
            </div>
          ) : null}

          <div className="action-row form-field-wide">
            <button type="submit" className="primary-button">新增請貨單</button>
          </div>
        </form>
      </section>

      <section className="content-card section-panel">
        <AdminSectionHeader eyebrow="請貨列表" title="我的請貨單" description={loading ? "讀取中..." : "草稿需送出後，本部才會收到請貨通知。"} />
        <DataTable
          columns={requestColumns}
          rows={requests}
          emptyText="目前沒有請貨單。"
          cardTitle={(row) => row.requestNo}
          cardDescription={(row) => row.itemSummary}
          cardBadges={(row) => <StatusBadge tone={statusTone(row.status)}>{STATUS_LABELS[row.status] || row.status}</StatusBadge>}
        />
      </section>

      {selectedRequest ? (
        <section className="content-card section-panel">
          <AdminSectionHeader
            eyebrow="請貨明細"
            title={selectedRequest.requestNo}
            description={`${selectedRequest.requestingStoreName || ""} / ${formatDate(selectedRequest.submittedAt)}`}
            badges={<StatusBadge tone={statusTone(selectedRequest.status)}>{STATUS_LABELS[selectedRequest.status] || selectedRequest.status}</StatusBadge>}
          />
          {selectedRequest.note ? <div className="empty-state">{selectedRequest.note}</div> : null}
          <DataTable
            columns={itemColumns}
            rows={selectedRequest.items || []}
            emptyText="此請貨單沒有品項。"
            cardTitle={(row) => row.requestedSku}
            cardDescription={(row) => `${row.requestedProductName} / ${row.quantityRequested} 件`}
          />
        </section>
      ) : null}
    </div>
  );
}
