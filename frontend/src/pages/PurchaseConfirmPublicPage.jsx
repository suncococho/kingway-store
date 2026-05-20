import { useEffect, useState } from "react";
import liff from "@line/liff";
import { useParams } from "react-router-dom";
import SignaturePad from "../components/SignaturePad";
import { apiRequest } from "../lib/api";

const DELIVERY_CHECK_ITEMS = [
  { id: "check-appearance", label: "外觀無損", value: "外觀無損" },
  { id: "check-function", label: "功能正常", value: "功能正常" },
  { id: "check-accessories", label: "配件齊全", value: "配件齊全" },
  { id: "check-spec", label: "規格相符", value: "規格相符" },
  {
    id: "legal-notice-no-lightning-label",
    label: "法規與閃電標章說明",
    key: "legal_notice_no_lightning_label",
    value: "本人已了解本車輛目前未屬於台灣「微型電動二輪車」掛牌管理車輛，亦未配置「閃電標章（審驗合格標章）」，並已知悉相關使用範圍、道路限制與交通法規；若因個人違規使用、非法改裝、進入限制道路或未遵守相關法令所產生之責任、罰則或事故，需由使用者自行負責，且本人確認門市已完成相關說明。"
  },
];

const EXPLANATION_CHECK_ITEMS = [
  { id: "explain-usage", label: "使用方法", value: "使用方法" },
  { id: "explain-warranty", label: "保固範圍", value: "保固範圍與期限（1 年）" },
  { id: "explain-maintenance", label: "保養方法", value: "日常維護與保養方法" },
  { id: "explain-laws", label: "法規說明", value: "臺灣電動自行車相關法規及速度限制" },
  { id: "explain-safety", label: "安全事項", value: "騎乘安全注意事項" }
];

const DEFAULT_CONTENT = {
  deliveryChecks: DELIVERY_CHECK_ITEMS.map((item) => item.value),
  staffExplanations: EXPLANATION_CHECK_ITEMS.map((item) => item.value),
  terms: [
    "本人已確認所購商品之外觀、功能、配件及規格皆與訂購內容相符，並經本人現場檢查確認無誤。",
    "門市店員已完成商品使用方式、保固範圍與期限、日常維護保養方式、臺灣電動自行車相關法規及速度限制、騎乘安全注意事項等說明。",
    "本人已了解本車輛目前未屬於台灣「微型電動二輪車」掛牌管理車輛，亦未配置「閃電標章（審驗合格標章）」，並已知悉相關使用範圍、道路限制與交通法規；若因個人違規使用、非法改裝、進入限制道路或未遵守相關法令所產生之責任、罰則或事故，需由使用者自行負責，且本人確認門市已完成相關說明。",
    "如因違規、改裝、超速、個人過失或不當使用所致之損害、事故、罰則或其他法律責任，概由本人自行負責。",
    "商品保固期間自交車日起算一年，保固範圍限於非人為因素造成之製造瑕疵。",
    "耗材、外觀磨損、人為損壞、正常耗損、改裝或不當使用所致之故障或損害，不屬保固範圍。",
    "電池及充電注意事項：應使用原廠或店家認可之充電器，避免高溫、潮濕、無人看管或不當環境下充電；若發現電池膨脹、漏液、異常發熱等情形，應立即停止使用並聯絡門市；電池自然衰退屬正常耗損，不屬一般保固範圍。"
  ],
  errors: {
    buyerName: "請填寫姓名",
    buyerPhone: "請填寫電話",
    buyerIdNumber: "請填寫證件號碼",
    signatureData: "請完成簽名",
    deliveryChecks: "請確認所有交車檢查項目",
    staffExplanations: "請確認店員說明項目",
    termsAccepted: "請先同意購買使用條款",
    finalConfirmationAccepted: "請勾選最終確認聲明"
  }
};

const EMPTY_FORM = {
  buyerName: "",
  buyerPhone: "",
  buyerIdNumber: "",
  deliveryChecks: [],
  staffExplanations: [],
  termsAccepted: false,
  finalConfirmationAccepted: false,
  signatureData: ""
};

function PurchaseConfirmPublicPage() {
  const { token } = useParams();
  const isManual = !token;
  const [data, setData] = useState(isManual ? { content: DEFAULT_CONTENT } : null);
  const [loading, setLoading] = useState(!isManual);
  const [error, setError] = useState("");
  const [profileName, setProfileName] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [manualSuccess, setManualSuccess] = useState(null);
  const [termsOpen, setTermsOpen] = useState(false);

  useEffect(() => {
    if (isManual) {
      async function redirectToLatestOrderConfirmation() {
        try {
          setLoading(true);
          setError("");

          await liff.init({
            liffId: import.meta.env.VITE_LIFF_ID || "2010080463-s7I6a2BG"
          });

          if (!liff.isLoggedIn()) {
            liff.login();
            return;
          }

          const profile = await liff.getProfile();
          setProfileName(profile.displayName || "");
        if (profile.userId && profile.displayName) {
          apiRequest("/line/profile-name", {
            method: "POST",
            body: JSON.stringify({
              lineUserId: profile.userId,
              displayName: profile.displayName
            })
          }).catch(() => {});
        }
          sessionStorage.setItem("lineProfileName", profile.displayName || "");
        setProfileName(profile.displayName || "");

          const response = await apiRequest("/purchase-confirmations/line/latest-order", {
            method: "POST",
            body: JSON.stringify({
              lineUserId: profile.userId,
              displayName: profile.displayName || ""
            })
          });

          if (response?.url) {
            window.location.href = response.url;
            return;
          }

          setData({ content: DEFAULT_CONTENT });
        } catch (error) {
          const message = error?.message || "";

          if (
            message.includes("access token expired") ||
            message.includes("The access token expired") ||
            message.includes("invalid token")
          ) {
            try {
              liff.logout();
            } catch (e) {}

            liff.login();
            return;
          }

          setError(message || "尚未找到可建立購買確認書的訂單。");
          setData({ content: DEFAULT_CONTENT });
        } finally {
          setLoading(false);
        }
      }

      redirectToLatestOrderConfirmation();
      return;
    }

    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await apiRequest(`/purchase-confirmations/public/${token}`);
        setData(response);
        setForm({
          buyerName: sessionStorage.getItem("lineProfileName") || response.buyerName || response.customerName || "",
          buyerPhone: response.buyerPhone || response.customerPhone || "",
          buyerIdNumber: response.buyerIdNumber || "",
          deliveryChecks: response.deliveryChecks || [],
          staffExplanations: response.staffExplanations || [],
          termsAccepted: Boolean(response.termsAccepted),
          finalConfirmationAccepted: Boolean(response.finalConfirmationAccepted),
          signatureData: response.signatureData || ""
        });
      } catch (error) {
        setError(error.message || "載入購買確認書失敗");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [isManual, token]);

  async function handleSubmit(event) {
    event.preventDefault();

    const content = data?.content;

    if (!content) {
      alert("購買確認書內容載入失敗");
      return;
    }

    if (!form.buyerName.trim()) {
      alert(content.errors.buyerName);
      return;
    }
    if (!form.buyerPhone.trim()) {
      alert(content.errors.buyerPhone);
      return;
    }
    if (!form.buyerIdNumber.trim()) {
      alert(content.errors.buyerIdNumber);
      return;
    }
    const requiredDeliveryValues = DELIVERY_CHECK_ITEMS.map((item) => item.value);
    const requiredExplanationValues = EXPLANATION_CHECK_ITEMS.map((item) => item.value);

    const checkedDeliveryValues = new Set(form.deliveryChecks || []);
    const checkedExplanationValues = new Set(form.staffExplanations || []);

    if (!requiredDeliveryValues.every((value) => checkedDeliveryValues.has(value))) {
      alert(content.errors.deliveryChecks);
      return;
    }
    if (!requiredExplanationValues.every((value) => checkedExplanationValues.has(value))) {
      alert(content.errors.staffExplanations);
      return;
    }
    if (!form.termsAccepted) {
      alert(content.errors.termsAccepted);
      return;
    }
    if (!form.finalConfirmationAccepted) {
      alert(content.errors.finalConfirmationAccepted);
      return;
    }
    if (!form.signatureData) {
      alert(content.errors.signatureData);
      return;
    }

    setSubmitting(true);
    try {
      const zhPayload = {
        姓名: form.buyerName.trim(),
        身份證: form.buyerIdNumber.trim(),
        電話: form.buyerPhone.trim(),
        外觀無損: form.deliveryChecks.includes("外觀無損") ? "✓" : "✗",
        功能正常: form.deliveryChecks.includes("功能正常") ? "✓" : "✗",
        配件齊全: form.deliveryChecks.includes("配件齊全") ? "✓" : "✗",
        規格相符: form.deliveryChecks.includes("規格相符") ? "✓" : "✗",
        條款同意: form.termsAccepted ? "✓" : "✗",
        使用方法: form.staffExplanations.includes("使用方法") ? "✓" : "✗",
        保固範圍: form.staffExplanations.includes("保固範圍與期限（1 年）") ? "✓" : "✗",
        保養方法: form.staffExplanations.includes("日常維護與保養方法") ? "✓" : "✗",
        法規說明: form.staffExplanations.includes("臺灣電動自行車相關法規及速度限制") ? "✓" : "✗",
        安全事項: form.staffExplanations.includes("騎乘安全注意事項") ? "✓" : "✗",
        最終確認: form.finalConfirmationAccepted ? "✓" : "✗",
        簽名圖片: form.signatureData
      };

      const payload = isManual
        ? zhPayload
        : {
            ...form,
            ...zhPayload
          };

      const response = await apiRequest(isManual ? "/purchase-confirmations/manual" : `/purchase-confirmations/public/${token}`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setPdfUrl(response.pdfUrl || "");
      if (isManual) {
        const matchedText = response.matchStatus === "matched_order"
          ? "已對應到系統訂單。"
          : response.matchStatus === "matched_customer"
            ? "已對應到系統客戶。"
            : "未找到對應訂單，已以手動資料保存。";
        alert(`購買確認書已送出。\n${matchedText}`);
        setManualSuccess({
          message: matchedText,
          pdfUrl: response.pdfUrl || ""
        });
        setForm(EMPTY_FORM);
      } else {
        setSubmitted(true);
      }
    } catch (error) {
      alert(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleInputChange(event) {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value
    }));
  }

  function toggleChecklist(name, item) {
    setForm((current) => {
      const exists = current[name].includes(item);
      return {
        ...current,
        [name]: exists ? current[name].filter((value) => value !== item) : [...current[name], item]
      };
    });
  }

  if (loading) {
    return <div className="public-page">載入中...</div>;
  }

  if (error) {
    return (
      <div className="public-page">
        <div className="public-card">
          <h1>{"購買確認書"}</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="public-page">
        <div className="public-card">
          <h1>{"購買確認書"}</h1>
          <p>{"目前無法取得購買確認資料。"}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="public-page">
        <div className="public-card">
          <h1>{"購買確認書已完成"}</h1>
          <p>{"感謝您完成購買確認書，KINGWAY 已保存您的確認紀錄。"}</p>
          {pdfUrl ? (
            <a className="primary-button" href={pdfUrl} target="_blank" rel="noreferrer">
              {"下載 PDF"}
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="public-page">
      <form className={`public-card purchase-confirm-card ${isManual ? "manual-tablet-card" : ""}`} onSubmit={handleSubmit}>
        <h1>{"購買確認書"}</h1>
        <p>{"請依序完成下列購買確認項目，內容確認無誤後再簽名送出。"}</p>
        {manualSuccess ? (
          <div className="page-section">
            <h2>{"已完成送出"}</h2>
            <p>{manualSuccess.message}</p>
            {manualSuccess.pdfUrl ? (
              <a className="primary-button" href={manualSuccess.pdfUrl} target="_blank" rel="noreferrer">
                {"下載 PDF"}
              </a>
            ) : null}
          </div>
        ) : null}
        <div className="page-section">
          <h2>{"基本資料"}</h2>
          <div className="grid-form compact-grid">
            <label className="form-field">
              <span>{"姓名"}</span>
              <input name="buyerName" value={form.buyerName} onChange={handleInputChange} />
            </label>
            <label className="form-field">
              <span>{"身份證"}</span>
              <input name="buyerIdNumber" value={form.buyerIdNumber} onChange={handleInputChange} />
            </label>
            <label className="form-field">
              <span>{"電話"}</span>
              <input name="buyerPhone" value={form.buyerPhone} onChange={handleInputChange} />
            </label>
          </div>
        </div>
        <div className="page-section">
          <h2>{"確認項目"}</h2>
          <div className="checklist-list">
            {DELIVERY_CHECK_ITEMS.map((item) => (
              <label key={item.id} className="checklist-item" htmlFor={item.id}>
                <input
                  id={item.id}
                  type="checkbox"
                  checked={form.deliveryChecks.includes(item.value)}
                  onChange={() => toggleChecklist("deliveryChecks", item.value)}
                />
                <span>{item.label}</span>
              </label>
            ))}
            <label className="checklist-item" htmlFor="acceptance-terms">
              <input
                id="acceptance-terms"
                type="checkbox"
                name="termsAccepted"
                checked={form.termsAccepted}
                onChange={handleInputChange}
              />
              <span>{"條款同意"}</span>
            </label>
            {EXPLANATION_CHECK_ITEMS.map((item) => (
              <label key={item.id} className="checklist-item" htmlFor={item.id}>
                <input
                  id={item.id}
                  type="checkbox"
                  checked={form.staffExplanations.includes(item.value)}
                  onChange={() => toggleChecklist("staffExplanations", item.value)}
                />
                <span>{item.label}</span>
              </label>
            ))}
            <label className="checklist-item" htmlFor="acceptance-final">
              <input
                id="acceptance-final"
                type="checkbox"
                name="finalConfirmationAccepted"
                checked={form.finalConfirmationAccepted}
                onChange={handleInputChange}
              />
              <span>{"最終確認"}</span>
            </label>
          </div>
        </div>
        <div className="page-section">
          <div className="section-header">
            <div>
              <h2>{"條款內容"}</h2>
              <p className="muted-text">{"平板簽名時先保留主要欄位，需要時再展開查看完整條款。"}</p>
            </div>
            <button type="button" className="secondary-button inline-submit" onClick={() => setTermsOpen((current) => !current)}>
              {termsOpen ? "收合條款" : "查看條款"}
            </button>
          </div>
          {termsOpen ? (
            <div className="stack-list purchase-terms-list">
              {data.content.terms.map((term, index) => (
                <div key={term} className="log-row">
                  <strong>{index + 1}.</strong>
                  <div>{term}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="page-section">
          <h2>{"簽名圖片"}</h2>
          <SignaturePad value={form.signatureData} onChange={(value) => setForm((current) => ({ ...current, signatureData: value }))} />
        </div>
        <button type="submit" className="primary-button" disabled={submitting}>
          {submitting ? "送出中..." : isManual ? "送出購買確認書" : "送出確認"}
        </button>
      </form>
    </div>
  );
}

export default PurchaseConfirmPublicPage;
