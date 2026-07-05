import { useEffect, useMemo, useState } from "react";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import PageHelpButton from "../components/PageHelpButton";
import StatusBadge from "../components/StatusBadge";
import {
  createStoreLineChannel,
  dryRunStoreLineChannel,
  fetchStoreLineChannel,
  fetchStoreLineChannels,
  updateStoreLineChannel,
  verifyStoreLineChannel
} from "../lib/storeLineChannelsApi";
import { PAGE_HELP } from "../lib/pageHelpContent";

const OWNERSHIP_OPTIONS = [
  ["HQ_MANAGED", "本部管理"],
  ["FRANCHISE_OWNED", "加盟店自有"],
  ["INDEPENDENT_OWNED", "獨立店自有"]
];

const OWNERSHIP_LABELS = Object.fromEntries(OWNERSHIP_OPTIONS);

const STATUS_LABELS = {
  NOT_TESTED: "尚未測試",
  DRY_RUN_OK: "Dry-run 成功",
  DRY_RUN_FAILED: "Dry-run 失敗",
  DISABLED: "未啟用"
};

const STATUS_TONES = {
  NOT_TESTED: "muted",
  DRY_RUN_OK: "success",
  DRY_RUN_FAILED: "danger",
  DISABLED: "muted"
};

function defaultForm(storeId = "") {
  return {
    storeId,
    ownershipType: "HQ_MANAGED",
    lineOfficialAccountName: "",
    lineOfficialAccountId: "",
    lineBasicId: "",
    lineChannelId: "",
    lineChannelSecretRef: "",
    channelAccessTokenRef: "",
    liffId: "",
    webhookPath: "",
    webhookUrl: "",
    isPrimary: true,
    enabled: false
  };
}

function formatDateTime(value) {
  if (!value) return "-";
  return String(value).replace("T", " ").slice(0, 19);
}

function getStoreLabel(store) {
  if (!store) return "-";
  return `${store.name || `Store ${store.id}`}${store.code ? `（${store.code}）` : ""}`;
}

function formFromChannel(channel = {}, fallbackStoreId = "") {
  return {
    storeId: channel.storeId || fallbackStoreId || "",
    ownershipType: channel.ownershipType || "HQ_MANAGED",
    lineOfficialAccountName: channel.lineOfficialAccountName || "",
    lineOfficialAccountId: channel.lineOfficialAccountId || "",
    lineBasicId: channel.lineBasicId || "",
    lineChannelId: "",
    lineChannelIdReadonly: channel.lineChannelIdMasked || "",
    lineChannelSecretRef: "",
    channelAccessTokenRef: "",
    liffId: channel.liffId || "",
    webhookPath: channel.webhookPath || "",
    webhookUrl: channel.webhookUrl || "",
    isPrimary: Boolean(channel.isPrimary),
    enabled: Boolean(channel.enabled)
  };
}

function buildPayload(form, editing = null) {
  const payload = {
    storeId: Number(form.storeId || 0),
    ownershipType: form.ownershipType,
    lineOfficialAccountName: form.lineOfficialAccountName,
    lineOfficialAccountId: form.lineOfficialAccountId,
    lineBasicId: form.lineBasicId,
    liffId: form.liffId,
    webhookPath: form.webhookPath,
    webhookUrl: form.webhookUrl,
    isPrimary: Boolean(form.isPrimary),
    enabled: Boolean(form.enabled)
  };

  if (!editing || String(form.lineChannelId || "").trim()) {
    payload.lineChannelId = String(form.lineChannelId || "").trim();
  }
  if (String(form.lineChannelSecretRef || "").trim()) {
    payload.lineChannelSecretRef = String(form.lineChannelSecretRef || "").trim();
  }
  if (String(form.channelAccessTokenRef || "").trim()) {
    payload.channelAccessTokenRef = String(form.channelAccessTokenRef || "").trim();
  }
  return payload;
}

function StoreLineChannelsPage() {
  const [channels, setChannels] = useState([]);
  const [stores, setStores] = useState([]);
  const [currentStoreId, setCurrentStoreId] = useState("");
  const [canManageSettings, setCanManageSettings] = useState(false);
  const [canManageCompanyChannels, setCanManageCompanyChannels] = useState(false);
  const [filters, setFilters] = useState({ storeId: "", enabled: "", ownershipType: "" });
  const [form, setForm] = useState(defaultForm());
  const [editing, setEditing] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [dryRunResult, setDryRunResult] = useState(null);

  async function loadData(nextFilters = filters) {
    try {
      setLoading(true);
      setError("");
      const response = await fetchStoreLineChannels(nextFilters);
      const rows = response.channels || [];
      const storeRows = response.stores || [];
      setChannels(rows);
      setStores(storeRows);
      setCurrentStoreId(response.currentStoreId || "");
      setCanManageSettings(Boolean(response.canManageSettings));
      setCanManageCompanyChannels(Boolean(response.canManageCompanyChannels));
      setForm((current) => ({
        ...current,
        storeId: current.storeId || response.currentStoreId || storeRows[0]?.id || ""
      }));
    } catch (err) {
      setChannels([]);
      setError(err?.message || "LINE Channel 管理資料載入失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setDryRunResult(null);
    setSuccessMessage("");
  }

  function openCreateModal() {
    const storeId = filters.storeId || currentStoreId || stores[0]?.id || "";
    const store = stores.find((item) => Number(item.id) === Number(storeId));
    setEditing(null);
    setForm({
      ...defaultForm(storeId),
      ownershipType: store?.defaultOwnershipType || "HQ_MANAGED"
    });
    setDryRunResult(null);
    setModalOpen(true);
  }

  async function openEditModal(row) {
    try {
      setBusyId(`edit-${row.id}`);
      setError("");
      const response = await fetchStoreLineChannel(row.id);
      const channel = response.channel || row;
      setEditing(channel);
      setForm(formFromChannel(channel, currentStoreId));
      setDryRunResult(null);
      setModalOpen(true);
    } catch (err) {
      setError(err?.message || "讀取 LINE Channel 失敗");
    } finally {
      setBusyId("");
    }
  }

  async function applyFilters(event) {
    event.preventDefault();
    await loadData(filters);
  }

  async function saveChannel(event) {
    event.preventDefault();
    try {
      setSaving(true);
      setError("");
      setSuccessMessage("");
      const payload = buildPayload(form, editing);
      const response = editing?.id
        ? await updateStoreLineChannel(editing.id, payload)
        : await createStoreLineChannel(payload);
      setSuccessMessage(editing?.id ? "LINE Channel 已更新" : "LINE Channel 已建立");
      setEditing(response.channel || null);
      setForm(formFromChannel(response.channel || {}, currentStoreId));
      setModalOpen(false);
      await loadData(filters);
    } catch (err) {
      setError(err?.message || "LINE Channel 儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  async function runDryRun(row) {
    try {
      setBusyId(`dry-run-${row.id}`);
      setError("");
      setSuccessMessage("");
      const result = await dryRunStoreLineChannel(row.id);
      setDryRunResult(result);
      setSuccessMessage(result.message || "Dry-run 測試完成");
      await loadData(filters);
    } catch (err) {
      setError(err?.message || "Dry-run 測試失敗");
    } finally {
      setBusyId("");
    }
  }

  async function runVerify(row) {
    try {
      setBusyId(`verify-${row.id}`);
      setError("");
      setSuccessMessage("");
      const result = await verifyStoreLineChannel(row.id);
      setDryRunResult(result);
      setSuccessMessage(result.message || "Verify 測試完成");
      await loadData(filters);
    } catch (err) {
      setError(err?.message || "Verify 測試失敗");
    } finally {
      setBusyId("");
    }
  }

  const columns = useMemo(() => [
    { key: "storeName", label: "門市", render: (row) => row.storeName || `#${row.storeId}` },
    { key: "ownershipType", label: "Ownership", render: (row) => OWNERSHIP_LABELS[row.ownershipType] || row.ownershipType },
    { key: "lineOfficialAccountName", label: "LINE OA 名稱", render: (row) => row.lineOfficialAccountName || "-" },
    { key: "lineBasicId", label: "Basic ID", render: (row) => row.lineBasicId || "-" },
    { key: "lineChannelIdMasked", label: "Channel ID", render: (row) => row.lineChannelIdMasked || "-" },
    { key: "secret", label: "Secret Ref 狀態", render: (row) => row.hasLineChannelSecretRef ? <StatusBadge tone="success">已設定</StatusBadge> : <StatusBadge tone="muted">未設定</StatusBadge> },
    { key: "token", label: "Token Ref 狀態", render: (row) => row.hasChannelAccessTokenRef ? <StatusBadge tone="success">已設定</StatusBadge> : <StatusBadge tone="muted">未設定</StatusBadge> },
    { key: "liffId", label: "LIFF ID", render: (row) => row.liffId || "-" },
    { key: "webhookUrl", label: "Webhook URL", render: (row) => <span className="line-settings-break">{row.webhookUrl || "-"}</span> },
    { key: "enabled", label: "Enabled", render: (row) => row.enabled ? <StatusBadge tone="success">啟用</StatusBadge> : <StatusBadge tone="muted">停用</StatusBadge> },
    { key: "connectionStatus", label: "Connection Status", render: (row) => <StatusBadge tone={STATUS_TONES[row.connectionStatus] || "neutral"}>{STATUS_LABELS[row.connectionStatus] || row.connectionStatus}</StatusBadge> },
    { key: "lastDryRunTestAt", label: "Last Dry-run", render: (row) => formatDateTime(row.lastDryRunTestAt) },
    { key: "lastWebhookAt", label: "Last Webhook", render: (row) => formatDateTime(row.lastWebhookAt) },
    { key: "updatedByName", label: "最後修改人員", render: (row) => row.updatedByName || "-" },
    {
      key: "actions",
      label: "操作",
      render: (row) => (
        <div className="compact-actions">
          <button type="button" className="secondary-button" onClick={() => openEditModal(row)} disabled={busyId === `edit-${row.id}`}>
            編輯
          </button>
          <button type="button" className="primary-button" onClick={() => runDryRun(row)} disabled={!canManageSettings || busyId === `dry-run-${row.id}`}>
            Dry-run 測試
          </button>
          <button type="button" className="secondary-button" onClick={() => runVerify(row)} disabled={!canManageSettings || busyId === `verify-${row.id}`}>
            Verify
          </button>
        </div>
      )
    }
  ], [busyId, canManageSettings]);

  return (
    <div className="page-stack">
      <PageHeader
        title="門市 LINE Channel 管理"
        description="管理各門市的 LINE 官方帳號 / Messaging API Channel。此階段僅建立設定與 dry-run，不會更換現有 webhook，也不會實際發送 LINE 訊息。"
      />
      <PageHelpButton help={PAGE_HELP.storeLineChannels} />

      {error ? <div className="alert alert-error">{error}</div> : null}
      {successMessage ? <div className="store-settings-success">{successMessage}</div> : null}

      <section className="content-card section-panel">
        <div className="section-heading-row">
          <div>
            <h2>設定說明</h2>
              <p className="muted-text">
              此頁只保存 Channel metadata、secret ref 與 token ref。Webhook 標準路徑為 /api/line/webhook/channel/:webhookPath，請勿輸入 LINE Access Token 或 Channel Secret 原文。
            </p>
          </div>
          <StatusBadge tone={canManageCompanyChannels ? "warning" : "info"}>
            {canManageCompanyChannels ? "公司 / 本部範圍" : "目前門市"}
          </StatusBadge>
        </div>
        <div className="notice-card">
          <strong>Dry-run 安全規則</strong>
          <p className="muted-text">Dry-run 測試只驗證欄位完整性並更新 connection status，不會呼叫 LINE API、不會 push、不會 reply。</p>
        </div>
      </section>

      <section className="content-card section-panel">
        <div className="section-heading-row">
          <div>
            <h2>LINE Channel 清單</h2>
            <p className="muted-text">Channel ID 會遮蔽顯示；secret ref 與 token ref 僅顯示是否已設定。</p>
          </div>
          <button type="button" className="primary-button" onClick={openCreateModal} disabled={!canManageSettings}>
            新增 LINE Channel
          </button>
        </div>

        <form className="form-grid" onSubmit={applyFilters}>
          <label className="form-field">
            <span>門市</span>
            <select value={filters.storeId} onChange={(event) => updateFilter("storeId", event.target.value)}>
              <option value="">全部可查看門市</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>{getStoreLabel(store)}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Ownership</span>
            <select value={filters.ownershipType} onChange={(event) => updateFilter("ownershipType", event.target.value)}>
              <option value="">全部</option>
              {OWNERSHIP_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="form-field">
            <span>啟用狀態</span>
            <select value={filters.enabled} onChange={(event) => updateFilter("enabled", event.target.value)}>
              <option value="">全部</option>
              <option value="true">啟用</option>
              <option value="false">停用</option>
            </select>
          </label>
          <div className="form-actions form-grid-full">
            <button type="submit" className="secondary-button" disabled={loading}>
              查詢
            </button>
          </div>
        </form>

        {loading ? <div className="loading-state">讀取資料中...</div> : (
          <DataTable
            columns={columns}
            rows={channels}
            emptyText="目前沒有 LINE Channel 設定。"
            cardTitle={(row) => row.lineOfficialAccountName || row.storeName || `Channel ${row.id}`}
            cardDescription={(row) => `${OWNERSHIP_LABELS[row.ownershipType] || row.ownershipType} / ${row.lineChannelIdMasked || "-"}`}
            cardBadges={(row) => <StatusBadge tone={STATUS_TONES[row.connectionStatus] || "neutral"}>{STATUS_LABELS[row.connectionStatus] || row.connectionStatus}</StatusBadge>}
          />
        )}
      </section>

      {dryRunResult ? (
        <section className="content-card section-panel">
          <div className="section-heading-row">
            <div>
              <h2>Dry-run 測試結果</h2>
              <p className="muted-text">{dryRunResult.message}</p>
            </div>
            <StatusBadge tone={dryRunResult.ok ? "success" : "danger"}>{dryRunResult.ok ? "成功" : "失敗"}</StatusBadge>
          </div>
          <div className="summary-grid">
            {(dryRunResult.checks || []).map((check) => (
              <div className="summary-card" key={check.key}>
                <div className="summary-label">{check.label}</div>
                <div className="summary-value">{check.ok ? "OK" : "NG"}</div>
              </div>
            ))}
          </div>
          <p className="muted-text">實際 LINE API 呼叫：{dryRunResult.actualLineApiCalled ? "是" : "否"}</p>
        </section>
      ) : null}

      {modalOpen ? (
        <div className="admin-modal-backdrop" role="presentation">
          <section className="admin-modal-card" role="dialog" aria-modal="true" aria-label="LINE Channel 設定">
            <div className="admin-modal-header">
              <div>
                <h2>{editing?.id ? "編輯 LINE Channel" : "新增 LINE Channel"}</h2>
                <p className="muted-text">Access Token / Channel Secret 原文請勿輸入，只能輸入 secret ref / token ref。</p>
              </div>
              <button type="button" className="secondary-button" onClick={() => setModalOpen(false)}>
                關閉
              </button>
            </div>
            <form className="admin-modal-body form-grid" onSubmit={saveChannel}>
              <label className="form-field">
                <span>門市</span>
                <select value={form.storeId} onChange={(event) => updateForm("storeId", event.target.value)} disabled={Boolean(editing?.id)}>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>{getStoreLabel(store)}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Ownership Type</span>
                <select value={form.ownershipType} onChange={(event) => updateForm("ownershipType", event.target.value)}>
                  {OWNERSHIP_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="form-field">
                <span>LINE OA 名稱</span>
                <input value={form.lineOfficialAccountName} onChange={(event) => updateForm("lineOfficialAccountName", event.target.value)} placeholder="KINGWAY Test OA" />
              </label>
              <label className="form-field">
                <span>LINE OA ID</span>
                <input value={form.lineOfficialAccountId} onChange={(event) => updateForm("lineOfficialAccountId", event.target.value)} placeholder="@kingway" />
              </label>
              <label className="form-field">
                <span>Basic ID</span>
                <input value={form.lineBasicId} onChange={(event) => updateForm("lineBasicId", event.target.value)} placeholder="@kingway-test" />
              </label>
              <label className="form-field">
                <span>Channel ID</span>
                <input
                  value={form.lineChannelId}
                  onChange={(event) => updateForm("lineChannelId", event.target.value)}
                  placeholder={editing?.id ? form.lineChannelIdReadonly || "留空代表不變" : "2000000000-test"}
                />
              </label>
              <label className="form-field form-grid-full">
                <span>Channel Secret Ref</span>
                <input
                  value={form.lineChannelSecretRef}
                  onChange={(event) => updateForm("lineChannelSecretRef", event.target.value)}
                  placeholder={editing?.hasLineChannelSecretRef ? "已設定，留空代表不變" : "env:KINGWAY_KAOHSIUNG_LINE_CHANNEL_SECRET"}
                />
                <small className="muted-text">Channel Secret 原文請勿輸入，請輸入 secret ref，例如 env:KINGWAY_KAOHSIUNG_LINE_CHANNEL_SECRET。</small>
              </label>
              <label className="form-field form-grid-full">
                <span>Access Token Ref</span>
                <input
                  value={form.channelAccessTokenRef}
                  onChange={(event) => updateForm("channelAccessTokenRef", event.target.value)}
                  placeholder={editing?.hasChannelAccessTokenRef ? "已設定，留空代表不變" : "env:KINGWAY_KAOHSIUNG_LINE_CHANNEL_ACCESS_TOKEN"}
                />
                <small className="muted-text">Access Token 原文請勿輸入，請輸入 token ref，例如 env:KINGWAY_KAOHSIUNG_LINE_CHANNEL_ACCESS_TOKEN。</small>
              </label>
              <label className="form-field">
                <span>LIFF ID</span>
                <input value={form.liffId} onChange={(event) => updateForm("liffId", event.target.value)} placeholder="test-liff-id" />
              </label>
              <label className="form-field">
                <span>Webhook Path</span>
                <input value={form.webhookPath} onChange={(event) => updateForm("webhookPath", event.target.value)} placeholder="kingway-test-channel" required />
              </label>
              <label className="form-field form-grid-full">
                <span>Webhook URL Preview</span>
                <input value={form.webhookUrl} onChange={(event) => updateForm("webhookUrl", event.target.value)} placeholder="留空時由系統依 webhook path 產生" />
              </label>
              <label className="line-settings-toggle-card">
                <input type="checkbox" checked={Boolean(form.isPrimary)} onChange={(event) => updateForm("isPrimary", event.target.checked)} />
                <div>
                  <strong>主要 Channel</strong>
                  <p>同一門市只保留一個主要 Channel，其他會自動取消主要狀態。</p>
                </div>
              </label>
              <label className="line-settings-toggle-card">
                <input type="checkbox" checked={Boolean(form.enabled)} onChange={(event) => updateForm("enabled", event.target.checked)} />
                <div>
                  <strong>啟用設定</strong>
                  <p>此階段不會更換現有 webhook，也不會實際發送 LINE 訊息。</p>
                </div>
              </label>
              <div className="form-actions form-grid-full">
                <button type="button" className="secondary-button" onClick={() => setModalOpen(false)} disabled={saving}>
                  取消
                </button>
                <button type="submit" className="primary-button" disabled={saving || !canManageSettings}>
                  {saving ? "儲存中..." : "儲存 LINE Channel"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default StoreLineChannelsPage;
