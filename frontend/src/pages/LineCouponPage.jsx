import { useEffect, useState } from "react";
import liff from "@line/liff";
import { resolveLineContext } from "../lib/lineContext";
import LinePhoneBindGate from "./LinePhoneBindGate";
import {
  DEFAULT_LINE_BINDING_STORE_CODE,
  cacheLineCustomerToObject,
  fetchLineBindingSnapshot,
  getLineBindingCache,
  saveLineBindingCache
} from "../lib/lineBindingRecovery";

export default function LineCouponPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lineUserId, setLineUserId] = useState("");
  const [profileName, setProfileName] = useState("");
  const [lineContextInfo, setLineContextInfo] = useState({
    inClient: false,
    failureReason: "",
    liffId: "",
    isLoggedIn: false,
    contextUserId: "",
    profileUserId: "",
    recoveredLineUserId: ""
  });

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

        if (!context.lineUserId) {
          const cachedBinding = context.inClient ? getLineBindingCache() : null;
          const cachedCustomer = cacheLineCustomerToObject(cachedBinding);
          if (cachedCustomer) {
            setData({ customer: cachedCustomer });
          }
          return;
        }

        const lineCustomer = await fetchLineBindingSnapshot({
          lineUserId: context.lineUserId,
          displayName: context.displayName || "",
          endpoint: "/line-order/customer",
          storeCode: DEFAULT_LINE_BINDING_STORE_CODE
        });

        if (lineCustomer?.customer) {
          saveLineBindingCache({
            lineUserId: context.lineUserId,
            customer: lineCustomer.customer,
            storeCode: DEFAULT_LINE_BINDING_STORE_CODE
          });
          setData({ customer: lineCustomer.customer });
          return;
        }

        const cachedCustomer = cacheLineCustomerToObject(getLineBindingCache(context.lineUserId));
        if (cachedCustomer) {
          setData({ customer: cachedCustomer });
        }
      } catch (e) {
        console.error(e);
        setData(null);
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

  return (
    <div style={{ minHeight: "100vh", background: "#eef2f7", padding: 18, boxSizing: "border-box" }}>
      <section style={{ background: "#0f172a", color: "#fff", borderRadius: 28, padding: 24, marginBottom: 18 }}>
        <div style={{ color: "#22c55e", fontWeight: 900, letterSpacing: 3 }}>KINGWAY</div>
        <h1 style={{ margin: "12px 0 6px", fontSize: 34 }}>會員服務</h1>
        <div style={{ color: "#cbd5e1" }}>查詢訂單、維修與售後服務請回到 LINE 對話。</div>
      </section>

      {loading ? (
        <Card>資料讀取中...</Card>
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
            const customer = restored?.customer || { phone, lineUserId, name: profileName || "LINE 客戶" };
            setData({ customer });
            saveLineBindingCache({
              lineUserId: lineUserId || customer.lineUserId,
              customer,
              storeCode: DEFAULT_LINE_BINDING_STORE_CODE
            });
          }}
        />
      ) : !data?.customer ? (
        <Card>尚未找到綁定資料，請回到 LINE 留下電話。</Card>
      ) : (
        <Card>
          <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 10 }}>
            服務已綁定
          </div>
          <div style={{ color: "#475569", lineHeight: 1.8 }}>
            您可以回到 LINE 對話查詢訂單、維修進度、購買確認書與客服協助。
          </div>
        </Card>
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
