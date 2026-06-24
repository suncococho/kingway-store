import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import { getStoredPlatformUser, platformRequest } from "../lib/platformAuth";

function getStatusTone(status) {
  return String(status || "").toLowerCase() === "active" ? "success" : "neutral";
}

function getFeatureTone(enabled) {
  return enabled ? "success" : "neutral";
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function featuresToDraft(features) {
  return (Array.isArray(features) ? features : []).reduce((acc, feature) => {
    const key = toText(feature.key);
    if (key) {
      acc[key] = Boolean(feature.enabled);
    }
    return acc;
  }, {});
}

function getPresetSummary(presetKey) {
  if (presetKey === "FREE") {
    return "免費版：保留 POS、訂單、維修、庫存與 LINE 基本能力。";
  }
  if (presetKey === "PREMIUM") {
    return "進階版：開啟進階報表、優惠券、供應商、購買確認書與員工管理。";
  }
  return "";
}

function getPlanLabel(plan) {
  const normalized = String(plan || "").toLowerCase();
  if (normalized === "free") return "免費版";
  if (normalized === "premium") return "進階版";
  if (normalized === "trial") return "試用版";
  if (normalized === "single_store") return "單店版";
  return plan || "-";
}

function SaasStoreFeaturesPage() {
  const { id } = useParams();
  const currentUser = getStoredPlatformUser();
  const isAdmin = ["PLATFORM_OWNER", "PLATFORM_ADMIN", "SUPPORT"].includes(
    String(currentUser?.role || "").trim().toUpperCase()
  );
  const [data, setData] = useState(null);
  const [draftFeatures, setDraftFeatures] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [success, setSuccess] = useState("");
  const [presetLoading, setPresetLoading] = useState("");

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    async function loadFeatures() {
      setLoading(true);
      setError("");
      setSaveError("");
      setSuccess("");

      try {
        const response = await platformRequest(`/saas-admin/stores/${id}/features`);
        setData(response);
        setDraftFeatures(featuresToDraft(response.features));
      } catch (err) {
        setError(err.message || "載入店家功能設定失敗");
      } finally {
        setLoading(false);
      }
    }

    loadFeatures();
  }, [id, isAdmin]);

  const store = data?.store
    ? {
        id: toNumber(data.store.id),
        code: toText(data.store.code, "-"),
        name: toText(data.store.name, ""),
        status: toText(data.store.status, "-"),
        plan: toText(data.store.plan, "-")
      }
    : null;
  const features = Array.isArray(data?.features)
    ? data.features.map((feature) => {
        const key = toText(feature.key);
        const hasDraftValue = Object.prototype.hasOwnProperty.call(draftFeatures, key);
        return {
          key,
          label: toText(feature.label, "未命名功能"),
          enabled: hasDraftValue ? Boolean(draftFeatures[key]) : Boolean(feature.enabled),
          persistedEnabled: Boolean(feature.enabled),
          description: toText(feature.description, "-")
        };
      })
    : [];
  const enabledCount = useMemo(() => features.filter((feature) => feature.enabled).length, [features]);
  const hasChanges = useMemo(
    () => features.some((feature) => feature.enabled !== feature.persistedEnabled),
    [features]
  );

  function toggleFeature(key, enabled) {
    setDraftFeatures((current) => ({ ...current, [key]: enabled }));
    setSaveError("");
    setSuccess("");
  }

  async function saveFeatures() {
    setSaving(true);
    setSaveError("");
    setSuccess("");

    try {
      const payload = features.reduce((acc, feature) => {
        acc[feature.key] = Boolean(feature.enabled);
        return acc;
      }, {});
      const response = await platformRequest(`/saas-admin/stores/${id}/features`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });

      setData(response);
      setDraftFeatures(featuresToDraft(response.features));
      setSuccess("功能設定已儲存。");
    } catch (err) {
      setSaveError(err.message || "儲存店家功能設定失敗");
    } finally {
      setSaving(false);
    }
  }

  async function applyPreset(presetKey) {
    setPresetLoading(presetKey);
    setSaveError("");
    setSuccess("");

    try {
      const response = await platformRequest(`/saas-admin/stores/${id}/features/preset`, {
        method: "POST",
        body: JSON.stringify({ preset: presetKey })
      });

      setData(response);
      setDraftFeatures(featuresToDraft(response.features));
      setSuccess(`${presetKey} preset 已套用。`);
    } catch (err) {
      setSaveError(err.message || "套用 preset 失敗");
    } finally {
      setPresetLoading("");
    }
  }

  const columns = [
    { key: "label", label: "功能" },
    { key: "description", label: "說明" },
    {
      key: "enabled",
      label: "狀態",
      render: (row) => (
        <StatusBadge tone={getFeatureTone(row.enabled)}>
          {row.enabled ? "已啟用" : "未啟用"}
        </StatusBadge>
      )
    },
    {
      key: "actions",
      label: "設定",
      mobileHidden: true,
      render: (row) => (
        <label className="checklist-item">
          <input
            type="checkbox"
            checked={row.enabled}
            disabled={saving}
            onChange={(event) => toggleFeature(row.key, event.target.checked)}
          />
          <span>{row.enabled ? "啟用" : "停用"}</span>
        </label>
      )
    }
  ];

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="店家功能設定" description="僅限平台管理員檢視。" />
        <div className="empty-state">沒有平台管理權限。</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="店家功能設定" description="載入店家功能設定中..." />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="店家功能設定" description="Platform Admin 的店家功能設定入口。" />
        <div className="empty-state">{error}</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="店家功能設定" description="管理單一店家目前啟用的平台功能模組。" />

      <div className="admin-summary-grid dashboard-summary-grid">
        <article className="admin-summary-card">
          <div className="admin-summary-label">店家代碼</div>
          <div className="admin-summary-value admin-summary-value-small">{store?.code || "-"}</div>
        </article>
        <article className="admin-summary-card">
          <div className="admin-summary-label">店家 ID</div>
          <div className="admin-summary-value">{store?.id ?? "-"}</div>
        </article>
        <article className="admin-summary-card">
          <div className="admin-summary-label">狀態</div>
          <div className="admin-summary-value admin-summary-value-small">{store?.status || "-"}</div>
        </article>
        <article className="admin-summary-card">
          <div className="admin-summary-label">方案</div>
          <div className="admin-summary-value admin-summary-value-small">{getPlanLabel(store?.plan)}</div>
        </article>
        <article className="admin-summary-card">
          <div className="admin-summary-label">已啟用功能</div>
          <div className="admin-summary-value">{enabledCount}</div>
        </article>
      </div>

      <section className="admin-panel">
        <AdminSectionHeader
          eyebrow="功能設定"
          title={store?.code || `店家 ${id}`}
          description="可編輯，儲存後會套用至此店家。"
          badges={
            <>
              <StatusBadge tone={getStatusTone(store?.status)}>{store?.status || "-"}</StatusBadge>
              <StatusBadge tone="info">{getPlanLabel(store?.plan)}</StatusBadge>
            </>
          }
          actions={
            <>
              <Link to="/platform-admin" className="secondary-button">返回平台管理</Link>
              <button
                type="button"
                className="secondary-button"
                onClick={() => applyPreset("FREE")}
                disabled={saving || presetLoading === "PREMIUM" || presetLoading === "FREE"}
              >
                {presetLoading === "FREE" ? "套用中..." : "套用免費版"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => applyPreset("PREMIUM")}
                disabled={saving || presetLoading === "FREE" || presetLoading === "PREMIUM"}
              >
                {presetLoading === "PREMIUM" ? "套用中..." : "套用進階版"}
              </button>
              <button
                type="button"
                className="primary-button inline-submit"
                onClick={saveFeatures}
                disabled={saving || Boolean(presetLoading) || !features.length || !hasChanges}
              >
                {saving ? "儲存中..." : "儲存設定"}
              </button>
            </>
          }
        />

        <div className="empty-state">
          功能關閉後，該店家人員將無法使用對應後台功能。
          第一階段已套用至：銷售報表、優惠券、發注/供應商。
          第二階段已套用至：庫存管理、購買確認書。
          第三階段已套用至：維修系統、員工管理。
          第四階段已套用至：訂單管理。
          最終階段已套用至：POS 系統。
        </div>

        <div className="empty-state">
          {getPresetSummary("FREE")}
          {" "}
          {getPresetSummary("PREMIUM")}
        </div>

        {saveError ? <div className="empty-state">{saveError}</div> : null}
        {success ? <div className="empty-state">{success}</div> : null}

        <DataTable
          columns={columns}
          rows={features}
          emptyText="目前沒有功能設定資料。"
          cardTitle={(row) => row.label}
          cardDescription={(row) => row.description}
          cardBadges={(row) => (
            <StatusBadge tone={getFeatureTone(row.enabled)}>
              {row.enabled ? "已啟用" : "未啟用"}
            </StatusBadge>
          )}
          cardFooter={(row) => (
            <label className="checklist-item">
              <input
                type="checkbox"
                checked={row.enabled}
                disabled={saving}
                onChange={(event) => toggleFeature(row.key, event.target.checked)}
              />
              <span>{row.enabled ? "啟用" : "停用"}</span>
            </label>
          )}
        />
      </section>
    </div>
  );
}

export default SaasStoreFeaturesPage;
