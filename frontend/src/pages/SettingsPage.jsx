import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AdminSectionHeader from "../components/AdminSectionHeader";
import PageHeader from "../components/PageHeader";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import { apiRequest } from "../lib/api";
import { getSettingsSectionFromSearch } from "../lib/mobileNavigation";

const WEEKDAY_OPTIONS = [
  { key: "MON", label: "週一" },
  { key: "TUE", label: "週二" },
  { key: "WED", label: "週三" },
  { key: "THU", label: "週四" },
  { key: "FRI", label: "週五" },
  { key: "SAT", label: "週六" },
  { key: "SUN", label: "週日" }
];

const STORE_DEFAULTS = {
  storeName: "",
  storeShortName: "",
  address: "",
  googleMapUrl: "",
  contactPhone: "",
  customerServiceNote: "",
  businessHours: "",
  holidayText: "",
  lineOaDisplayName: "",
  lineAddFriendUrl: "",
  lineOaDisplayInfo: "",
  storeDescription: "",
  navigationNote: "",
  bulletinCopy: "",
  receiptDisplayInfo: "",
  purchaseConfirmationCopy: "",
  repairReservationCopy: "",
  surveyFollowUpCopy: "",
  taxRate: "0.05",
  currency: "TWD",
  amountDisplayMode: "INCLUDE_TAX",
  orderNoPrefix: "",
  repairNoPrefix: "",
  purchaseConfirmationNoRule: "",
  repairReservationWeekdays: [],
  basicInspectionFee: "0",
  storageFeeRule: "",
  depositRule: "",
  ebikePurchaseRule: "",
  phoneBindingRequired: true
};

const SYSTEM_DEFAULTS = {
  line: {
    clientOaEnabled: true,
    staffGroupModeEnabled: true,
    quickReplyEnabled: true,
    launcherEnabled: true
  },
  notifications: {
    repairReservation: true,
    repairEstimate: true,
    purchaseConfirmation: true,
    survey: true,
    lowStock: true,
    dailyReportSendTime: "21:00",
    pendingSummarySendTime: "09:00"
  },
  pos: {
    saveToServerRule: true,
    multipleCartEnabled: true,
    customerInfoRequiredBeforeCheckout: true,
    phoneBindingRequired: true,
    ebikeSpecialRulesSummary: "",
    repairSpecialRulesSummary: ""
  },
  display: {
    dashboardFocusNote: "",
    adminNotice: ""
  }
};

const MAIN_SECTIONS = [
  { key: "store", label: "門市設定" },
  { key: "system", label: "系統設定" }
];

const STORE_TABS = [
  { key: "basic", label: "基本資料" },
  { key: "display", label: "對外顯示" },
  { key: "pos", label: "訂單/POS 預設" },
  { key: "policy", label: "門市政策" }
];

const SYSTEM_TABS = [
  { key: "line", label: "LINE" },
  { key: "notifications", label: "通知" },
  { key: "permissions", label: "權限" },
  { key: "pos", label: "POS 規則" },
  { key: "status", label: "系統狀態" }
];

function cloneStoreForm(source) {
  return {
    storeName: source?.storeName || "",
    storeShortName: source?.storeShortName || "",
    address: source?.address || "",
    googleMapUrl: source?.googleMapUrl || "",
    contactPhone: source?.contactPhone || "",
    customerServiceNote: source?.customerServiceNote || "",
    businessHours: source?.businessHours || "",
    holidayText: source?.holidayText || "",
    lineOaDisplayName: source?.lineOaDisplayName || "",
    lineAddFriendUrl: source?.lineAddFriendUrl || "",
    lineOaDisplayInfo: source?.lineOaDisplayInfo || "",
    storeDescription: source?.storeDescription || "",
    navigationNote: source?.navigationNote || "",
    bulletinCopy: source?.bulletinCopy || "",
    receiptDisplayInfo: source?.receiptDisplayInfo || "",
    purchaseConfirmationCopy: source?.purchaseConfirmationCopy || "",
    repairReservationCopy: source?.repairReservationCopy || "",
    surveyFollowUpCopy: source?.surveyFollowUpCopy || "",
    taxRate: String(source?.taxRate ?? "0.05"),
    currency: source?.currency || "TWD",
    amountDisplayMode: source?.amountDisplayMode || "INCLUDE_TAX",
    orderNoPrefix: source?.orderNoPrefix || "",
    repairNoPrefix: source?.repairNoPrefix || "",
    purchaseConfirmationNoRule: source?.purchaseConfirmationNoRule || "",
    repairReservationWeekdays: Array.isArray(source?.repairReservationWeekdays) ? source.repairReservationWeekdays : [],
    basicInspectionFee: String(source?.basicInspectionFee ?? "0"),
    storageFeeRule: source?.storageFeeRule || "",
    depositRule: source?.depositRule || "",
    ebikePurchaseRule: source?.ebikePurchaseRule || "",
    phoneBindingRequired: Boolean(source?.phoneBindingRequired)
  };
}

function cloneSystemForm(source) {
  return {
    line: {
      clientOaEnabled: Boolean(source?.line?.clientOaEnabled),
      staffGroupModeEnabled: Boolean(source?.line?.staffGroupModeEnabled),
      quickReplyEnabled: Boolean(source?.line?.quickReplyEnabled),
      launcherEnabled: Boolean(source?.line?.launcherEnabled)
    },
    notifications: {
      repairReservation: Boolean(source?.notifications?.repairReservation),
      repairEstimate: Boolean(source?.notifications?.repairEstimate),
      purchaseConfirmation: Boolean(source?.notifications?.purchaseConfirmation),
      survey: Boolean(source?.notifications?.survey),
      lowStock: Boolean(source?.notifications?.lowStock),
      dailyReportSendTime: source?.notifications?.dailyReportSendTime || "21:00",
      pendingSummarySendTime: source?.notifications?.pendingSummarySendTime || "09:00"
    },
    pos: {
      saveToServerRule: Boolean(source?.pos?.saveToServerRule),
      multipleCartEnabled: Boolean(source?.pos?.multipleCartEnabled),
      customerInfoRequiredBeforeCheckout: Boolean(source?.pos?.customerInfoRequiredBeforeCheckout),
      phoneBindingRequired: Boolean(source?.pos?.phoneBindingRequired),
      ebikeSpecialRulesSummary: source?.pos?.ebikeSpecialRulesSummary || "",
      repairSpecialRulesSummary: source?.pos?.repairSpecialRulesSummary || ""
    },
    display: {
      dashboardFocusNote: source?.display?.dashboardFocusNote || "",
      adminNotice: source?.display?.adminNotice || ""
    }
  };
}

function joinWeekdays(days = []) {
  const labels = WEEKDAY_OPTIONS.filter((item) => days.includes(item.key)).map((item) => item.label);
  return labels.length ? labels.join("、") : "未設定";
}

function formatYesNo(value) {
  return value ? "是" : "否";
}

function formatEnabled(value) {
  return value ? "已啟用" : "未啟用";
}

function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const section = useMemo(() => getSettingsSectionFromSearch(location.search), [location.search]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [storeTab, setStoreTab] = useState("basic");
  const [systemTab, setSystemTab] = useState("line");
  const [storeForm, setStoreForm] = useState(STORE_DEFAULTS);
  const [systemForm, setSystemForm] = useState(SYSTEM_DEFAULTS);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await apiRequest("/settings");
        setSettings(response);
        setStoreForm(cloneStoreForm(response.store));
        setSystemForm(cloneSystemForm(response.system));
      } catch (err) {
        setError(err.message || "載入設定失敗");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const summary = settings?.summary || {};
  const storeSummary = summary.store || {};
  const lineSummary = summary.line || {};
  const groupsSummary = summary.groups || {};
  const permissionsSummary = summary.permissions || {};
  const systemStatus = summary.systemStatus || {};
  const posSummary = summary.pos || {};

  const lineBadges = useMemo(
    () => [
      { label: "Webhook 狀態", tone: lineSummary.webhookStatus === "已啟用" ? "success" : "warning", text: lineSummary.webhookStatus || "-" },
      { label: "Token 狀態", tone: lineSummary.channelAccessTokenStatus === "已設定" ? "success" : "warning", text: lineSummary.channelAccessTokenStatus || "-" },
      { label: "密鑰狀態", tone: lineSummary.channelSecretStatus === "已設定" ? "success" : "warning", text: lineSummary.channelSecretStatus || "-" },
      { label: "客服 OA", tone: lineSummary.clientOaEnabledStatus === "已啟用" ? "success" : "neutral", text: lineSummary.clientOaEnabledStatus || "-" },
      { label: "員工群組模式", tone: lineSummary.staffGroupModeStatus === "已啟用" ? "info" : "neutral", text: lineSummary.staffGroupModeStatus || "-" },
      { label: "快速回覆", tone: lineSummary.quickReplyStatus === "已啟用" ? "success" : "neutral", text: lineSummary.quickReplyStatus || "-" }
    ],
    [lineSummary]
  );

  function updateStoreField(name, value) {
    setStoreForm((current) => ({ ...current, [name]: value }));
  }

  function toggleStoreWeekday(code) {
    setStoreForm((current) => ({
      ...current,
      repairReservationWeekdays: current.repairReservationWeekdays.includes(code)
        ? current.repairReservationWeekdays.filter((item) => item !== code)
        : [...current.repairReservationWeekdays, code]
    }));
  }

  function updateSystemField(sectionName, name, value) {
    setSystemForm((current) => ({
      ...current,
      [sectionName]: {
        ...current[sectionName],
        [name]: value
      }
    }));
  }

  async function saveStore(event) {
    event.preventDefault();
    setSaving("store");
    try {
      await apiRequest("/settings/store", {
        method: "PATCH",
        body: JSON.stringify(storeForm)
      });
      const refreshed = await apiRequest("/settings");
      setSettings(refreshed);
      setStoreForm(cloneStoreForm(refreshed.store));
      setSystemForm(cloneSystemForm(refreshed.system));
      alert("門市設定已更新");
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving("");
    }
  }

  async function saveSystem(event) {
    event.preventDefault();
    setSaving("system");
    try {
      await apiRequest("/settings/system", {
        method: "PATCH",
        body: JSON.stringify(systemForm)
      });
      const refreshed = await apiRequest("/settings");
      setSettings(refreshed);
      setStoreForm(cloneStoreForm(refreshed.store));
      setSystemForm(cloneSystemForm(refreshed.system));
      alert("系統設定已更新");
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving("");
    }
  }

  function changeMainSection(nextSection) {
    navigate(`/settings?section=${nextSection}`, { replace: true });
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="系統管理" description="載入設定中..." />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="系統管理" description="門市設定與系統設定集中管理。" />
        <div className="error-banner">{error}</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="系統管理" description="單一 canonical 設定區，管理門市資訊、LINE 狀態、通知預設、POS 規則與系統摘要。" />

      <SectionTabs items={MAIN_SECTIONS} value={section} onChange={changeMainSection} label="設定子功能" />

      {section === "store" ? (
        <section className="content-card section-panel">
          <AdminSectionHeader
            eyebrow="門市設定"
            title="門市對外資訊與政策"
            description="門市基本資料、對外顯示文案、訂單/POS 預設與門市政策集中管理。"
            badges={<StatusBadge tone="info">可編輯</StatusBadge>}
          />
          <SectionTabs items={STORE_TABS} value={storeTab} onChange={setStoreTab} label="門市設定子功能" />

          <form onSubmit={saveStore}>
            {storeTab === "basic" ? (
              <div className="admin-split-grid">
                <div className="content-card">
                  <div className="section-title">基本資料</div>
                  <div className="grid-form compact-grid">
                    <label className="form-field form-field-wide">
                      <span>門市名稱</span>
                      <input value={storeForm.storeName} onChange={(event) => updateStoreField("storeName", event.target.value)} />
                    </label>
                    <label className="form-field">
                      <span>門市簡稱</span>
                      <input value={storeForm.storeShortName} onChange={(event) => updateStoreField("storeShortName", event.target.value)} />
                    </label>
                    <label className="form-field form-field-wide">
                      <span>地址</span>
                      <input value={storeForm.address} onChange={(event) => updateStoreField("address", event.target.value)} />
                    </label>
                    <label className="form-field form-field-wide">
                      <span>Google 地圖連結</span>
                      <input value={storeForm.googleMapUrl} onChange={(event) => updateStoreField("googleMapUrl", event.target.value)} />
                    </label>
                    <label className="form-field">
                      <span>聯絡電話</span>
                      <input value={storeForm.contactPhone} onChange={(event) => updateStoreField("contactPhone", event.target.value)} />
                    </label>
                    <label className="form-field">
                      <span>營業時間</span>
                      <input value={storeForm.businessHours} onChange={(event) => updateStoreField("businessHours", event.target.value)} />
                    </label>
                    <label className="form-field">
                      <span>公休日</span>
                      <input value={storeForm.holidayText} onChange={(event) => updateStoreField("holidayText", event.target.value)} />
                    </label>
                    <label className="form-field form-field-wide">
                      <span>客服說明</span>
                      <textarea rows="3" value={storeForm.customerServiceNote} onChange={(event) => updateStoreField("customerServiceNote", event.target.value)} />
                    </label>
                  </div>
                  <button type="submit" className="primary-button inline-submit" disabled={saving === "store"}>
                    {saving === "store" ? "儲存中..." : "儲存門市設定"}
                  </button>
                </div>
                <div className="content-card">
                  <div className="section-title">公開摘要</div>
                  <div className="stack-list">
                    <div className="log-row">
                      <strong>門市名稱：</strong>
                      <div>{storeForm.storeName || storeSummary.storeName || "-"}</div>
                    </div>
                    <div className="log-row">
                      <strong>門市簡稱：</strong>
                      <div>{storeForm.storeShortName || storeSummary.storeShortName || "-"}</div>
                    </div>
                    <div className="log-row">
                      <strong>地址：</strong>
                      <div>{storeForm.address || storeSummary.address || "-"}</div>
                    </div>
                    <div className="log-row">
                      <strong>營業時間 / 公休日：</strong>
                      <div>{`${storeForm.businessHours || "-"} / ${storeForm.holidayText || "-"}`}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {storeTab === "display" ? (
              <div className="admin-split-grid">
                <div className="content-card">
                  <div className="section-title">對外顯示</div>
                  <div className="grid-form compact-grid">
                    <label className="form-field">
                      <span>LINE OA 顯示名稱</span>
                      <input value={storeForm.lineOaDisplayName} onChange={(event) => updateStoreField("lineOaDisplayName", event.target.value)} />
                    </label>
                    <label className="form-field">
                      <span>LINE 加好友連結</span>
                      <input value={storeForm.lineAddFriendUrl} onChange={(event) => updateStoreField("lineAddFriendUrl", event.target.value)} />
                    </label>
                    <label className="form-field form-field-wide">
                      <span>門市簡介</span>
                      <textarea rows="3" value={storeForm.storeDescription} onChange={(event) => updateStoreField("storeDescription", event.target.value)} />
                    </label>
                    <label className="form-field form-field-wide">
                      <span>導航說明</span>
                      <textarea rows="3" value={storeForm.navigationNote} onChange={(event) => updateStoreField("navigationNote", event.target.value)} />
                    </label>
                    <label className="form-field form-field-wide">
                      <span>門市公告文案</span>
                      <textarea rows="3" value={storeForm.bulletinCopy} onChange={(event) => updateStoreField("bulletinCopy", event.target.value)} />
                    </label>
                    <label className="form-field form-field-wide">
                      <span>購買確認書預設顯示文案</span>
                      <textarea rows="3" value={storeForm.purchaseConfirmationCopy} onChange={(event) => updateStoreField("purchaseConfirmationCopy", event.target.value)} />
                    </label>
                    <label className="form-field form-field-wide">
                      <span>維修預約預設說明文案</span>
                      <textarea rows="3" value={storeForm.repairReservationCopy} onChange={(event) => updateStoreField("repairReservationCopy", event.target.value)} />
                    </label>
                    <label className="form-field form-field-wide">
                      <span>問卷 / 後續提醒文案</span>
                      <textarea rows="3" value={storeForm.surveyFollowUpCopy} onChange={(event) => updateStoreField("surveyFollowUpCopy", event.target.value)} />
                    </label>
                    <label className="form-field form-field-wide">
                      <span>收據 / 購買確認預設顯示資訊</span>
                      <textarea rows="3" value={storeForm.receiptDisplayInfo} onChange={(event) => updateStoreField("receiptDisplayInfo", event.target.value)} />
                    </label>
                  </div>
                  <button type="submit" className="primary-button inline-submit" disabled={saving === "store"}>
                    {saving === "store" ? "儲存中..." : "儲存門市設定"}
                  </button>
                </div>
                <div className="content-card">
                  <div className="section-title">對外摘要</div>
                  <div className="stack-list">
                    <div className="log-row">
                      <strong>LINE OA：</strong>
                      <div>{storeForm.lineOaDisplayName || storeSummary.lineOaDisplayName || "-"}</div>
                    </div>
                    <div className="log-row">
                      <strong>公告文案：</strong>
                      <div>{storeForm.bulletinCopy || storeSummary.bulletinCopy || "-"}</div>
                    </div>
                    <div className="log-row">
                      <strong>門市簡介：</strong>
                      <div>{storeForm.storeDescription || storeSummary.storeDescription || "-"}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {storeTab === "pos" ? (
              <div className="admin-split-grid">
                <div className="content-card">
                  <div className="section-title">訂單 / POS 預設</div>
                  <div className="grid-form compact-grid">
                    <label className="form-field">
                      <span>預設稅率</span>
                      <input value={storeForm.taxRate} onChange={(event) => updateStoreField("taxRate", event.target.value)} />
                    </label>
                    <label className="form-field">
                      <span>預設幣別</span>
                      <select value={storeForm.currency} onChange={(event) => updateStoreField("currency", event.target.value)}>
                        <option value="TWD">TWD</option>
                        <option value="USD">USD</option>
                        <option value="JPY">JPY</option>
                      </select>
                    </label>
                    <label className="form-field">
                      <span>金額顯示方式</span>
                      <select value={storeForm.amountDisplayMode} onChange={(event) => updateStoreField("amountDisplayMode", event.target.value)}>
                        <option value="INCLUDE_TAX">含稅顯示</option>
                        <option value="EXCLUDE_TAX">未稅顯示</option>
                      </select>
                    </label>
                    <label className="form-field">
                      <span>訂單編號 prefix</span>
                      <input value={storeForm.orderNoPrefix} onChange={(event) => updateStoreField("orderNoPrefix", event.target.value)} />
                    </label>
                    <label className="form-field">
                      <span>維修單編號 prefix</span>
                      <input value={storeForm.repairNoPrefix} onChange={(event) => updateStoreField("repairNoPrefix", event.target.value)} />
                    </label>
                    <label className="form-field form-field-wide">
                      <span>購買確認書編號規則</span>
                      <input value={storeForm.purchaseConfirmationNoRule} onChange={(event) => updateStoreField("purchaseConfirmationNoRule", event.target.value)} />
                    </label>
                  </div>
                  <button type="submit" className="primary-button inline-submit" disabled={saving === "store"}>
                    {saving === "store" ? "儲存中..." : "儲存門市設定"}
                  </button>
                </div>
                <div className="content-card">
                  <div className="section-title">摘要</div>
                  <div className="field-grid">
                    <div className="field-item">
                      <div className="field-label">稅率</div>
                      <div className="field-value">{storeForm.taxRate}</div>
                    </div>
                    <div className="field-item">
                      <div className="field-label">幣別</div>
                      <div className="field-value">{storeForm.currency}</div>
                    </div>
                    <div className="field-item">
                      <div className="field-label">金額顯示方式</div>
                      <div className="field-value">{storeForm.amountDisplayMode === "INCLUDE_TAX" ? "含稅顯示" : "未稅顯示"}</div>
                    </div>
                    <div className="field-item">
                      <div className="field-label">訂單 prefix</div>
                      <div className="field-value">{storeForm.orderNoPrefix || "-"}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {storeTab === "policy" ? (
              <div className="admin-split-grid">
                <div className="content-card">
                  <div className="section-title">門市政策</div>
                  <div className="grid-form compact-grid">
                    <div className="form-field form-field-wide">
                      <span>維修可預約星期</span>
                      <div className="stack-list">
                        {WEEKDAY_OPTIONS.map((item) => (
                          <label key={item.key} className="checklist-item">
                            <input
                              type="checkbox"
                              checked={storeForm.repairReservationWeekdays.includes(item.key)}
                              onChange={() => toggleStoreWeekday(item.key)}
                            />
                            <span>{item.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <label className="form-field">
                      <span>基本檢查費</span>
                      <input value={storeForm.basicInspectionFee} onChange={(event) => updateStoreField("basicInspectionFee", event.target.value)} />
                    </label>
                    <label className="form-field form-field-wide">
                      <span>保管費規則</span>
                      <textarea rows="3" value={storeForm.storageFeeRule} onChange={(event) => updateStoreField("storageFeeRule", event.target.value)} />
                    </label>
                    <label className="form-field form-field-wide">
                      <span>訂金預設規則</span>
                      <textarea rows="3" value={storeForm.depositRule} onChange={(event) => updateStoreField("depositRule", event.target.value)} />
                    </label>
                    <label className="form-field form-field-wide">
                      <span>電動自行車購買條件說明</span>
                      <textarea rows="3" value={storeForm.ebikePurchaseRule} onChange={(event) => updateStoreField("ebikePurchaseRule", event.target.value)} />
                    </label>
                    <label className="checklist-item">
                      <input
                        type="checkbox"
                        checked={storeForm.phoneBindingRequired}
                        onChange={(event) => updateStoreField("phoneBindingRequired", event.target.checked)}
                      />
                      <span>是否需要手機綁定</span>
                    </label>
                  </div>
                  <button type="submit" className="primary-button inline-submit" disabled={saving === "store"}>
                    {saving === "store" ? "儲存中..." : "儲存門市設定"}
                  </button>
                </div>
                <div className="content-card">
                  <div className="section-title">政策摘要</div>
                  <div className="stack-list">
                    <div className="log-row">
                      <strong>可預約星期：</strong>
                      <div>{joinWeekdays(storeForm.repairReservationWeekdays)}</div>
                    </div>
                    <div className="log-row">
                      <strong>檢查費：</strong>
                      <div>NT$ {storeForm.basicInspectionFee}</div>
                    </div>
                    <div className="log-row">
                      <strong>手機綁定：</strong>
                      <div>{formatYesNo(storeForm.phoneBindingRequired)}</div>
                    </div>
                    <div className="log-row">
                      <strong>電動自行車說明：</strong>
                      <div>{storeForm.ebikePurchaseRule || "-"}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </form>
        </section>
      ) : (
        <section className="content-card section-panel">
          <AdminSectionHeader
            eyebrow="系統設定"
            title="系統層設定與狀態"
            description="LINE 狀態、通知預設、權限摘要、POS 規則與系統狀態集中管理。敏感值只顯示安全摘要。"
            badges={<StatusBadge tone="info">可編輯 / 可檢視</StatusBadge>}
          />
          <SectionTabs items={SYSTEM_TABS} value={systemTab} onChange={setSystemTab} label="系統設定子功能" />

          <form onSubmit={saveSystem}>
            {systemTab === "line" ? (
              <div className="admin-split-grid">
                <div className="content-card">
                  <div className="section-title">LINE</div>
                  <div className="stack-list">
                    {lineBadges.map((badge) => (
                      <StatusBadge key={badge.label} tone={badge.tone}>
                        {badge.label}：{badge.text}
                      </StatusBadge>
                    ))}
                  </div>
                  <div className="field-grid">
                    <div className="field-item">
                      <div className="field-label">LINE webhook 狀態</div>
                      <div className="field-value">{lineSummary.webhookStatus || "-"}</div>
                    </div>
                    <div className="field-item">
                      <div className="field-label">客戶 OA 啟用狀態</div>
                      <div className="field-value">{lineSummary.clientOaEnabledStatus || "-"}</div>
                    </div>
                    <div className="field-item">
                      <div className="field-label">員工群組模式啟用狀態</div>
                      <div className="field-value">{lineSummary.staffGroupModeStatus || "-"}</div>
                    </div>
                    <div className="field-item">
                      <div className="field-label">快速回覆 / 啟動按鈕</div>
                      <div className="field-value">{`${lineSummary.quickReplyStatus || "-"} / ${lineSummary.launcherStatus || "-"}`}</div>
                    </div>
                  </div>
                </div>
                <div className="content-card">
                  <div className="section-title">群組註冊摘要</div>
                  <div className="stack-list">
                    <div className="log-row">
                      <strong>STAFF 群組：</strong>
                      <div>{groupsSummary.staff?.length || 0} 筆</div>
                    </div>
                    <div className="log-row">
                      <strong>QA / ADMIN 群組：</strong>
                      <div>{(groupsSummary.admin?.length || 0) + (groupsSummary.daily?.length || 0)} 筆</div>
                    </div>
                    <div className="log-row">
                      <strong>註冊狀態：</strong>
                      <div>{lineSummary.qaGroupIdStatus || "-"}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {systemTab === "notifications" ? (
              <div className="admin-split-grid">
                <div className="content-card">
                  <div className="section-title">通知</div>
                  <div className="grid-form compact-grid">
                    <label className="checklist-item">
                      <input
                        type="checkbox"
                        checked={systemForm.notifications.repairReservation}
                        onChange={(event) => updateSystemField("notifications", "repairReservation", event.target.checked)}
                      />
                      <span>維修預約通知</span>
                    </label>
                    <label className="checklist-item">
                      <input
                        type="checkbox"
                        checked={systemForm.notifications.repairEstimate}
                        onChange={(event) => updateSystemField("notifications", "repairEstimate", event.target.checked)}
                      />
                      <span>維修估價通知</span>
                    </label>
                    <label className="checklist-item">
                      <input
                        type="checkbox"
                        checked={systemForm.notifications.purchaseConfirmation}
                        onChange={(event) => updateSystemField("notifications", "purchaseConfirmation", event.target.checked)}
                      />
                      <span>購買確認通知</span>
                    </label>
                    <label className="checklist-item">
                      <input
                        type="checkbox"
                        checked={systemForm.notifications.survey}
                        onChange={(event) => updateSystemField("notifications", "survey", event.target.checked)}
                      />
                      <span>問卷通知</span>
                    </label>
                    <label className="checklist-item">
                      <input
                        type="checkbox"
                        checked={systemForm.notifications.lowStock}
                        onChange={(event) => updateSystemField("notifications", "lowStock", event.target.checked)}
                      />
                      <span>低庫存通知</span>
                    </label>
                    <label className="form-field">
                      <span>日結報告發送時間</span>
                      <input value={systemForm.notifications.dailyReportSendTime} onChange={(event) => updateSystemField("notifications", "dailyReportSendTime", event.target.value)} />
                    </label>
                    <label className="form-field">
                      <span>待辦摘要發送時間</span>
                      <input value={systemForm.notifications.pendingSummarySendTime} onChange={(event) => updateSystemField("notifications", "pendingSummarySendTime", event.target.value)} />
                    </label>
                  </div>
                  <button type="submit" className="primary-button inline-submit" disabled={saving === "system"}>
                    {saving === "system" ? "儲存中..." : "儲存系統設定"}
                  </button>
                </div>
                <div className="content-card">
                  <div className="section-title">通知摘要</div>
                  <div className="stack-list">
                    <div className="log-row">
                      <strong>日結時間：</strong>
                      <div>{systemForm.notifications.dailyReportSendTime}</div>
                    </div>
                    <div className="log-row">
                      <strong>待辦摘要：</strong>
                      <div>{systemForm.notifications.pendingSummarySendTime}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {systemTab === "permissions" ? (
              <div className="admin-split-grid">
                <div className="content-card">
                  <div className="section-title">權限</div>
                  <div className="stack-list">
                    {(permissionsSummary.roles || []).map((role) => (
                      <div key={role.role} className="log-row">
                        <strong>{role.label || role.role}</strong>
                        <div>{role.summary || "-"}</div>
                      </div>
                    ))}
                    <div className="log-row">
                      <strong>需要管理員批准：</strong>
                      <div>{(permissionsSummary.adminApprovalItems || []).join("、") || "-"}</div>
                    </div>
                    <div className="log-row">
                      <strong>員工 LINE userId 連結狀態摘要：</strong>
                      <div>{permissionsSummary.staffLinkedStatus || "-"}</div>
                    </div>
                    <div className="log-row">
                      <strong>員工綁定說明：</strong>
                      <div>{permissionsSummary.staffLineLinkSummary || "-"}</div>
                    </div>
                  </div>
                </div>
                <div className="content-card">
                  <div className="section-title">權限摘要</div>
                  <div className="field-grid">
                    <div className="field-item">
                      <div className="field-label">角色列表</div>
                      <div className="field-value">{(permissionsSummary.roles || []).map((role) => role.label).join("、") || "-"}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {systemTab === "pos" ? (
              <div className="admin-split-grid">
                <div className="content-card">
                  <div className="section-title">POS 規則</div>
                  <div className="grid-form compact-grid">
                    <label className="checklist-item">
                      <input
                        type="checkbox"
                        checked={systemForm.pos.saveToServerRule}
                        onChange={(event) => updateSystemField("pos", "saveToServerRule", event.target.checked)}
                      />
                      <span>儲存到伺服器規則</span>
                    </label>
                    <label className="checklist-item">
                      <input
                        type="checkbox"
                        checked={systemForm.pos.multipleCartEnabled}
                        onChange={(event) => updateSystemField("pos", "multipleCartEnabled", event.target.checked)}
                      />
                      <span>多購物車啟用狀態</span>
                    </label>
                    <label className="checklist-item">
                      <input
                        type="checkbox"
                        checked={systemForm.pos.customerInfoRequiredBeforeCheckout}
                        onChange={(event) => updateSystemField("pos", "customerInfoRequiredBeforeCheckout", event.target.checked)}
                      />
                      <span>結帳前顧客資訊是否必填</span>
                    </label>
                    <label className="checklist-item">
                      <input
                        type="checkbox"
                        checked={systemForm.pos.phoneBindingRequired}
                        onChange={(event) => updateSystemField("pos", "phoneBindingRequired", event.target.checked)}
                      />
                      <span>手機綁定是否必填</span>
                    </label>
                    <label className="form-field form-field-wide">
                      <span>電動自行車特殊規則摘要</span>
                      <textarea rows="3" value={systemForm.pos.ebikeSpecialRulesSummary} onChange={(event) => updateSystemField("pos", "ebikeSpecialRulesSummary", event.target.value)} />
                    </label>
                    <label className="form-field form-field-wide">
                      <span>維修類型特殊規則摘要</span>
                      <textarea rows="3" value={systemForm.pos.repairSpecialRulesSummary} onChange={(event) => updateSystemField("pos", "repairSpecialRulesSummary", event.target.value)} />
                    </label>
                  </div>
                  <button type="submit" className="primary-button inline-submit" disabled={saving === "system"}>
                    {saving === "system" ? "儲存中..." : "儲存系統設定"}
                  </button>
                </div>
                <div className="content-card">
                  <div className="section-title">規則摘要</div>
                  <div className="stack-list">
                    <div className="log-row">
                      <strong>儲存到伺服器：</strong>
                      <div>{formatEnabled(systemForm.pos.saveToServerRule)}</div>
                    </div>
                    <div className="log-row">
                      <strong>多購物車：</strong>
                      <div>{formatEnabled(systemForm.pos.multipleCartEnabled)}</div>
                    </div>
                    <div className="log-row">
                      <strong>顧客資訊必填：</strong>
                      <div>{formatYesNo(systemForm.pos.customerInfoRequiredBeforeCheckout)}</div>
                    </div>
                    <div className="log-row">
                      <strong>手機綁定必填：</strong>
                      <div>{formatYesNo(systemForm.pos.phoneBindingRequired)}</div>
                    </div>
                    <div className="log-row">
                      <strong>電動自行車規則：</strong>
                      <div>{systemForm.pos.ebikeSpecialRulesSummary || "-"}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {systemTab === "status" ? (
              <div className="admin-split-grid">
                <div className="content-card">
                  <div className="section-title">系統狀態</div>
                  <div className="field-grid">
                    <div className="field-item">
                      <div className="field-label">資料庫連線狀態</div>
                      <div className="field-value">{systemStatus.dbStatus || "已連線"}</div>
                    </div>
                    <div className="field-item">
                      <div className="field-label">LINE 連線狀態</div>
                      <div className="field-value">{systemStatus.lineStatus || "-"}</div>
                    </div>
                    <div className="field-item">
                      <div className="field-label">最近 webhook 接收時間</div>
                      <div className="field-value">{systemStatus.latestWebhookReceivedAt || "未記錄"}</div>
                    </div>
                    <div className="field-item">
                      <div className="field-label">最近日結發送時間</div>
                      <div className="field-value">{systemStatus.latestDailyReportSentAt || "未記錄"}</div>
                    </div>
                    <div className="field-item">
                      <div className="field-label">最近錯誤摘要</div>
                      <div className="field-value small-text">{systemStatus.latestErrorSummary || "目前無錯誤紀錄"}</div>
                    </div>
                    <div className="field-item">
                      <div className="field-label">版本</div>
                      <div className="field-value">{systemStatus.version || "-"}</div>
                    </div>
                    <div className="field-item">
                      <div className="field-label">最近部署時間</div>
                      <div className="field-value">{systemStatus.deployedAt || "未提供"}</div>
                    </div>
                  </div>
                </div>
                <div className="content-card">
                  <div className="section-title">安全摘要</div>
                  <div className="stack-list">
                    <div className="log-row">
                      <strong>LINE 存取權杖狀態：</strong>
                      <div>{lineSummary.channelAccessTokenStatus || "-"}</div>
                    </div>
                    <div className="log-row">
                      <strong>LINE 密鑰狀態：</strong>
                      <div>{lineSummary.channelSecretStatus || "-"}</div>
                    </div>
                    <div className="log-row">
                      <strong>快速回覆 / 啟動按鈕：</strong>
                      <div>{`${lineSummary.quickReplyStatus || "-"} / ${lineSummary.launcherStatus || "-"}`}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </form>
        </section>
      )}
    </div>
  );
}

export default SettingsPage;
