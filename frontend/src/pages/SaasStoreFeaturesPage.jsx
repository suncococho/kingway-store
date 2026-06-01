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
        setError(err.message || "載入店鋪功能設定失敗");
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
      setSaveError(err.message || "儲存店鋪功能設定失敗");
    } finally {
      setSaving(false);
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
        <PageHeader title="店鋪功能設定" description="僅限平台管理員檢視。" />
        <div className="empty-state">沒有 SaaS 管理權限。</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="店鋪功能設定" description="載入店鋪功能設定中..." />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="店鋪功能設定" description="SaaS 平台的店鋪功能設定入口。" />
        <div className="empty-state">{error}</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="店鋪功能設定" description="管理單一店鋪目前啟用的 SaaS 功能模組。" />

      <div className="admin-summary-grid dashboard-summary-grid">
        <article className="admin-summary-card">
          <div className="admin-summary-label">店鋪代碼</div>
          <div className="admin-summary-value admin-summary-value-small">{store?.code || "-"}</div>
        </article>
        <article className="admin-summary-card">
          <div className="admin-summary-label">Store ID</div>
          <div className="admin-summary-value">{store?.id ?? "-"}</div>
        </article>
        <article className="admin-summary-card">
          <div className="admin-summary-label">狀態</div>
          <div className="admin-summary-value admin-summary-value-small">{store?.status || "-"}</div>
        </article>
        <article className="admin-summary-card">
          <div className="admin-summary-label">Plan</div>
          <div className="admin-summary-value admin-summary-value-small">{store?.plan || "-"}</div>
        </article>
        <article className="admin-summary-card">
          <div className="admin-summary-label">已啟用功能</div>
          <div className="admin-summary-value">{enabledCount}</div>
        </article>
      </div>

      <section className="admin-panel">
        <AdminSectionHeader
          eyebrow="Feature flags"
          title={store?.code || `Store ${id}`}
          description="可編輯，儲存後會套用至此店鋪。"
          badges={
            <>
              <StatusBadge tone={getStatusTone(store?.status)}>{store?.status || "-"}</StatusBadge>
              <StatusBadge tone="info">{store?.plan || "-"}</StatusBadge>
            </>
          }
          actions={
            <>
              <Link to="/platform-admin" className="secondary-button">返回 SaaS 管理</Link>
              <button
                type="button"
                className="primary-button inline-submit"
                onClick={saveFeatures}
                disabled={saving || !features.length || !hasChanges}
              >
                {saving ? "儲存中..." : "儲存設定"}
              </button>
            </>
          }
        />

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
