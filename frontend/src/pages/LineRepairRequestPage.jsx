import { useEffect, useState } from "react";
import liff from "@line/liff";
import { apiRequest } from "../lib/api";
import LinePhoneBindGate from "./LinePhoneBindGate";

const LIFF_ID = import.meta.env.VITE_LIFF_ID || "2010080463-s7I6a2BG";

function LineRepairRequestPage() {
  const [loading, setLoading] = useState(true);
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

        const data = await apiRequest(`/line-repair/customer?lineUserId=${encodeURIComponent(profile.userId)}`);
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

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");

    if (!customer?.id) {
      setError("尚未找到綁定資料，請先回 LINE 對話輸入手機號碼完成綁定。");
      return;
    }

    if (!form.bikeModel.trim()) {
      setError("請填寫車款 / 車種。");
      return;
    }

    if (!form.issueDescription.trim()) {
      setError("請填寫問題描述。");
      return;
    }

    try {
      await apiRequest("/line-repair/create", {
        method: "POST",
        body: JSON.stringify({
          lineUserId,
          bikeModel: form.bikeModel,
          reservationDate: form.reservationDate || null,
          issueDescription: form.issueDescription
        })
      });

      setDone(true);
    } catch (err) {
      setError(err.message || "送出失敗");
    }
  }

  if (loading) {
    return <div className="line-customer-page"><section className="line-customer-summary">資料讀取中...</section></div>;
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

          <form className="line-customer-summary" onSubmit={submit}>
        <label className="form-field">
          <span>車款 / 車種</span>
          <input value={form.bikeModel} onChange={(e) => update("bikeModel", e.target.value)} placeholder="例如 Fatbike / 電動自行車 / 車款名稱" />
        </label>

        <label className="form-field">
          <span>希望到店日期</span>
          <input type="date" value={form.reservationDate} onChange={(e) => update("reservationDate", e.target.value)} />
        </label>

        <label className="form-field">
          <span>問題描述</span>
          <textarea rows="5" value={form.issueDescription} onChange={(e) => update("issueDescription", e.target.value)} placeholder="請描述故障情況，例如無法啟動、煞車異音、電池問題、控制器問題等" />
        </label>

        <button className="line-customer-close" type="submit">送出維修預約</button>
          </form>
        </>
      )}
    </div>
  );
}

export default LineRepairRequestPage;
