import { useState } from "react";
import { apiRequest } from "../lib/api";

function LinePhoneBindGate({ lineUserId, onBound, title = "請先完成電話綁定" }) {
  const [phone, setPhone] = useState("");
  const [binding, setBinding] = useState(false);
  const [error, setError] = useState("");

  const cleanPhonePreview = String(phone || "").replace(/\D/g, "");
  const canBind = /^09\d{8}$/.test(cleanPhonePreview);

  async function bindPhone() {
    setError("");
    const cleanPhone = String(phone || "").replace(/\D/g, "");

    if (!lineUserId) {
      setError("缺少 LINE 使用者資料，請重新從 LINE 開啟。");
      return;
    }

    if (!/^09\d{8}$/.test(cleanPhone)) {
      setError("請輸入正確手機號碼，例如 0912345678");
      return;
    }

    try {
      setBinding(true);
      const data = await apiRequest("/line-bind-phone", {
        method: "POST",
        body: JSON.stringify({
          lineUserId,
          phone: cleanPhone
        })
      });

      onBound?.(cleanPhone, data);
    } catch (e) {
      setError(e.message || "電話綁定失敗");
    } finally {
      setBinding(false);
    }
  }

  return (
    <section className="line-customer-summary">
      <div className="line-customer-summary-title">{title}</div>
      <p style={{ lineHeight: 1.7 }}>
        完成綁定後，即可使用購買預約、維修預約、優惠券、購買確認書與訂單查詢服務。
      </p>

      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
        placeholder="請輸入手機號碼，例如 0912345678"
        inputMode="tel"
        style={{
          width: "100%",
          boxSizing: "border-box",
          border: "1px solid #cbd5e1",
          borderRadius: 18,
          padding: "16px 18px",
          fontSize: 18,
          marginTop: 12,
          marginBottom: 14
        }}
      />

      <button
        className="line-customer-close"
        type="button"
        onClick={bindPhone}
        disabled={binding || !canBind}
      >
        {binding ? "綁定中..." : "確認綁定"}
      </button>

      {error ? <div className="error-banner" style={{ marginTop: 14 }}>{error}</div> : null}
    </section>
  );
}

export default LinePhoneBindGate;
