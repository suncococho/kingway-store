import { useEffect, useState } from "react";
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

const GOOGLE_REVIEW_URL = "https://www.google.com/search?q=KINGWAY+台南門市+Google+評論";

function LineGoogleReviewPage() {
  const [loading, setLoading] = useState(true);
  const [lineUserId, setLineUserId] = useState("");
  const [customer, setCustomer] = useState(null);
  const [profileName, setProfileName] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
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
    async function init() {
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

        const data = await fetchLineBindingSnapshot({
          lineUserId: context.lineUserId,
          displayName: context.displayName || "",
          endpoint: "/line-google-review/customer",
          storeCode: DEFAULT_LINE_BINDING_STORE_CODE
        });
        if (data?.customer) {
          setCustomer(data.customer || null);
          saveLineBindingCache({
            lineUserId: context.lineUserId,
            customer: data.customer,
            storeCode: DEFAULT_LINE_BINDING_STORE_CODE
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

  async function submitReviewDone() {
    setError("");

    if (!customer?.id) {
      setError("尚未找到綁定資料，請先回 LINE 對話輸入手機號碼完成綁定。");
      return;
    }

    try {
      await apiRequest("/line-google-review/request", {
        method: "POST",
        body: JSON.stringify({ lineUserId })
      });
      setDone(true);
    } catch (err) {
      setError(err.message || "送出失敗");
    }
  }

  if (loading) {
    return <div className="line-customer-page"><section className="line-customer-summary">資料讀取中...</section></div>;
  }

  return (
    <div className="line-customer-page">
      <section className="line-customer-hero">
        <div className="line-customer-brand">KINGWAY</div>
        <h1>Google 評論確認</h1>
        <p>完成 Google 評論後，請回來點擊「我已完成評論」，門市將確認您的回饋。</p>
      </section>

      {(!customer || !customer.phone) ? (
        <LinePhoneBindGate
          lineUserId={lineUserId}
          inClient={lineInClient}
          failureReason={lineContextFailureReason}
          lineContextDebug={lineContextDebug}
          onBound={async (phone) => {
            const restored = await fetchLineBindingSnapshot({
              lineUserId,
              displayName: profileName,
              endpoint: "/line-google-review/customer",
              storeCode: DEFAULT_LINE_BINDING_STORE_CODE
            });

            if (restored?.customer) {
              setCustomer(restored.customer);
              saveLineBindingCache({
                lineUserId,
                customer: restored.customer,
                storeCode: DEFAULT_LINE_BINDING_STORE_CODE
              });
              return;
            }

            setCustomer((current) => {
              const next = { ...(current || {}), phone };
              saveLineBindingCache({
                lineUserId,
                customer: next,
                storeCode: DEFAULT_LINE_BINDING_STORE_CODE
              });
              return next;
            });
          }}
        />
      ) : (
        <>
          <section className="line-customer-summary">
            <div className="line-customer-summary-title">{profileName || customer?.name || "LINE 客戶"}</div>
            <div>電話：<strong>{customer?.phone}</strong></div>
          </section>

          {error ? <div className="error-banner">{error}</div> : null}

          {done ? (
        <section className="line-customer-summary">
          <div className="line-customer-summary-title">已送出評論紀錄</div>
          <p>感謝您的評論，門市將確認您的回饋。</p>
        </section>
      ) : (
        <section className="line-customer-summary">
          <a className="line-customer-close" href={GOOGLE_REVIEW_URL} target="_blank" rel="noreferrer">
            前往 Google 評論
          </a>

          <button className="line-customer-close" type="button" onClick={submitReviewDone}>
            我已完成評論
          </button>
        </section>
          )}
        </>
      )}
    </div>
  );
}

export default LineGoogleReviewPage;
