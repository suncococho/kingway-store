import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import { getStoredPlatformUser, platformRequest } from "../lib/platformAuth";

const EMPTY_COMPANY_FORM = {
  code: "",
  name: "",
  status: "ACTIVE",
  note: ""
};
const EMPTY_STORE_FORM = {
  storeId: "",
  relationshipType: "FRANCHISE_STORE",
  status: "ACTIVE"
};
const EMPTY_MEMBER_FORM = {
  staffUserId: "",
  role: "viewer",
  status: "ACTIVE"
};
const RELATIONSHIP_OPTIONS = [
  { value: "HEADQUARTERS", label: "總部" },
  { value: "WAREHOUSE", label: "本部倉庫" },
  { value: "DIRECT_STORE", label: "直營門市" },
  { value: "FRANCHISE_STORE", label: "加盟門市" }
];
const MEMBER_ROLE_OPTIONS = [
  { value: "company_owner", label: "公司擁有者" },
  { value: "hq_admin", label: "總部管理員" },
  { value: "finance", label: "財務" },
  { value: "inventory_manager", label: "庫存管理" },
  { value: "viewer", label: "檢視者" }
];

function getStatusTone(status) {
  return status === "ACTIVE" || status === "active" ? "success" : "neutral";
}

function getRelationshipLabel(value) {
  return RELATIONSHIP_OPTIONS.find((option) => option.value === value)?.label || value || "-";
}

function getMemberRoleLabel(value) {
  return MEMBER_ROLE_OPTIONS.find((option) => option.value === value)?.label || value || "-";
}

function PlatformCompaniesPage() {
  const currentUser = getStoredPlatformUser();
  const currentRole = String(currentUser?.role || "").trim().toUpperCase();
  const canManage = ["PLATFORM_OWNER", "PLATFORM_ADMIN"].includes(currentRole);
  const isAdmin = canManage || currentRole === "SUPPORT";
  const [companies, setCompanies] = useState([]);
  const [stores, setStores] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [companyForm, setCompanyForm] = useState(EMPTY_COMPANY_FORM);
  const [storeForm, setStoreForm] = useState(EMPTY_STORE_FORM);
  const [memberForm, setMemberForm] = useState(EMPTY_MEMBER_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [companyResponse, storeResponse] = await Promise.all([
        platformRequest("/saas-admin/companies"),
        platformRequest("/saas-admin/stores")
      ]);
      const nextCompanies = Array.isArray(companyResponse.companies) ? companyResponse.companies : [];
      setCompanies(nextCompanies);
      setStores(Array.isArray(storeResponse.stores) ? storeResponse.stores : []);
      if (!selectedCompanyId && nextCompanies[0]) {
        setSelectedCompanyId(String(nextCompanies[0].id));
      }
    } catch (requestError) {
      setError(requestError.message || "讀取公司資料失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    loadData();
  }, [isAdmin]);

  const selectedCompany = useMemo(
    () => companies.find((company) => String(company.id) === String(selectedCompanyId)) || null,
    [companies, selectedCompanyId]
  );

  function updateCompanyForm(event) {
    const { name, value } = event.target;
    setCompanyForm((current) => ({ ...current, [name]: value }));
  }

  function updateStoreForm(event) {
    const { name, value } = event.target;
    setStoreForm((current) => ({ ...current, [name]: value }));
  }

  function updateMemberForm(event) {
    const { name, value } = event.target;
    setMemberForm((current) => ({ ...current, [name]: value }));
  }

  async function createCompany(event) {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await platformRequest("/saas-admin/companies", {
        method: "POST",
        body: JSON.stringify(companyForm)
      });
      setCompanyForm(EMPTY_COMPANY_FORM);
      setSelectedCompanyId(String(response.company?.id || ""));
      setSuccess("公司資料已建立。");
      await loadData();
    } catch (requestError) {
      setError(requestError.message || "建立公司失敗");
    } finally {
      setSaving(false);
    }
  }

  async function attachStore(event) {
    event.preventDefault();
    if (!canManage || !selectedCompany) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await platformRequest(`/saas-admin/companies/${selectedCompany.id}/stores`, {
        method: "POST",
        body: JSON.stringify(storeForm)
      });
      setStoreForm(EMPTY_STORE_FORM);
      setSuccess("所屬門市已更新。");
      await loadData();
    } catch (requestError) {
      setError(requestError.message || "更新所屬門市失敗");
    } finally {
      setSaving(false);
    }
  }

  async function attachMember(event) {
    event.preventDefault();
    if (!canManage || !selectedCompany) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await platformRequest(`/saas-admin/companies/${selectedCompany.id}/members`, {
        method: "POST",
        body: JSON.stringify(memberForm)
      });
      setMemberForm(EMPTY_MEMBER_FORM);
      setSuccess("總部權限已更新。");
      await loadData();
    } catch (requestError) {
      setError(requestError.message || "更新總部權限失敗");
    } finally {
      setSaving(false);
    }
  }

  const companyColumns = [
    { key: "code", label: "公司代碼" },
    { key: "name", label: "公司名稱" },
    {
      key: "status",
      label: "狀態",
      render: (row) => <StatusBadge tone={getStatusTone(row.status)}>{row.status === "ACTIVE" ? "啟用" : "停用"}</StatusBadge>
    },
    { key: "storeCount", label: "門市數" },
    { key: "memberCount", label: "權限人員" },
    {
      key: "actions",
      label: "操作",
      render: (row) => (
        <button type="button" className="secondary-button" onClick={() => setSelectedCompanyId(String(row.id))}>
          管理
        </button>
      )
    }
  ];
  const storeColumns = [
    { key: "storeCode", label: "門市代碼" },
    { key: "storeName", label: "門市名稱" },
    { key: "relationshipType", label: "關係", render: (row) => getRelationshipLabel(row.relationshipType) },
    { key: "status", label: "狀態", render: (row) => <StatusBadge tone={getStatusTone(row.status)}>{row.status === "ACTIVE" ? "啟用" : "停用"}</StatusBadge> }
  ];
  const memberColumns = [
    { key: "username", label: "帳號" },
    { key: "displayName", label: "姓名" },
    { key: "role", label: "總部角色", render: (row) => getMemberRoleLabel(row.role) },
    { key: "status", label: "狀態", render: (row) => <StatusBadge tone={getStatusTone(row.status)}>{row.status === "ACTIVE" ? "啟用" : "停用"}</StatusBadge> }
  ];

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="公司 / 品牌管理" description="僅限平台管理員檢視。" />
        <div className="empty-state">沒有平台管理權限。</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="公司 / 品牌管理" description="建立 franchise company、所屬門市與總部權限；本部出貨與結算留待下一階段。" />

      <section className="admin-panel">
        <AdminSectionHeader
          eyebrow="平台管理"
          title="Franchise Companies"
          description="此區只管理公司結構，不處理出貨、入庫或加盟店結算。"
          actions={(
            <div className="compact-actions">
              <Link to="/platform-admin/onboarding" className="primary-button">新增店家 / 公司</Link>
              <Link to="/platform-admin" className="secondary-button">返回平台管理</Link>
            </div>
          )}
        />
        {loading ? <div className="loading-state">載入中...</div> : null}
        {error ? <div className="empty-state">{error}</div> : null}
        {success ? <div className="empty-state">{success}</div> : null}
        <DataTable
          columns={companyColumns}
          rows={companies}
          emptyText="目前尚無公司資料。"
          cardTitle={(row) => row.name}
          cardDescription={(row) => `${row.code} / 門市 ${row.storeCount || 0} / 權限 ${row.memberCount || 0}`}
          cardBadges={(row) => <StatusBadge tone={getStatusTone(row.status)}>{row.status === "ACTIVE" ? "啟用" : "停用"}</StatusBadge>}
        />
      </section>

      {canManage ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="公司資料" title="新增公司 / 品牌" description="公司代碼建立後可再連結門市與總部權限人員。" />
          <form className="form-grid" onSubmit={createCompany}>
            <label className="form-field"><span>公司代碼</span><input name="code" value={companyForm.code} onChange={updateCompanyForm} placeholder="KINGWAY_HQ" required /></label>
            <label className="form-field"><span>公司名稱</span><input name="name" value={companyForm.name} onChange={updateCompanyForm} placeholder="KINGWAY 總部" required /></label>
            <label className="form-field"><span>狀態</span><select name="status" value={companyForm.status} onChange={updateCompanyForm}><option value="ACTIVE">啟用</option><option value="INACTIVE">停用</option></select></label>
            <label className="form-field form-field-wide"><span>備註</span><input name="note" value={companyForm.note} onChange={updateCompanyForm} /></label>
            <button type="submit" className="primary-button inline-submit" disabled={saving}>{saving ? "處理中..." : "建立公司"}</button>
          </form>
        </section>
      ) : null}

      {selectedCompany ? (
        <section className="admin-panel">
          <AdminSectionHeader
            eyebrow="總部結構"
            title={selectedCompany.name}
            description="管理所屬門市與總部權限。本部出貨、門市入庫、加盟店結算尚未啟用。"
            badges={<StatusBadge tone={getStatusTone(selectedCompany.status)}>{selectedCompany.status === "ACTIVE" ? "啟用" : "停用"}</StatusBadge>}
            actions={<Link to={`/platform-admin/onboarding?type=company-store&companyId=${selectedCompany.id}`} className="primary-button">新增門市</Link>}
          />

          <div className="two-column-grid">
            <div>
              <h3>所屬門市</h3>
              <DataTable columns={storeColumns} rows={selectedCompany.stores || []} emptyText="尚未連結門市。" />
              {canManage ? (
                <form className="grid-form compact-grid" onSubmit={attachStore}>
                  <label className="form-field"><span>門市</span><select name="storeId" value={storeForm.storeId} onChange={updateStoreForm} required><option value="">選擇門市</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.code} / {store.name}</option>)}</select></label>
                  <label className="form-field"><span>關係</span><select name="relationshipType" value={storeForm.relationshipType} onChange={updateStoreForm}>{RELATIONSHIP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <button type="submit" className="primary-button inline-submit" disabled={saving}>連結門市</button>
                </form>
              ) : null}
            </div>

            <div>
              <h3>總部權限</h3>
              <DataTable columns={memberColumns} rows={selectedCompany.members || []} emptyText="尚未設定總部權限。" />
              {canManage ? (
                <form className="grid-form compact-grid" onSubmit={attachMember}>
                  <label className="form-field"><span>人員 ID</span><input name="staffUserId" value={memberForm.staffUserId} onChange={updateMemberForm} placeholder="staff_users.id" required /></label>
                  <label className="form-field"><span>角色</span><select name="role" value={memberForm.role} onChange={updateMemberForm}>{MEMBER_ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <button type="submit" className="primary-button inline-submit" disabled={saving}>設定權限</button>
                </form>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default PlatformCompaniesPage;
