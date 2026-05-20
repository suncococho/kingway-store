import { useEffect, useState } from "react";
import liff from "@line/liff";

export default function LineSupportPage() {
  const params = new URLSearchParams(window.location.search);
  const orderNo = params.get("orderNo") || "";
  const type = params.get("type") || "support";

  const [lineUserId, setLineUserId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState(
    type === "payment" && orderNo ? `我想詢問訂單 ${orderNo} 的付款方式。` : ""
  );
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function init() {
      try {
        await liff.init({ liffId: import.meta.env.VITE_LIFF_ID || "2010080463-s7I6a2BG" });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();
        setLineUserId(profile.userId || "");

        const res = await fetch(`/api/line-order/customer?lineUserId=${encodeURIComponent(profile.userId)}`);
        const json = res.ok ? await res.json() : null;

        if (json?.customer) {
          setName(json.customer.name || profile.displayName || "");
          setPhone(json.customer.phone || "");
        } else {
          setName(profile.displayName || "");
        }
      } catch (e) {
        console.error(e);
      }
    }

    init();
  }, []);

  async function submit() {
    setError("");

    if (!message.trim()) {
      setError("請輸入您的需求");
      return;
    }

    try {
      const res = await fetch("/api/line-support/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineUserId,
          name,
          phone,
          orderNo,
          type,
          message: message.trim()
        })
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json.message || "送出失敗");
      }

      setDone(true);

      setTimeout(() => {
        try {
          if (liff.isInClient()) {
            liff.closeWindow();
            return;
          }
        } catch (e) {}
        window.location.href = "https://line.me/R/";
      }, 1200);
    } catch (e) {
      setError(e.message || "送出失敗");
    }
  }

  const closeLine = () => {
    try {
      if (liff.isInClient()) return liff.closeWindow();
    } catch (e) {}
    window.location.href = "https://line.me/R/";
  };

  return (
    <div style={{ minHeight: "100vh", background: "#eef2f7", padding: 18, boxSizing: "border-box" }}>
      <section style={{ background: "#0f172a", color: "#fff", borderRadius: 28, padding: 24, marginBottom: 18 }}>
        <div style={{ color: "#22c55e", fontWeight: 900, letterSpacing: 3 }}>KINGWAY</div>
        <h1 style={{ margin: "12px 0 6px", fontSize: 34 }}>客服協助</h1>
        <div style={{ color: "#cbd5e1" }}>請留下需求，門市人員會協助您。</div>
      </section>

      {done ? (
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>已送出</h2>
          <p>我們已收到您的通知，門市人員會盡快協助。</p>
          <button onClick={closeLine} style={greenButton}>返回 LINE</button>
        </section>
      ) : (
        <section style={cardStyle}>
          {orderNo ? <Info label="訂單" value={orderNo} /> : null}

          <label style={labelStyle}>姓名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />

          <label style={labelStyle}>電話</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />

          <label style={labelStyle}>需求內容</label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} style={textareaStyle} />

          {error ? <div style={{ color: "#dc2626", fontWeight: 900, marginBottom: 12 }}>{error}</div> : null}

          <button onClick={submit} style={greenButton}>送出給門市</button>
        </section>
      )}
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #e5e7eb", marginBottom: 14 }}>
      <span style={{ color: "#64748b" }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const cardStyle = {
  background: "#fff",
  borderRadius: 24,
  padding: 20,
  boxShadow: "0 10px 28px rgba(15,23,42,.1)"
};

const labelStyle = {
  display: "block",
  margin: "14px 0 8px",
  fontWeight: 900,
  color: "#0f172a"
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #cbd5e1",
  borderRadius: 16,
  padding: 14,
  fontSize: 16
};

const textareaStyle = {
  ...inputStyle,
  resize: "vertical"
};

const greenButton = {
  width: "100%",
  border: 0,
  borderRadius: 18,
  padding: 16,
  background: "#06c755",
  color: "#fff",
  fontSize: 18,
  fontWeight: 900
};
