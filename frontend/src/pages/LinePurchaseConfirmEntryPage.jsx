import { useEffect, useState } from "react";
import liff from "@line/liff";
import { apiRequest } from "../lib/api";

const LIFF_ID = import.meta.env.VITE_LIFF_ID || "2010080463-s7I6a2BG";

function LinePurchaseConfirmEntryPage() {
  const [message, setMessage] = useState("資料確認中...");

  useEffect(() => {
    async function init() {
      try {
        await liff.init({ liffId: LIFF_ID });
        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();
        const data = await apiRequest(`/line-purchase-confirm/entry?lineUserId=${encodeURIComponent(profile.userId)}`);

        if (data.status === "UNPAID") {
          setMessage("尚未完成付款，暫時不能填寫購買確認書。");
          return;
        }

        if (data.url) {
          window.location.href = data.url;
          return;
        }

        setMessage(data.message || "目前沒有可填寫的購買確認書。");
      } catch (error) {
        setMessage(error.message || "讀取購買確認書失敗");
      }
    }

    init();
  }, []);

  return (
    <div className="line-customer-page">
      <section className="line-customer-hero">
        <div className="line-customer-brand">KINGWAY</div>
        <h1>購買確認書</h1>
        <p>{message}</p>
      </section>
    </div>
  );
}

export default LinePurchaseConfirmEntryPage;
