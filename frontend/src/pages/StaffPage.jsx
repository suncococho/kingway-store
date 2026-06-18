import { useEffect, useMemo, useState } from "react";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import { useFetchList } from "../hooks/useFetchList";
import { apiRequest } from "../lib/api";
import { MENU_CATALOG, ROLE_LABELS, STAFF_ROLES } from "../lib/menuPermissions";

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "管理員" },
  { value: "MANAGER", label: "店長" },
  { value: "CASHIER", label: "收銀" },
  { value: "REPAIR", label: "維修" },
  { value: "INVENTORY", label: "庫存" }
];
const STORE_ROLE_OPTIONS = [
  { value: "admin", label: "管理者" },
  { value: "staff", label: "一般員工" }
];

function getRoleLabel(role) {
  const map = {
    ADMIN: "管理員",
    MANAGER: "店長",
    CASHIER: "收銀",
    REPAIR: "維修",
    INVENTORY: "庫存"
  };

  return map[role] || role || "-";
}

function getStoreRoleLabel(role) {
  const map = {
    owner: "Owner",
    admin: "管理者",
    staff: "一般員工"
  };

  return map[role] || role || "-";
}

function clonePermissionMap(permissions = {}) {
  return MENU_CATALOG.reduce((map, item) => {
    const value = permissions[item.key] || {};
    map[item.key] = {
      canView: Boolean(value.canView),
      canAccess: Boolean(value.canAccess)
    };
    return map;
  }, {});
}

function cloneOverrideMap(permissions = {}) {
  return MENU_CATALOG.reduce((map, item) => {
    const value = permissions[item.key] || {};
    map[item.key] = {
      canView: value.canView === undefined ? null : value.canView,
      canAccess: value.canAccess === undefined ? null : value.canAccess
    };
    return map;
  }, {});
}

function serializeRolePermissions(permissions = {}) {
  return MENU_CATALOG.map((item) => ({
    menuKey: item.key,
    canView: Boolean(permissions[item.key]?.canView),
    canAccess: Boolean(permissions[item.key]?.canAccess)
  }));
}

function serializeUserPermissions(permissions = {}) {
  return MENU_CATALOG.map((item) => ({
    menuKey: item.key,
    canView: permissions[item.key]?.canView ?? null,
    canAccess: permissions[item.key]?.canAccess ?? null
  }));
}

function overrideSelectValue(value) {
  if (value === null || value === undefined) return "inherit";
  return value ? "allow" : "deny";
}

function selectValueToOverride(value) {
  if (value === "inherit") return null;
  return value === "allow";
}

function StaffPage() {
  const staff = useFetchList("/staff");
  const kpi = useFetchList("/kpi");
  const [activeTab, setActiveTab] = useState("STAFF");
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [staffForm, setStaffForm] = useState({
    username: "",
    password: "",
    displayName: "",
    role: "CASHIER",
    storeRole: "staff",
    lineUserId: "",
    isActive: true
  });
  const [staffSaving, setStaffSaving] = useState(false);
  const [staffError, setStaffError] = useState("");
  const [staffSuccess, setStaffSuccess] = useState("");
  const [kpiForm, setKpiForm] = useState({
    staffUserId: "",
    actionType: "",
    refType: "",
    refId: "",
    score: "1"
  });
  const [permissionData, setPermissionData] = useState(null);
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [permissionError, setPermissionError] = useState("");
  const [permissionSuccess, setPermissionSuccess] = useState("");
  const [selectedPermissionRole, setSelectedPermissionRole] = useState("CASHIER");
  const [rolePermissionDraft, setRolePermissionDraft] = useState(() => clonePermissionMap());
  const [selectedPermissionStaffId, setSelectedPermissionStaffId] = useState("");
  const [userPermissionDraft, setUserPermissionDraft] = useState(() => cloneOverrideMap());

  const rows = useMemo(
    () =>
      staff.items.map((item) => ({
        ...item,
        isActive: Boolean(item.isActive) && item.membershipStatus !== "disabled",
        storeRoleLabel: getStoreRoleLabel(item.storeRole),
        activeLabel: Boolean(item.isActive) && item.membershipStatus !== "disabled" ? "啟用中" : "停用",
        lineBindingLabel: item.lineUserId ? "已綁定" : "未綁定",
        membershipStatusLabel: item.membershipStatus === "disabled" ? "已停用" : "有效"
      })),
    [staff.items]
  );

  const kpiRows = useMemo(
    () =>
      kpi.items.map((item) => ({
        ...item,
        logCount: Number(item.logCount || 0),
        totalScore: Number(item.totalScore || 0)
      })),
    [kpi.items]
  );

  const summaryCards = [
    { label: "員工總數", value: rows.length },
    { label: "啟用中", value: rows.filter((item) => item.isActive).length },
    { label: "管理者", value: rows.filter((item) => item.storeRole === "owner" || item.storeRole === "admin").length },
    { label: "LINE 已綁定", value: rows.filter((item) => item.lineUserId).length },
    { label: "KPI 有紀錄", value: kpiRows.filter((item) => item.logCount > 0).length }
  ];

  const permissionStaff = useMemo(
    () => (permissionData?.staff || []).find((item) => String(item.id) === String(selectedPermissionStaffId)) || null,
    [permissionData, selectedPermissionStaffId]
  );

  useEffect(() => {
    if (activeTab !== "PERMISSIONS" || permissionData) {
      return;
    }
    loadPermissionData();
  }, [activeTab, permissionData]);

  useEffect(() => {
    if (!permissionData) {
      return;
    }
    setRolePermissionDraft(clonePermissionMap(permissionData.rolePermissions?.[selectedPermissionRole]));
  }, [permissionData, selectedPermissionRole]);

  useEffect(() => {
    if (!permissionData || !selectedPermissionStaffId) {
      setUserPermissionDraft(cloneOverrideMap());
      return;
    }
    setUserPermissionDraft(cloneOverrideMap(permissionData.userOverrides?.[selectedPermissionStaffId]));
  }, [permissionData, selectedPermissionStaffId]);

  function handleStaffChange(event) {
    const { name, value, type, checked } = event.target;
    setStaffForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value
    }));
  }

  function handleKpiChange(event) {
    const { name, value } = event.target;
    setKpiForm((current) => ({
      ...current,
      [name]: value
    }));
  }

  async function loadPermissionData() {
    setPermissionLoading(true);
    setPermissionError("");
    try {
      const data = await apiRequest("/staff/permissions");
      setPermissionData(data);
      if (!selectedPermissionStaffId && Array.isArray(data.staff) && data.staff.length) {
        const firstEditable = data.staff.find((item) => !item.isOwner) || data.staff[0];
        setSelectedPermissionStaffId(String(firstEditable.id));
      }
    } catch (error) {
      setPermissionError(error.message || "權限資料讀取失敗");
    } finally {
      setPermissionLoading(false);
    }
  }

  function updateRolePermission(menuKey, field, value) {
    setRolePermissionDraft((current) => ({
      ...current,
      [menuKey]: {
        ...(current[menuKey] || {}),
        [field]: value
      }
    }));
  }

  function updateUserPermission(menuKey, field, value) {
    setUserPermissionDraft((current) => ({
      ...current,
      [menuKey]: {
        ...(current[menuKey] || {}),
        [field]: selectValueToOverride(value)
      }
    }));
  }

  async function saveRolePermissions(event) {
    event.preventDefault();
    setPermissionLoading(true);
    setPermissionError("");
    setPermissionSuccess("");
    try {
      await apiRequest(`/staff/roles/${selectedPermissionRole}/menu-permissions`, {
        method: "PUT",
        body: JSON.stringify({ permissions: serializeRolePermissions(rolePermissionDraft) })
      });
      await loadPermissionData();
      setPermissionSuccess("角色權限已儲存");
    } catch (error) {
      setPermissionError(error.message || "角色權限儲存失敗");
    } finally {
      setPermissionLoading(false);
    }
  }

  async function saveUserPermissions(event) {
    event.preventDefault();
    if (!selectedPermissionStaffId || permissionStaff?.isOwner) {
      setPermissionError("owner 權限不可被覆寫");
      return;
    }
    setPermissionLoading(true);
    setPermissionError("");
    setPermissionSuccess("");
    try {
      await apiRequest(`/staff/${selectedPermissionStaffId}/menu-permissions`, {
        method: "PUT",
        body: JSON.stringify({ permissions: serializeUserPermissions(userPermissionDraft) })
      });
      await loadPermissionData();
      setPermissionSuccess("員工個別權限已儲存");
    } catch (error) {
      setPermissionError(error.message || "員工個別權限儲存失敗");
    } finally {
      setPermissionLoading(false);
    }
  }

  function startEditStaff(row) {
    setSelectedStaffId(row.id);
    setStaffError("");
    setStaffSuccess("");
    setStaffForm({
      username: row.username || "",
      password: "",
      displayName: row.displayName || "",
      role: row.role || "CASHIER",
      storeRole: row.storeRole === "owner" ? "owner" : row.storeRole || "staff",
      lineUserId: row.lineUserId || "",
      isActive: Boolean(row.isActive)
    });
  }

  function clearStaffForm() {
    setSelectedStaffId(null);
    setStaffError("");
    setStaffSuccess("");
    setStaffForm({
      username: "",
      password: "",
      displayName: "",
      role: "CASHIER",
      storeRole: "staff",
      lineUserId: "",
      isActive: true
    });
  }

  async function saveStaff(event) {
    event.preventDefault();
    setStaffSaving(true);
    setStaffError("");
    setStaffSuccess("");

    try {
      const payload = {
        username: staffForm.username,
        displayName: staffForm.displayName,
        role: staffForm.role,
        storeRole: staffForm.storeRole,
        lineUserId: staffForm.lineUserId.trim() || null,
        isActive: staffForm.isActive
      };

      if (staffForm.password) {
        payload.password = staffForm.password;
      }

      if (selectedStaffId) {
        await apiRequest(`/staff/${selectedStaffId}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
      } else {
        if (!staffForm.password) {
          setStaffError("新增員工時必須輸入密碼");
          return;
        }
        await apiRequest("/staff", {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            password: staffForm.password
          })
        });
      }

      await staff.refetch();
      clearStaffForm();
      setStaffSuccess(selectedStaffId ? "員工已更新" : "員工已新增");
    } catch (error) {
      setStaffError(error.message || "儲存員工失敗");
    } finally {
      setStaffSaving(false);
    }
  }

  async function submitManualKpi(event) {
    event.preventDefault();
    try {
      await apiRequest("/kpi/manual-log", {
        method: "POST",
        body: JSON.stringify({
          staffUserId: Number(kpiForm.staffUserId),
          actionType: kpiForm.actionType,
          refType: kpiForm.refType,
          refId: kpiForm.refId === "" ? null : Number(kpiForm.refId),
          score: Number(kpiForm.score || 0)
        })
      });
      kpi.refetch();
      setKpiForm({
        staffUserId: "",
        actionType: "",
        refType: "",
        refId: "",
        score: "1"
      });
      alert("KPI 紀錄已新增");
    } catch (error) {
      alert(error.message);
    }
  }

  return (
    <div>
      <PageHeader title="員工管理" description="員工資料、LINE 綁定、啟用狀態與手動 KPI 紀錄都在同一個 web 控制面。" />
      {staff.error || kpi.error ? <div className="empty-state">{staff.error || kpi.error}</div> : null}
      {staffError ? <div className="error-banner">{staffError}</div> : null}
      {staffSuccess ? <div className="success-banner">{staffSuccess}</div> : null}
      {permissionError ? <div className="error-banner">{permissionError}</div> : null}
      {permissionSuccess ? <div className="success-banner">{permissionSuccess}</div> : null}

      <div className="admin-summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className="admin-summary-card">
            <div className="admin-summary-label">{card.label}</div>
            <div className="admin-summary-value">{card.value}</div>
          </article>
        ))}
      </div>

      <div className="section-tabs-wrap">
        <div className="section-tabs" role="tablist" aria-label="員工管理分頁">
          {[
            { key: "STAFF", label: "員工列表" },
            { key: "KPI", label: "KPI" },
            { key: "PERMISSIONS", label: "權限管理" }
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`section-tab ${activeTab === tab.key ? "section-tab-active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "STAFF" ? (
      <div className="admin-split-grid">
        <section className="admin-panel">
          <AdminSectionHeader
            eyebrow="員工列表"
            title="既有員工"
            description="可直接檢視角色、LINE 綁定與啟用狀態，並從同一頁進入編輯。"
          />
          <DataTable
            columns={[
              { key: "username", label: "帳號" },
              { key: "displayName", label: "姓名" },
              { key: "role", label: "工作角色", render: (row) => getRoleLabel(row.role) },
              { key: "storeRole", label: "管理權限", render: (row) => getStoreRoleLabel(row.storeRole) },
              { key: "lineUserId", label: "LINE userId", mobileHidden: true },
              {
                key: "status",
                label: "狀態",
                render: (row) => <StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.activeLabel}</StatusBadge>
              },
              {
                key: "actions",
                label: "操作",
                render: (row) => (
        <button type="button" className="secondary-button" onClick={() => startEditStaff(row)}>
          編輯
        </button>
      ),
                mobileHidden: true
              }
            ]}
            rows={rows}
            emptyText="目前沒有員工資料。"
            cardTitle={(row) => row.displayName}
            cardDescription={(row) => `${row.username} / ${getRoleLabel(row.role)} / ${getStoreRoleLabel(row.storeRole)}`}
            cardBadges={(row) => (
              <>
                <StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.activeLabel}</StatusBadge>
                <StatusBadge tone={row.storeRole === "owner" ? "warning" : "info"}>{row.storeRoleLabel}</StatusBadge>
                <StatusBadge tone={row.lineUserId ? "info" : "neutral"}>{row.lineBindingLabel}</StatusBadge>
              </>
            )}
            cardFooter={(row) => (
              <div className="field-grid">
                <div className="field-item">
                  <div className="field-label">管理權限</div>
                  <div className="field-value">{row.storeRoleLabel}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">LINE userId</div>
                  <div className="field-value">{row.lineUserId || "-"}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">操作</div>
                  <div className="field-value">
                    <button type="button" className="secondary-button" onClick={() => startEditStaff(row)}>
                      編輯
                    </button>
                  </div>
                </div>
              </div>
            )}
          />
        </section>

        <section className="admin-panel">
          <AdminSectionHeader
            eyebrow={selectedStaffId ? "編輯員工" : "新增員工"}
            title={selectedStaffId ? `編輯 #${selectedStaffId}` : "新增員工"}
            description="工作角色決定日常職務，管理權限決定是否可管理門市設定與員工。密碼欄位留空就不變更。"
            actions={
              selectedStaffId ? (
                <button type="button" className="secondary-button" onClick={clearStaffForm}>
                  取消編輯
                </button>
              ) : null
            }
          />
          <form className="grid-form compact-grid" onSubmit={saveStaff}>
            <label className="form-field">
              <span>帳號</span>
              <input name="username" value={staffForm.username} onChange={handleStaffChange} required />
            </label>
            <label className="form-field">
              <span>密碼</span>
              <input name="password" type="password" value={staffForm.password} onChange={handleStaffChange} placeholder={selectedStaffId ? "留空不變更；輸入新密碼即重設" : "必填"} />
            </label>
            <label className="form-field">
              <span>姓名</span>
              <input name="displayName" value={staffForm.displayName} onChange={handleStaffChange} required />
            </label>
            <label className="form-field">
              <span>工作角色</span>
              <select name="role" value={staffForm.role} onChange={handleStaffChange}>
                {ROLE_OPTIONS.map((role) => (
              <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>管理權限</span>
              <select
                name="storeRole"
                value={staffForm.storeRole}
                onChange={handleStaffChange}
                disabled={staffForm.storeRole === "owner"}
              >
                {staffForm.storeRole === "owner" ? <option value="owner">Owner</option> : null}
                {STORE_ROLE_OPTIONS.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>LINE userId</span>
              <input name="lineUserId" value={staffForm.lineUserId} onChange={handleStaffChange} />
            </label>
            <label className="form-field">
              <span>啟用狀態</span>
              <select
                name="isActive"
                value={staffForm.isActive ? "1" : "0"}
                onChange={(event) => setStaffForm((current) => ({ ...current, isActive: event.target.value === "1" }))}
                disabled={staffForm.storeRole === "owner"}
              >
                <option value="1">啟用</option>
                <option value="0">停用</option>
              </select>
            </label>
            <button type="submit" className="primary-button inline-submit" disabled={staffSaving}>
              {staffSaving ? "儲存中..." : selectedStaffId ? "儲存變更" : "新增員工"}
            </button>
          </form>
        </section>
      </div>
      ) : null}

      {activeTab === "KPI" ? (
      <>
      <section className="admin-panel">
        <AdminSectionHeader
          eyebrow="手動 KPI"
          title="手動新增 KPI 紀錄"
          description="當需要人工補登或調整績效紀錄時，直接寫入同一套 KPI 資料表。"
        />
        <form className="grid-form compact-grid" onSubmit={submitManualKpi}>
          <label className="form-field">
            <span>員工</span>
            <select name="staffUserId" value={kpiForm.staffUserId} onChange={handleKpiChange} required>
              <option value="">請選擇員工</option>
              {rows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.displayName} ({getRoleLabel(row.role)})
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>動作代碼</span>
            <input name="actionType" value={kpiForm.actionType} onChange={handleKpiChange} placeholder="例如 MANUAL_ADJUST" required />
          </label>
          <label className="form-field">
            <span>參照類型</span>
            <input name="refType" value={kpiForm.refType} onChange={handleKpiChange} placeholder="例如 ORDER / ATTENDANCE" />
          </label>
          <label className="form-field">
            <span>參照 ID</span>
            <input name="refId" type="number" value={kpiForm.refId} onChange={handleKpiChange} />
          </label>
          <label className="form-field">
            <span>分數</span>
            <input name="score" type="number" value={kpiForm.score} onChange={handleKpiChange} />
          </label>
          <button type="submit" className="primary-button inline-submit">
            新增 KPI
          </button>
        </form>
      </section>

      <section className="admin-panel">
        <AdminSectionHeader eyebrow="KPI 摘要" title="目前 KPI 排名" description="維持既有 KPI 資料視圖，不另外建立第二套績效模型。" />
        <DataTable
            columns={[
              { key: "staffName", label: "員工" },
              { key: "role", label: "角色", render: (row) => getRoleLabel(row.role) },
              { key: "logCount", label: "紀錄數" },
              { key: "totalScore", label: "總分" }
            ]}
          rows={kpiRows}
          emptyText="目前沒有 KPI 資料。"
          cardTitle={(row) => row.staffName}
          cardDescription={(row) => `${row.role} / 總分 ${row.totalScore}`}
          cardBadges={(row) => <StatusBadge tone="info">紀錄 {row.logCount}</StatusBadge>}
        />
      </section>
      </>
      ) : null}

      {activeTab === "PERMISSIONS" ? (
        <div className="admin-split-grid">
          <section className="admin-panel">
            <AdminSectionHeader
              eyebrow="角色權限"
              title="角色預設選單權限"
              description="設定各工作角色可看到與可使用的功能。owner 不受此設定限制。"
              actions={
                <button type="button" className="secondary-button" onClick={loadPermissionData} disabled={permissionLoading}>
                  重新整理
                </button>
              }
            />
            <form onSubmit={saveRolePermissions}>
              <label className="form-field">
                <span>角色</span>
                <select value={selectedPermissionRole} onChange={(event) => setSelectedPermissionRole(event.target.value)}>
                  {STAFF_ROLES.map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role] || role}</option>
                  ))}
                </select>
              </label>
              <div className="table-wrapper desktop-only">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>功能</th>
                      <th>顯示選單</th>
                      <th>允許使用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MENU_CATALOG.map((item) => (
                      <tr key={item.key}>
                        <td>{item.label}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={Boolean(rolePermissionDraft[item.key]?.canView)}
                            onChange={(event) => updateRolePermission(item.key, "canView", event.target.checked)}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={Boolean(rolePermissionDraft[item.key]?.canAccess)}
                            onChange={(event) => updateRolePermission(item.key, "canAccess", event.target.checked)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="data-card-list mobile-only">
                {MENU_CATALOG.map((item) => (
                  <article key={item.key} className="data-card">
                    <div className="data-card-title">{item.label}</div>
                    <label className="checklist-item">
                      <input
                        type="checkbox"
                        checked={Boolean(rolePermissionDraft[item.key]?.canView)}
                        onChange={(event) => updateRolePermission(item.key, "canView", event.target.checked)}
                      />
                      <span>顯示選單</span>
                    </label>
                    <label className="checklist-item">
                      <input
                        type="checkbox"
                        checked={Boolean(rolePermissionDraft[item.key]?.canAccess)}
                        onChange={(event) => updateRolePermission(item.key, "canAccess", event.target.checked)}
                      />
                      <span>允許使用</span>
                    </label>
                  </article>
                ))}
              </div>
              <button type="submit" className="primary-button inline-submit" disabled={permissionLoading}>
                {permissionLoading ? "儲存中..." : "儲存角色權限"}
              </button>
            </form>
          </section>

          <section className="admin-panel">
            <AdminSectionHeader
              eyebrow="員工個別權限"
              title="員工 override"
              description="可針對單一員工覆寫角色預設。選擇繼承時會使用角色權限。"
            />
            <form onSubmit={saveUserPermissions}>
              <label className="form-field">
                <span>員工</span>
                <select value={selectedPermissionStaffId} onChange={(event) => setSelectedPermissionStaffId(event.target.value)}>
                  <option value="">請選擇員工</option>
                  {(permissionData?.staff || []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName || item.username}（{item.isOwner ? "Owner" : `${ROLE_LABELS[item.role] || item.role} / ${getStoreRoleLabel(item.storeRole)}`}）
                    </option>
                  ))}
                </select>
              </label>
              {permissionStaff?.isOwner ? (
                <div className="empty-state">owner 永遠擁有全部權限，不能被隱藏或覆寫。</div>
              ) : null}
              <div className="table-wrapper desktop-only">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>功能</th>
                      <th>顯示選單</th>
                      <th>允許使用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MENU_CATALOG.map((item) => (
                      <tr key={item.key}>
                        <td>{item.label}</td>
                        <td>
                          <select
                            value={overrideSelectValue(userPermissionDraft[item.key]?.canView)}
                            onChange={(event) => updateUserPermission(item.key, "canView", event.target.value)}
                            disabled={!selectedPermissionStaffId || permissionStaff?.isOwner}
                          >
                            <option value="inherit">繼承角色設定</option>
                            <option value="allow">允許</option>
                            <option value="deny">禁用</option>
                          </select>
                        </td>
                        <td>
                          <select
                            value={overrideSelectValue(userPermissionDraft[item.key]?.canAccess)}
                            onChange={(event) => updateUserPermission(item.key, "canAccess", event.target.value)}
                            disabled={!selectedPermissionStaffId || permissionStaff?.isOwner}
                          >
                            <option value="inherit">繼承角色設定</option>
                            <option value="allow">允許</option>
                            <option value="deny">禁用</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="data-card-list mobile-only">
                {MENU_CATALOG.map((item) => (
                  <article key={item.key} className="data-card">
                    <div className="data-card-title">{item.label}</div>
                    <label className="form-field">
                      <span>顯示選單</span>
                      <select
                        value={overrideSelectValue(userPermissionDraft[item.key]?.canView)}
                        onChange={(event) => updateUserPermission(item.key, "canView", event.target.value)}
                        disabled={!selectedPermissionStaffId || permissionStaff?.isOwner}
                      >
                        <option value="inherit">繼承角色設定</option>
                        <option value="allow">允許</option>
                        <option value="deny">禁用</option>
                      </select>
                    </label>
                    <label className="form-field">
                      <span>允許使用</span>
                      <select
                        value={overrideSelectValue(userPermissionDraft[item.key]?.canAccess)}
                        onChange={(event) => updateUserPermission(item.key, "canAccess", event.target.value)}
                        disabled={!selectedPermissionStaffId || permissionStaff?.isOwner}
                      >
                        <option value="inherit">繼承角色設定</option>
                        <option value="allow">允許</option>
                        <option value="deny">禁用</option>
                      </select>
                    </label>
                  </article>
                ))}
              </div>
              <button type="submit" className="primary-button inline-submit" disabled={permissionLoading || !selectedPermissionStaffId || permissionStaff?.isOwner}>
                {permissionLoading ? "儲存中..." : "儲存權限"}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default StaffPage;
