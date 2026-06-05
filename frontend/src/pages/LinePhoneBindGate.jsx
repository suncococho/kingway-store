import { useState } from "react";
import { apiRequest } from "../lib/api";

const isLiffDebugVisible = (() => {
  if (typeof import.meta === "undefined" || !import.meta.env) {
    return false;
  }

  const values = [
    String(import.meta.env.MODE || ""),
    String(import.meta.env.VITE_NODE_ENV || ""),
    String(import.meta.env.NODE_ENV || ""),
    String(import.meta.env.VITE_APP_ENV || ""),
    String(typeof process !== "undefined" && process?.env?.NODE_ENV ? process.env.NODE_ENV : ""),
    String(typeof process !== "undefined" && process?.env?.APP_ENV ? process.env.APP_ENV : "")
  ].map((value) => value.trim().toLowerCase());

  return values.some((value) => value === "staging" || value === "staging_restore" || value === "production");
})();

function LinePhoneBindGate({
  lineUserId,
  onBound,
  title = "請先完成電話綁定",
  inClient = false,
  failureReason = "",
  lineContextDebug = null
}) {
  const [phone, setPhone] = useState("");
  const [binding, setBinding] = useState(false);
  const [error, setError] = useState("");

  const cleanPhonePreview = String(phone || "").replace(/\D/g, "");
  const canBind = /^09\d{8}$/.test(cleanPhonePreview);

  async function bindPhone() {
    setError("");
    const cleanPhone = String(phone || "").replace(/\D/g, "");
    const baseError = "無法取得 LINE 使用者資料。\n請回到 KINGWAY LINE 官方帳號，從選單重新開啟此頁面。";

    if (!lineUserId) {
      setError(
        inClient && failureReason
          ? `${baseError}\n原因：${failureReason}`
          : baseError
      );
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

      {error ? (
        <>
          <div className="error-banner" style={{ marginTop: 14 }}>{error}</div>

          {(isLiffDebugVisible && lineContextDebug) ? (
            <div style={{
              marginTop: 12,
              border: "1px solid #cbd5e1",
              borderRadius: 14,
              background: "#f8fafc",
              padding: 12,
              fontSize: 12,
              lineHeight: 1.5,
              overflow: "auto"
            }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>LIFF Debug</div>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
{JSON.stringify(
  {
    liffId: lineContextDebug.liffId || "",
    isInClient: Boolean(lineContextDebug.isInClient),
    isLoggedIn: Boolean(lineContextDebug.isLoggedIn),
    context: { userId: lineContextDebug.contextUserId || "" },
    profile: { userId: lineContextDebug.profileUserId || "" },
    lineUserId: lineContextDebug.recoveredLineUserId || "",
    failureReason: lineContextDebug.failureReason || ""
  },
  null,
  2
)}
              </pre>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export default LinePhoneBindGate;
