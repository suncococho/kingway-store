import { useEffect, useMemo, useState } from "react";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import PageHelpButton from "../components/PageHelpButton";
import StatusBadge from "../components/StatusBadge";
import {
  fetchStoreLineNotificationSettings,
  fetchSupplierLineNotificationSettings,
  testStoreLineNotification,
  testSupplierLineNotification,
  updateStoreLineNotificationSettings,
  updateSupplierLineNotificationSettings
} from "../lib/lineNotificationSettingsApi";
import { PAGE_HELP } from "../lib/pageHelpContent";

const STAFF_EVENT_FIELDS = [
  ["notifyOrderReservation", "LINE 訂單預約"],
  ["notifyRepairReservation", "LINE 維修預約"],
  ["notifyPurchaseConfirmation", "購買確認書完成"],
  ["notifyRepairConfirmation", "維修完成確認書完成"],
  ["notifyReplenishment", "門市請貨"],
  ["notifyTransfer", "本部出貨"],
  ["notifyInbound", "門市入庫"],
  ["notifyDailyTasks", "每日任務提醒"],
  ["notifyInternalMessages", "訊息中心提醒"]
];

function defaultStoreForm(setting = null) {
  return {
    storeId: setting?.storeId || "",
    channelType: "LINE",
    purpose: "STAFF_GROUP",
    targetId: setting?.targetId || "",
    enabled: setting?.enabled ?? true,
    notifyOrderReservation: setting?.notifyOrderReservation ?? true,
    notifyRepairReservation: setting?.notifyRepairReservation ?? true,
    notifyPurchaseConfirmation: setting?.notifyPurchaseConfirmation ?? true,
    notifyRepairConfirmation: setting?.notifyRepairConfirmation ?? true,
    notifyReplenishment: setting?.notifyReplenishment ?? true,
    notifyTransfer: setting?.notifyTransfer ?? true,
    notifyInbound: setting?.notifyInbound ?? true,
    notifyDailyTasks: setting?.notifyDailyTasks ?? false,
    notifyInternalMessages: setting?.notifyInternalMessages ?? false
  };
}

function defaultSupplierForm(row = {}) {
  return {
    lineGroupId: row.lineGroupId || "",
    enabled: row.enabled || false,
    notifyPurchaseOrder: row.notifyPurchaseOrder ?? true,
    notifyReturn: row.notifyReturn ?? true,
    notifySettlement: row.notifySettlement ?? false
  };
}

function PreviewBox({ preview }) {
  if (!preview) return null;
  return (
    <div className="notice-card">
      <strong>Dry-run preview</strong>
      <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>{preview.messagePreview}</pre>
      {preview.targetPreview ? <div className="muted-text">Target: {preview.targetPreview}</div> : null}
    </div>
  );
}

function LineNotificationSettingsPage() {
  const [storeSettings, setStoreSettings] = useState([]);
  const [supplierSettings, setSupplierSettings] = useState([]);
  const [canManageStoreSettings, setCanManageStoreSettings] = useState(false);
  const [canManageSupplierSettings, setCanManageSupplierSettings] = useState(false);
  const [storeForm, setStoreForm] = useState(defaultStoreForm());
  const [supplierForms, setSupplierForms] = useState({});
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [supplierError, setSupplierError] = useState("");
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");

  async function loadSettings() {
    try {
      setLoading(true);
      setError("");
      const storeResponse = await fetchStoreLineNotificationSettings();
      const settings = storeResponse.settings || [];
      setStoreSettings(settings);
      setCanManageStoreSettings(Boolean(storeResponse.canManageSettings));
      const primary = settings.find((item) => item.channelType === "LINE" && item.purpose === "STAFF_GROUP") || settings[0] || null;
      setStoreForm(defaultStoreForm(primary));
    } catch (err) {
      setError(err?.message || "LINE 通知設定載入失敗");
    } finally {
      setLoading(false);
    }

    try {
      setSupplierError("");
      const supplierResponse = await fetchSupplierLineNotificationSettings();
      const rows = supplierResponse.settings || [];
      setSupplierSettings(rows);
      setCanManageSupplierSettings(Boolean(supplierResponse.canManageSettings));
      setSupplierForms(Object.fromEntries(rows.map((row) => [row.supplierId, defaultSupplierForm(row)])));
    } catch (err) {
      setSupplierSettings([]);
      setCanManageSupplierSettings(false);
      setSupplierError(err?.status === 403 ? "目前門市類型不使用供應商 LINE 群組設定。" : (err?.message || "供應商 LINE 設定載入失敗"));
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  function updateStoreForm(key, value) {
    setStoreForm((current) => ({ ...current, [key]: value }));
  }

  function updateSupplierForm(supplierId, key, value) {
    setSupplierForms((current) => ({
      ...current,
      [supplierId]: {
        ...defaultSupplierForm(supplierSettings.find((row) => row.supplierId === supplierId)),
        ...(current[supplierId] || {}),
        [key]: value
      }
    }));
  }

  async function saveStoreSettings(event) {
    event.preventDefault();
    try {
      setBusyKey("store-save");
      await updateStoreLineNotificationSettings(storeForm);
      await loadSettings();
      window.alert("員工 LINE 群組設定已儲存");
    } catch (err) {
      window.alert(err?.message || "員工 LINE 設定儲存失敗");
    } finally {
      setBusyKey("");
    }
  }

  async function testStoreSettings() {
    try {
      setBusyKey("store-test");
      const result = await testStoreLineNotification(storeForm);
      setPreview(result);
    } catch (err) {
      window.alert(err?.message || "測試通知失敗");
    } finally {
      setBusyKey("");
    }
  }

  async function saveSupplierSettings(row) {
    try {
      setBusyKey(`supplier-save-${row.supplierId}`);
      await updateSupplierLineNotificationSettings(row.supplierId, supplierForms[row.supplierId] || defaultSupplierForm(row));
      await loadSettings();
      window.alert("供應商 LINE 群組設定已儲存");
    } catch (err) {
      window.alert(err?.message || "供應商 LINE 設定儲存失敗");
    } finally {
      setBusyKey("");
    }
  }

  async function testSupplierSettings(row) {
    try {
      setBusyKey(`supplier-test-${row.supplierId}`);
      const result = await testSupplierLineNotification(row.supplierId, supplierForms[row.supplierId] || defaultSupplierForm(row));
      setPreview(result);
    } catch (err) {
      window.alert(err?.message || "供應商測試通知失敗");
    } finally {
      setBusyKey("");
    }
  }

  const supplierColumns = useMemo(() => [
    {
      key: "supplierName",
      label: "供應商",
      render: (row) => (
        <div>
          <strong>{row.supplierName}</strong>
          <div className="muted-text">{row.ownerType === "COMPANY" ? "公司供應商" : "本店供應商"}</div>
        </div>
      )
    },
    {
      key: "lineGroupId",
      label: "LINE 群組 ID",
      render: (row) => (
        <input
          value={(supplierForms[row.supplierId] || defaultSupplierForm(row)).lineGroupId}
          onChange={(event) => updateSupplierForm(row.supplierId, "lineGroupId", event.target.value)}
          placeholder="LINE_SUPPLIER_GROUP_TEST"
          disabled={!canManageSupplierSettings}
        />
      )
    },
    {
      key: "enabled",
      label: "啟用",
      render: (row) => {
        const form = supplierForms[row.supplierId] || defaultSupplierForm(row);
        return (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={Boolean(form.enabled)}
              onChange={(event) => updateSupplierForm(row.supplierId, "enabled", event.target.checked)}
              disabled={!canManageSupplierSettings}
            />
            啟用
          </label>
        );
      }
    },
    {
      key: "events",
      label: "通知項目",
      render: (row) => {
        const form = supplierForms[row.supplierId] || defaultSupplierForm(row);
        return (
          <div className="stacked-list">
            <label className="checkbox-label">
              <input type="checkbox" checked={Boolean(form.notifyPurchaseOrder)} onChange={(event) => updateSupplierForm(row.supplierId, "notifyPurchaseOrder", event.target.checked)} disabled={!canManageSupplierSettings} />
              發注通知
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={Boolean(form.notifyReturn)} onChange={(event) => updateSupplierForm(row.supplierId, "notifyReturn", event.target.checked)} disabled={!canManageSupplierSettings} />
              退貨通知
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={Boolean(form.notifySettlement)} onChange={(event) => updateSupplierForm(row.supplierId, "notifySettlement", event.target.checked)} disabled={!canManageSupplierSettings} />
              月結通知
            </label>
          </div>
        );
      }
    },
    {
      key: "status",
      label: "狀態",
      render: (row) => <StatusBadge tone={row.enabled ? "success" : "neutral"}>{row.enabled ? "已設定" : "未啟用"}</StatusBadge>
    },
    {
      key: "actions",
      label: "操作",
      render: (row) => (
        <div className="table-actions">
          <button type="button" className="primary-button" onClick={() => saveSupplierSettings(row)} disabled={!canManageSupplierSettings || busyKey === `supplier-save-${row.supplierId}`}>
            儲存
          </button>
          <button type="button" className="secondary-button" onClick={() => testSupplierSettings(row)} disabled={busyKey === `supplier-test-${row.supplierId}`}>
            測試
          </button>
        </div>
      )
    }
  ], [busyKey, canManageSupplierSettings, supplierForms, supplierSettings]);

  return (
    <div className="page-stack">
      <PageHeader
        title="LINE 通知設定"
        description="設定員工 LINE 群組與供應商 LINE 群組。此階段測試通知採 dry-run，不會實際發送 LINE。"
      />
      <PageHelpButton help={PAGE_HELP.lineNotifications} />

      <section className="content-card section-panel">
        <div className="section-heading-row">
          <div>
            <h2>員工 LINE 群組通知</h2>
            <p className="muted-text">請先將 KINGWAY LINE Bot 加入員工群組，再填入 groupId。第一版需手動輸入，之後可加入自動偵測。</p>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? <div className="empty-state">LINE 通知設定載入中...</div> : null}
        <form className="form-grid" onSubmit={saveStoreSettings}>
          <label>
            員工 LINE 群組 ID
            <input value={storeForm.targetId} onChange={(event) => updateStoreForm("targetId", event.target.value)} placeholder="LINE_GROUP_TEST_TAINAN" disabled={!canManageStoreSettings} required />
          </label>
          <label>
            通知目的
            <select value={storeForm.purpose} onChange={(event) => updateStoreForm("purpose", event.target.value)} disabled={!canManageStoreSettings}>
              <option value="STAFF_GROUP">員工群組</option>
              <option value="DAILY_TASK">每日任務</option>
              <option value="SYSTEM_ALERT">系統提醒</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={Boolean(storeForm.enabled)} onChange={(event) => updateStoreForm("enabled", event.target.checked)} disabled={!canManageStoreSettings} />
            啟用員工 LINE 通知
          </label>
          <div className="form-grid-full checkbox-grid">
            {STAFF_EVENT_FIELDS.map(([key, label]) => (
              <label key={key} className="checkbox-label">
                <input type="checkbox" checked={Boolean(storeForm[key])} onChange={(event) => updateStoreForm(key, event.target.checked)} disabled={!canManageStoreSettings} />
                {label}
              </label>
            ))}
          </div>
          <div className="form-actions form-grid-full">
            <button type="submit" className="primary-button" disabled={!canManageStoreSettings || busyKey === "store-save"}>
              儲存設定
            </button>
            <button type="button" className="secondary-button" onClick={testStoreSettings} disabled={busyKey === "store-test"}>
              測試通知
            </button>
          </div>
        </form>
      </section>

      <PreviewBox preview={preview} />

      <section className="content-card section-panel">
        <div className="section-heading-row">
          <div>
            <h2>供應商 LINE 群組通知</h2>
            <p className="muted-text">同一供應商在不同門市可設定不同 LINE 群組；直營或加盟門市若不直接使用供應商流程，會隱藏或阻擋此設定。</p>
          </div>
        </div>
        {supplierError ? <div className="alert alert-warning">{supplierError}</div> : null}
        <DataTable
          rows={supplierSettings}
          columns={supplierColumns}
          emptyText="目前沒有可設定的供應商。"
          cardTitle={(row) => row.supplierName}
          cardDescription={(row) => row.ownerType === "COMPANY" ? "公司供應商" : "本店供應商"}
          cardBadges={(row) => <StatusBadge tone={row.enabled ? "success" : "neutral"}>{row.enabled ? "已設定" : "未啟用"}</StatusBadge>}
          cardFooter={(row) => supplierColumns.find((column) => column.key === "actions").render(row)}
        />
      </section>
    </div>
  );
}

export default LineNotificationSettingsPage;
