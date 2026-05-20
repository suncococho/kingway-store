import { useEffect, useState } from "react";
import liff from "@line/liff";
import LinePhoneBindGate from "./LinePhoneBindGate";

const money = (v) => `NT$ ${Number(v || 0).toLocaleString()}`;

export default function LineCustomerPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileName, setProfileName] = useState("");
  const [lineUserId, setLineUserId] = useState("");

  const closeLine = () => {
    try {
      if (liff.isInClient()) {
        liff.closeWindow();
        return;
      }
    } catch (e) {}
    window.location.href = "https://line.me/R/";
  };

  useEffect(() => {
    async function init() {
      try {
        await liff.init({
          liffId: import.meta.env.VITE_LIFF_ID || "2010080463-s7I6a2BG"
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();
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
        setLineUserId(profile.userId);
        const res = await fetch(`/api/customer-status?q=${encodeURIComponent(profile.userId)}&displayName=${encodeURIComponent(profile.displayName || "")}`);
        const json = await res.json();
        setData(json);
      } catch (e) {
        console.error(e);
        setData(null);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  const latestOrder = data?.orders?.[0];
  const latestRepair = data?.repairs?.[0];

  return (
    <div className="line-customer-page">
      <section className="line-customer-hero">
        <div className="line-customer-brand">KINGWAY</div>
        <h1>客戶中心</h1>
        <p>訂單、維修、優惠與客服都在這裡。</p>
      </section>

      {loading ? (
        <section className="line-customer-summary">資料讀取中...</section>
      ) : !data?.customer?.phone ? (
        <LinePhoneBindGate
          lineUserId={lineUserId}
          onBound={(phone) => setData((current) => ({
            ...(current || {}),
            customer: { ...((current || {}).customer || {}), phone }
          }))}
        />
      ) : !data?.customer?.phone ? (
        <LinePhoneBindGate
          lineUserId={lineUserId}
          onBound={(phone) => setData((current) => ({
            ...(current || {}),
            customer: { ...((current || {}).customer || {}), phone }
          }))}
        />
      ) : data?.customer ? (
        <section className="line-customer-summary">
          <div className="line-customer-summary-title">{profileName || data.customer.name || "LINE 客戶"}</div>
          <div className="line-customer-info-row">電話 <strong>{data.customer.phone || "-"}</strong></div>
          <div className="line-customer-info-row">最近訂單 <strong>{latestOrder?.orderNo || "目前沒有訂單"}</strong></div>
          <div className="line-customer-info-row">最近維修 <strong>{latestRepair ? `#${latestRepair.id} ${latestRepair.status}` : "目前沒有維修"}</strong></div>
          {latestOrder ? (
            <div className="line-customer-info-row danger">未付金額 <strong>{money(latestOrder.unpaidBalance)}</strong></div>
          ) : null}
        </section>
      ) : (
        <section className="line-customer-summary">
          尚未找到綁定資料。請先完成 LINE 電話綁定或聯繫門市協助。
        </section>
      )}

      <section className="line-customer-menu">
        <a href="/line-progress" className="line-customer-item">查詢進度</a>
        <a href="/line-order" className="line-customer-item">電動自行車預約</a>
        <a href="/repair-reservation" className="line-customer-item">維修預約</a>
        <a href="/purchase-confirm/manual" className="line-customer-item">購買確認書</a>
        <a href="/google-review" className="line-customer-item">Google 評論優惠</a>
        <a href="/coupon-center" className="line-customer-item">優惠券中心</a>
        <a href="/store-info" className="line-customer-item">門市資訊</a>
        <a href="/support" className="line-customer-item">客服協助</a>
      </section>

      <button type="button" className="line-customer-close" onClick={closeLine}>
        返回 LINE
      </button>
    </div>
  );
}
