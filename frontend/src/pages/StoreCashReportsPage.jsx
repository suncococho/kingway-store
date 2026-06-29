import { useEffect, useMemo, useState } from "react";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import PageHelpButton from "../components/PageHelpButton";
import StatusBadge from "../components/StatusBadge";
import {
  fetchCashReportReference,
  fetchCashReportSummary,
  fetchCashReports,
  fetchTodayCashReport,
  saveCashReport
} from "../lib/storeCashReportsApi";
import { PAGE_HELP } from "../lib/pageHelpContent";

const COUNT_FIELDS = [
  ["count1000", "NT$1000", 1000],
  ["count100", "NT$100", 100],
  ["count50", "NT$50", 50],
  ["count10", "NT$10", 10],
  ["count1", "NT$1", 1]
];

const MONEY_FIELDS = [
  ["orderCashAmount", "訂單現金收款"],
  ["reservationDepositCashAmount", "預約金現金"],
  ["sameDayFullCashAmount", "當日全額現金"],
  ["cashReceivableAmount", "現金未收款"]
];

function todayText() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultForm(reportDate = todayText(), storeId = "") {
  return {
    reportDate,
    storeId,
    count1000: "0",
    count100: "0",
    count50: "0",
    count10: "0",
    count1: "0",
    orderCashAmount: "0",
    reservationDepositCashAmount: "0",
    cashReceivableAmount: "0",
    sameDayFullCashAmount: "0",
    note: ""
  };
}

function formFromReport(report, fallbackDate, fallbackStoreId) {
  return {
    reportDate: report?.reportDate || fallbackDate || todayText(),
    storeId: report?.storeId || fallbackStoreId || "",
    count1000: String(report?.count1000 ?? 0),
    count100: String(report?.count100 ?? 0),
    count50: String(report?.count50 ?? 0),
    count10: String(report?.count10 ?? 0),
    count1: String(report?.count1 ?? 0),
    orderCashAmount: String(report?.orderCashAmount ?? "0"),
    reservationDepositCashAmount: String(report?.reservationDepositCashAmount ?? "0"),
    cashReceivableAmount: String(report?.cashReceivableAmount ?? "0"),
    sameDayFullCashAmount: String(report?.sameDayFullCashAmount ?? "0"),
    note: report?.note || ""
  };
}

function numberValue(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return `NT$ ${Number(value || 0).toLocaleString("zh-TW", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function calculateOperatingTotal(form) {
  return numberValue(form.count1000) * 1000 +
    numberValue(form.count100) * 100 +
    numberValue(form.count50) * 50 +
    numberValue(form.count10) * 10 +
    numberValue(form.count1);
}

function calculateCashInflow(form) {
  return numberValue(form.orderCashAmount) +
    numberValue(form.reservationDepositCashAmount) +
    numberValue(form.sameDayFullCashAmount);
}

function calculateReferenceCash(reference) {
  return numberValue(reference?.orderCashAmount) +
    numberValue(reference?.reservationDepositCashAmount) +
    numberValue(reference?.sameDayFullCashAmount);
}

function StaffName({ value }) {
  return <span>{value || "-"}</span>;
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

function StoreCashReportsPage() {
  const [form, setForm] = useState(defaultForm());
  const [currentReport, setCurrentReport] = useState(null);
  const [reports, setReports] = useState([]);
  const [stores, setStores] = useState([]);
  const [canViewAllStores, setCanViewAllStores] = useState(false);
  const [currentStoreId, setCurrentStoreId] = useState("");
  const [filters, setFilters] = useState({
    startDate: todayText().slice(0, 8) + "01",
    endDate: todayText(),
    storeId: ""
  });
  const [summary, setSummary] = useState(null);
  const [cashReference, setCashReference] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [passwordModal, setPasswordModal] = useState({
    open: false,
    password: "",
    reason: "",
    pendingPayload: null
  });

  const operatingTotal = useMemo(() => calculateOperatingTotal(form), [form]);
  const cashInflow = useMemo(() => calculateCashInflow(form), [form]);
  const referenceCash = useMemo(() => calculateReferenceCash(cashReference), [cashReference]);

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function loadReports(nextFilters = filters) {
    try {
      const [listResponse, summaryResponse] = await Promise.all([
        fetchCashReports(nextFilters),
        fetchCashReportSummary(nextFilters)
      ]);
      setReports(listResponse.reports || []);
      setStores(listResponse.stores || []);
      setCanViewAllStores(Boolean(listResponse.canViewAllStores));
      setCurrentStoreId(listResponse.currentStoreId || "");
      setSummary(summaryResponse.summary || null);
    } catch (err) {
      setReports([]);
      setError(err?.message || "現金日報列表載入失敗");
    }
  }

  async function loadCurrent(reportDate = form.reportDate, storeId = form.storeId) {
    try {
      setLoading(true);
      setError("");
      const response = await fetchTodayCashReport({ reportDate, storeId });
      const referenceResponse = await fetchCashReportReference({ reportDate, storeId: storeId || response.currentStoreId || "" });
      const report = response.report || null;
      setCurrentReport(report);
      setStores(response.stores || []);
      setCanViewAllStores(Boolean(response.canViewAllStores));
      setCurrentStoreId(response.currentStoreId || "");
      setForm(formFromReport(report, reportDate, storeId || response.currentStoreId || ""));
      setCashReference(referenceResponse.reference || null);
    } catch (err) {
      setCashReference(null);
      setError(err?.message || "現金日報載入失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCurrent();
    loadReports();
  }, []);

  async function handleDateChange(value) {
    updateForm("reportDate", value);
    await loadCurrent(value, form.storeId);
  }

  async function handleStoreChange(value) {
    updateForm("storeId", value);
    setFilters((current) => ({ ...current, storeId: value }));
    await loadCurrent(form.reportDate, value);
  }

  function buildPayload(extra = {}) {
    return {
      ...form,
      storeId: form.storeId || currentStoreId,
      ...extra
    };
  }

  async function submitPayload(payload) {
    try {
      setSaving(true);
      setError("");
      const response = await saveCashReport(payload);
      setCurrentReport(response.report || null);
      setForm(formFromReport(response.report, form.reportDate, form.storeId));
      await loadReports(filters);
      window.alert(response.created ? "現金日報已建立" : "修改完成");
    } catch (err) {
      setError(err?.message || "現金日報儲存失敗");
      if (err?.status === 400 && String(err?.message || "").includes("密碼")) {
        setPasswordModal((current) => ({ ...current, open: true, pendingPayload: payload }));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    const payload = buildPayload();
    if (currentReport?.id && currentReport.requiresPassword) {
      setPasswordModal({
        open: true,
        password: "",
        reason: "",
        pendingPayload: payload
      });
      return;
    }
    await submitPayload(payload);
  }

  async function confirmPasswordSave(event) {
    event.preventDefault();
    const payload = {
      ...(passwordModal.pendingPayload || buildPayload()),
      editPassword: passwordModal.password,
      editReason: passwordModal.reason
    };
    setPasswordModal({
      open: false,
      password: "",
      reason: "",
      pendingPayload: null
    });
    await submitPayload(payload);
  }

  function loadRow(row) {
    setCurrentReport(row);
    setForm(formFromReport(row, row.reportDate, row.storeId));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function applyFilters(event) {
    event.preventDefault();
    await loadReports(filters);
  }

  const columns = useMemo(() => [
    { key: "reportDate", label: "日期" },
    { key: "storeName", label: "門市", render: (row) => row.storeName || `#${row.storeId}` },
    { key: "operatingCashTotal", label: "營業金總額", render: (row) => money(row.operatingCashTotal) },
    { key: "totalCashInflow", label: "現金收入合計", render: (row) => money(row.totalCashInflow) },
    { key: "cashReceivableAmount", label: "現金未收款", render: (row) => money(row.cashReceivableAmount) },
    { key: "createdByName", label: "建立人員", render: (row) => <StaffName value={row.createdByName} /> },
    { key: "updatedByName", label: "最後修改人員", render: (row) => <StaffName value={row.updatedByName} /> },
    { key: "updatedAt", label: "修改時間", render: (row) => row.updatedAt || "-" },
    { key: "status", label: "狀態", render: (row) => <StatusBadge tone={row.requiresPassword ? "warning" : "success"}>{row.requiresPassword ? "需密碼修改" : "可直接修改"}</StatusBadge> },
    {
      key: "actions",
      label: "操作",
      render: (row) => (
        <button type="button" className="secondary-button" onClick={() => loadRow(row)}>
          詳細 / 修改
        </button>
      )
    }
  ], []);

  const editMessage = currentReport?.id
    ? currentReport.requiresPassword
      ? "已超過 1 小時，請輸入管理者密碼"
      : `1小時內可直接修改，剩餘 ${currentReport.minutesUntilLocked || 0} 分鐘`
    : "尚未建立，儲存後會記錄建立人員與最後修改人員";

  return (
    <div className="page-stack operation-page">
      <PageHeader
        title="門市現金日報"
        description="每日記錄門市營業金、訂單現金收款、預約金、現金未收款與當日全額現金。"
      />
      <PageHelpButton help={PAGE_HELP.storeCashReports} />

      <section className="summary-grid operation-summary-grid" aria-label="現金日報摘要">
        <SummaryCard label="營業金總額" value={money(operatingTotal)} note="依面額盤點自動計算" />
        <SummaryCard label="現金收入合計" value={money(cashInflow)} note="訂單現金 + 預約金 + 當日全額現金" />
        <SummaryCard label="系統參考現金" value={money(referenceCash)} note="僅供參考，請以實際盤點為準" />
        <SummaryCard label="現金未收款" value={money(form.cashReceivableAmount)} note="需後續追蹤收款" />
      </section>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <section className="content-card section-panel operation-section-card">
        <div className="section-heading-row">
          <div>
            <h2>系統參考金額</h2>
            <p className="muted-text">依 order_payment_records 與訂單收款紀錄提供當日現金參考值，不會自動覆蓋現金日報輸入內容。僅供參考，請以實際盤點為準。</p>
          </div>
          <StatusBadge tone="info">參考值</StatusBadge>
        </div>
        <div className="summary-grid operation-summary-grid compact-summary-grid">
          <SummaryCard label="訂單現金收款參考" value={money(cashReference?.orderCashAmount)} />
          <SummaryCard label="預約金現金參考" value={money(cashReference?.reservationDepositCashAmount)} />
          <SummaryCard label="當日全額現金參考" value={money(cashReference?.sameDayFullCashAmount)} />
          <SummaryCard label="現金未收款參考" value={money(cashReference?.cashReceivableAmount)} />
        </div>
      </section>

      <section className="content-card section-panel operation-section-card">
        <div className="section-heading-row">
          <div>
            <h2>日報輸入</h2>
            <p className="muted-text">{editMessage}。此修改將記錄修改人員與時間。</p>
          </div>
          <StatusBadge tone={currentReport?.requiresPassword ? "warning" : "success"}>
            {currentReport?.requiresPassword ? "需管理者確認" : "1小時內可直接修改"}
          </StatusBadge>
        </div>

        <form className="operation-form" onSubmit={handleSave}>
          <div className="operation-fieldset">
            <div className="operation-fieldset-title">日期 / 門市</div>
            <div className="operation-field-grid compact-operation-grid">
              <label>
                日期
                <input type="date" value={form.reportDate} onChange={(event) => handleDateChange(event.target.value)} required />
              </label>
              {canViewAllStores ? (
                <label>
                  門市
                  <select value={form.storeId || currentStoreId || ""} onChange={(event) => handleStoreChange(event.target.value)}>
                    {stores.map((store) => (
                      <option key={store.id} value={store.id}>{store.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          </div>

          <div className="operation-two-column">
            <section className="operation-fieldset">
              <div className="operation-fieldset-title">營業金盤點</div>
              <div className="denomination-grid">
                {COUNT_FIELDS.map(([key, label, value]) => {
                  const count = numberValue(form[key]);
                  return (
                    <label className="denomination-row" key={key}>
                      <span>{label}</span>
                      <input type="number" min="0" step="1" value={form[key]} onChange={(event) => updateForm(key, event.target.value)} />
                      <strong>{value.toLocaleString("zh-TW")} × {count || 0} = {money(value * count)}</strong>
                    </label>
                  );
                })}
              </div>
              <div className="operation-total-row">
                <span>營業金總額</span>
                <strong>{money(operatingTotal)}</strong>
              </div>
            </section>

            <section className="operation-fieldset">
              <div className="operation-fieldset-title">現金收款</div>
              <div className="operation-field-grid single-column-grid">
                {MONEY_FIELDS.map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input type="number" min="0" step="0.01" value={form[key]} onChange={(event) => updateForm(key, event.target.value)} />
                  </label>
                ))}
              </div>
              <div className="operation-total-row">
                <span>現金收入合計</span>
                <strong>{money(cashInflow)}</strong>
              </div>
            </section>
          </div>

          <label className="operation-fieldset">
            <span className="operation-fieldset-title">備註</span>
            <textarea value={form.note} onChange={(event) => updateForm("note", event.target.value)} rows={3} />
          </label>

          {currentReport?.id ? (
            <div className="muted-text compact-note">
              建立人員：{currentReport.createdByName || "-"} / 最後修改人員：{currentReport.updatedByName || "-"}
              {currentReport.lateEditApprovedByName ? ` / 逾時確認：${currentReport.lateEditApprovedByName}` : ""}
            </div>
          ) : null}

          <div className="form-actions">
            <button type="submit" className="primary-button" disabled={saving || loading}>
              儲存今日現金日報
            </button>
          </div>
        </form>
      </section>

      <section className="content-card section-panel operation-section-card">
        <div className="section-heading-row">
          <div>
            <h2>日期別列表</h2>
            <p className="muted-text">依日期查看現金日報，並可載入既有資料進行修改。</p>
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
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="form-actions">
            <button type="submit" className="secondary-button">查詢</button>
          </div>
        </form>
        {summary ? (
          <div className="summary-grid operation-summary-grid compact-summary-grid">
            <SummaryCard label="筆數" value={summary.reportCount || 0} />
            <SummaryCard label="營業金總額" value={money(summary.operatingCashTotal)} />
            <SummaryCard label="現金收入合計" value={money(summary.totalCashInflow)} />
          </div>
        ) : null}
        <DataTable
          rows={reports}
          columns={columns}
          emptyText="目前沒有現金日報。"
          cardTitle={(row) => `${row.reportDate} / ${row.storeName || `#${row.storeId}`}`}
          cardDescription={(row) => `營業金 ${money(row.operatingCashTotal)} / 現金收入 ${money(row.totalCashInflow)} / 未收 ${money(row.cashReceivableAmount)}`}
          cardBadges={(row) => (
            <StatusBadge tone={row.requiresPassword ? "warning" : "success"}>
              {row.requiresPassword ? "需密碼修改" : "可直接修改"}
            </StatusBadge>
          )}
        />
      </section>

      {passwordModal.open ? (
        <div className="admin-modal-backdrop" role="presentation">
          <section className="admin-modal" role="dialog" aria-modal="true" aria-label="管理者密碼確認">
            <div className="admin-modal-header">
              <div>
                <h2>已超過 1 小時，請輸入管理者密碼</h2>
                <p className="admin-modal-copy">此修改將記錄修改人員與時間。</p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPasswordModal({ open: false, password: "", reason: "", pendingPayload: null })}
              >
                關閉
              </button>
            </div>
            <form className="admin-modal-body form-grid" onSubmit={confirmPasswordSave}>
              <label>
                管理者密碼
                <input
                  type="password"
                  value={passwordModal.password}
                  onChange={(event) => setPasswordModal((current) => ({ ...current, password: event.target.value }))}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label className="form-grid-full">
                修改原因
                <textarea
                  value={passwordModal.reason}
                  onChange={(event) => setPasswordModal((current) => ({ ...current, reason: event.target.value }))}
                  rows={3}
                  required
                />
              </label>
              <div className="form-actions form-grid-full">
                <button type="submit" className="primary-button">確認修改</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default StoreCashReportsPage;
