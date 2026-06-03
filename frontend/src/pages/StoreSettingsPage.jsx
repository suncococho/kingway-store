import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AdminSectionHeader from "../components/AdminSectionHeader";
import PageHeader from "../components/PageHeader";
import { apiRequest, apiUploadImage } from "../lib/api";
import { getStoredUser } from "../lib/auth";

const DEFAULT_FORM = {
  displayName: "",
  address: "",
  phone: "",
  businessHours: "",
  timezone: "Asia/Taipei",
  defaultLanguage: "zh-TW",
  invoiceDisplayName: "",
  businessNumber: "",
  logoUrl: ""
};

const LANGUAGE_OPTIONS = [
  { value: "zh-TW", label: "繁體中文（台灣）" },
  { value: "en", label: "English" }
];

const TIMEZONE_OPTIONS = [
  { value: "Asia/Taipei", label: "Asia/Taipei" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo" },
  { value: "UTC", label: "UTC" }
];

function normalizeForm(store) {
  return {
    displayName: String(store?.displayName || ""),
    address: String(store?.address || ""),
    phone: String(store?.phone || ""),
    businessHours: String(store?.businessHours || ""),
    timezone: String(store?.timezone || DEFAULT_FORM.timezone),
    defaultLanguage: String(store?.defaultLanguage || DEFAULT_FORM.defaultLanguage),
    invoiceDisplayName: String(store?.invoiceDisplayName || ""),
    businessNumber: String(store?.businessNumber || ""),
    logoUrl: String(store?.logoUrl || "")
  };
}

function StoreSettingsPage() {
  const user = getStoredUser();
  const role = String(user?.role || "").trim().toUpperCase();
  const canEdit = ["ADMIN", "MANAGER"].includes(role);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  async function loadSettings() {
    setLoading(true);
    setError("");

    try {
      const response = await apiRequest("/store/settings");
      setForm(normalizeForm(response?.store));
    } catch (loadError) {
      setError(loadError.message || "載入門市設定失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  const readOnlyHint = useMemo(() => {
    if (canEdit) {
      return "可在此維護門市名稱、地址、電話與對外顯示資訊。";
    }

    return "目前帳號僅可檢視，若需修改請使用 ADMIN 或 MANAGER 帳號。";
  }, [canEdit]);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({
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

    try {
      const response = await apiRequest("/store/settings", {
        method: "PATCH",
        body: JSON.stringify(form)
      });

      setForm(normalizeForm(response?.store));
      setSuccessMessage("門市設定已儲存。");
    } catch (saveError) {
      setError(saveError.message || "儲存門市設定失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !canEdit) {
      return;
    }

    setUploadingLogo(true);
    setError("");
    setSuccessMessage("");

    try {
      const response = await apiUploadImage("/store/settings/logo", file);
      setForm(normalizeForm(response?.store));
      setSuccessMessage("門市 Logo 已更新。");
    } catch (uploadError) {
      setError(uploadError.message || "上傳門市 Logo 失敗");
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleLogoRemove() {
    if (!canEdit) {
      return;
    }

    setSaving(true);
    setError("");
    setSuccessMessage("");

    try {
      const response = await apiRequest("/store/settings", {
        method: "PATCH",
        body: JSON.stringify({
          logoUrl: ""
        })
      });

      setForm(normalizeForm(response?.store));
      setSuccessMessage("門市 Logo 已移除。");
    } catch (saveError) {
      setError(saveError.message || "移除門市 Logo 失敗");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="門市設定" description="載入門市設定中..." />
        <div className="loading-state">讀取資料中，請稍候...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="門市設定" description={readOnlyHint} />

      <div className="store-settings-grid">
        <section className="admin-panel store-settings-main-panel">
          <AdminSectionHeader
            eyebrow="Store Profile"
            title="基本資料"
            description="此頁只會讀寫目前登入帳號所屬門市的設定，不會跨店共用。"
            actions={
              <Link to="/settings?section=system" className="secondary-button">
                前往系統設定
              </Link>
            }
          />

          {error ? <div className="error-banner">{error}</div> : null}
          {successMessage ? <div className="store-settings-success">{successMessage}</div> : null}

          <form className="form-grid store-settings-form" onSubmit={handleSubmit}>
            <label className="form-field">
              <span>門市顯示名稱</span>
              <input name="displayName" value={form.displayName} onChange={handleChange} placeholder="KINGWAY 台南門市" disabled={!canEdit || saving} />
            </label>
            <label className="form-field">
              <span>聯絡電話</span>
              <input name="phone" value={form.phone} onChange={handleChange} placeholder="06-000-0000" disabled={!canEdit || saving} />
            </label>
            <label className="form-field form-field-wide">
              <span>地址</span>
              <input name="address" value={form.address} onChange={handleChange} placeholder="台南市..." disabled={!canEdit || saving} />
            </label>
            <label className="form-field form-field-wide">
              <span>營業時間</span>
              <input name="businessHours" value={form.businessHours} onChange={handleChange} placeholder="每日 13:00 - 21:00" disabled={!canEdit || saving} />
            </label>
            <label className="form-field">
              <span>時區</span>
              <select name="timezone" value={form.timezone} onChange={handleChange} disabled={!canEdit || saving}>
                {TIMEZONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>預設語言</span>
              <select name="defaultLanguage" value={form.defaultLanguage} onChange={handleChange} disabled={!canEdit || saving}>
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>發票 / 收據顯示名稱</span>
              <input name="invoiceDisplayName" value={form.invoiceDisplayName} onChange={handleChange} placeholder="KINGWAY 台南門市" disabled={!canEdit || saving} />
            </label>
            <label className="form-field">
              <span>統編 / 商業編號</span>
              <input name="businessNumber" value={form.businessNumber} onChange={handleChange} placeholder="12345678" disabled={!canEdit || saving} />
            </label>

            <div className="compact-actions store-settings-actions form-field-wide">
              <button type="submit" className="primary-button" disabled={!canEdit || saving}>
                {saving ? "儲存中..." : canEdit ? "儲存門市設定" : "目前為唯讀"}
              </button>
            </div>
          </form>
        </section>

        <section className="store-settings-side-column">
          <article className="admin-panel">
            <AdminSectionHeader
              eyebrow="Logo"
              title="門市 Logo"
              description="Logo 會以目前登入門市為範圍獨立儲存，不會影響其他門市。"
            />
            <div className="store-settings-logo-card">
              <div className="store-settings-logo-preview">
                {form.logoUrl ? (
                  <img src={form.logoUrl} alt="門市 Logo 預覽" className="store-settings-logo-image" />
                ) : (
                  <div className="store-settings-logo-empty">
                    <strong>尚未上傳 Logo</strong>
                    <p>建議使用透明背景 PNG 或 SVG，方便後續門市品牌延伸。</p>
                  </div>
                )}
              </div>

              <div className="store-settings-logo-meta">
                <div className="store-settings-logo-meta-title">目前品牌圖像</div>
                <div className="store-settings-logo-meta-text">
                  {form.logoUrl ? "已儲存目前門市專用 Logo。" : "目前仍使用系統預設文字品牌。"}
                </div>
              </div>

              <div className="compact-actions store-settings-logo-actions">
                <label className={`secondary-button${!canEdit || uploadingLogo || saving ? " disabled" : ""}`}>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    onChange={handleLogoUpload}
                    disabled={!canEdit || uploadingLogo || saving}
                    hidden
                  />
                  {uploadingLogo ? "上傳中..." : "上傳 Logo"}
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleLogoRemove}
                  disabled={!canEdit || !form.logoUrl || uploadingLogo || saving}
                >
                  移除 Logo
                </button>
              </div>

              <p className="store-settings-logo-hint">
                支援 JPG、PNG、WEBP、GIF、SVG，單檔上限 4MB。
              </p>
            </div>
          </article>

          <article className="admin-panel">
            <AdminSectionHeader
              eyebrow="LINE"
              title="LINE 設定"
              description="LINE OA、Webhook 與 LIFF 已獨立到安全設定頁，避免與一般門市資料混在一起。"
            />
            <div className="store-settings-placeholder-card">
              <strong>前往獨立設定頁</strong>
              <p>可在專用頁面查看遮罩後的 token / secret 狀態，並安全更新目前門市的 LINE 設定。</p>
              <div className="store-settings-logo-actions">
                <Link to="/settings/line" className="primary-button inline-submit">
                  開啟 LINE 設定
                </Link>
              </div>
            </div>
          </article>
        </section>
      </div>
    </div>
  );
}

export default StoreSettingsPage;
