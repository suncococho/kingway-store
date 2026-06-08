import { useEffect, useMemo, useState } from "react";
import DataTable from "../components/DataTable";
import ProcessingOverlay from "../components/ProcessingOverlay";
import StatusBadge from "../components/StatusBadge";
import { useProcessingGuard } from "../hooks/useProcessingGuard";
import { apiRequest } from "../lib/api";

function toNumber(value) {
  return Number(value || 0);
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  return String(value).slice(0, 10);
}

function normalizeRequestType(value) {
  const type = String(value || "").trim().toUpperCase();
  if (type === "RETURN" || value === "退貨") {
    return "RETURN";
  }
  return "PURCHASE_ORDER";
}

function getTypeLabel(value) {
  return normalizeRequestType(value) === "RETURN" ? "退貨" : "發注";
}

function getStatusLabel(status) {
  const labels = {
    PENDING_SUPPLIER: "待入庫",
    APPROVED: "待入庫",
    PARTIALLY_RECEIVED: "部分入庫",
    RECEIVED: "已完成",
    RETURN_CONFIRMED: "已退貨",
    REJECTED: "已拒絕"
  };
  return labels[status] || status || "-";
}

function getStatusTone(status) {
  if (status === "PARTIALLY_RECEIVED") {
    return "warning";
  }
  if (status === "RECEIVED" || status === "RETURN_CONFIRMED") {
    return "success";
  }
  if (status === "REJECTED") {
    return "danger";
  }
  return "info";
}

function getPendingQuantity(row) {
  if (normalizeRequestType(row.requestType) !== "PURCHASE_ORDER") {
    return 0;
  }
  return Math.max(toNumber(row.quantity) - toNumber(row.receivedQuantity), 0);
}

function getProductSupplierName(product) {
  return product?.supplierName || product?.supplier_name || product?.supplier || product?.vendorName || product?.vendor_name || "";
}

export default function SuppliersPage() {
  const [rows, setRows] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [filters, setFilters] = useState({
    startDate: "",
    endDate: "",
    supplierName: "ALL",
    productText: "",
    type: "ALL",
    status: "ALL"
  });
  const [form, setForm] = useState({
    supplierName: "",
    sku: "",
    quantity: 1,
    type: "PURCHASE_ORDER"
  });
  const { isProcessing, pendingAction, runWithProcessing } = useProcessingGuard();

  async function load() {
    setError("");

    try {
      setRows(await apiRequest("/suppliers/requests"));
      setMonthly(await apiRequest("/suppliers/monthly"));
      setProducts(await apiRequest("/products"));
    } catch (requestError) {
      setRows([]);
      setMonthly([]);
      setProducts([]);
      setError(requestError.message || "供應商資料讀取失敗");
    }
  }

  async function refreshWithProcessing() {
    await runWithProcessing(load, { id: "supplier-refresh", label: "供應商資料更新中..." }).catch((requestError) => {
      setError(requestError.message || "供應商資料讀取失敗");
    });
  }

  useEffect(() => {
    load();
  }, []);

  const normalizedRows = useMemo(
    () =>
      rows.map((row) => {
        const requestType = normalizeRequestType(row.requestType || row.request_type);
        return {
          ...row,
          requestType,
          typeLabel: getTypeLabel(requestType),
          statusLabel: getStatusLabel(row.status),
          statusTone: getStatusTone(row.status),
          createdDateLabel: formatDate(row.createdAt),
          quantity: toNumber(row.quantity),
          receivedQuantity: toNumber(row.receivedQuantity),
          pendingQuantity: getPendingQuantity({ ...row, requestType }),
          returnQuantity: requestType === "RETURN" ? toNumber(row.quantity) : 0,
          supplierName: row.supplierName || "未指定供應商",
          sku: row.sku || "-",
          productName: row.productName || "-"
        };
      }),
    [rows]
  );

  const supplierOptions = useMemo(() => {
    const names = new Set();

    for (const row of normalizedRows) {
      if (row.supplierName) {
        names.add(row.supplierName);
      }
    }

    for (const row of monthly) {
      if (row.supplierName) {
        names.add(row.supplierName);
      }
    }

    for (const product of products) {
      const supplierName = getProductSupplierName(product);
      if (supplierName) {
        names.add(supplierName);
      }
    }

    return Array.from(names).sort();
  }, [monthly, normalizedRows, products]);

  const skuSupplierMap = useMemo(() => {
    const map = new Map();

    for (const row of normalizedRows) {
      if (!row.sku || row.sku === "-" || !row.supplierName) {
        continue;
      }

      const suppliers = map.get(row.sku) || new Set();
      suppliers.add(row.supplierName);
      map.set(row.sku, suppliers);
    }

    return map;
  }, [normalizedRows]);

  useEffect(() => {
    if (!form.supplierName && supplierOptions.length) {
      setForm((current) => ({ ...current, supplierName: supplierOptions[0] }));
    }
  }, [form.supplierName, supplierOptions]);

  const filteredRows = useMemo(
    () =>
      normalizedRows.filter((row) => {
        const rowDate = row.createdDateLabel === "-" ? "" : row.createdDateLabel;
        const text = filters.productText.trim().toLowerCase();

        if (filters.startDate && rowDate && rowDate < filters.startDate) {
          return false;
        }
        if (filters.endDate && rowDate && rowDate > filters.endDate) {
          return false;
        }
        if (filters.supplierName !== "ALL" && row.supplierName !== filters.supplierName) {
          return false;
        }
        if (text && !`${row.sku} ${row.productName}`.toLowerCase().includes(text)) {
          return false;
        }
        if (filters.type !== "ALL" && row.requestType !== filters.type) {
          return false;
        }
        if (filters.status !== "ALL") {
          if (filters.status === "PENDING_RECEIVE" && !["PENDING_SUPPLIER", "APPROVED"].includes(row.status)) {
            return false;
          }
          if (filters.status !== "PENDING_RECEIVE" && row.status !== filters.status) {
            return false;
          }
        }
        return true;
      }),
    [filters, normalizedRows]
  );

  const kpis = useMemo(() => {
    const supplierCount = new Set(filteredRows.map((row) => row.supplierName)).size;
    const productCount = new Set(filteredRows.map((row) => row.sku).filter((sku) => sku && sku !== "-")).size;

    return [
      { label: "發注總數", value: filteredRows.filter((row) => row.requestType === "PURCHASE_ORDER").reduce((sum, row) => sum + row.quantity, 0) },
      { label: "入庫總數", value: filteredRows.reduce((sum, row) => sum + row.receivedQuantity, 0) },
      { label: "退貨總數", value: filteredRows.filter((row) => row.requestType === "RETURN").reduce((sum, row) => sum + row.quantity, 0) },
      { label: "待入庫數", value: filteredRows.reduce((sum, row) => sum + row.pendingQuantity, 0) },
      { label: "供應商數", value: supplierCount },
      { label: "商品種類數", value: productCount }
    ];
  }, [filteredRows]);

  const supplierSummaryRows = useMemo(() => {
    const summary = new Map();

    for (const row of filteredRows) {
      const current = summary.get(row.supplierName) || {
        id: row.supplierName,
        supplierName: row.supplierName,
        purchaseQuantity: 0,
        receivedQuantity: 0,
        returnQuantity: 0,
        pendingQuantity: 0,
        lastTradeDate: "",
        status: "RECEIVED"
      };

      if (row.requestType === "PURCHASE_ORDER") {
        current.purchaseQuantity += row.quantity;
        current.receivedQuantity += row.receivedQuantity;
        current.pendingQuantity += row.pendingQuantity;
      } else {
        current.returnQuantity += row.quantity;
      }

      if (row.createdDateLabel !== "-" && row.createdDateLabel > current.lastTradeDate) {
        current.lastTradeDate = row.createdDateLabel;
      }
      if (current.pendingQuantity > 0) {
        current.status = "PENDING_SUPPLIER";
      } else if (current.returnQuantity > 0) {
        current.status = "RETURN_CONFIRMED";
      }

      summary.set(row.supplierName, current);
    }

    return Array.from(summary.values());
  }, [filteredRows]);

  const productSummaryRows = useMemo(() => {
    const summary = new Map();

    for (const row of filteredRows) {
      const key = `${row.supplierName}-${row.sku}`;
      const current = summary.get(key) || {
        id: key,
        sku: row.sku,
        productName: row.productName,
        supplierName: row.supplierName,
        purchaseQuantity: 0,
        receivedQuantity: 0,
        returnQuantity: 0,
        stock: toNumber(row.stock),
        pendingQuantity: 0
      };

      if (row.requestType === "PURCHASE_ORDER") {
        current.purchaseQuantity += row.quantity;
        current.receivedQuantity += row.receivedQuantity;
        current.pendingQuantity += row.pendingQuantity;
      } else {
        current.returnQuantity += row.quantity;
      }

      summary.set(key, current);
    }

    return Array.from(summary.values());
  }, [filteredRows]);

  const productOptions = products
    .filter((product) => {
      const q = productSearch.trim().toLowerCase();
      if (!q) return false;
      const textMatches = String(product.sku || "").toLowerCase().includes(q) || String(product.name || "").toLowerCase().includes(q);
      if (!textMatches) {
        return false;
      }

      if (!form.supplierName) {
        return true;
      }

      const productSupplierName = getProductSupplierName(product);
      if (productSupplierName) {
        return productSupplierName === form.supplierName;
      }

      const suppliers = skuSupplierMap.get(product.sku);
      if (suppliers?.size) {
        return suppliers.has(form.supplierName);
      }

      return true;
    })
    .slice(0, 8);

  const selectedProduct = products.find((product) => product.sku === form.sku);

  async function createRequest() {
    if (!form.supplierName || !form.sku || Number(form.quantity || 0) <= 0) {
      alert("請選擇供應商、SKU 與數量");
      return;
    }

    await runWithProcessing(async () => {
      await apiRequest("/suppliers/requests", {
        method: "POST",
        body: JSON.stringify({
          type: form.type,
          supplierName: form.supplierName,
          sku: form.sku,
          quantity: Number(form.quantity),
          note: "WEB ERP"
        })
      });

      setForm({
        supplierName: form.supplierName,
        sku: "",
        quantity: 1,
        type: form.type
      });
      setProductSearch("");
      await load();
      alert("建立完成");
    }, { id: "supplier-create", label: "供應商單建立中..." }).catch((requestError) => {
      alert(requestError.message || "建立失敗");
    });
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

  async function completeReturn(id) {
    if (!confirm("確認退貨完成？")) return;

    await apiRequest(`/suppliers/${id}/return-done`, {
      method: "POST",
      body: JSON.stringify({})
    });

    await load();
    alert("退貨完成");
  }

  const supplierSummaryColumns = [
    { key: "supplierName", label: "供應商" },
    { key: "purchaseQuantity", label: "發注數量" },
    { key: "receivedQuantity", label: "入庫數量" },
    { key: "returnQuantity", label: "退貨數量" },
    { key: "pendingQuantity", label: "待入庫" },
    { key: "lastTradeDate", label: "最近交易日", render: (row) => row.lastTradeDate || "-" },
    { key: "status", label: "狀態", render: (row) => <StatusBadge tone={getStatusTone(row.status)}>{getStatusLabel(row.status)}</StatusBadge> }
  ];

  const productSummaryColumns = [
    { key: "sku", label: "SKU" },
    { key: "productName", label: "商品名稱" },
    { key: "supplierName", label: "供應商" },
    { key: "purchaseQuantity", label: "發注數量" },
    { key: "receivedQuantity", label: "入庫數量" },
    { key: "returnQuantity", label: "退貨數量" },
    { key: "stock", label: "目前庫存" },
    { key: "pendingQuantity", label: "待入庫" }
  ];

  const transactionColumns = [
    { key: "createdDateLabel", label: "日期" },
    { key: "typeLabel", label: "類型", render: (row) => <StatusBadge tone={row.requestType === "RETURN" ? "warning" : "info"}>{row.typeLabel}</StatusBadge> },
    { key: "supplierName", label: "供應商" },
    { key: "sku", label: "SKU" },
    { key: "productName", label: "商品" },
    { key: "quantity", label: "數量" },
    { key: "receivedQuantity", label: "已入庫" },
    { key: "pendingQuantity", label: "待入庫" },
    { key: "status", label: "狀態", render: (row) => <StatusBadge tone={row.statusTone}>{row.statusLabel}</StatusBadge> },
    {
      key: "actions",
      label: "操作",
      render: (row) => {
        const canReceive = row.requestType === "PURCHASE_ORDER" && row.pendingQuantity > 0 && row.status !== "REJECTED";
        const canReturn = row.requestType === "RETURN" && row.status !== "RETURN_CONFIRMED" && row.status !== "REJECTED";

        return (
          <div className="action-row compact-actions">
            {canReceive ? (
              <button className="primary-button" onClick={() => receiveRequest(row.id)}>
                確認入庫
              </button>
            ) : null}
            {canReturn ? (
              <button className="primary-button" onClick={() => completeReturn(row.id)}>
                完成退貨
              </button>
            ) : null}
          </div>
        );
      }
    }
  ];

  return (
    <div className="page-container suppliers-page">
      <div className="page-header">
        <div>
          <h1>供應商 / 發注 / 退貨</h1>
          <p>依供應商、商品與交易狀態整理發注、入庫與退貨。</p>
        </div>
        <button className="primary-button" onClick={refreshWithProcessing} disabled={isProcessing}>
          {pendingAction?.id === "supplier-refresh" ? "處理中..." : "重新整理"}
        </button>
      </div>

      {error ? <div className="empty-state">{error}</div> : null}

      <section className="content-card section-panel">
        <div className="section-header">
          <div>
            <h2>篩選條件</h2>
            <p className="muted-text">先縮小期間、供應商、商品與狀態，再查看摘要與交易。</p>
          </div>
        </div>
        <div className="grid-form compact-grid">
          <label className="form-field">
            <span>期間開始日</span>
            <input type="date" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} />
          </label>
          <label className="form-field">
            <span>期間結束日</span>
            <input type="date" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} />
          </label>
          <label className="form-field">
            <span>供應商</span>
            <select value={filters.supplierName} onChange={(event) => setFilters((current) => ({ ...current, supplierName: event.target.value }))}>
              <option value="ALL">全部供應商</option>
              {supplierOptions.map((supplierName) => (
                <option key={supplierName} value={supplierName}>{supplierName}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>商品 / SKU</span>
            <input value={filters.productText} onChange={(event) => setFilters((current) => ({ ...current, productText: event.target.value }))} placeholder="搜尋 SKU 或商品名稱" />
          </label>
          <label className="form-field">
            <span>類型</span>
            <select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}>
              <option value="ALL">全部</option>
              <option value="PURCHASE_ORDER">發注</option>
              <option value="RETURN">退貨</option>
            </select>
          </label>
          <label className="form-field">
            <span>狀態</span>
            <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="ALL">全部</option>
              <option value="PENDING_RECEIVE">待入庫</option>
              <option value="PARTIALLY_RECEIVED">部分入庫</option>
              <option value="RECEIVED">已完成</option>
              <option value="RETURN_CONFIRMED">已退貨</option>
            </select>
          </label>
        </div>
      </section>

      <div className="admin-summary-grid">
        {kpis.map((card) => (
          <article key={card.label} className="admin-summary-card">
            <div className="admin-summary-label">{card.label}</div>
            <div className="admin-summary-value">{card.value}</div>
          </article>
        ))}
      </div>

      <section className="content-card section-panel">
        <div className="section-header">
          <div>
            <h2>供應商別摘要</h2>
            <p className="muted-text">快速看每個供應商的發注、入庫、退貨與待入庫量。</p>
          </div>
        </div>
        <DataTable
          columns={supplierSummaryColumns}
          rows={supplierSummaryRows}
          emptyText="目前沒有符合條件的供應商資料。"
          cardTitle={(row) => row.supplierName}
          cardDescription={(row) => `發注 ${row.purchaseQuantity} / 入庫 ${row.receivedQuantity} / 待入庫 ${row.pendingQuantity}`}
          cardBadges={(row) => <StatusBadge tone={getStatusTone(row.status)}>{getStatusLabel(row.status)}</StatusBadge>}
        />
      </section>

      <section className="content-card section-panel">
        <div className="section-header">
          <div>
            <h2>商品別摘要</h2>
            <p className="muted-text">依 SKU 與供應商彙總數量，確認商品目前庫存與未入庫量。</p>
          </div>
        </div>
        <DataTable
          columns={productSummaryColumns}
          rows={productSummaryRows}
          emptyText="目前沒有符合條件的商品資料。"
          cardTitle={(row) => row.sku}
          cardDescription={(row) => `${row.productName} / ${row.supplierName}`}
          cardBadges={(row) => <StatusBadge tone={row.pendingQuantity > 0 ? "warning" : "success"}>待入庫 {row.pendingQuantity}</StatusBadge>}
        />
      </section>

      <section className="content-card section-panel">
        <div className="section-header">
          <div>
            <h2>交易紀錄</h2>
            <p className="muted-text">發注、入庫、退貨依日期排序，桌機看表格，手機看卡片。</p>
          </div>
          <StatusBadge tone="info">顯示 {filteredRows.length} 筆</StatusBadge>
        </div>
        <DataTable
          columns={transactionColumns}
          rows={filteredRows}
          emptyText="目前沒有符合條件的交易紀錄。"
          cardTitle={(row) => `#${row.id} ${row.typeLabel}`}
          cardDescription={(row) => `${row.createdDateLabel} / ${row.supplierName} / ${row.sku}`}
          cardBadges={(row) => <StatusBadge tone={row.statusTone}>{row.statusLabel}</StatusBadge>}
        />
      </section>

      <section className="content-card section-panel">
        <div className="section-header">
          <div>
            <h2>建立發注 / 退貨</h2>
            <p className="muted-text">建立供應商交易後，依狀態在交易紀錄中完成入庫或退貨確認。</p>
          </div>
        </div>
        <div className="grid-form compact-grid">
          <label className="form-field">
            <span>供應商</span>
            <select value={form.supplierName} onChange={(event) => {
              setForm((current) => ({ ...current, supplierName: event.target.value, sku: "" }));
              setProductSearch("");
            }}>
              {supplierOptions.length ? null : <option value="">尚無供應商資料</option>}
              {supplierOptions.map((supplierName) => (
                <option key={supplierName} value={supplierName}>{supplierName}</option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>SKU / 商品搜尋</span>
            <input placeholder={form.supplierName ? "搜尋此供應商的 SKU / 商品名稱" : "請先選擇供應商"} value={productSearch || form.sku} disabled={!form.supplierName} onChange={(event) => {
              setProductSearch(event.target.value);
              setForm((current) => ({ ...current, sku: event.target.value }));
            }} />
          </label>

          <label className="form-field">
            <span>數量</span>
            <input type="number" min="1" placeholder="數量" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: Number(event.target.value) }))} />
          </label>

          <label className="form-field">
            <span>類型</span>
            <select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}>
              <option value="PURCHASE_ORDER">發注</option>
              <option value="RETURN">退貨</option>
            </select>
          </label>

          {selectedProduct ? (
            <div className="field-item form-field-wide">
              <div className="field-label">已選擇商品</div>
              <div className="field-value">{selectedProduct.sku} / {selectedProduct.name} / 庫存 {selectedProduct.stock}</div>
            </div>
          ) : null}

          {productOptions.length ? (
            <div className="stack-list form-field-wide">
              {productOptions.map((product) => (
                <button type="button" key={product.id} className="secondary-button" onClick={() => {
                  setForm((current) => ({ ...current, sku: product.sku }));
                  setProductSearch("");
                }}>
                  {product.sku} / {product.name} / 庫存 {product.stock}
                </button>
              ))}
            </div>
          ) : null}

          <button className="primary-button inline-submit" onClick={createRequest} disabled={isProcessing || !form.supplierName}>
            {pendingAction?.id === "supplier-create" ? "處理中..." : "建立"}
          </button>
        </div>
      </section>

      <section className="content-card section-panel">
        <div className="section-header">
          <div>
            <h2>月結摘要</h2>
            <p className="muted-text">目前 API 提供當月供應商彙總，作為月結快速參考。</p>
          </div>
        </div>
        <div className="admin-highlight-list">
          {monthly.map((row) => (
            <div className="metric-row" key={row.supplierName || "none"}>
              <span>{row.supplierName || "-"}</span>
              <strong>發注 {toNumber(row.poQty)} / 入庫 {toNumber(row.receivedQty)} / 退貨 {toNumber(row.returnQty)}</strong>
            </div>
          ))}
          {!monthly.length ? <div className="empty-state">目前沒有月結資料。</div> : null}
        </div>
      </section>
      <ProcessingOverlay active={isProcessing} message={pendingAction?.label || "處理中，請稍候..."} />
    </div>
  );
}
