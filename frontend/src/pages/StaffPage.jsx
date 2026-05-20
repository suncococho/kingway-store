import { useMemo, useState } from "react";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import { useFetchList } from "../hooks/useFetchList";
import { apiRequest } from "../lib/api";

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "管理員" },
  { value: "MANAGER", label: "店長" },
  { value: "CASHIER", label: "收銀" },
  { value: "REPAIR", label: "維修" },
  { value: "INVENTORY", label: "庫存" }
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

function StaffPage() {
  const staff = useFetchList("/staff");
  const kpi = useFetchList("/kpi");
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [staffForm, setStaffForm] = useState({
    username: "",
    password: "",
    displayName: "",
    role: "CASHIER",
    lineUserId: "",
    isActive: true
  });
  const [kpiForm, setKpiForm] = useState({
    staffUserId: "",
    actionType: "",
    refType: "",
    refId: "",
    score: "1"
  });

  const rows = useMemo(
    () =>
      staff.items.map((item) => ({
        ...item,
        isActive: Boolean(item.isActive),
        activeLabel: item.isActive ? "啟用中" : "停用",
        lineBindingLabel: item.lineUserId ? "已綁定" : "未綁定"
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
    { label: "LINE 已綁定", value: rows.filter((item) => item.lineUserId).length },
    { label: "KPI 有紀錄", value: kpiRows.filter((item) => item.logCount > 0).length }
  ];

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

  function startEditStaff(row) {
    setSelectedStaffId(row.id);
    setStaffForm({
      username: row.username || "",
      password: "",
      displayName: row.displayName || "",
      role: row.role || "CASHIER",
      lineUserId: row.lineUserId || "",
      isActive: Boolean(row.isActive)
    });
  }

  function clearStaffForm() {
    setSelectedStaffId(null);
    setStaffForm({
      username: "",
      password: "",
      displayName: "",
      role: "CASHIER",
      lineUserId: "",
      isActive: true
    });
  }

  async function saveStaff(event) {
    event.preventDefault();

    try {
      const payload = {
        username: staffForm.username,
        displayName: staffForm.displayName,
        role: staffForm.role,
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
          alert("新增員工時必須輸入密碼");
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

      staff.refetch();
      clearStaffForm();
      alert(selectedStaffId ? "員工已更新" : "員工已新增");
    } catch (error) {
      alert(error.message);
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

      <div className="admin-summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className="admin-summary-card">
            <div className="admin-summary-label">{card.label}</div>
            <div className="admin-summary-value">{card.value}</div>
          </article>
        ))}
      </div>

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
              { key: "role", label: "角色", render: (row) => getRoleLabel(row.role) },
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
            cardDescription={(row) => `${row.username} / ${getRoleLabel(row.role)}`}
            cardBadges={(row) => (
              <>
                <StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.activeLabel}</StatusBadge>
                <StatusBadge tone={row.lineUserId ? "info" : "neutral"}>{row.lineBindingLabel}</StatusBadge>
              </>
            )}
            cardFooter={(row) => (
              <div className="field-grid">
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
            description="同一張表單同時支援新增與修改，避免出現第二套員工維護流程。"
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
              <input name="password" type="password" value={staffForm.password} onChange={handleStaffChange} placeholder={selectedStaffId ? "留空不變更" : "必填"} />
            </label>
            <label className="form-field">
              <span>姓名</span>
              <input name="displayName" value={staffForm.displayName} onChange={handleStaffChange} required />
            </label>
            <label className="form-field">
              <span>角色</span>
              <select name="role" value={staffForm.role} onChange={handleStaffChange}>
                {ROLE_OPTIONS.map((role) => (
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
              <select name="isActive" value={staffForm.isActive ? "1" : "0"} onChange={(event) => setStaffForm((current) => ({ ...current, isActive: event.target.value === "1" }))}>
                <option value="1">啟用</option>
                <option value="0">停用</option>
              </select>
            </label>
            <button type="submit" className="primary-button inline-submit">
              {selectedStaffId ? "儲存變更" : "新增員工"}
            </button>
          </form>
        </section>
      </div>

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
    </div>
  );
}

export default StaffPage;
