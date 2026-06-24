import { useEffect, useState } from "react";
import liff from "@line/liff";
import { apiRequest } from "../lib/api";
import LinePhoneBindGate from "./LinePhoneBindGate";
import { resolveLineContext } from "../lib/lineContext";
import { formatRepairStatus } from "../lib/display";
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

const CUSTOMER_MENU_ITEMS = [
  {
    id: "repair-estimate",
    label: "維修估價",
    description: "快速送出維修預約",
    href: "/line-repair-request"
  },
  {
    id: "repair-history",
    label: "維修進度",
    description: "追蹤維修估價與進度",
    href: "/line-progress?tab=repair"
  },
  {
    id: "order-history",
    label: "我的訂單",
    description: "查詢訂單狀態與明細",
    href: "/line-progress?tab=order"
  },
  {
    id: "member-service",
    label: "會員服務",
    description: "訂單、維修與售後協助",
    href: "/line-coupon"
  }
];

function PendingActionsPanel({ actions }) {
  if (!actions?.length) {
    return null;
  }

  return (
    <section
      className="line-customer-summary"
      style={{
        border: "1px solid #fde68a",
        background: "#fffbeb",
        boxShadow: "0 14px 32px rgba(180, 83, 9, 0.14)"
      }}
    >
      <div className="line-customer-summary-title">待確認事項</div>
      <div style={{ color: "#92400e", fontWeight: 800, marginBottom: 12 }}>
        您有需要確認或簽署的項目
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {actions.map((action, index) => (
          <div
            key={`${action.type}-${action.refId || index}`}
            style={{
              padding: 14,
              borderRadius: 16,
              background: "#fff",
              border: "1px solid #fcd34d"
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 17, color: "#78350f" }}>{action.title}</div>
            <div style={{ marginTop: 6, color: "#64748b", lineHeight: 1.5 }}>{action.description}</div>
            <a
              href={action.url}
              style={{
                display: "block",
                width: "100%",
                boxSizing: "border-box",
                marginTop: 12,
                padding: "14px 16px",
                borderRadius: 16,
                background: action.type === "REPAIR_QUOTE" ? "#16a34a" : "#0ea5e9",
                color: "#fff",
                textAlign: "center",
                textDecoration: "none",
                fontSize: 16,
                fontWeight: 900
              }}
            >
              {action.buttonLabel || (action.type === "REPAIR_QUOTE" ? "立即確認" : "前往簽署")}
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function LineCustomerPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileName, setProfileName] = useState("");
  const [lineUserId, setLineUserId] = useState("");
  const [lineContextInfo, setLineContextInfo] = useState({
    inClient: false,
    failureReason: "",
    liffId: "",
    isLoggedIn: false,
    contextUserId: "",
    profileUserId: "",
    recoveredLineUserId: ""
  });

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
        const context = await resolveLineContext();
        setLineContextInfo({
          inClient: Boolean(context.inClient),
          failureReason: context.failureReason || "",
          liffId: context.liffId || "",
          isLoggedIn: Boolean(context.isLoggedIn),
          contextUserId: context.contextUserId || "",
          profileUserId: context.profileUserId || "",
          recoveredLineUserId: context.lineUserId || ""
        });

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

        setLineUserId(context.lineUserId);
        const lineCustomer = await fetchLineBindingSnapshot({
          lineUserId: context.lineUserId,
          displayName: context.displayName || "",
          endpoint: "/line-order/customer",
          storeCode: DEFAULT_LINE_BINDING_STORE_CODE
        });

        if (lineCustomer?.customer) {
          setData(lineCustomer);
          saveLineBindingCache({
            lineUserId: context.lineUserId,
            customer: lineCustomer.customer,
            storeCode: DEFAULT_LINE_BINDING_STORE_CODE
          });
          return;
        }

        const cachedCustomer = cacheLineCustomerToObject(
          getLineBindingCache(context.lineUserId)
        );
        if (cachedCustomer) {
          setData({ customer: cachedCustomer, orders: [], repairs: [] });
        }
      } catch (e) {
        console.error(e);
        setLineContextInfo((current) => ({
          ...current,
          failureReason: current.failureReason || e.message || "無法讀取客戶資料"
        }));
        setData(null);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  const latestOrder = data?.orders?.[0];
  const latestRepair = data?.repairs?.[0];
  const pendingActions = data?.pendingActions || [];

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
          displayName={profileName}
          inClient={lineContextInfo.inClient}
          failureReason={lineContextInfo.failureReason}
          lineContextDebug={lineContextInfo}
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
      ) : data?.customer ? (
        <section className="line-customer-summary">
          <div className="line-customer-summary-title">{resolveDisplayName(profileName, data.customer.name)}</div>
          <div className="line-customer-info-row">手機號碼 <strong>{data.customer.phone || "-"}</strong></div>
          <div className="line-customer-info-row">最近訂單 <strong>{latestOrder?.orderNo || "目前沒有訂單"}</strong></div>
          <div className="line-customer-info-row">最近維修 <strong>{latestRepair ? `#${latestRepair.id} ${formatRepairStatus(latestRepair.status)}` : "目前沒有維修"}</strong></div>
          {latestOrder ? (
            <div className="line-customer-info-row danger">未付款金額 <strong>{money(latestOrder.unpaidBalance)}</strong></div>
          ) : null}
        </section>
      ) : (
        <section className="line-customer-summary">
          尚未找到綁定資料。請先完成 LINE 電話綁定或聯繫門市協助。
        </section>
      )}

      {data?.customer?.phone ? (
        <PendingActionsPanel actions={pendingActions} />
      ) : null}

      {data?.customer?.phone ? (
        <section
          className="line-customer-menu"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 14
          }}
        >
          {CUSTOMER_MENU_ITEMS.map((item) => (
            <a
              key={item.id}
              href={item.href}
              className="line-customer-item"
              style={{
                borderRadius: 20,
                padding: "16px",
                minHeight: 118,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 6,
                textDecoration: "none",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                color: "#0f172a",
                fontWeight: 900
              }}
            >
              <span style={{ fontSize: 18 }}>{item.label}</span>
              <span style={{ color: "#64748b", fontWeight: 500, lineHeight: 1.5 }}>{item.description}</span>
            </a>
          ))}
        </section>
      ) : null}

      <button type="button" className="line-customer-close" onClick={closeLine}>
        返回 LINE
      </button>
    </div>
  );
}
