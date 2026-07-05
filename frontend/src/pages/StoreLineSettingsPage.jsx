import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AdminSectionHeader from "../components/AdminSectionHeader";
import PageHeader from "../components/PageHeader";
import { apiRequest } from "../lib/api";
import { getStoredUser } from "../lib/auth";

const DEFAULT_FORM = {
  lineEnabled: false,
  channelId: "",
  channelSecret: "",
  channelSecretPresent: false,
  channelAccessToken: "",
  channelAccessTokenPresent: false,
  liffUrl: "",
  loginAuthUrl: "",
  webhookPath: "",
  webhookUrl: "",
  customerOaName: "",
  staffGroupEnabled: false,
  updatedAt: null,
  updatedByStaffId: null
};

function normalizeForm(lineSettings) {
  return {
    lineEnabled: Boolean(lineSettings?.lineEnabled),
    channelId: String(lineSettings?.channelId || ""),
    channelSecret: String(lineSettings?.channelSecret || ""),
    channelSecretPresent: Boolean(lineSettings?.channelSecretPresent),
    channelAccessToken: String(lineSettings?.channelAccessToken || ""),
    channelAccessTokenPresent: Boolean(lineSettings?.channelAccessTokenPresent),
    liffUrl: String(lineSettings?.liffUrl || ""),
    loginAuthUrl: String(lineSettings?.loginAuthUrl || ""),
    webhookPath: String(lineSettings?.webhookPath || ""),
    webhookUrl: String(lineSettings?.webhookUrl || ""),
    customerOaName: String(lineSettings?.customerOaName || ""),
    staffGroupEnabled: Boolean(lineSettings?.staffGroupEnabled),
    updatedAt: lineSettings?.updatedAt || null,
    updatedByStaffId: lineSettings?.updatedByStaffId ?? null
  };
}

function formatStatus(present) {
  return present ? "已設定" : "尚未設定";
}

function formatEnabled(value) {
  return value ? "已啟用" : "未啟用";
}

function formatTimestamp(value) {
  if (!value) {
    return "尚未更新";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "尚未更新";
  }

  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei"
  }).format(date);
}

function StoreLineSettingsPage() {
  const user = getStoredUser();
  const role = String(user?.role || "").trim().toUpperCase();
  const canEdit = ["ADMIN", "MANAGER"].includes(role);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [drafts, setDrafts] = useState({
    channelSecret: "",
    channelAccessToken: ""
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  async function loadLineSettings() {
    setLoading(true);
    setError("");

    try {
      const response = await apiRequest("/store/settings/line");
      setForm(normalizeForm(response?.lineSettings));
    } catch (loadError) {
      setError(loadError.message || "載入 LINE 設定失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLineSettings();
  }, []);

  const readOnlyHint = useMemo(() => {
    if (canEdit) {
      return "此頁為 legacy 門市 LINE 摘要設定。新 LINE 官方帳號、Webhook、LIFF 與憑證請改用 LINE Channel 管理。";
    }

    return "目前帳號僅可檢視，若需修改請使用 ADMIN 或 MANAGER 帳號。";
  }, [canEdit]);

  function handleChange(event) {
    const { name, type, checked, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value
    }));
    setSuccessMessage("");
  }

  function handleSecretDraftChange(event) {
    const { name, value } = event.target;
    setDrafts((current) => ({
      ...current,
      [name]: value
    }));
    setSuccessMessage("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canEdit) {
      return;
    }

    setSaving(true);
    setError("");
    setSuccessMessage("");

    const payload = {
      lineEnabled: form.lineEnabled,
      channelId: form.channelId,
      liffUrl: form.liffUrl,
      loginAuthUrl: form.loginAuthUrl,
      customerOaName: form.customerOaName,
      staffGroupEnabled: form.staffGroupEnabled
    };

    if (drafts.channelSecret.trim()) {
      payload.channelSecret = drafts.channelSecret.trim();
    }

    if (drafts.channelAccessToken.trim()) {
      payload.channelAccessToken = drafts.channelAccessToken.trim();
    }

    try {
      const response = await apiRequest("/store/settings/line", {
        method: "PATCH",
        body: JSON.stringify(payload)
      });

      setForm(normalizeForm(response?.lineSettings));
      setDrafts({
        channelSecret: "",
        channelAccessToken: ""
      });
      setSuccessMessage("LINE 設定已儲存。敏感欄位僅顯示遮罩狀態。");
    } catch (saveError) {
      setError(saveError.message || "儲存 LINE 設定失敗");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="LINE 設定" description="載入 LINE 設定中..." />
        <div className="loading-state">讀取資料中，請稍候...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="LINE 設定" description={readOnlyHint} />

      <div className="line-settings-grid">
        <section className="line-settings-main-column">
          <article className="admin-panel">
            <AdminSectionHeader
              eyebrow="Overview"
              title="LINE 狀態總覽"
              description="此頁只會讀寫目前登入帳號所屬門市的 LINE 設定，不會影響其他門市。"
              actions={
                <Link to="/settings/line-channels" className="secondary-button">
                  前往 LINE Channel 管理
                </Link>
              }
            />

            <div className="line-settings-status-grid">
              <div className="line-settings-status-card">
                <span>LINE OA</span>
                <strong>{formatEnabled(form.lineEnabled)}</strong>
              </div>
              <div className="line-settings-status-card">
                <span>Channel Secret 狀態</span>
                <strong>{formatStatus(form.channelSecretPresent)}</strong>
              </div>
              <div className="line-settings-status-card">
                <span>Access Token 狀態</span>
                <strong>{formatStatus(form.channelAccessTokenPresent)}</strong>
              </div>
              <div className="line-settings-status-card">
                <span>員工通知群組</span>
                <strong>{formatEnabled(form.staffGroupEnabled)}</strong>
              </div>
            </div>

            {error ? <div className="error-banner">{error}</div> : null}
            {successMessage ? <div className="store-settings-success">{successMessage}</div> : null}

            <form className="form-grid line-settings-form" onSubmit={handleSubmit}>
              <div className="line-settings-toggle-row form-field-wide">
                <label className="line-settings-toggle-card">
                  <input
                    type="checkbox"
                    name="lineEnabled"
                    checked={form.lineEnabled}
                    onChange={handleChange}
                    disabled={!canEdit || saving}
                  />
                  <div>
                    <strong>啟用門市 LINE OA 設定</strong>
                    <p>僅更新目前門市的設定資料，不會直接改動既有正式 webhook 流量。</p>
                  </div>
                </label>
                <label className="line-settings-toggle-card">
                  <input
                    type="checkbox"
                    name="staffGroupEnabled"
                    checked={form.staffGroupEnabled}
                    onChange={handleChange}
                    disabled={!canEdit || saving}
                  />
                  <div>
                    <strong>啟用員工群組通知模式</strong>
                    <p>保留現有群組流程，只記錄本門市是否啟用通知模式。</p>
                  </div>
                </label>
              </div>

              <label className="form-field">
                <span>客戶 OA 顯示名稱</span>
                <input
                  name="customerOaName"
                  value={form.customerOaName}
                  onChange={handleChange}
                  placeholder="KINGWAY 台南門市 LINE"
                  disabled={!canEdit || saving}
                />
              </label>

              <label className="form-field">
                <span>Channel ID</span>
                <input
                  name="channelId"
                  value={form.channelId}
                  onChange={handleChange}
                  placeholder="2000xxxxxx"
                  disabled={!canEdit || saving}
                />
              </label>

              <label className="form-field form-field-wide">
                <span>目前 Channel Secret</span>
                <input value={form.channelSecret || "尚未設定"} readOnly disabled />
              </label>

              <label className="form-field form-field-wide">
                <span>更新 Channel Secret</span>
                <input
                  name="channelSecret"
                  value={drafts.channelSecret}
                  onChange={handleSecretDraftChange}
                  placeholder="legacy raw credential 更新已停用，請至 LINE Channel 管理設定 secret ref"
                  disabled
                />
              </label>

              <label className="form-field form-field-wide">
                <span>目前 Channel Access Token</span>
                <input value={form.channelAccessToken || "尚未設定"} readOnly disabled />
              </label>

              <label className="form-field form-field-wide">
                <span>更新 Channel Access Token</span>
                <input
                  name="channelAccessToken"
                  value={drafts.channelAccessToken}
                  onChange={handleSecretDraftChange}
                  placeholder="legacy raw credential 更新已停用，請至 LINE Channel 管理設定 token ref"
                  disabled
                />
              </label>

              <label className="form-field form-field-wide">
                <span>LIFF URL</span>
                <input
                  name="liffUrl"
                  value={form.liffUrl}
                  onChange={handleChange}
                  placeholder="https://liff.line.me/..."
                  disabled={!canEdit || saving}
                />
              </label>

              <label className="form-field form-field-wide">
                <span>LINE Login 授權網址</span>
                <input
                  name="loginAuthUrl"
                  value={form.loginAuthUrl}
                  onChange={handleChange}
                  placeholder="https://access.line.me/oauth2/..."
                  disabled={!canEdit || saving}
                />
              </label>

              <div className="compact-actions store-settings-actions form-field-wide">
                <button type="submit" className="primary-button" disabled={!canEdit || saving}>
                  {saving ? "儲存中..." : canEdit ? "儲存 LINE 設定" : "目前為唯讀"}
                </button>
              </div>
            </form>
          </article>
        </section>

        <aside className="line-settings-side-column">
          <article className="admin-panel">
            <AdminSectionHeader
              eyebrow="Webhook 設定"
              title="Webhook 顯示"
              description="只顯示目前設定與未來候選路徑，不會在此頁切換既有正式 webhook。"
            />
            <div className="line-settings-side-card">
              <div className="line-settings-detail-block">
                <span>目前正式 webhook</span>
                <strong>/api/line/webhook</strong>
              </div>
              <div className="line-settings-detail-block">
                <span>門市專屬候選路徑</span>
                <strong>{form.webhookPath || "系統將於首次儲存時自動產生"}</strong>
              </div>
              <div className="line-settings-detail-block">
                <span>門市專屬候選網址</span>
                <strong className="line-settings-break">{form.webhookUrl || "尚未產生"}</strong>
              </div>
            </div>
          </article>

          <article className="admin-panel">
            <AdminSectionHeader
              eyebrow="更新記錄"
              title="更新資訊"
              description="敏感值不會顯示原文。直接儲存與 env 參照都只會顯示遮罩狀態。"
            />
            <div className="line-settings-side-card">
              <div className="line-settings-detail-block">
                <span>最後更新時間</span>
                <strong>{formatTimestamp(form.updatedAt)}</strong>
              </div>
              <div className="line-settings-detail-block">
                <span>最後更新員工 ID</span>
                <strong>{form.updatedByStaffId || "尚未記錄"}</strong>
              </div>
              <div className="line-settings-detail-block">
                <span>安全提示</span>
                <strong className="line-settings-break">
                  畫面只顯示「已設定」與遮罩標示。留空儲存不會覆蓋既有 token / secret，本階段不提供清除功能。
                </strong>
              </div>
            </div>
          </article>
        </aside>
      </div>
    </div>
  );
}

export default StoreLineSettingsPage;
