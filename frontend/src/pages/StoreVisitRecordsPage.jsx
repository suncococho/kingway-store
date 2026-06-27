import { useEffect, useMemo, useState } from "react";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import PageHelpButton from "../components/PageHelpButton";
import StatusBadge from "../components/StatusBadge";
import {
  createVisitRecord,
  fetchVisitRecord,
  fetchVisitRecordSummary,
  fetchVisitRecords,
  updateVisitRecord
} from "../lib/storeVisitRecordsApi";
import { PAGE_HELP } from "../lib/pageHelpContent";

const VISIT_RESULT_OPTIONS = [
  ["INTERESTED", "有興趣"],
  ["TEST_RIDE", "試乘"],
  ["QUOTE_REQUESTED", "已報價"],
  ["RESERVED", "已預約"],
  ["PURCHASED", "已購買"],
  ["NEED_FOLLOW_UP", "需追蹤"],
  ["NO_PURCHASE", "未購買"],
  ["OTHER", "其他"]
];

const VISIT_RESULT_LABELS = Object.fromEntries(VISIT_RESULT_OPTIONS);

function todayText() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentTimeText() {
  const date = new Date();
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function monthStartText() {
  return `${todayText().slice(0, 8)}01`;
}

function defaultForm(storeId = "") {
  return {
    storeId,
    visitDate: todayText(),
    visitTime: currentTimeText(),
    visitorCount: "1",
    customerName: "",
    customerPhone: "",
    lineFriendAdded: false,
    lineIdentifier: "",
    lineDisplayName: "",
    interestedVehicle: "",
    visitResult: "INTERESTED",
    followUpRequired: false,
    followUpAt: "",
    note: ""
  };
}

function formFromRecord(record = {}, fallbackStoreId = "") {
  return {
    storeId: record.storeId || fallbackStoreId || "",
    visitDate: record.visitDate || todayText(),
    visitTime: (record.visitTime || currentTimeText()).slice(0, 5),
    visitorCount: String(record.visitorCount ?? 1),
    customerName: record.customerName || "",
    customerPhone: record.customerPhone || "",
    lineFriendAdded: Boolean(record.lineFriendAdded),
    lineIdentifier: record.lineIdentifier || "",
    lineDisplayName: record.lineDisplayName || "",
    interestedVehicle: record.interestedVehicle || "",
    visitResult: record.visitResult || "INTERESTED",
    followUpRequired: Boolean(record.followUpRequired),
    followUpAt: record.followUpAt ? record.followUpAt.replace(" ", "T").slice(0, 16) : "",
    note: record.note || ""
  };
}

function compactText(value, maxLength = 28) {
  const text = String(value || "").trim();
  if (!text) return "-";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function StoreVisitRecordsPage() {
  const [form, setForm] = useState(defaultForm());
  const [editing, setEditing] = useState(null);
  const [records, setRecords] = useState([]);
  const [stores, setStores] = useState([]);
  const [canViewAllStores, setCanViewAllStores] = useState(false);
  const [currentStoreId, setCurrentStoreId] = useState("");
  const [filters, setFilters] = useState({
    startDate: monthStartText(),
    endDate: todayText(),
    storeId: "",
    visitResult: "",
    lineFriendAdded: "",
    keyword: ""
  });
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function loadData(nextFilters = filters) {
    try {
      setLoading(true);
      setError("");
      const [listResponse, summaryResponse] = await Promise.all([
        fetchVisitRecords(nextFilters),
        fetchVisitRecordSummary(nextFilters)
      ]);
      setRecords(listResponse.records || []);
      setStores(listResponse.stores || []);
      setCanViewAllStores(Boolean(listResponse.canViewAllStores));
      setCurrentStoreId(listResponse.currentStoreId || "");
      setSummary(summaryResponse.summary || null);
      setForm((current) => ({
        ...current,
        storeId: current.storeId || listResponse.currentStoreId || ""
      }));
    } catch (err) {
      setRecords([]);
      setError(err?.message || "來店紀錄載入失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function buildPayload(source = form) {
    return {
      ...source,
      storeId: source.storeId || currentStoreId
    };
  }

  async function handleCreate(event) {
    event.preventDefault();
    try {
      setSaving(true);
      setError("");
      await createVisitRecord(buildPayload());
      window.alert("來店紀錄已建立");
      setForm(defaultForm(form.storeId || currentStoreId));
      await loadData(filters);
    } catch (err) {
      setError(err?.message || "來店紀錄儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  async function openEdit(record) {
    try {
      setError("");
      const response = await fetchVisitRecord(record.id);
      setEditing(response.record || record);
    } catch (err) {
      setError(err?.message || "來店紀錄讀取失敗");
    }
  }

  async function handleUpdate(event) {
    event.preventDefault();
    if (!editing?.id) return;
    try {
      setSaving(true);
      setError("");
      const payload = buildPayload(formFromRecord(editing, currentStoreId));
      await updateVisitRecord(editing.id, payload);
      window.alert("來店紀錄已更新");
      setEditing(null);
      await loadData(filters);
    } catch (err) {
      setError(err?.message || "來店紀錄更新失敗");
    } finally {
      setSaving(false);
    }
  }

  function updateEditingForm(key, value) {
    setEditing((current) => ({
      ...current,
      ...formFromRecord(current || {}, currentStoreId),
      [key]: value
    }));
  }

  async function applyFilters(event) {
    event.preventDefault();
    await loadData(filters);
  }

  const columns = useMemo(() => [
    { key: "visitDate", label: "日期" },
    { key: "visitTime", label: "時間", render: (row) => row.visitTime?.slice(0, 5) || "-" },
    { key: "storeName", label: "門市", render: (row) => row.storeName || `#${row.storeId}` },
    { key: "customerName", label: "客戶", render: (row) => row.customerName || row.customerPhone || "-" },
    { key: "visitorCount", label: "人數" },
    { key: "lineFriendAdded", label: "LINE 好友", render: (row) => row.lineFriendAdded ? <StatusBadge tone="success">已加</StatusBadge> : <StatusBadge tone="muted">未加</StatusBadge> },
    { key: "lineInfo", label: "LINE ID / LINE 名稱", render: (row) => row.lineDisplayName || row.lineIdentifierMasked || "-" },
    { key: "interestedVehicle", label: "興趣車款", render: (row) => row.interestedVehicle || row.interestedProductSku || "-" },
    { key: "visitResult", label: "結果", render: (row) => VISIT_RESULT_LABELS[row.visitResult] || row.visitResult },
    { key: "note", label: "備註", render: (row) => compactText(row.note) },
    { key: "createdByName", label: "建立人員", render: (row) => row.createdByName || "-" },
    { key: "updatedByName", label: "最後修改人員", render: (row) => row.updatedByName || "-" },
    { key: "updatedAt", label: "修改時間", render: (row) => row.updatedAt || "-" },
    {
      key: "actions",
      label: "操作",
      render: (row) => (
        <button type="button" className="secondary-button" onClick={() => openEdit(row)}>
          詳細 / 修改
        </button>
      )
    }
  ], []);

  const editingForm = editing ? formFromRecord(editing, currentStoreId) : null;

  return (
    <div className="page-stack">
      <PageHeader
        title="門市來店紀錄"
        description="記錄每日來店客戶、人數、LINE 加好友狀態、感興趣車款與後續追蹤。"
      />
      <PageHelpButton help={PAGE_HELP.storeVisitRecords} />

      {error ? <div className="alert alert-error">{error}</div> : null}

      <section className="summary-grid">
        <div className="summary-card"><div className="summary-label">來店筆數</div><div className="summary-value">{summary?.totalVisits || 0}</div></div>
        <div className="summary-card"><div className="summary-label">來店人數</div><div className="summary-value">{summary?.totalVisitorCount || 0}</div></div>
        <div className="summary-card"><div className="summary-label">LINE 好友新增</div><div className="summary-value">{summary?.lineFriendAddedCount || 0}</div></div>
        <div className="summary-card"><div className="summary-label">需追蹤</div><div className="summary-value">{summary?.followUpRequiredCount || 0}</div></div>
      </section>

      <section className="content-card section-panel">
        <div className="section-heading-row">
          <div>
            <h2>新增來店紀錄</h2>
            <p className="muted-text">LINE ID / LINE 名稱屬於個人資料，列表僅顯示遮蔽後資訊。</p>
          </div>
          <StatusBadge tone="info">門市紀錄</StatusBadge>
        </div>
        <VisitRecordForm
          form={form}
          stores={stores}
          canViewAllStores={canViewAllStores}
          saving={saving}
          submitLabel="儲存來店紀錄"
          onSubmit={handleCreate}
          onChange={updateForm}
        />
      </section>

      <section className="content-card section-panel">
        <div className="section-heading-row">
          <div>
            <h2>日期別列表</h2>
            <p className="muted-text">依日期、門市、來店結果與關鍵字查詢來店紀錄。</p>
          </div>
        </div>
        <form className="form-grid" onSubmit={applyFilters}>
          <label>
            開始日期
            <input type="date" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} />
          </label>
          <label>
            結束日期
            <input type="date" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} />
          </label>
          {canViewAllStores ? (
            <label>
              門市篩選
              <select value={filters.storeId} onChange={(event) => setFilters((current) => ({ ...current, storeId: event.target.value }))}>
                <option value="">全部門市</option>
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label>
          ) : null}
          <label>
            來店結果
            <select value={filters.visitResult} onChange={(event) => setFilters((current) => ({ ...current, visitResult: event.target.value }))}>
              <option value="">全部結果</option>
              {VISIT_RESULT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            LINE 好友
            <select value={filters.lineFriendAdded} onChange={(event) => setFilters((current) => ({ ...current, lineFriendAdded: event.target.value }))}>
              <option value="">全部</option>
              <option value="true">已加好友</option>
              <option value="false">未加好友</option>
            </select>
          </label>
          <label>
            關鍵字
            <input value={filters.keyword} onChange={(event) => setFilters((current) => ({ ...current, keyword: event.target.value }))} placeholder="姓名 / 電話 / 車款 / 備註" />
          </label>
          <div className="form-actions">
            <button type="submit" className="secondary-button" disabled={loading}>查詢</button>
          </div>
        </form>
        <DataTable
          rows={records}
          columns={columns}
          emptyText="目前沒有來店紀錄。"
          cardTitle={(row) => `${row.visitDate} ${row.visitTime?.slice(0, 5) || ""}`}
          cardDescription={(row) => `${row.customerName || row.customerPhone || "未留名"} / ${VISIT_RESULT_LABELS[row.visitResult] || row.visitResult}`}
          cardBadges={(row) => row.followUpRequired ? <StatusBadge tone="warning">需追蹤</StatusBadge> : <StatusBadge tone="info">{row.visitorCount} 人</StatusBadge>}
        />
      </section>

      {summary?.topVehicles?.length ? (
        <section className="content-card section-panel">
          <h2>興趣車款 Top 5</h2>
          <div className="summary-grid">
            {summary.topVehicles.map((item) => (
              <div className="summary-card" key={item.interestedVehicle}>
                <div className="summary-label">{item.interestedVehicle}</div>
                <div className="summary-value">{item.count}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {editing ? (
        <div className="admin-modal-backdrop" role="presentation">
          <section className="admin-modal" role="dialog" aria-modal="true" aria-label="修改來店紀錄">
            <div className="admin-modal-header">
              <div>
                <h2>修改來店紀錄</h2>
                <p className="admin-modal-copy">建立人員：{editing.createdByName || "-"} / 最後修改人員：{editing.updatedByName || "-"}</p>
              </div>
              <button type="button" className="secondary-button" onClick={() => setEditing(null)}>關閉</button>
            </div>
            <div className="admin-modal-body">
              <VisitRecordForm
                form={editingForm}
                stores={stores}
                canViewAllStores={false}
                saving={saving}
                submitLabel="儲存修改"
                onSubmit={handleUpdate}
                onChange={updateEditingForm}
              />
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function VisitRecordForm({ form, stores, canViewAllStores, saving, submitLabel, onSubmit, onChange }) {
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <label>
        來店日期
        <input type="date" value={form.visitDate} onChange={(event) => onChange("visitDate", event.target.value)} required />
      </label>
      <label>
        來店時間
        <input type="time" value={form.visitTime} onChange={(event) => onChange("visitTime", event.target.value)} />
      </label>
      {canViewAllStores ? (
        <label>
          門市
          <select value={form.storeId || ""} onChange={(event) => onChange("storeId", event.target.value)}>
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        </label>
      ) : null}
      <label>
        來店人數
        <input type="number" min="1" step="1" value={form.visitorCount} onChange={(event) => onChange("visitorCount", event.target.value)} required />
      </label>
      <label>
        客戶名
        <input value={form.customerName} onChange={(event) => onChange("customerName", event.target.value)} placeholder="可不填" />
      </label>
      <label>
        電話
        <input value={form.customerPhone} onChange={(event) => onChange("customerPhone", event.target.value)} placeholder="可不填" />
      </label>
      <label className="checkbox-field">
        <input type="checkbox" checked={Boolean(form.lineFriendAdded)} onChange={(event) => onChange("lineFriendAdded", event.target.checked)} />
        LINE 已加好友
      </label>
      <label>
        LINE ID / LINE 名稱
        <input value={form.lineIdentifier} onChange={(event) => onChange("lineIdentifier", event.target.value)} placeholder="客戶提供的 LINE ID 或名稱" />
      </label>
      <label>
        LINE 顯示名稱
        <input value={form.lineDisplayName} onChange={(event) => onChange("lineDisplayName", event.target.value)} placeholder="可不填" />
      </label>
      <label>
        興趣車款
        <input value={form.interestedVehicle} onChange={(event) => onChange("interestedVehicle", event.target.value)} placeholder="例如 SHARK / 車款 / SKU" />
      </label>
      <label>
        來店結果
        <select value={form.visitResult} onChange={(event) => onChange("visitResult", event.target.value)}>
          {VISIT_RESULT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="checkbox-field">
        <input type="checkbox" checked={Boolean(form.followUpRequired)} onChange={(event) => onChange("followUpRequired", event.target.checked)} />
        需追蹤
      </label>
      <label>
        追蹤時間
        <input type="datetime-local" value={form.followUpAt} onChange={(event) => onChange("followUpAt", event.target.value)} />
      </label>
      <label className="form-grid-full">
        備註
        <textarea value={form.note} onChange={(event) => onChange("note", event.target.value)} rows={3} />
      </label>
      <div className="form-actions form-grid-full">
        <button type="submit" className="primary-button" disabled={saving}>{submitLabel}</button>
      </div>
    </form>
  );
}

export default StoreVisitRecordsPage;
