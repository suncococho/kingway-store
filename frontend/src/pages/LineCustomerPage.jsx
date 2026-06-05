import { useEffect, useState } from "react";
import liff from "@line/liff";
import { apiRequest } from "../lib/api";
import LinePhoneBindGate from "./LinePhoneBindGate";
import { resolveLineContext } from "../lib/lineContext";
import {
  DEFAULT_LINE_BINDING_STORE_CODE,
  cacheLineCustomerToObject,
  fetchLineBindingSnapshot,
  getLineBindingCache,
  saveLineBindingCache
} from "../lib/lineBindingRecovery";

const money = (v) => `NT$ ${Number(v || 0).toLocaleString()}`;

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
