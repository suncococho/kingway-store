import { useEffect, useState } from "react";
import liff from "@line/liff";

const money = (v) => `NT$ ${Number(v || 0).toLocaleString()}`;

function couponTypeLabel(type) {
  if (type === "new_friend") return "新朋友優惠";
  if (type === "google_review") return "Google 評論優惠";
  return type || "優惠券";
}

function statusLabel(coupon) {
  if (coupon.isUsed) return "已使用";
  const map = {
    issued: "可使用",
    pending_approval: "審核中",
    approved: "已核准",
    rejected: "已拒絕",
    used: "已使用",
    expired: "已過期"
  };
  return map[coupon.status] || coupon.status || "-";
}

export default function LineCouponPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        await liff.init({ liffId: import.meta.env.VITE_LIFF_ID || "2010080463-s7I6a2BG" });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();
        const res = await fetch(`/api/customer-status?q=${encodeURIComponent(profile.userId)}`);
        setData(await res.json());
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  const closeLine = () => {
    try {
      if (liff.isInClient()) return liff.closeWindow();
    } catch (e) {}
    window.location.href = "https://line.me/R/";
  };

  const coupons = data?.coupons || [];

  return (
    <div style={{ minHeight: "100vh", background: "#eef2f7", padding: 18, boxSizing: "border-box" }}>
      <section style={{ background: "#0f172a", color: "#fff", borderRadius: 28, padding: 24, marginBottom: 18 }}>
        <div style={{ color: "#22c55e", fontWeight: 900, letterSpacing: 3 }}>KINGWAY</div>
        <h1 style={{ margin: "12px 0 6px", fontSize: 34 }}>優惠券中心</h1>
        <div style={{ color: "#cbd5e1" }}>查看您的可用優惠與審核狀態。</div>
      </section>

      {loading ? (
        <Card>資料讀取中...</Card>
      ) : !data?.customer ? (
        <Card>尚未找到綁定資料，請回到 LINE 留下電話。</Card>
      ) : coupons.length ? (
        coupons.map((c) => (
          <Card key={c.id}>
            <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 10 }}>
              {couponTypeLabel(c.couponType)}
            </div>
            <Row label="代碼" value={c.code} />
            <Row label="金額" value={money(c.amount)} danger={Number(c.amount || 0) >= 1000} />
            <Row label="狀態" value={statusLabel(c)} />
            <Row label="適用" value={c.eligibleCategory || "EBIKE"} />

            {c.status === "pending_approval" ? (
              <div style={{
                marginTop: 16,
                padding: 16,
                borderRadius: 18,
                background: "#fff7ed",
                border: "1px solid #fb923c",
                color: "#9a3412",
                fontWeight: 900
              }}>
                Google 評論優惠正在審核中，門市確認後會通知您。
              </div>
            ) : null}

            {!c.isUsed && (
              <div
                style={{
                  marginTop: 16,
                  padding: 16,
                  borderRadius: 18,
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0"
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: 8 }}>
                  使用說明
                </div>

                <div style={{ color: "#475569", lineHeight: 1.7 }}>
                  • 僅限電動自行車使用<br />
                  • 結帳前請出示此畫面<br />
                  • 每位客戶限使用一次<br />
                  • 不可兌換現金
                </div>
              </div>
            )}
          </Card>
        ))
      ) : (
        <Card>目前沒有優惠券。</Card>
      )}

      <button onClick={closeLine} style={{ width: "100%", marginTop: 20, padding: 18, border: 0, borderRadius: 22, background: "#06c755", color: "#fff", fontSize: 20, fontWeight: 900 }}>
        返回 LINE
      </button>
    </div>
  );
}

function Card({ children }) {
  return <section style={{ background: "#fff", borderRadius: 24, padding: 20, marginBottom: 16, boxShadow: "0 10px 28px rgba(15,23,42,.1)" }}>{children}</section>;
}

function Row({ label, value, danger }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: "1px solid #e5e7eb" }}>
      <span style={{ color: "#64748b" }}>{label}</span>
      <strong style={{ color: danger ? "#dc2626" : "#0f172a", textAlign: "right" }}>{value}</strong>
    </div>
  );
}
