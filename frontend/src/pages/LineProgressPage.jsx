import { useEffect, useState } from "react";
import liff from "@line/liff";
import { apiRequest } from "../lib/api";
import LinePhoneBindGate from "./LinePhoneBindGate";
import { resolveLineContext } from "../lib/lineContext";

const money = (v) => `NT$ ${Number(v || 0).toLocaleString()}`;


function RepairSteps({ status }) {
  const steps = [
    { key: "reserved", label: "接收" },
    { key: "checking", label: "檢查" },
    { key: "estimate_pending_approval", label: "報價" },
    { key: "repairing", label: "維修" },
    { key: "completed_waiting_pickup", label: "取車" }
  ];

  const order = {
    reserved: 0,
    checking: 1,
    estimate_pending_approval: 2,
    estimate_approved: 2,
    repairing: 3,
    completed_waiting_pickup: 4,
    picked_up: 4,
    completed: 4
  };

  const current = order[status] ?? 0;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(5, 1fr)",
      gap: 6,
      margin: "14px 0 8px"
    }}>
      {steps.map((step, index) => (
        <div
          key={step.key}
          style={{
            borderRadius: 12,
            padding: "8px 4px",
            textAlign: "center",
            fontSize: 13,
            fontWeight: 900,
            background: index <= current ? "#dcfce7" : "#f1f5f9",
            color: index <= current ? "#166534" : "#94a3b8"
          }}
        >
          {step.label}
        </div>
      ))}
    </div>
  );
}


export default function LineProgressPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileName, setProfileName] = useState("");
  const [lineUserId, setLineUserId] = useState("");
  const [lineContextFailureReason, setLineContextFailureReason] = useState("");
  const [lineInClient, setLineInClient] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const context = await resolveLineContext();
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
          return;
        }

        const response = await apiRequest(`/customer-status?q=${encodeURIComponent(context.lineUserId)}&displayName=${encodeURIComponent(context.displayName || "")}`);
        setData(response);
      } catch (e) {
        console.error(e);
        setLineContextFailureReason((current) => current || e.message || "讀取進度失敗");
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

  const orders = data?.orders || [];
  const repairs = data?.repairs || [];

  return (
    <div style={{ minHeight: "100vh", background: "#eef2f7", padding: 18, boxSizing: "border-box" }}>
      <div style={{ background: "#0f172a", color: "#fff", borderRadius: 28, padding: 24, marginBottom: 18 }}>
        <div style={{ color: "#22c55e", fontWeight: 900, letterSpacing: 3 }}>KINGWAY</div>
        <h1 style={{ margin: "12px 0 6px", fontSize: 34 }}>查詢進度</h1>
        <div style={{ color: "#cbd5e1" }}>KW_PROGRESS_V2｜您的訂單與維修狀態</div>
      </div>

      {loading ? (
        <Card>資料讀取中...</Card>
      ) : !data?.customer?.phone ? (
        <LinePhoneBindGate
          lineUserId={lineUserId}
          inClient={lineInClient}
          failureReason={lineContextFailureReason}
          onBound={(phone) => setData((current) => ({
            ...(current || {}),
            customer: { ...((current || {}).customer || {}), phone }
          }))}
        />
      ) : (
        <>
          <Card>
            <Title>{profileName || data.customer.name || "LINE 客戶"}</Title>
            <Row label="電話" value={data.customer.phone || "-"} />
          </Card>

          <Section>我的訂單</Section>
          {orders.length ? orders.slice(0, 10).map((o) => (
            <Card key={o.id}>
              <Title>{o.orderNo}</Title>
              <Row label="狀態" value={o.status || "-"} />
              <Row label="付款" value={o.finalPaymentStatus || "-"} />
              <Row label="總金額" value={money(o.totalAmount)} />
              <Row label="未付" value={money(o.unpaidBalance)} danger={Number(o.unpaidBalance || 0) > 0} />

              {Number(o.unpaidBalance || 0) > 0 ? (
                <a
                  href={`/support?orderNo=${encodeURIComponent(o.orderNo || "")}&type=payment`}
                  style={{
                    display: "block",
                    marginTop: 14,
                    padding: 14,
                    borderRadius: 16,
                    background: "#16a34a",
                    color: "#fff",
                    textDecoration: "none",
                    textAlign: "center",
                    fontSize: 17,
                    fontWeight: 900
                  }}
                >
                  聯繫門市付款
                </a>
              ) : null}
            </Card>
          )) : <Card>目前沒有訂單。</Card>}

          <Section>我的維修</Section>
          {repairs.length ? repairs.slice(0, 10).map((r) => (
            <Card key={r.id}>
              <Title>維修單 #{r.id}</Title>
              <Row label="車款" value={r.bikeModel || "-"} />
              <Row label="問題" value={r.issueDescription || "-"} />
              <RepairSteps status={r.status} />
              <Row label="狀態" value={r.status || "-"} />
              <Row label="報價" value={money(r.estimateAmount)} />
            </Card>
          )) : <Card>目前沒有維修紀錄。</Card>}
        </>
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

function Title({ children }) {
  return <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 10 }}>{children}</div>;
}

function Section({ children }) {
  return <h2 style={{ fontSize: 24, margin: "24px 0 12px" }}>{children}</h2>;
}

function Row({ label, value, danger }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: "1px solid #e5e7eb" }}>
      <span style={{ color: "#64748b" }}>{label}</span>
      <strong style={{ color: danger ? "#dc2626" : "#0f172a", textAlign: "right" }}>{value}</strong>
    </div>
  );
}
