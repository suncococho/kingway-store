import { useEffect, useState } from "react";
import liff from "@line/liff";
import { Link, useLocation } from "react-router-dom";
import { apiRequest } from "../lib/api";

const DEFAULT_STORE_INFO = {
  storeName: "KINGWAY 台南門市",
  address: "台南市東區東門路二段245號",
  businessHours: "每日 13:00 - 21:00",
  mapUrl: "https://www.google.com/maps/search/?api=1&query=%E5%8F%B0%E5%8D%97%E5%B8%82%E6%9D%B1%E5%8D%80%E6%9D%B1%E9%96%80%E8%B7%AF%E4%BA%8C%E6%AE%B5245%E8%99%9F",
  contactPhone: "",
  lineOaDisplayInfo: "歡迎透過 KINGWAY LINE 官方帳號聯絡門市。",
  storeDescription: "歡迎透過 LINE 與門市聯繫，確認庫存、維修與交車流程。",
  receiptDisplayInfo: "購買確認與收據內容以現場說明與 LINE 訊息為準。"
};

const PAGE_CONTENT = {
  "/repair-reservation": {
    title: "維修預約",
    description: "請回到 LINE 對話依照門市提示填寫維修預約資料。",
    tips: [
      "可預約日為星期二、星期三、星期日。",
      "送出格式：預約維修 YYYY-MM-DD | 車款名稱 | 問題描述"
    ]
  },
  "/coupon-center": {
    title: "會員服務",
    description: "請回到 LINE 對話查詢訂單、維修與售後服務。",
    tips: ["若尚未綁定手機，請先在 LINE 回覆手機號碼。"]
  },
  "/google-review": {
    title: "Google 評論",
    description: "完成 Google 評論後，請回到 LINE 對話輸入「我已完成評論」，門市將確認您的回饋。",
    tips: ["感謝您的評論，門市將確認您的回饋。"]
  },
  "/progress": {
    title: "查詢進度",
    description: "請回到 LINE 對話輸入「查詢進度」、「我的訂單」或「我的維修」取得最新摘要。",
    tips: ["若剛完成付款、維修或問卷，請稍候再重新查詢。"]
  },
  "/store-info": {
    title: "門市資訊",
    description: "KINGWAY 台南門市資訊。",
    tips: ["地址：台南市東區東門路二段245號", "營業時間：每日 13:00 - 21:00"]
  },
  "/support": {
    title: "客服協助",
    description: "請回到 LINE 對話直接留言需求、姓名與電話，門市人員會盡快協助您。",
    tips: ["可留言：維修問題、訂單查詢、交車確認。"]
  }
};

function closeLineEntryPage() {
  try {
    if (liff.isInClient()) {
      liff.closeWindow();
      return;
    }
  } catch (e) {}
  window.location.href = "https://line.me/R/";
}

function LineEntryPage() {
  const location = useLocation();
  const content = PAGE_CONTENT[location.pathname] || PAGE_CONTENT["/support"];
  const [storeInfo, setStoreInfo] = useState(DEFAULT_STORE_INFO);

  useEffect(() => {
    if (location.pathname !== "/store-info") {
      return;
    }

    let active = true;
    async function loadStoreInfo() {
      try {
        const response = await apiRequest("/settings/public");
        if (active) {
          setStoreInfo({ ...DEFAULT_STORE_INFO, ...response });
        }
      } catch (error) {
        if (active) {
          setStoreInfo(DEFAULT_STORE_INFO);
        }
      }
    }

    loadStoreInfo();

    return () => {
      active = false;
    };
  }, [location.pathname]);

  return (
    <div className="public-page">
      <div className="public-card">
        <h1>{content.title}</h1>
        <p>{content.description}</p>
        {location.pathname === "/store-info" ? (
          <div className="page-section">
            <div className="stack-list">
              <div className="log-row">
                <strong>門市名稱：</strong>
                <div>{storeInfo.storeName}</div>
              </div>
              <div className="log-row">
                <strong>地址：</strong>
                <div>{storeInfo.address}</div>
              </div>
              <div className="log-row">
                <strong>營業時間：</strong>
                <div>{storeInfo.businessHours}</div>
              </div>
              {storeInfo.contactPhone ? (
                <div className="log-row">
                  <strong>聯絡電話：</strong>
                  <div>{storeInfo.contactPhone}</div>
                </div>
              ) : null}
              <div className="log-row">
                <strong>地圖連結：</strong>
                <a href={storeInfo.mapUrl} target="_blank" rel="noreferrer">
                  開啟地圖
                </a>
              </div>



            </div>
          </div>
        ) : (
          <div className="page-section">
            {content.tips.map((tip) => (
              <p key={tip}>{tip}</p>
            ))}
          </div>
        )}
        <button type="button" className="line-customer-close" onClick={closeLineEntryPage}>
          返回 LINE
        </button>
      </div>
    </div>
  );
}

export default LineEntryPage;
