import { useEffect, useState } from "react";
import liff from "@line/liff";
import { apiRequest } from "../lib/api";
import LinePhoneBindGate from "./LinePhoneBindGate";

const LIFF_ID = import.meta.env.VITE_LIFF_ID || "2010080463-s7I6a2BG";
const GOOGLE_REVIEW_URL = "https://www.google.com/search?q=KINGWAY+台南門市+Google+評論";

function LineGoogleReviewPage() {
  const [loading, setLoading] = useState(true);
  const [lineUserId, setLineUserId] = useState("");
  const [customer, setCustomer] = useState(null);
  const [profileName, setProfileName] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        await liff.init({ liffId: LIFF_ID });
        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();
        setLineUserId(profile.userId);
        setProfileName(profile.displayName || "");
        if (profile.userId && profile.displayName) {
          apiRequest("/line/profile-name", {
            method: "POST",
            body: JSON.stringify({
              lineUserId: profile.userId,
              displayName: profile.displayName
            })
          }).catch(() => {});
        }

        const data = await apiRequest(`/line-google-review/customer?lineUserId=${encodeURIComponent(profile.userId)}`);
        setCustomer(data.customer || null);
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
        <h1>Google 評論優惠</h1>
        <p>完成 Google 評論後，請回來點擊「我已完成評論」，門市會收到審核通知。</p>
      </section>

      {(!customer || !customer.phone) ? (
        <LinePhoneBindGate
          lineUserId={lineUserId}
          onBound={(phone) => setCustomer((current) => ({ ...(current || {}), phone }))}
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
          <div className="line-customer-summary-title">已送出審核</div>
          <p>門市確認 Google 評論後，系統會發放 Google 評論。</p>
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
