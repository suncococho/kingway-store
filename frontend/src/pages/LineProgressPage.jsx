import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import liff from "@line/liff";
import { apiRequest } from "../lib/api";
import LinePhoneBindGate from "./LinePhoneBindGate";
import { resolveLineContext } from "../lib/lineContext";
import { formatOrderStatus, formatPaymentStatus, formatRepairStatus } from "../lib/display";
import {
  DEFAULT_LINE_BINDING_STORE_CODE,
  cacheLineCustomerToObject,
  fetchLineBindingSnapshot,
  getLineBindingCache,
  saveLineBindingCache
} from "../lib/lineBindingRecovery";

const money = (v) => `NT$ ${Number(v || 0).toLocaleString()}`;

function normalizeText(value) {
  return String(value || "").trim();
}

function isPlaceholderCustomerName(value) {
  const normalized = normalizeText(value);
  return !normalized || normalized === "LINE 客戶" || normalized === "LINE Customer";
}

function resolveDisplayName(profileName, customerName) {
  const normalizedProfile = normalizeText(profileName);
  if (normalizedProfile) {
    return normalizedProfile;
  }

  const normalizedCustomer = normalizeText(customerName);
  if (normalizedCustomer && !isPlaceholderCustomerName(normalizedCustomer)) {
    return normalizedCustomer;
  }

  return "LINE 客戶";
}


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

function getQuoteStatus(repair) {
  const value = String(repair?.quoteStatus || "").trim().toUpperCase();
  if (["PENDING", "APPROVED", "REJECTED", "FAILED", "NONE"].includes(value)) {
    return value;
  }
  const response = String(repair?.customerEstimateResponse || "").trim();
  if (response === "approved") return "APPROVED";
  if (response === "rejected") return "REJECTED";
  if (repair?.status === "estimate_pending_approval" || Number(repair?.estimateAmount || 0) > 0) return "PENDING";
  return "NONE";
}

function getRepairConfirmationStatus(repair) {
  const value = String(repair?.repairConfirmationStatus || "NONE").trim().toUpperCase();
  return ["PENDING", "COMPLETED", "CANCELED"].includes(value) ? value : "NONE";
}

function isRepairCompleted(repair) {
  const status = String(repair?.status || "").trim();
  return ["completed_waiting_pickup", "picked_up", "completed"].includes(status) || Boolean(repair?.completedAt || repair?.pickedUpAt);
}

function isRepairPaid(repair) {
  const status = String(repair?.finalPaymentStatus || repair?.orderPaymentStatus || repair?.paymentStatus || "").trim().toUpperCase();
  return ["PAID", "FULLY_PAID", "COMPLETED", "已付款", "已付清"].includes(status);
}

function ActionButton({ children, onClick, disabled, tone = "primary" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        padding: 14,
        border: 0,
        borderRadius: 16,
        background: disabled ? "#94a3b8" : tone === "danger" ? "#dc2626" : "#16a34a",
        color: "#fff",
        fontSize: 16,
        fontWeight: 900,
        marginTop: 10
      }}
    >
      {children}
    </button>
  );
}

function NoticeBlock({ children, tone = "info" }) {
  const colors = tone === "danger"
    ? { background: "#fef2f2", border: "#fecaca", color: "#991b1b" }
    : tone === "success"
      ? { background: "#f0fdf4", border: "#bbf7d0", color: "#166534" }
      : { background: "#f8fafc", border: "#dbeafe", color: "#0f172a" };
  return (
    <div style={{
      marginTop: 12,
      padding: 14,
      borderRadius: 18,
      background: colors.background,
      border: `1px solid ${colors.border}`,
      color: colors.color
    }}>
      {children}
    </div>
  );
}


export default function LineProgressPage() {
  const location = useLocation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileName, setProfileName] = useState("");
  const [lineUserId, setLineUserId] = useState("");
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
  const [quoteSubmitting, setQuoteSubmitting] = useState({});
  const [quoteMessage, setQuoteMessage] = useState({});

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
            setData({ customer: cachedCustomer, orders: [], repairs: [] });
          }
          return;
        }

        const response = await fetchLineBindingSnapshot({
          lineUserId: context.lineUserId,
          displayName: context.displayName || "",
          endpoint: "/line-order/customer",
          storeCode: DEFAULT_LINE_BINDING_STORE_CODE
        });

        setData(response || { customer: null, orders: [], repairs: [] });
        if (response?.customer) {
          saveLineBindingCache({
            lineUserId: context.lineUserId,
            customer: response.customer,
            storeCode: DEFAULT_LINE_BINDING_STORE_CODE
          });
        } else {
          const cachedCustomer = cacheLineCustomerToObject(
            getLineBindingCache(context.lineUserId)
          );
          if (cachedCustomer) {
            setData({ customer: cachedCustomer, orders: [], repairs: [] });
          }
        }
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

  async function respondQuote(repair, approved) {
    if (!repair?.id || !lineUserId) {
      setQuoteMessage((current) => ({
        ...current,
        [repair?.id || "unknown"]: "請先完成 LINE 身分確認後再回覆報價。"
      }));
      return;
    }

    setQuoteSubmitting((current) => ({ ...current, [repair.id]: true }));
    setQuoteMessage((current) => ({ ...current, [repair.id]: "" }));

    try {
      const response = await apiRequest(`/line-repair/${repair.id}/quote/${approved ? "approve" : "reject"}`, {
        method: "POST",
        body: JSON.stringify({
          lineUserId,
          storeCode: DEFAULT_LINE_BINDING_STORE_CODE
        })
      });

      setData((current) => ({
        ...(current || {}),
        repairs: (current?.repairs || []).map((item) => (
          String(item.id) === String(repair.id)
            ? {
                ...item,
                quoteStatus: response?.quoteStatus || (approved ? "APPROVED" : "REJECTED"),
                customerEstimateResponse: approved ? "approved" : "rejected"
              }
            : item
        ))
      }));
      setQuoteMessage((current) => ({
        ...current,
        [repair.id]: response?.message || (approved ? "已同意維修報價" : "已拒絕維修報價")
      }));
    } catch (error) {
      setQuoteMessage((current) => ({
        ...current,
        [repair.id]: error.message || "報價回覆失敗，請稍後再試或聯繫門市。"
      }));
    } finally {
      setQuoteSubmitting((current) => ({ ...current, [repair.id]: false }));
    }
  }

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
          displayName={profileName}
          inClient={lineInClient}
          failureReason={lineContextFailureReason}
          lineContextDebug={lineContextDebug}
          onBound={async (phone) => {
            const restored = await fetchLineBindingSnapshot({
              lineUserId,
              displayName: profileName,
              endpoint: "/line-order/customer",
              storeCode: DEFAULT_LINE_BINDING_STORE_CODE
            });

            if (restored?.customer) {
              setData(restored);
              saveLineBindingCache({
                lineUserId: lineUserId || restored.customer.lineUserId,
                customer: restored.customer,
                storeCode: DEFAULT_LINE_BINDING_STORE_CODE
              });
              return;
            }

            setData((current) => {
              const next = {
                ...(current || {}),
                customer: {
                  ...((current || {}).customer || {}),
                  phone,
                  lineUserId
                }
              };
              saveLineBindingCache({
                lineUserId,
                customer: next.customer,
                storeCode: DEFAULT_LINE_BINDING_STORE_CODE
              });
              return next;
            });
          }}
        />
      ) : (
        <>
          <Card>
            <Title>{resolveDisplayName(profileName, data.customer?.name)}</Title>
            <Row label="電話" value={data.customer.phone || "-"} />
          </Card>

          {(() => {
            const query = new URLSearchParams(location.search);
            const tab = query.get("tab");
            const focusRepairId = query.get("repairId");
            const showOrders = tab !== "repair";
            const showRepairs = tab !== "order";
            const visibleOrders = showOrders ? orders.slice(0, 10) : [];
            const orderedRepairs = focusRepairId
              ? [
                  ...repairs.filter((repair) => String(repair.id) === String(focusRepairId)),
                  ...repairs.filter((repair) => String(repair.id) !== String(focusRepairId))
                ]
              : repairs;
            const visibleRepairs = showRepairs ? orderedRepairs.slice(0, 10) : [];

            return (
              <>
                {showOrders ? (
                  <>
                    <Section>我的訂單</Section>
                    {visibleOrders.length ? visibleOrders.map((o) => (
                      <Card key={o.id}>
                        <Title>{o.orderNo}</Title>
                        <Row label="訂單狀態" value={formatOrderStatus(o.status)} />
                        <Row label="付款狀態" value={formatPaymentStatus(o.finalPaymentStatus)} />
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
                  </>
                ) : null}

                {showRepairs ? (
                  <>
                    <Section>我的維修</Section>
                    {visibleRepairs.length ? visibleRepairs.map((r) => (
                      <Card key={r.id}>
                        <Title>維修單 #{r.id}</Title>
                        <Row label="車款" value={r.bikeModel || "-"} />
                        <Row label="問題" value={r.issueDescription || "-"} />
                        <RepairSteps status={r.status} />
                        <Row label="維修狀態" value={formatRepairStatus(r.status)} />
                        <Row label="報價" value={money(r.estimateAmount)} />
                        <QuoteConfirmationBlock
                          repair={r}
                          submitting={Boolean(quoteSubmitting[r.id])}
                          message={quoteMessage[r.id]}
                          onApprove={() => respondQuote(r, true)}
                          onReject={() => respondQuote(r, false)}
                        />
                        <RepairConfirmationBlock repair={r} />
                      </Card>
                    )) : <Card>目前沒有維修紀錄。</Card>}
                  </>
                ) : null}
              </>
            );
          })()}
        </>
      )}

      <button onClick={closeLine} style={{ width: "100%", marginTop: 20, padding: 18, border: 0, borderRadius: 22, background: "#06c755", color: "#fff", fontSize: 20, fontWeight: 900 }}>
        返回 LINE
      </button>
    </div>
  );
}

function QuoteConfirmationBlock({ repair, submitting, message, onApprove, onReject }) {
  const [expanded, setExpanded] = useState(false);
  const status = getQuoteStatus(repair);
  const amount = Number(repair?.estimateAmount || 0);
  const showPendingActions = status === "PENDING" || status === "FAILED";
  const showQuoteContent = expanded || showPendingActions;

  if (status === "NONE" && amount <= 0) {
    return (
      <NoticeBlock>
        <strong>維修報價確認</strong>
        <div style={{ marginTop: 6 }}>尚未產生維修報價</div>
      </NoticeBlock>
    );
  }

  return (
    <NoticeBlock tone={status === "FAILED" ? "danger" : status === "APPROVED" ? "success" : "info"}>
      <strong>維修報價確認</strong>
      {status === "FAILED" ? (
        <div style={{ marginTop: 6 }}>LINE 報價通知發送失敗，但您仍可在此確認報價。</div>
      ) : null}
      {showQuoteContent ? (
        <>
          <div style={{ marginTop: 8 }}>報價金額：<strong>{money(amount)}</strong></div>
          {repair?.estimateNote || repair?.estimateDescription ? (
            <div style={{ marginTop: 6, color: "#475569" }}>{repair.estimateNote || repair.estimateDescription}</div>
          ) : null}
        </>
      ) : null}
      {showPendingActions ? (
        <>
          <div style={{ marginTop: 6 }}>請確認本次維修報價，並選擇是否同意維修。</div>
          {!expanded ? (
            <ActionButton onClick={() => setExpanded(true)} disabled={submitting}>
              確認維修報價
            </ActionButton>
          ) : (
            <>
              <ActionButton onClick={onApprove} disabled={submitting}>
                {submitting ? "處理中..." : "同意維修報價"}
              </ActionButton>
              <ActionButton onClick={onReject} disabled={submitting} tone="danger">
                暫不維修
              </ActionButton>
            </>
          )}
        </>
      ) : null}
      {status === "APPROVED" ? (
        <>
          <div style={{ marginTop: 8 }}>已同意維修報價</div>
          {!expanded ? <ActionButton onClick={() => setExpanded(true)}>查看報價內容</ActionButton> : null}
        </>
      ) : null}
      {status === "REJECTED" ? (
        <>
          <div style={{ marginTop: 8 }}>已拒絕維修報價 / 暫不維修</div>
          {!expanded ? <ActionButton onClick={() => setExpanded(true)}>查看報價內容</ActionButton> : null}
        </>
      ) : null}
      {message ? <div style={{ marginTop: 8, fontWeight: 800 }}>{message}</div> : null}
    </NoticeBlock>
  );
}

function RepairConfirmationBlock({ repair }) {
  const status = getRepairConfirmationStatus(repair);

  if (status === "NONE") {
    const completedAndPaid = isRepairCompleted(repair) && isRepairPaid(repair);
    return (
      <NoticeBlock>
        <strong>維修完成確認書</strong>
        <div style={{ marginTop: 6 }}>
          {completedAndPaid ? "維修確認書準備中，請洽門市人員。" : "維修完成後將顯示維修確認書"}
        </div>
        {completedAndPaid ? (
          <ActionButton disabled>
            尚未建立維修確認書
          </ActionButton>
        ) : null}
      </NoticeBlock>
    );
  }

  if (status === "PENDING") {
    return (
      <NoticeBlock>
        <strong>維修完成確認書</strong>
        <div style={{ marginTop: 6 }}>請確認本次維修內容與車輛狀態，確認無誤後完成簽名。</div>
        {repair.repairConfirmationLink ? (
          <a href={repair.repairConfirmationLink} style={{
            display: "block",
            marginTop: 12,
            padding: 14,
            borderRadius: 16,
            background: "#16a34a",
            color: "#fff",
            textDecoration: "none",
            textAlign: "center",
            fontSize: 16,
            fontWeight: 900
          }}>
            簽署維修確認書
          </a>
        ) : null}
      </NoticeBlock>
    );
  }

  if (status === "COMPLETED") {
    return (
      <NoticeBlock tone="success">
        <strong>維修完成確認書</strong>
        <div style={{ marginTop: 6 }}>已完成維修確認</div>
        {repair.repairConfirmationPdfUrl ? (
          <a href={repair.repairConfirmationPdfUrl} target="_blank" rel="noreferrer" style={{
            display: "block",
            marginTop: 12,
            padding: 14,
            borderRadius: 16,
            background: "#16a34a",
            color: "#fff",
            textDecoration: "none",
            textAlign: "center",
            fontSize: 16,
            fontWeight: 900
          }}>
            查看維修確認書 PDF
          </a>
        ) : null}
      </NoticeBlock>
    );
  }

  return (
    <NoticeBlock tone="danger">
      <strong>維修完成確認書</strong>
      <div style={{ marginTop: 6 }}>維修確認書已取消</div>
    </NoticeBlock>
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
