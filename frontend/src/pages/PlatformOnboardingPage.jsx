import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import AdminSectionHeader from "../components/AdminSectionHeader";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import {
  getStoredPlatformToken,
  getStoredPlatformUser,
  platformRequest
} from "../lib/platformAuth";

const PLAN_OPTIONS = [
  { value: "trial", label: "試用版" },
  { value: "free", label: "免費版" },
  { value: "premium", label: "進階版" },
  { value: "single_store", label: "單店版" }
];
const STATUS_OPTIONS = [
  { value: "active", label: "啟用" },
  { value: "suspended", label: "暫停" },
  { value: "inactive", label: "停用" }
];
const RELATIONSHIP_OPTIONS = [
  { value: "DIRECT_STORE", label: "直營門市" },
  { value: "FRANCHISE_STORE", label: "加盟門市" },
  { value: "WAREHOUSE", label: "倉庫" }
];
const EMPTY_INDEPENDENT = {
  storeCode: "",
  storeName: "",
  ownerUsername: "",
  ownerName: "",
  ownerPhone: "",
  ownerEmail: "",
  temporaryPassword: "",
  plan: "trial",
  status: "active",
  trialEndsAt: "",
  paymentStatus: "NONE",
  billingNote: ""
};
const EMPTY_FRANCHISE = {
  companyCode: "",
  companyName: "",
  hqStoreCode: "",
  hqStoreName: "",
  hqOwnerUsername: "",
  hqOwnerName: "",
  hqOwnerPhone: "",
  temporaryPassword: "",
  plan: "trial",
  status: "active",
  trialEndsAt: "",
  paymentStatus: "NONE",
  billingNote: ""
};
const EMPTY_COMPANY_STORE = {
  companyId: "",
  relationshipType: "DIRECT_STORE",
  storeCode: "",
  storeName: "",
  ownerUsername: "",
  ownerName: "",
  ownerPhone: "",
  ownerEmail: "",
  temporaryPassword: "",
  plan: "trial",
  status: "active",
  trialEndsAt: "",
  paymentStatus: "NONE",
  billingNote: ""
};
const PAYMENT_STATUS_OPTIONS = [
  { value: "NONE", label: "未設定" },
  { value: "UNPAID", label: "未付款" },
  { value: "PAID", label: "已付款" },
  { value: "PAST_DUE", label: "逾期" }
];

function isManageRole(role) {
  return ["PLATFORM_OWNER", "PLATFORM_ADMIN"].includes(String(role || "").toUpperCase());
}

function Field({ label, children, wide = false }) {
  return (
    <label className={`form-field${wide ? " form-field-wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function ResultPanel({ result }) {
  if (!result) return null;
  return (
    <section className="admin-panel">
      <AdminSectionHeader eyebrow="建立完成" title="新增資料已建立" />
      <div className="stats-grid">
        {result.company ? (
          <div className="stat-card">
            <span>Company ID</span>
            <strong>{result.company.id}</strong>
            <small>{result.company.code} / {result.company.name}</small>
          </div>
        ) : null}
        <div className="stat-card">
          <span>Store ID</span>
          <strong>{result.store?.id || "-"}</strong>
          <small>{result.store?.code} / {result.store?.name}</small>
        </div>
        <div className="stat-card">
          <span>Owner ID</span>
          <strong>{result.owner?.id || "-"}</strong>
          <small>{result.owner?.username}</small>
        </div>
        {result.relationshipType ? (
          <div className="stat-card">
            <span>公司關係</span>
            <strong>{result.relationshipType}</strong>
            <small>{result.companyRole ? `company role: ${result.companyRole}` : "無總部權限"}</small>
          </div>
        ) : null}
      </div>
      <div className="empty-state">
        請將帳號與臨時密碼交給店主，首次登入後請立即修改密碼。系統不會在建立完成後再次顯示臨時密碼。
      </div>
    </section>
  );
}

function PlatformOnboardingPage() {
  const token = getStoredPlatformToken();
  const currentUser = getStoredPlatformUser();
  const canManage = isManageRole(currentUser?.role);
  const [searchParams] = useSearchParams();
  const initialType = searchParams.get("type") === "company-store" ? "company-store" : "independent";
  const [activeTab, setActiveTab] = useState(initialType);
  const [companies, setCompanies] = useState([]);
  const [independentForm, setIndependentForm] = useState(EMPTY_INDEPENDENT);
  const [franchiseForm, setFranchiseForm] = useState(EMPTY_FRANCHISE);
  const [companyStoreForm, setCompanyStoreForm] = useState({
    ...EMPTY_COMPANY_STORE,
    companyId: searchParams.get("companyId") || ""
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!token || !canManage) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    platformRequest("/platform-admin/onboarding/options")
      .then((response) => {
        if (cancelled) return;
        setCompanies(Array.isArray(response.companies) ? response.companies : []);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message || "讀取開店設定失敗");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, canManage]);

  const selectedCompany = useMemo(
    () => companies.find((company) => String(company.id) === String(companyStoreForm.companyId)) || null,
    [companies, companyStoreForm.companyId]
  );

  if (!token) {
    return <Navigate to="/platform-admin/login" replace />;
  }

  function updateForm(setter) {
    return (event) => {
      const { name, value } = event.target;
      setter((current) => ({ ...current, [name]: value }));
    };
  }

  async function submitForm(event, path, form, reset) {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setError("");
    setResult(null);
    try {
      const response = await platformRequest(path, {
        method: "POST",
        body: JSON.stringify(form)
      });
      setResult(response);
      reset();
      const options = await platformRequest("/platform-admin/onboarding/options");
      setCompanies(Array.isArray(options.companies) ? options.companies : []);
    } catch (requestError) {
      setError(requestError.message || "建立失敗");
    } finally {
      setSaving(false);
    }
  }

  const tabButtons = [
    { key: "independent", label: "個人店家" },
    { key: "franchise", label: "加盟 / 連鎖公司" },
    { key: "company-store", label: "公司新增門市" }
  ];

  if (!canManage) {
    return (
      <div>
        <PageHeader title="平台開店設定" description="僅限平台管理員使用。" />
        <div className="empty-state">沒有平台開店權限。</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="平台開店設定" description="建立個人店家、加盟公司與公司所屬門市，系統會自動建立 owner 帳號與權限。" />

      <section className="admin-panel">
        <AdminSectionHeader
          eyebrow="Platform Onboarding"
          title="新增店家 / 公司"
          description="此功能只建立基本組織、門市、owner 帳號與權限；不建立實際訂單、庫存或結算資料。"
          actions={<Link to="/platform-admin" className="secondary-button">返回平台管理</Link>}
        />
        <div className="segmented-control">
          {tabButtons.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={activeTab === tab.key ? "active" : ""}
              onClick={() => {
                setActiveTab(tab.key);
                setError("");
                setResult(null);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {loading ? <div className="loading-state">載入中...</div> : null}
        {error ? <div className="empty-state">{error}</div> : null}
      </section>

      {activeTab === "independent" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="個人店家" title="建立單店帳號" description="適用於不隸屬公司或 franchise 的獨立店家。" />
          <form className="form-grid" onSubmit={(event) => submitForm(event, "/platform-admin/onboarding/independent-store", independentForm, () => setIndependentForm(EMPTY_INDEPENDENT))}>
            <Field label="Store Code"><input name="storeCode" value={independentForm.storeCode} onChange={updateForm(setIndependentForm)} placeholder="STG_INDEPENDENT_001" required /></Field>
            <Field label="店家名稱"><input name="storeName" value={independentForm.storeName} onChange={updateForm(setIndependentForm)} required /></Field>
            <Field label="Owner 帳號"><input name="ownerUsername" value={independentForm.ownerUsername} onChange={updateForm(setIndependentForm)} required /></Field>
            <Field label="Owner 姓名"><input name="ownerName" value={independentForm.ownerName} onChange={updateForm(setIndependentForm)} required /></Field>
            <Field label="Owner 電話"><input name="ownerPhone" value={independentForm.ownerPhone} onChange={updateForm(setIndependentForm)} /></Field>
            <Field label="Owner Email"><input name="ownerEmail" value={independentForm.ownerEmail} onChange={updateForm(setIndependentForm)} /></Field>
            <Field label="臨時密碼"><input name="temporaryPassword" type="password" value={independentForm.temporaryPassword} onChange={updateForm(setIndependentForm)} minLength={8} required /></Field>
            <Field label="方案"><select name="plan" value={independentForm.plan} onChange={updateForm(setIndependentForm)}>{PLAN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
            <Field label="狀態"><select name="status" value={independentForm.status} onChange={updateForm(setIndependentForm)}>{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
            <Field label="Trial 到期"><input name="trialEndsAt" type="datetime-local" value={independentForm.trialEndsAt} onChange={updateForm(setIndependentForm)} /></Field>
            <Field label="付款狀態"><select name="paymentStatus" value={independentForm.paymentStatus} onChange={updateForm(setIndependentForm)}>{PAYMENT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
            <button type="submit" className="primary-button inline-submit" disabled={saving}>{saving ? "建立中..." : "建立個人店家"}</button>
          </form>
        </section>
      ) : null}

      {activeTab === "franchise" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="加盟 / 連鎖公司" title="建立公司與 HQ 門市" description="建立公司、總部門市、HQ owner，並自動授予 company_owner。" />
          <form className="form-grid" onSubmit={(event) => submitForm(event, "/platform-admin/onboarding/franchise-company", franchiseForm, () => setFranchiseForm(EMPTY_FRANCHISE))}>
            <Field label="Company Code"><input name="companyCode" value={franchiseForm.companyCode} onChange={updateForm(setFranchiseForm)} placeholder="STG_FRANCHISE_001" required /></Field>
            <Field label="公司名稱"><input name="companyName" value={franchiseForm.companyName} onChange={updateForm(setFranchiseForm)} required /></Field>
            <Field label="HQ Store Code"><input name="hqStoreCode" value={franchiseForm.hqStoreCode} onChange={updateForm(setFranchiseForm)} required /></Field>
            <Field label="HQ 店名"><input name="hqStoreName" value={franchiseForm.hqStoreName} onChange={updateForm(setFranchiseForm)} required /></Field>
            <Field label="HQ Owner 帳號"><input name="hqOwnerUsername" value={franchiseForm.hqOwnerUsername} onChange={updateForm(setFranchiseForm)} required /></Field>
            <Field label="HQ Owner 姓名"><input name="hqOwnerName" value={franchiseForm.hqOwnerName} onChange={updateForm(setFranchiseForm)} required /></Field>
            <Field label="HQ Owner 電話"><input name="hqOwnerPhone" value={franchiseForm.hqOwnerPhone} onChange={updateForm(setFranchiseForm)} /></Field>
            <Field label="臨時密碼"><input name="temporaryPassword" type="password" value={franchiseForm.temporaryPassword} onChange={updateForm(setFranchiseForm)} minLength={8} required /></Field>
            <Field label="方案"><select name="plan" value={franchiseForm.plan} onChange={updateForm(setFranchiseForm)}>{PLAN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
            <Field label="狀態"><select name="status" value={franchiseForm.status} onChange={updateForm(setFranchiseForm)}>{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
            <Field label="Trial 到期"><input name="trialEndsAt" type="datetime-local" value={franchiseForm.trialEndsAt} onChange={updateForm(setFranchiseForm)} /></Field>
            <Field label="付款狀態"><select name="paymentStatus" value={franchiseForm.paymentStatus} onChange={updateForm(setFranchiseForm)}>{PAYMENT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
            <button type="submit" className="primary-button inline-submit" disabled={saving}>{saving ? "建立中..." : "建立公司與 HQ"}</button>
          </form>
        </section>
      ) : null}

      {activeTab === "company-store" ? (
        <section className="admin-panel">
          <AdminSectionHeader
            eyebrow="公司新增門市"
            title="建立公司所屬門市"
            description="直營與加盟門市 owner 只建立 store owner 權限，不預設加入 company_memberships。"
            badges={selectedCompany ? <StatusBadge tone="success">{selectedCompany.code}</StatusBadge> : null}
          />
          <form className="form-grid" onSubmit={(event) => submitForm(event, "/platform-admin/onboarding/company-store", companyStoreForm, () => setCompanyStoreForm({ ...EMPTY_COMPANY_STORE, companyId: companyStoreForm.companyId }))}>
            <Field label="公司"><select name="companyId" value={companyStoreForm.companyId} onChange={updateForm(setCompanyStoreForm)} required><option value="">選擇公司</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.code} / {company.name}</option>)}</select></Field>
            <Field label="門市類型"><select name="relationshipType" value={companyStoreForm.relationshipType} onChange={updateForm(setCompanyStoreForm)}>{RELATIONSHIP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
            <Field label="Store Code"><input name="storeCode" value={companyStoreForm.storeCode} onChange={updateForm(setCompanyStoreForm)} placeholder="STG_DIRECT_001" required /></Field>
            <Field label="門市名稱"><input name="storeName" value={companyStoreForm.storeName} onChange={updateForm(setCompanyStoreForm)} required /></Field>
            <Field label="Owner 帳號"><input name="ownerUsername" value={companyStoreForm.ownerUsername} onChange={updateForm(setCompanyStoreForm)} required /></Field>
            <Field label="Owner 姓名"><input name="ownerName" value={companyStoreForm.ownerName} onChange={updateForm(setCompanyStoreForm)} required /></Field>
            <Field label="Owner 電話"><input name="ownerPhone" value={companyStoreForm.ownerPhone} onChange={updateForm(setCompanyStoreForm)} /></Field>
            <Field label="Owner Email"><input name="ownerEmail" value={companyStoreForm.ownerEmail} onChange={updateForm(setCompanyStoreForm)} /></Field>
            <Field label="臨時密碼"><input name="temporaryPassword" type="password" value={companyStoreForm.temporaryPassword} onChange={updateForm(setCompanyStoreForm)} minLength={8} required /></Field>
            <Field label="方案"><select name="plan" value={companyStoreForm.plan} onChange={updateForm(setCompanyStoreForm)}>{PLAN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
            <Field label="狀態"><select name="status" value={companyStoreForm.status} onChange={updateForm(setCompanyStoreForm)}>{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
            <Field label="Trial 到期"><input name="trialEndsAt" type="datetime-local" value={companyStoreForm.trialEndsAt} onChange={updateForm(setCompanyStoreForm)} /></Field>
            <Field label="付款狀態"><select name="paymentStatus" value={companyStoreForm.paymentStatus} onChange={updateForm(setCompanyStoreForm)}>{PAYMENT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
            <button type="submit" className="primary-button inline-submit" disabled={saving}>{saving ? "建立中..." : "建立公司門市"}</button>
          </form>
        </section>
      ) : null}

      <ResultPanel result={result} />
    </div>
  );
}

export default PlatformOnboardingPage;
