import { useEffect, useState } from "react";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import { apiRequest } from "../lib/api";

function getRelationshipLabel(value) {
  const labels = {
    HEADQUARTERS: "總部",
    WAREHOUSE: "本部倉庫",
    DIRECT_STORE: "直營門市",
    FRANCHISE_STORE: "加盟門市"
  };
  return labels[value] || value || "-";
}

const STATUS_LABELS = {
  DRAFT: "草稿",
  SHIPPED: "已出貨，待門市入庫",
  PARTIALLY_RECEIVED: "部分入庫",
  RECEIVED: "已完成入庫",
  DISCREPANCY: "差異",
  CANCELED: "已取消"
};

function getStatusTone(status) {
  if (status === "RECEIVED") return "success";
  if (status === "SHIPPED" || status === "PARTIALLY_RECEIVED") return "warning";
  if (status === "DISCREPANCY") return "danger";
  if (status === "CANCELED") return "neutral";
  return "info";
}

const EMPTY_TRANSFER_FORM = {
  fromStoreId: "",
  toStoreId: "",
  productQuery: "",
  selectedProductId: "",
  quantity: 1,
  unitCost: 0,
  note: "",
  items: []
};

function HeadquartersPage() {
  const [data, setData] = useState(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [activeTab, setActiveTab] = useState("company");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [transferForm, setTransferForm] = useState(EMPTY_TRANSFER_FORM);
  const [transfers, setTransfers] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [transferLoading, setTransferLoading] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadCompanies() {
      setLoading(true);
      setError("");
      try {
        const response = await apiRequest("/company/me");
        if (!active) return;
        setData(response);
        const firstCompany = Array.isArray(response.companies) ? response.companies[0] : null;
        setSelectedCompanyId(firstCompany ? String(firstCompany.id) : "");
      } catch (requestError) {
        if (active) setError(requestError.message || "讀取總部資料失敗");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadCompanies();
    return () => {
      active = false;
    };
  }, []);

  const companies = Array.isArray(data?.companies) ? data.companies : [];
  const selectedCompany = companies.find((company) => String(company.id) === String(selectedCompanyId)) || companies[0] || null;
  const companyStores = selectedCompany?.stores || [];
  const fromStores = companyStores.filter((store) => ["HEADQUARTERS", "WAREHOUSE"].includes(store.relationshipType));
  const toStores = companyStores.filter((store) => ["FRANCHISE_STORE", "DIRECT_STORE"].includes(store.relationshipType));
  const selectedCandidate = candidates.find((product) => String(product.fromProductId) === String(transferForm.selectedProductId)) || null;
  const canWriteTransfers = ["company_owner", "hq_admin", "inventory_manager"].includes(selectedCompany?.role);
  const tabs = [
    { key: "company", label: "公司資料" },
    { key: "stores", label: "所屬門市" },
    { key: "transfers", label: "本部出貨" },
    { key: "stock", label: "跨店庫存: 下一階段" },
    { key: "settlement", label: "加盟店結算: 下一階段" }
  ];
  const storeColumns = [
    { key: "storeCode", label: "門市代碼" },
    { key: "storeName", label: "門市名稱" },
    { key: "relationshipType", label: "關係", render: (row) => getRelationshipLabel(row.relationshipType) },
    { key: "storeStatus", label: "門市狀態" }
  ];
  const transferColumns = [
    { key: "transferNo", label: "出貨單號" },
    { key: "status", label: "狀態", render: (row) => <StatusBadge tone={getStatusTone(row.status)}>{STATUS_LABELS[row.status] || row.status}</StatusBadge> },
    { key: "fromStoreName", label: "出貨門市" },
    { key: "toStoreName", label: "收貨門市" },
    { key: "itemSummary", label: "商品" },
    {
      key: "note",
      label: "來源 / 備註",
      render: (row) => row.note ? (
        <span>{String(row.note).includes("REQ-") ? `來源：門市請貨 ${row.note}` : row.note}</span>
      ) : "-"
    },
    { key: "actions", label: "操作", render: (row) => (
      <div className="action-row compact-actions">
        {row.status === "DRAFT" && canWriteTransfers ? <button type="button" className="primary-button" onClick={() => shipTransfer(row.id)}>確認出貨（扣本部庫存）</button> : null}
        {row.status === "DRAFT" && canWriteTransfers ? <button type="button" className="secondary-button" onClick={() => cancelTransfer(row.id)}>取消</button> : null}
        {row.status === "SHIPPED" ? <StatusBadge tone="warning">待入庫</StatusBadge> : null}
        {row.status === "RECEIVED" ? <StatusBadge tone="success">已完成入庫</StatusBadge> : null}
      </div>
    ) }
  ];

  useEffect(() => {
    if (!selectedCompany) return;
    setTransferForm((current) => ({
      ...current,
      fromStoreId: current.fromStoreId || String(fromStores[0]?.storeId || ""),
      toStoreId: current.toStoreId || String(toStores[0]?.storeId || "")
    }));
  }, [selectedCompanyId, selectedCompany?.id]);

  useEffect(() => {
    if (!selectedCompany?.id) return;
    loadTransfers();
  }, [selectedCompany?.id]);

  useEffect(() => {
    if (!selectedCompany?.id || !transferForm.fromStoreId || !transferForm.toStoreId) {
      setCandidates([]);
      return;
    }
    const timer = setTimeout(() => {
      loadCandidates();
    }, 250);
    return () => clearTimeout(timer);
  }, [selectedCompany?.id, transferForm.fromStoreId, transferForm.toStoreId, transferForm.productQuery]);

  async function loadTransfers() {
    if (!selectedCompany?.id) return;
    setTransferLoading(true);
    try {
      const response = await apiRequest(`/store-transfers/company/${selectedCompany.id}`);
      setTransfers(Array.isArray(response.transfers) ? response.transfers : []);
    } catch (requestError) {
      setError(requestError.message || "出貨單讀取失敗");
    } finally {
      setTransferLoading(false);
    }
  }

  async function loadCandidates() {
    const params = new URLSearchParams({
      fromStoreId: transferForm.fromStoreId,
      toStoreId: transferForm.toStoreId,
      q: transferForm.productQuery || ""
    });
    try {
      const response = await apiRequest(`/store-transfers/company/${selectedCompany.id}/products/transfer-candidates?${params.toString()}`);
      const rows = Array.isArray(response.products) ? response.products : [];
      setCandidates(rows);
      const selected = rows.find((row) => String(row.fromProductId) === String(transferForm.selectedProductId));
      if (!selected) {
        setTransferForm((current) => ({ ...current, selectedProductId: "" }));
      }
    } catch (requestError) {
      setCandidates([]);
      setError(requestError.message || "商品搜尋失敗");
    }
  }

  function updateTransferForm(event) {
    const { name, value } = event.target;
    setTransferForm((current) => ({
      ...current,
      [name]: name === "quantity" ? Number(value) : value,
      ...(name === "fromStoreId" || name === "toStoreId" ? { items: [], selectedProductId: "" } : {})
    }));
  }

  function chooseCandidate(product) {
    setTransferForm((current) => ({
      ...current,
      selectedProductId: String(product.fromProductId),
      unitCost: Number(product.unitCost || 0)
    }));
  }

  function addTransferItem() {
    if (!selectedCandidate) {
      alert("請先選擇可對應收貨門市 SKU 的商品");
      return;
    }
    if (!selectedCandidate.mapped) {
      alert("門市商品未建立，請先於收貨門市建立相同 SKU 商品");
      return;
    }
    const quantity = Number(transferForm.quantity || 0);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      alert("請輸入正確出貨數量");
      return;
    }
    setTransferForm((current) => {
      const existingIndex = current.items.findIndex((item) => String(item.fromProductId) === String(selectedCandidate.fromProductId));
      const nextItem = {
        fromProductId: Number(selectedCandidate.fromProductId),
        sku: selectedCandidate.sku,
        name: selectedCandidate.name,
        quantity,
        unitCost: Number(current.unitCost || selectedCandidate.unitCost || 0)
      };
      const items = existingIndex >= 0
        ? current.items.map((item, index) => index === existingIndex ? nextItem : item)
        : [...current.items, nextItem];
      return {
        ...current,
        items,
        selectedProductId: "",
        quantity: 1
      };
    });
  }

  function removeTransferItem(fromProductId) {
    setTransferForm((current) => ({
      ...current,
      items: current.items.filter((item) => String(item.fromProductId) !== String(fromProductId))
    }));
  }

  async function createTransfer(event) {
    event.preventDefault();
    if (!transferForm.items.length) {
      alert("請先加入出貨商品");
      return;
    }
    try {
      await apiRequest(`/store-transfers/company/${selectedCompany.id}`, {
        method: "POST",
        body: JSON.stringify({
          fromStoreId: Number(transferForm.fromStoreId),
          toStoreId: Number(transferForm.toStoreId),
          note: transferForm.note || null,
          items: transferForm.items.map((item) => ({
            fromProductId: Number(item.fromProductId),
            quantity: Number(item.quantity || 0),
            unitCost: Number(item.unitCost || 0)
          }))
        }),
        processingMessage: "建立出貨單中"
      });
      setTransferForm((current) => ({ ...EMPTY_TRANSFER_FORM, fromStoreId: current.fromStoreId, toStoreId: current.toStoreId }));
      await loadTransfers();
    } catch (requestError) {
      alert(requestError.message || "建立出貨單失敗");
    }
  }

  async function shipTransfer(id) {
    if (!confirm("確認後本部庫存將立即扣除，且此出貨單會進入門市入庫流程。請確認商品、數量與門市無誤後再繼續。")) return;
    try {
      await apiRequest(`/store-transfers/company/${selectedCompany.id}/${id}/ship`, { method: "POST", processingMessage: "出貨處理中" });
      await loadTransfers();
    } catch (requestError) {
      alert(requestError.message || "出貨失敗");
    }
  }

  async function cancelTransfer(id) {
    if (!confirm("確認取消此草稿？")) return;
    try {
      await apiRequest(`/store-transfers/company/${selectedCompany.id}/${id}/cancel`, { method: "POST" });
      await loadTransfers();
    } catch (requestError) {
      alert(requestError.message || "取消失敗");
    }
  }

  if (loading) {
    return <PageHeader title="總部管理" description="載入總部資料中..." />;
  }

  if (error) {
    return (
      <div>
        <PageHeader title="總部管理" description="公司 / 品牌與所屬門市。" />
        <div className="empty-state">{error}</div>
      </div>
    );
  }

  if (!companies.length) {
    return (
      <div>
        <PageHeader title="總部管理" description="公司 / 品牌與所屬門市。" />
        <div className="empty-state">此帳號沒有總部管理權限。</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="總部管理" description="公司資料、所屬門市與本部出貨。" />
      <SectionTabs items={tabs} value={activeTab} onChange={setActiveTab} />

      {activeTab === "company" ? <section className="content-card section-panel">
        <AdminSectionHeader
          eyebrow="公司資料"
          title={selectedCompany?.name || "總部"}
          description="目前本部出貨已啟用；結算與跨店庫存留待下一階段。"
          badges={<StatusBadge tone="info">{selectedCompany?.role || "viewer"}</StatusBadge>}
          actions={
            companies.length > 1 ? (
              <select value={selectedCompanyId} onChange={(event) => setSelectedCompanyId(event.target.value)}>
                {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            ) : null
          }
        />
        <div className="admin-summary-grid dashboard-summary-grid">
          <article className="admin-summary-card"><div className="admin-summary-label">公司代碼</div><div className="admin-summary-value admin-summary-value-small">{selectedCompany?.code || "-"}</div></article>
          <article className="admin-summary-card"><div className="admin-summary-label">公司狀態</div><div className="admin-summary-value admin-summary-value-small">{selectedCompany?.status || "-"}</div></article>
          <article className="admin-summary-card"><div className="admin-summary-label">所屬門市</div><div className="admin-summary-value">{selectedCompany?.stores?.length || 0}</div></article>
        </div>
      </section> : null}

      {activeTab === "stores" ? <section className="content-card section-panel">
        <AdminSectionHeader eyebrow="所屬門市" title="門市列表" description="總部帳號可查看所屬門市；門市員工仍只看自己的店別。" />
        <DataTable columns={storeColumns} rows={selectedCompany?.stores || []} emptyText="尚未連結門市。" />
      </section> : null}

      {activeTab === "transfers" ? (
        <>
          <section className="content-card section-panel">
            <AdminSectionHeader
              eyebrow="本部出貨"
              title="新增調撥單"
              description="本部出貨用於將高雄本部庫存調撥至直營店或加盟店。出貨後本部庫存會先扣除，門市完成入庫確認後，門市庫存才會增加。"
            />
            <div className="empty-state">
              此頁是已建立出貨單的實際出貨確認頁。按下『確認出貨（扣本部庫存）』後，本部庫存會立即扣除。若您要處理門市請貨，請先至『本部請貨管理』建立出貨單。
            </div>
            {canWriteTransfers ? (
              <form className="grid-form compact-grid" onSubmit={createTransfer}>
                <label className="form-field"><span>出貨門市</span><select name="fromStoreId" value={transferForm.fromStoreId} onChange={updateTransferForm}>{fromStores.map((store) => <option key={store.storeId} value={store.storeId}>{store.storeName}</option>)}</select></label>
                <label className="form-field"><span>收貨門市</span><select name="toStoreId" value={transferForm.toStoreId} onChange={updateTransferForm}>{toStores.map((store) => <option key={store.storeId} value={store.storeId}>{store.storeName}</option>)}</select></label>
                <label className="form-field"><span>商品搜尋</span><input name="productQuery" value={transferForm.productQuery} onChange={updateTransferForm} placeholder="SKU / 商品名稱" /></label>
                <label className="form-field"><span>數量</span><input name="quantity" type="number" min="1" value={transferForm.quantity} onChange={updateTransferForm} /></label>
                <label className="form-field"><span>結算單價</span><input name="unitCost" type="number" min="0" step="1" value={transferForm.unitCost} onChange={updateTransferForm} /></label>
                <label className="form-field form-field-wide"><span>備註</span><input name="note" value={transferForm.note} onChange={updateTransferForm} /></label>
                {Number(transferForm.unitCost || 0) <= 0 ? <div className="empty-state form-field-wide">結算單價為 0，月結金額可能為 0，請確認。</div> : null}
                {selectedCandidate ? (
                  <div className="field-grid form-field-wide">
                    <div className="field-item"><div className="field-label">SKU</div><div className="field-value">{selectedCandidate.sku}</div></div>
                    <div className="field-item"><div className="field-label">商品名稱</div><div className="field-value">{selectedCandidate.name}</div></div>
                    <div className="field-item"><div className="field-label">出貨數量</div><div className="field-value">{transferForm.quantity}</div></div>
                    <div className="field-item"><div className="field-label">結算單價</div><div className="field-value">NT$ {Number(transferForm.unitCost || 0).toLocaleString()}</div></div>
                    <div className="field-item"><div className="field-label">小計</div><div className="field-value">NT$ {(Number(transferForm.quantity || 0) * Number(transferForm.unitCost || 0)).toLocaleString()}</div></div>
                  </div>
                ) : null}
                <div className="form-field-wide stack-list">
                  {candidates.slice(0, 8).map((product) => (
                    <button type="button" key={product.fromProductId} className={String(product.fromProductId) === String(transferForm.selectedProductId) ? "primary-button" : "secondary-button"} onClick={() => chooseCandidate(product)}>
                      {product.sku} / {product.name} / 本部庫存 {product.fromStock} / 門市庫存 {product.toStock ?? "-"} {product.mapped ? "" : " / 門市商品未建立"}
                    </button>
                  ))}
                </div>
                <div className="action-row form-field-wide">
                  <button type="button" className="secondary-button" onClick={addTransferItem}>加入出貨商品</button>
                  <button type="submit" className="primary-button">新增調撥單</button>
                </div>
                {transferForm.items.length ? (
                  <div className="form-field-wide stack-list">
                    {transferForm.items.map((item) => (
                      <div className="field-item" key={item.fromProductId}>
                        <div className="field-label">{item.sku} / {item.name}</div>
                        <div className="field-value">出貨數量 {item.quantity} / 結算單價 NT$ {item.unitCost.toLocaleString()} / 小計 NT$ {(Number(item.quantity || 0) * Number(item.unitCost || 0)).toLocaleString()}</div>
                        {Number(item.unitCost || 0) <= 0 ? <div className="field-label">結算單價為 0，月結金額可能為 0，請確認。</div> : null}
                        <button type="button" className="secondary-button" onClick={() => removeTransferItem(item.fromProductId)}>移除</button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </form>
            ) : <div className="empty-state">此帳號只有總部出貨查詢權限。</div>}
          </section>
          <section className="content-card section-panel">
            <AdminSectionHeader eyebrow="出貨紀錄" title="本部出貨列表" description={transferLoading ? "讀取中..." : "只有草稿出貨單會顯示『確認出貨（扣本部庫存）』；已出貨後由收貨門市入庫確認。"} />
            <DataTable columns={transferColumns} rows={transfers} emptyText="尚無出貨單。" cardTitle={(row) => row.transferNo} cardDescription={(row) => `${row.fromStoreName} -> ${row.toStoreName}`} cardBadges={(row) => <StatusBadge tone={getStatusTone(row.status)}>{STATUS_LABELS[row.status] || row.status}</StatusBadge>} />
          </section>
        </>
      ) : null}

      {activeTab === "stock" || activeTab === "settlement" ? <section className="content-card section-panel">
        <AdminSectionHeader eyebrow="下一階段" title={activeTab === "stock" ? "跨店庫存" : "加盟店結算"} description="此功能留待下一階段。" />
        <div className="admin-highlight-list">
          <div className="metric-row"><span>跨店庫存</span><strong>下一階段</strong></div>
          <div className="metric-row"><span>加盟店結算</span><strong>下一階段</strong></div>
        </div>
      </section> : null}
    </div>
  );
}

export default HeadquartersPage;
