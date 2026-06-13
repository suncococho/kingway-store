import { useEffect, useRef, useState } from "react";
import liff from "@line/liff";
import { apiRequest } from "../lib/api";
import { resolveLineContext } from "../lib/lineContext";
import LinePhoneBindGate from "./LinePhoneBindGate";
import {
  DEFAULT_LINE_BINDING_STORE_CODE,
  cacheLineCustomerToObject,
  fetchLineBindingSnapshot,
  getLineBindingCache,
  saveLineBindingCache
} from "../lib/lineBindingRecovery";

const LEGACY_STORE_CONTEXT = {
  storeId: 1,
  storeCode: "KINGWAY_TAINAN",
  storeName: "KINGWAY 台南",
  customerOaName: "KINGWAY 台南門市 LINE",
  isExplicitStore: false
};

function buildCustomerOaName(response, fallbackStoreName) {
  const configured = String(response?.lineSettings?.customerOaName || "").trim();
  if (configured) {
    return configured;
  }

  const baseName = String(response?.store?.storeName || fallbackStoreName || LEGACY_STORE_CONTEXT.storeName).trim();
  return baseName ? `${baseName} LINE` : LEGACY_STORE_CONTEXT.customerOaName;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function isPlaceholderCustomerName(value) {
  const normalized = normalizeText(value);
  return !normalized || normalized === "LINE 客戶" || normalized === "LINE Customer";
}

function resolveDisplayName(profileName, customerName) {
  const normalizedProfile = normalizeText(profileName);
  if (normalizedProfile) {
    return normalizedProfile;
  }

  const normalizedCustomer = normalizeText(customerName);
  if (normalizedCustomer && !isPlaceholderCustomerName(normalizedCustomer)) {
    return normalizedCustomer;
  }

  return "LINE 客戶";
}

function LineRepairRequestPage() {
  const [loading, setLoading] = useState(true);
  const [storeLoading, setStoreLoading] = useState(true);
  const [storeContext, setStoreContext] = useState(LEGACY_STORE_CONTEXT);
  const [storeError, setStoreError] = useState("");
  const [customer, setCustomer] = useState(null);
  const [profileName, setProfileName] = useState("");
  const [lineUserId, setLineUserId] = useState("");
  const [form, setForm] = useState({
    bikeModel: "",
    reservationDate: "",
    issueDescription: ""
  });
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const [lineContextFailureReason, setLineContextFailureReason] = useState("");
  const [lineInClient, setLineInClient] = useState(false);
  const [lineContextDebug, setLineContextDebug] = useState({
    inClient: false,
    isLoggedIn: false,
    liffId: "",
    contextUserId: "",
    profileUserId: "",
    recoveredLineUserId: ""
  });

  useEffect(() => {
    async function loadStoreContext() {
      const params = new URLSearchParams(window.location.search);
      const storeCode = String(params.get("store") || "").trim();

      if (!storeCode) {
        setStoreContext(LEGACY_STORE_CONTEXT);
        setStoreError("");
        setStoreLoading(false);
        return LEGACY_STORE_CONTEXT;
      }

      try {
        const response = await apiRequest(`/storefront/resolve-store?store=${encodeURIComponent(storeCode)}`);
        const nextStoreContext = {
          storeId: Number(response?.store?.storeId || 0) || LEGACY_STORE_CONTEXT.storeId,
          storeCode: response?.store?.storeCode || storeCode,
          storeName: response?.store?.storeName || LEGACY_STORE_CONTEXT.storeName,
          customerOaName: buildCustomerOaName(response, response?.store?.storeName),
          isExplicitStore: true
        };
        setStoreContext(nextStoreContext);
        setStoreError("");
        return nextStoreContext;
      } catch (resolveError) {
        setStoreError(resolveError.message || "找不到有效的門市資訊");
        return null;
      } finally {
        setStoreLoading(false);
      }
    }

    async function init() {
      const resolvedStoreContext = await loadStoreContext();
      if (!resolvedStoreContext) {
        setLoading(false);
        return;
      }

      try {
        const context = await resolveLineContext();
        setLineContextDebug({
          inClient: Boolean(context.inClient),
          isLoggedIn: Boolean(context.isLoggedIn),
          liffId: context.liffId || "",
          contextUserId: context.contextUserId || "",
          profileUserId: context.profileUserId || "",
          recoveredLineUserId: context.lineUserId || "",
          failureReason: context.failureReason || ""
        });
        setLineContextFailureReason(context.failureReason || "");
        setLineInClient(Boolean(context.inClient));

        if (!context.isLoggedIn || context.shouldLogin) {
          return;
        }

        setLineUserId(context.lineUserId || "");
        setProfileName(context.displayName || "");
        if (context.lineUserId && context.displayName) {
          apiRequest("/line/profile-name", {
            method: "POST",
            body: JSON.stringify({
              lineUserId: context.lineUserId,
              displayName: context.displayName
            })
          }).catch(() => {});
        }

        if (!context.lineUserId) {
          const cachedBinding = context.inClient ? getLineBindingCache() : null;
          const cachedLineUserId = cachedBinding?.lineUserId || "";
          if (!cachedLineUserId) {
            return;
          }

          setLineUserId(cachedLineUserId);
          const cachedCustomer = cacheLineCustomerToObject(cachedBinding);
          if (cachedCustomer) {
            setCustomer(cachedCustomer);
          }
          return;
        }

        const storeCode = resolvedStoreContext.isExplicitStore
          ? resolvedStoreContext.storeCode
          : DEFAULT_LINE_BINDING_STORE_CODE;
        const data = await fetchLineBindingSnapshot({
          lineUserId: context.lineUserId,
          displayName: context.displayName || "",
          endpoint: "/line-repair/customer",
          storeCode
        });

        if (data?.customer) {
          setCustomer(data.customer || null);
          saveLineBindingCache({
            lineUserId: context.lineUserId,
            customer: data.customer,
            storeCode
          });
        } else {
          const cachedCustomer = cacheLineCustomerToObject(
            getLineBindingCache(context.lineUserId)
          );
          if (cachedCustomer) {
            setCustomer(cachedCustomer);
          }
        }
      } catch (err) {
        if (String(err.message || "").includes("access token expired")) {
          try { liff.logout(); } catch (e) {}
          liff.login();
          return;
        }
        setError(err.message || "讀取客戶資料失敗");
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();

    if (submitLockRef.current) {
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setError("");

    if (!customer?.id) {
      setError("尚未找到綁定資料，請先回 LINE 對話輸入手機號碼完成綁定。");
      setSubmitting(false);
      submitLockRef.current = false;
      return;
    }

    if (!form.bikeModel.trim()) {
      setError("請填寫車款 / 車種。");
      setSubmitting(false);
      submitLockRef.current = false;
      return;
    }

    if (!form.issueDescription.trim()) {
      setError("請填寫問題描述。");
      setSubmitting(false);
      submitLockRef.current = false;
      return;
    }

    try {
      const storeQuery = storeContext.isExplicitStore
        ? `?store=${encodeURIComponent(storeContext.storeCode)}`
        : "";
      await apiRequest(`/line-repair/create${storeQuery}`, {
        method: "POST",
        body: JSON.stringify({
          lineUserId,
          displayName: profileName,
          bikeModel: form.bikeModel,
          reservationDate: form.reservationDate || null,
          issueDescription: form.issueDescription,
          storeCode: storeContext.isExplicitStore ? storeContext.storeCode : undefined
        })
      });

      setDone(true);
    } catch (err) {
      setError(err.message || "送出失敗");
      setSubmitting(false);
      submitLockRef.current = false;
    }
  }

  if (loading) {
    return (
      <div className="line-customer-page">
        {!storeLoading ? (
          <section className="line-customer-summary">
            <div className="line-customer-summary-title">{storeError ? "門市資訊" : storeContext.storeName}</div>
            <div>{storeError ? storeError : storeContext.customerOaName}</div>
          </section>
        ) : null}
        <section className="line-customer-summary">資料讀取中...</section>
      </div>
    );
  }

  if (done) {
    return (
      <div className="line-customer-page">
        <section className="line-customer-hero">
          <div className="line-customer-brand">KINGWAY</div>
          <h1>維修預約已送出</h1>
          <p>門市收到後會確認內容，並透過 LINE 或電話與您聯繫。</p>
        </section>
        <button className="line-customer-close" onClick={() => liff.isInClient() ? liff.closeWindow() : window.location.href = "/line-customer"}>
          關閉
        </button>
      </div>
    );
  }

  return (
    <div className="line-customer-page">
      <section className="line-customer-hero">
        <div className="line-customer-brand">KINGWAY</div>
        <h1>維修預約</h1>
        <p>請填寫車款、希望到店日期與問題描述。</p>
      </section>

      {!storeLoading ? (
        <section className="line-customer-summary">
          <div className="line-customer-summary-title">{storeError ? "門市資訊" : storeContext.storeName}</div>
          <div>{storeError ? storeError : `目前 OA：${storeContext.customerOaName}`}</div>
        </section>
      ) : null}

      {storeError ? null : (!customer || !customer.phone) ? (
        <LinePhoneBindGate
          lineUserId={lineUserId}
          displayName={profileName}
          inClient={lineInClient}
          failureReason={lineContextFailureReason}
          lineContextDebug={lineContextDebug}
          onBound={async (phone) => {
            const storeCode = storeContext.isExplicitStore ? storeContext.storeCode : DEFAULT_LINE_BINDING_STORE_CODE;
            const restored = await fetchLineBindingSnapshot({
              lineUserId,
              displayName: profileName,
              endpoint: "/line-repair/customer",
              storeCode
            });

            if (restored?.customer) {
              setCustomer(restored.customer);
              saveLineBindingCache({
                lineUserId,
                customer: restored.customer,
                storeCode
              });
              return;
            }

            setCustomer((current) => {
              const next = { ...(current || {}), phone };
              saveLineBindingCache({
                lineUserId,
                customer: next,
                storeCode
              });
              return next;
            });
          }}
        />
      ) : (
          <>
          <section className="line-customer-summary">
            <div className="line-customer-summary-title">{resolveDisplayName(profileName, customer?.name)}</div>
            <div>電話：<strong>{customer?.phone}</strong></div>
          </section>

          {error ? <div className="error-banner">{error}</div> : null}
          {submitting ? (
            <section className="line-customer-summary">
              <div className="line-customer-summary-title">正在送出維修預約，請不要重複點擊</div>
              <div>請稍候，我們正在建立您的預約</div>
            </section>
          ) : null}

          <form className="line-customer-summary" onSubmit={submit}>
        <label className="form-field">
          <span>車款 / 車種</span>
          <input value={form.bikeModel} onChange={(e) => update("bikeModel", e.target.value)} placeholder="例如 Fatbike / 電動自行車 / 車款名稱" disabled={submitting} />
        </label>

        <label className="form-field">
          <span>希望到店日期</span>
          <input type="date" value={form.reservationDate} onChange={(e) => update("reservationDate", e.target.value)} disabled={submitting} />
        </label>

        <label className="form-field">
          <span>問題描述</span>
          <textarea rows="5" value={form.issueDescription} onChange={(e) => update("issueDescription", e.target.value)} placeholder="請描述故障情況，例如無法啟動、煞車異音、電池問題、控制器問題等" disabled={submitting} />
        </label>

        <button className="line-customer-close" type="submit" disabled={submitting}>
          {submitting ? "預約送出中..." : "送出維修預約"}
        </button>
          </form>
        </>
      )}
    </div>
  );
}

export default LineRepairRequestPage;
