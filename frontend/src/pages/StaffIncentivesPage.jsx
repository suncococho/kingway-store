import { useEffect, useMemo, useState } from "react";
import AdminSectionHeader from "../components/AdminSectionHeader";
import SignaturePad from "../components/SignaturePad";
import DataTable from "../components/DataTable";
import FilterBar from "../components/FilterBar";
import PageHeader from "../components/PageHeader";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import { apiOpenFile, apiRequest } from "../lib/api";
import { getStoredUser } from "../lib/auth";

const TYPE_LABELS = {
  BIKE: "車輛",
  ACCESSORY: "配件",
  REPAIR_INSPECTION: "維修檢查"
};
const STAGE_LABELS = {
  SALE: "成交",
  HANDOVER: "交車",
  FOLLOWUP: "售後追蹤",
  ALL_STAGES: "三階段全部完成",
  ITEM: "配件",
  INSPECTION: "初步檢查"
};
const AGREEMENT_CHECKS = [
  ["completionStandards", "我已閱讀並了解車輛銷售、交車、配件、維修檢查及售後追蹤之完成標準。"],
  ["caseOwnership", "我了解接受案件或被指定為負責人後，應持續處理至本人負責階段完成，或完成明確交接。"],
  ["truthfulRecords", "我了解系統紀錄必須與實際工作一致，不得虛報、代簽、倒填或提前標示完成。"],
  ["ordinaryWorkDuty", "我了解未設績效獎金之一般工作仍屬本人職務，不得拒絕、拖延或消極處理。"],
  ["pendingUntilComplete", "我了解案件尚未符合完成條件時，相關績效得維持待確認，補正完成後再予認定。"],
  ["exceptionReporting", "我了解遇有異常、安全疑慮、顧客爭議或無法完成時，應立即回報主管並留下紀錄。"],
  ["policyAccepted", "我同意遵守 KINGWAY 案件完成責任及銷售服務績效制度。"]
];

const STATUS_LABELS = {
  PENDING: "待確認",
  EARNED: "已取得",
  APPROVED: "已核准",
  PAID: "已支付",
  VOID: "已作廢",
  DISPUTED: "有異議",
  OPEN: "待處理",
  REVIEWING: "處理中",
  RESOLVED: "已解決",
  REJECTED: "已駁回",
  DRAFT: "草稿",
  CANCELED: "已取消",
  SIGNED: "已簽署",
  UNSIGNED: "未簽署"
};

function taipeiMonth() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  return `${parts.find((item) => item.type === "year")?.value}-${parts.find((item) => item.type === "month")?.value}`;
}

function money(value) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function dateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

function statusTone(status) {
  if (["PAID", "APPROVED", "RESOLVED", "SIGNED"].includes(status)) return "success";
  if (["PENDING", "EARNED", "OPEN", "REVIEWING", "DRAFT"].includes(status)) return "warning";
  if (["VOID", "REJECTED", "CANCELED"].includes(status)) return "danger";
  if (status === "DISPUTED") return "warm";
  return "neutral";
}

function Status({ value }) {
  return <StatusBadge tone={statusTone(value)}>{STATUS_LABELS[value] || value || "-"}</StatusBadge>;
}


function EventTable({ events, emptyText = "目前沒有績效紀錄。", showStaff = false, action = null }) {
  const columns = [
    ...(showStaff ? [{ key: "staffDisplayName", label: "員工" }] : []),
    { key: "date", label: "日期", render: (row) => dateTime(row.earnedAt || row.createdAt) },
    { key: "incentiveType", label: "類型", render: (row) => TYPE_LABELS[row.incentiveType] || row.incentiveType },
    { key: "earningStage", label: "階段", render: (row) => STAGE_LABELS[row.earningStage] || row.earningStage },
    {
      key: "source",
      label: "商品／來源",
      render: (row) => row.productNameSnapshot || `${row.sourceType || "來源"} #${row.sourceId}`
    },
    { key: "actualSaleAmount", label: "實際交易金額", render: (row) => money(row.actualSaleAmount) },
    { key: "assignedRatio", label: "分配比例", render: (row) => `${Math.round(Number(row.assignedRatio || 0) * 100)}%` },
    { key: "finalAmount", label: "績效金額", render: (row) => money(row.finalAmount) },
    { key: "status", label: "狀態", render: (row) => <Status value={row.status} /> },
    { key: "pendingReason", label: "待確認原因", render: (row) => row.pendingReason || row.voidReason || "-" },
    ...(action ? [{ key: "action", label: "操作", render: action }] : [])
  ];
  return (
    <DataTable
      columns={columns}
      rows={events}
      emptyText={emptyText}
      cardTitle={(row) => `${TYPE_LABELS[row.incentiveType] || row.incentiveType} / ${money(row.finalAmount)}`}
      cardDescription={(row) => `${showStaff ? `${row.staffDisplayName || "-"} / ` : ""}${dateTime(row.earnedAt || row.createdAt)}`}
      cardBadges={(row) => <Status value={row.status} />}
      cardFooter={action ? (row) => action(row) : undefined}
    />
  );
}

function SummaryCards({ summary = {} }) {
  const cards = [
    ["本月績效", summary.totalAmount],
    ["待確認", Number(summary.pendingAmount || 0) + Number(summary.earnedAmount || 0)],
    ["已核准", summary.approvedAmount],
    ["已支付", summary.paidAmount]
  ];
  return (
    <div className="admin-summary-grid">
      {cards.map(([label, value]) => (
        <article className="admin-summary-card" key={label}>
          <div className="admin-summary-label">{label}</div>
          <div className="admin-summary-value">{money(value)}</div>
        </article>
      ))}
    </div>
  );
}

function StaffIncentivesPage() {
  const currentUser = useMemo(() => getStoredUser(), []);
  const role = String(currentUser?.role || "").trim().toUpperCase();
  const isAdmin = role === "ADMIN";
  const canViewStore = ["ADMIN", "MANAGER"].includes(role);
  const [month, setMonth] = useState(taipeiMonth());
  const [tab, setTab] = useState("SUMMARY");
  const [selfData, setSelfData] = useState(null);
  const [adminData, setAdminData] = useState({
    overview: [],
    events: [],
    agreements: [],
    disputes: [],
    adjustments: [],
    payouts: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [eventFilters, setEventFilters] = useState({ staffUserId: "", status: "", type: "" });
  const [disputeForm, setDisputeForm] = useState({ eventId: "", reason: "" });
  const [adminDispute, setAdminDispute] = useState({ id: "", status: "REVIEWING", adminResponse: "" });
  const [agreementSaving, setAgreementSaving] = useState(false);
  const [agreementForm, setAgreementForm] = useState({
    requiredChecks: Object.fromEntries(AGREEMENT_CHECKS.map(([key]) => [key, false])),
    signatureData: ""
  });

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const self = await apiRequest(`/staff-incentives/me?month=${encodeURIComponent(month)}`);
      setSelfData(self);
      if (canViewStore) {
        const [overview, events, agreements, disputes, adjustments, payouts] = await Promise.all([
          apiRequest(`/staff-incentives/admin/overview?month=${encodeURIComponent(month)}`),
          apiRequest(`/staff-incentives/admin/events?month=${encodeURIComponent(month)}`),
          apiRequest("/staff-incentives/admin/agreements"),
          apiRequest("/staff-incentives/admin/disputes"),
          apiRequest("/staff-incentives/admin/adjustments"),
          apiRequest(`/staff-incentives/admin/payouts?month=${encodeURIComponent(month)}`)
        ]);
        setAdminData({
          overview: overview.staff || [],
          events: events.events || [],
          agreements: agreements.agreements || [],
          disputes: disputes.disputes || [],
          adjustments: adjustments.adjustments || [],
          payouts: payouts.payouts || []
        });
      }
    } catch (requestError) {
      setError(requestError.message || "績效資料讀取失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [month, canViewStore]);

  const tabs = [
    { key: "SUMMARY", label: "本月績效" },
    { key: "BIKE", label: "車輛銷售" },
    { key: "ACCESSORY", label: "配件績效" },
    { key: "REPAIR", label: "維修檢查" },
    { key: "PENDING", label: "待確認" },
    { key: "APPROVED", label: "已核准" },
    { key: "PAID", label: "已支付" },
    { key: "PLAN", label: "績效辦法與同意書" },
    { key: "DISPUTE", label: "提出異議" },
    ...(canViewStore
      ? [
          { key: "ADMIN_OVERVIEW", label: "全體員工" },
          { key: "ADMIN_EVENTS", label: "全部績效明細" },
          { key: "ADMIN_AGREEMENTS", label: "績效同意書" },
          { key: "ADMIN_DISPUTES", label: "異議處理" },
          { key: "ADMIN_ADJUSTMENTS", label: "調整紀錄" },
          { key: "ADMIN_PAYOUTS", label: "月結支付" }
        ]
      : [])
  ];

  const selfEvents = selfData?.events || [];
  const visibleSelfEvents = useMemo(() => {
    if (tab === "BIKE") return selfEvents.filter((item) => item.incentiveType === "BIKE");
    if (tab === "ACCESSORY") return selfEvents.filter((item) => item.incentiveType === "ACCESSORY");
    if (tab === "REPAIR") return selfEvents.filter((item) => item.incentiveType === "REPAIR_INSPECTION");
    if (tab === "PENDING") return selfEvents.filter((item) => ["PENDING", "EARNED"].includes(item.status));
    if (tab === "APPROVED") return selfEvents.filter((item) => item.status === "APPROVED");
    if (tab === "PAID") return selfEvents.filter((item) => item.status === "PAID");
    return selfEvents;
  }, [selfEvents, tab]);

  const filteredAdminEvents = useMemo(
    () =>
      adminData.events.filter((item) => {
        if (eventFilters.staffUserId && String(item.staffUserId) !== eventFilters.staffUserId) return false;
        if (eventFilters.status && item.status !== eventFilters.status) return false;
        if (eventFilters.type && item.incentiveType !== eventFilters.type) return false;
        return true;
      }),
    [adminData.events, eventFilters]
  );

  async function submitDispute(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!disputeForm.eventId || disputeForm.reason.trim().length < 3) {
      setError("請選擇績效紀錄並填寫至少 3 字的原因。");
      return;
    }
    try {
      await apiRequest(`/staff-incentives/events/${disputeForm.eventId}/disputes`, {
        method: "POST",
        body: JSON.stringify({ reason: disputeForm.reason.trim() }),
        processingMessage: "提交異議中"
      });
      setSuccess("異議已送出。已核准或已支付金額不會因此自動扣回。");
      setDisputeForm({ eventId: "", reason: "" });
      await loadData();
    } catch (requestError) {
      setError(requestError.message || "異議送出失敗");
    }
  }

  function chooseAdminDispute(row) {
    setAdminDispute({
      id: String(row.id),
      status: row.status === "OPEN" ? "REVIEWING" : row.status,
      adminResponse: row.adminResponse || ""
    });
  }

  async function saveAdminDispute(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!adminDispute.id) return;
    try {
      await apiRequest(`/staff-incentives/admin/disputes/${adminDispute.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: adminDispute.status,
          adminResponse: adminDispute.adminResponse
        }),
        processingMessage: "更新異議中"
      });
      setSuccess("異議狀態已更新，績效金額未自動變更。");
      setAdminDispute({ id: "", status: "REVIEWING", adminResponse: "" });
      await loadData();
    } catch (requestError) {
      setError(requestError.message || "異議更新失敗");
    }
  }

  function updateAgreementCheck(key, checked) {
    setAgreementForm((current) => ({
      ...current,
      requiredChecks: {
        ...current.requiredChecks,
        [key]: checked
      }
    }));
  }

  async function signAgreement(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!selfData?.plan) {
      setError("目前沒有可簽署的生效績效辦法。");
      return;
    }
    if (!Object.values(agreementForm.requiredChecks).every(Boolean)) {
      setError("請逐項確認績效辦法與同意內容。");
      return;
    }
    if (!agreementForm.signatureData) {
      setError("請完成並確認電子簽名。");
      return;
    }
    setAgreementSaving(true);
    try {
      const response = await apiRequest("/staff-incentives/agreements/sign", {
        method: "POST",
        body: JSON.stringify({
          planVersionId: selfData.plan.id,
          requiredChecks: agreementForm.requiredChecks,
          signatureData: agreementForm.signatureData
        }),
        processingMessage: "簽署績效同意書中",
        processingDescription: "正在產生簽署紀錄與 PDF，請勿重複送出。"
      });
      setSuccess(response.alreadySigned ? "此版本已完成簽署。" : "績效同意書已簽署並產生 PDF。");
      setAgreementForm({
        requiredChecks: Object.fromEntries(AGREEMENT_CHECKS.map(([key]) => [key, false])),
        signatureData: ""
      });
      await loadData();
    } catch (requestError) {
      setError(requestError.message || "績效同意書簽署失敗");
    } finally {
      setAgreementSaving(false);
    }
  }

  async function openOwnAgreementPdf() {
    setError("");
    try {
      const query = agreement?.id ? `?agreementId=${encodeURIComponent(agreement.id)}` : "";
      await apiOpenFile(`/staff-incentives/agreements/me/pdf${query}`);
    } catch (requestError) {
      setError(requestError.message || "同意書 PDF 開啟失敗");
    }
  }

  async function openAdminAgreementPdf(row) {
    if (!row?.agreementId) return;
    setError("");
    try {
      await apiOpenFile(`/staff-incentives/admin/agreements/${row.agreementId}/pdf`);
    } catch (requestError) {
      setError(requestError.message || "同意書 PDF 開啟失敗");
    }
  }

  const plan = selfData?.plan || null;
  const agreement = selfData?.agreement || null;

  return (
    <div>
      <PageHeader
        title="我的銷售服務績效"
        description="查看車輛、配件、維修檢查、核准與支付狀態；員工只會看到自己的資料。"
      />
      <FilterBar>
        <label className="form-field">
          <span>月份</span>
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <button type="button" className="secondary-button" onClick={loadData} disabled={loading}>
          {loading ? "讀取中..." : "重新整理"}
        </button>
      </FilterBar>
      {error ? <div className="empty-state">{error}</div> : null}
      {success ? <div className="empty-state">{success}</div> : null}
      <SectionTabs items={tabs} value={tab} onChange={setTab} label="績效功能" />

      {tab === "SUMMARY" ? (
        <>
          <SummaryCards summary={selfData?.summary} />
          <div className="admin-split-grid">
            <section className="admin-panel">
              <AdminSectionHeader eyebrow="績效組成" title={`${month} 績效摘要`} description="作廢紀錄不計入本月總額。" />
              <div className="metric-list">
                <div className="metric-row"><span>車輛</span><strong>{money(selfData?.summary?.bikeAmount)}</strong></div>
                <div className="metric-row"><span>配件</span><strong>{money(selfData?.summary?.accessoryAmount)}</strong></div>
                <div className="metric-row"><span>維修檢查</span><strong>{money(selfData?.summary?.repairInspectionAmount)}</strong></div>
                <div className="metric-row"><span>成交 / 交車 / 售後</span><strong>{money(Number(selfData?.summary?.saleAmount || 0) + Number(selfData?.summary?.handoverAmount || 0) + Number(selfData?.summary?.followupAmount || 0))}</strong></div>
              </div>
            </section>
            <section className="admin-panel">
              <AdminSectionHeader eyebrow="重要原則" title="績效不會任意扣回" description="已核准或已支付績效如需更正，必須留下調整與審核紀錄。" />
              <p className="muted-text">提出異議只會建立待處理紀錄，不會自動變更已核准或已支付的金額。</p>
            </section>
          </div>
          <section className="admin-panel">
            <AdminSectionHeader eyebrow="明細" title="本月績效紀錄" description="依取得或建立時間由新到舊顯示。" />
            <EventTable events={selfEvents} />
          </section>
        </>
      ) : null}

      {["BIKE", "ACCESSORY", "REPAIR", "PENDING", "APPROVED", "PAID"].includes(tab) ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="我的績效" title={tabs.find((item) => item.key === tab)?.label || "績效明細"} description={`${month} 本人資料`} />
          <EventTable events={visibleSelfEvents} />
        </section>
      ) : null}

      {tab === "PLAN" ? (
        <div className="admin-split-grid">
          <section className="admin-panel">
            <AdminSectionHeader eyebrow="績效辦法" title={plan ? `案件完成責任版本 ${plan.version}` : "目前沒有生效中的績效辦法"} description={plan ? `生效日：${dateTime(plan.effectiveFrom)}` : "請洽管理員確認。"} />
            <div className="metric-list">
              <div className="metric-row"><span>車輛銷售</span><strong>完成條件</strong></div>
              <div className="metric-row"><span>完成交車</span><strong>完成條件</strong></div>
              <div className="metric-row"><span>售後追蹤</span><strong>完成條件</strong></div>
              <div className="metric-row"><span>三階段全部完成後一次給付</span><strong>{money(plan?.bikeTotalAmount ?? 600)}</strong></div>
              <div className="metric-row"><span>配件</span><strong>{Math.round(Number(plan?.accessoryRate ?? 0.1) * 100)}%</strong></div>
              <div className="metric-row"><span>維修初步檢查</span><strong>{money(plan?.repairInspectionAmount ?? 100)}</strong></div>
            </div>
            <p className="muted-text">車輛銷售、完成交車、售後追蹤三階段全部完成後，每台一次給付 NT$600；任一階段未完成皆不產生車輛績效金額事件。共同銷售依預先指定 70% / 30%。配件依個別品項實際成交價 10%。一般自行車零件、維修零件、工資、安裝費、運費等不列入配件績效。</p>
            {plan?.agreementText ? <div className="content-card"><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{plan.agreementText}</pre></div> : null}
          </section>
          <section className="admin-panel">
            <AdminSectionHeader
              eyebrow="同意書"
              title={agreement ? "已簽署" : "尚未簽署"}
              description={agreement ? "此版本已完成電子簽名並保存 PDF。" : "請先閱讀案件完成責任，再逐項確認並完成本人電子簽名。"}
              badges={<Status value={agreement ? "SIGNED" : "UNSIGNED"} />}
            />
            {agreement ? (
              <>
                <div className="metric-list">
                  <div className="metric-row"><span>同意書編號</span><strong>{agreement.agreementNumber || "-"}</strong></div>
                  <div className="metric-row"><span>簽署時間</span><strong>{dateTime(agreement.signedAt)}</strong></div>
                  <div className="metric-row"><span>文件雜湊</span><strong style={{ overflowWrap: "anywhere" }}>{agreement.documentHash || "-"}</strong></div>
                </div>
                <button type="button" className="secondary-button" onClick={openOwnAgreementPdf}>查看已簽署 PDF</button>
              </>
            ) : plan ? (
              <form onSubmit={signAgreement}>
                <div className="metric-list">
                  {AGREEMENT_CHECKS.map(([key, label]) => (
                    <label className="metric-row" key={key} style={{ alignItems: "flex-start", gap: 12 }}>
                      <input
                        type="checkbox"
                        checked={Boolean(agreementForm.requiredChecks[key])}
                        onChange={(event) => updateAgreementCheck(key, event.target.checked)}
                      />
                      <span style={{ flex: 1 }}>{label}</span>
                    </label>
                  ))}
                </div>
                <SignaturePad
                  value={agreementForm.signatureData}
                  onChange={(signatureData) => setAgreementForm((current) => ({ ...current, signatureData }))}
                />
                <p className="muted-text">送出後會記錄登入員工、時間、IP、瀏覽器資訊及文件雜湊，並將簽署 PDF 保存於門市 NAS。</p>
                <button type="submit" className="primary-button" disabled={agreementSaving}>
                  {agreementSaving ? "簽署中..." : "同意並完成簽署"}
                </button>
              </form>
            ) : (
              <p className="muted-text">目前沒有可簽署的生效績效辦法。</p>
            )}
          </section>
        </div>
      ) : null}

      {tab === "DISPUTE" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="提出異議" title="選擇本人績效紀錄" description="可對待確認、已核准或已支付紀錄提出說明；系統不會自動扣回金額。" />
          <form onSubmit={submitDispute}>
            <div className="form-grid">
              <label className="form-field">
                <span>績效紀錄</span>
                <select value={disputeForm.eventId} onChange={(event) => setDisputeForm((current) => ({ ...current, eventId: event.target.value }))} required>
                  <option value="">請選擇</option>
                  {selfEvents.map((item) => (
                    <option key={item.id} value={item.id}>{dateTime(item.earnedAt || item.createdAt)} / {TYPE_LABELS[item.incentiveType]} / {money(item.finalAmount)} / {STATUS_LABELS[item.status]}</option>
                  ))}
                </select>
              </label>
              <label className="form-field form-field-wide">
                <span>異議原因</span>
                <textarea value={disputeForm.reason} onChange={(event) => setDisputeForm((current) => ({ ...current, reason: event.target.value }))} rows={5} maxLength={1000} required />
              </label>
            </div>
            <button type="submit" className="primary-button">送出異議</button>
          </form>
        </section>
      ) : null}

      {canViewStore && tab === "ADMIN_OVERVIEW" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="管理用" title="全體員工績效摘要" description="僅供作業管理，不建立名次或公開排行榜。" />
          <DataTable
            columns={[
              { key: "staffDisplayName", label: "員工" },
              { key: "totalAmount", label: "本月績效", render: (row) => money(row.totalAmount) },
              { key: "pending", label: "待確認", render: (row) => money(Number(row.pendingAmount || 0) + Number(row.earnedAmount || 0)) },
              { key: "approvedAmount", label: "已核准", render: (row) => money(row.approvedAmount) },
              { key: "paidAmount", label: "已支付", render: (row) => money(row.paidAmount) },
              { key: "eventCount", label: "紀錄數" },
              { key: "openDisputeCount", label: "未結異議" }
            ]}
            rows={adminData.overview}
            emptyText="目前沒有員工績效摘要。"
            cardTitle={(row) => row.staffDisplayName}
            cardDescription={(row) => `本月績效 ${money(row.totalAmount)} / 紀錄 ${row.eventCount} 筆`}
          />
        </section>
      ) : null}

      {canViewStore && tab === "ADMIN_EVENTS" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="管理用" title="全部績效明細" description="依員工、狀態與類型篩選。" />
          <FilterBar>
            <label className="form-field"><span>員工</span><select value={eventFilters.staffUserId} onChange={(event) => setEventFilters((current) => ({ ...current, staffUserId: event.target.value }))}><option value="">全部</option>{adminData.overview.map((row) => <option key={row.staffUserId} value={row.staffUserId}>{row.staffDisplayName}</option>)}</select></label>
            <label className="form-field"><span>狀態</span><select value={eventFilters.status} onChange={(event) => setEventFilters((current) => ({ ...current, status: event.target.value }))}><option value="">全部</option>{["PENDING", "EARNED", "APPROVED", "PAID", "VOID", "DISPUTED"].map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</select></label>
            <label className="form-field"><span>類型</span><select value={eventFilters.type} onChange={(event) => setEventFilters((current) => ({ ...current, type: event.target.value }))}><option value="">全部</option>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </FilterBar>
          <EventTable events={filteredAdminEvents} showStaff />
        </section>
      ) : null}

      {canViewStore && tab === "ADMIN_AGREEMENTS" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="管理用" title="績效同意書" description="查看目前生效版本的簽署狀態。" />
          <DataTable columns={[
            { key: "staffDisplayName", label: "員工" },
            { key: "planVersion", label: "版本", render: (row) => row.planVersion || "尚無生效版本" },
            { key: "agreementStatus", label: "狀態", render: (row) => <Status value={row.agreementStatus} /> },
            { key: "agreementNumber", label: "同意書編號", render: (row) => row.agreementNumber || "-" },
            { key: "signedAt", label: "簽署時間", render: (row) => dateTime(row.signedAt) },
            { key: "pdf", label: "PDF", render: (row) => row.agreementId ? <button type="button" className="secondary-button" onClick={() => openAdminAgreementPdf(row)}>查看 PDF</button> : "-" }
          ]} rows={adminData.agreements} emptyText="目前沒有員工資料。" cardTitle={(row) => row.staffDisplayName} cardBadges={(row) => <Status value={row.agreementStatus} />} />
        </section>
      ) : null}

      {canViewStore && tab === "ADMIN_DISPUTES" ? (
        <div className="admin-split-grid">
          <section className="admin-panel">
            <AdminSectionHeader eyebrow="管理用" title="異議處理" description="選擇紀錄後在右側更新；不會自動修改績效金額。" />
            <DataTable columns={[
              { key: "staffDisplayName", label: "員工" },
              { key: "type", label: "績效", render: (row) => `${TYPE_LABELS[row.incentiveType]} / ${STAGE_LABELS[row.earningStage]}` },
              { key: "finalAmount", label: "金額", render: (row) => money(row.finalAmount) },
              { key: "reason", label: "原因" },
              { key: "status", label: "狀態", render: (row) => <Status value={row.status} /> },
              { key: "action", label: "操作", render: (row) => isAdmin ? <button type="button" className="secondary-button" onClick={() => chooseAdminDispute(row)}>處理</button> : "唯讀" }
            ]} rows={adminData.disputes} emptyText="目前沒有異議。" cardTitle={(row) => `${row.staffDisplayName} / ${money(row.finalAmount)}`} cardBadges={(row) => <Status value={row.status} />} cardFooter={(row) => isAdmin ? <button type="button" className="secondary-button" onClick={() => chooseAdminDispute(row)}>處理</button> : null} />
          </section>
          <section className="admin-panel">
            <AdminSectionHeader eyebrow="異議回覆" title={adminDispute.id ? `異議 #${adminDispute.id}` : "請選擇異議"} />
            <form onSubmit={saveAdminDispute}>
              <label className="form-field"><span>狀態</span><select value={adminDispute.status} onChange={(event) => setAdminDispute((current) => ({ ...current, status: event.target.value }))} disabled={!isAdmin || !adminDispute.id}>{["REVIEWING", "RESOLVED", "REJECTED"].map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</select></label>
              <label className="form-field"><span>管理員回覆</span><textarea rows={6} value={adminDispute.adminResponse} onChange={(event) => setAdminDispute((current) => ({ ...current, adminResponse: event.target.value }))} disabled={!isAdmin || !adminDispute.id} /></label>
              <button type="submit" className="primary-button" disabled={!isAdmin || !adminDispute.id}>儲存處理結果</button>
            </form>
          </section>
        </div>
      ) : null}

      {canViewStore && tab === "ADMIN_ADJUSTMENTS" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="唯讀稽核" title="績效調整紀錄" description="已核准或已支付績效如需更正，應由具備稽核紀錄的調整流程處理。" />
          <DataTable columns={[
            { key: "createdAt", label: "時間", render: (row) => dateTime(row.createdAt) },
            { key: "staffDisplayName", label: "員工" },
            { key: "eventId", label: "績效紀錄" },
            { key: "previousAmount", label: "原金額", render: (row) => money(row.previousAmount) },
            { key: "adjustmentAmount", label: "調整", render: (row) => money(row.adjustmentAmount) },
            { key: "finalAmount", label: "調整後", render: (row) => money(row.finalAmount) },
            { key: "reason", label: "原因" }
          ]} rows={adminData.adjustments} emptyText="目前沒有調整紀錄。" cardTitle={(row) => `${row.staffDisplayName} / ${money(row.finalAmount)}`} />
        </section>
      ) : null}

      {canViewStore && tab === "ADMIN_PAYOUTS" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="唯讀月結" title={`${month} 月結支付`} description="本頁先提供核對與查詢，不在此版本直接執行支付。" />
          <DataTable columns={[
            { key: "staffDisplayName", label: "員工" },
            { key: "earnedAmount", label: "取得金額", render: (row) => money(row.earnedAmount) },
            { key: "adjustmentAmount", label: "調整金額", render: (row) => money(row.adjustmentAmount) },
            { key: "finalAmount", label: "最終金額", render: (row) => money(row.finalAmount) },
            { key: "status", label: "狀態", render: (row) => <Status value={row.status} /> },
            { key: "paidAt", label: "支付時間", render: (row) => dateTime(row.paidAt) },
            { key: "note", label: "備註", render: (row) => row.note || "-" }
          ]} rows={adminData.payouts} emptyText="本月尚未建立月結支付紀錄。" cardTitle={(row) => `${row.staffDisplayName} / ${money(row.finalAmount)}`} cardBadges={(row) => <Status value={row.status} />} />
        </section>
      ) : null}
    </div>
  );
}

export default StaffIncentivesPage;
