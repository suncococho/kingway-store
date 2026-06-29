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

function SummaryCard({ label, value, note }) {
  return (
    <article className="summary-card operation-summary-card">
      <div className="summary-label">{label}</div>
      <div className="summary-value">{value}</div>
      {note ? <div className="muted-text compact-note">{note}</div> : null}
    </article>
  );
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
  const [todaySummary, setTodaySummary] = useState(null);
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
      const today = todayText();
      const [listResponse, summaryResponse, todaySummaryResponse] = await Promise.all([
        fetchVisitRecords(nextFilters),
        fetchVisitRecordSummary(nextFilters),
        fetchVisitRecordSummary({ ...nextFilters, startDate: today, endDate: today })
      ]);
      setRecords(listResponse.records || []);
      setStores(listResponse.stores || []);
      setCanViewAllStores(Boolean(listResponse.canViewAllStores));
      setCurrentStoreId(listResponse.currentStoreId || "");
      setSummary(summaryResponse.summary || null);
      setTodaySummary(todaySummaryResponse.summary || null);
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
    { key: "interestedVehicle", label: "感興趣車款", render: (row) => row.interestedVehicle || row.interestedProductSku || "-" },
    { key: "visitResult", label: "來店結果", render: (row) => <StatusBadge tone={row.followUpRequired ? "warning" : "info"}>{VISIT_RESULT_LABELS[row.visitResult] || row.visitResult}</StatusBadge> },
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
    <div className="page-stack operation-page">
      <PageHeader
        title="門市來店紀錄"
        description="記錄每日來店客戶、人數、LINE 加好友狀態、感興趣車款與後續追蹤。"
      />
      <PageHelpButton help={PAGE_HELP.storeVisitRecords} />

      {error ? <div className="alert alert-error">{error}</div> : null}

      <section className="summary-grid operation-summary-grid" aria-label="今日來店摘要">
        <SummaryCard label="今日來店件數" value={todaySummary?.totalVisits || 0} note="今日新增紀錄" />
        <SummaryCard label="今日來店人數" value={todaySummary?.totalVisitorCount || 0} note="visitor_count 合計" />
        <SummaryCard label="今日 LINE 加好友" value={todaySummary?.lineFriendAddedCount || 0} note="已勾選 LINE 加好友" />
        <SummaryCard label="今日需追蹤" value={todaySummary?.followUpRequiredCount || 0} note="已標記後續追蹤" />
      </section>

      <section className="content-card section-panel operation-section-card">
        <div className="section-heading-row">
          <div>
            <h2>新增來店紀錄</h2>
            <p className="muted-text">輸入來店時間、人數、感興趣車款與來店結果。LINE ID / LINE 名稱屬於個人資料，列表僅顯示遮蔽後資訊。</p>
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

      <section className="content-card section-panel operation-section-card">
        <div className="section-heading-row">
          <div>
            <h2>來店紀錄查詢</h2>
            <p className="muted-text">依日期、門市、來店結果、LINE 好友與關鍵字查詢。下方摘要依目前篩選期間計算。</p>
          </div>
        </div>
        <form className="form-grid filter-grid" onSubmit={applyFilters}>
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

        <div className="summary-grid operation-summary-grid compact-summary-grid">
          <SummaryCard label="篩選來店件數" value={summary?.totalVisits || 0} />
          <SummaryCard label="篩選來店人數" value={summary?.totalVisitorCount || 0} />
          <SummaryCard label="篩選 LINE 加好友" value={summary?.lineFriendAddedCount || 0} />
          <SummaryCard label="篩選需追蹤" value={summary?.followUpRequiredCount || 0} />
        </div>

        <DataTable
          rows={records}
          columns={columns}
          emptyText="目前沒有來店紀錄。"
          cardTitle={(row) => `${row.visitDate} ${row.visitTime?.slice(0, 5) || ""} / ${row.visitorCount || 0} 人`}
          cardDescription={(row) => `${row.interestedVehicle || row.interestedProductSku || "未記錄車款"} / ${VISIT_RESULT_LABELS[row.visitResult] || row.visitResult}`}
          cardBadges={(row) => row.followUpRequired ? <StatusBadge tone="warning">需追蹤</StatusBadge> : <StatusBadge tone="info">{row.visitorCount} 人</StatusBadge>}
        />
      </section>

      {summary?.topVehicles?.length ? (
        <section className="content-card section-panel operation-section-card">
          <div className="section-heading-row">
            <div>
              <h2>感興趣車款 Top 5</h2>
              <p className="muted-text">依目前篩選期間統計，供每日追蹤與 21:00 營運報告參考。</p>
            </div>
          </div>
          <div className="summary-grid operation-summary-grid">
            {summary.topVehicles.map((item) => (
              <SummaryCard key={item.interestedVehicle} label={item.interestedVehicle} value={item.count} />
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
    <form className="operation-form" onSubmit={onSubmit}>
      <div className="operation-fieldset">
        <div className="operation-fieldset-title">日期 / 時間</div>
        <div className="operation-field-grid">
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
        </div>
      </div>

      <div className="operation-fieldset">
        <div className="operation-fieldset-title">客戶 / LINE</div>
        <div className="operation-field-grid">
          <label>
            客戶姓名
            <input value={form.customerName} onChange={(event) => onChange("customerName", event.target.value)} placeholder="可不填" />
          </label>
          <label>
            電話
            <input value={form.customerPhone} onChange={(event) => onChange("customerPhone", event.target.value)} placeholder="可不填" />
          </label>
          <label className="checkbox-field operation-checkbox">
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
        </div>
      </div>

      <div className="operation-fieldset">
        <div className="operation-fieldset-title">感興趣車款 / 來店結果</div>
        <div className="operation-field-grid">
          <label>
            感興趣車款
            <input value={form.interestedVehicle} onChange={(event) => onChange("interestedVehicle", event.target.value)} placeholder="例如 SHARK / 車款 / SKU" />
          </label>
          <label>
            來店結果
            <select value={form.visitResult} onChange={(event) => onChange("visitResult", event.target.value)}>
              {VISIT_RESULT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="checkbox-field operation-checkbox">
            <input type="checkbox" checked={Boolean(form.followUpRequired)} onChange={(event) => onChange("followUpRequired", event.target.checked)} />
            需追蹤
          </label>
          <label>
            追蹤時間
            <input type="datetime-local" value={form.followUpAt} onChange={(event) => onChange("followUpAt", event.target.value)} />
          </label>
        </div>
      </div>

      <label className="operation-fieldset">
        <span className="operation-fieldset-title">備註</span>
        <textarea value={form.note} onChange={(event) => onChange("note", event.target.value)} rows={3} />
      </label>
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={saving}>{submitLabel}</button>
      </div>
    </form>
  );
}

export default StoreVisitRecordsPage;
