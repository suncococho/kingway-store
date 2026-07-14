import { useEffect, useState } from "react";
import liff from "@line/liff";
import { useLocation, useParams } from "react-router-dom";
import SignaturePad from "../components/SignaturePad";
import WarrantyRepairAdditionalTerms from "../components/WarrantyRepairAdditionalTerms";
import { apiRequest } from "../lib/api";
import { resolveLineContext } from "../lib/lineContext";

const DELIVERY_CHECK_ITEMS = [
  { id: "check-condition", label: "車況確認", value: "車況確認", description: "已當場檢查車輛外觀、功能、配件與規格，確認皆正常無誤、與訂單相符。", required: true },
  { id: "check-photo", label: "照片使用同意", value: "照片使用同意", description: "本人同意門市於交車時拍攝之照片，得用於門市紀錄、社群或行銷用途。", required: false }
];

const EXPLANATION_CHECK_ITEMS = [
  { id: "explain-delivery", label: "說明確認", value: "說明確認", description: "已聽取店員關於使用方法、保固範圍（1年）、保養及安全注意事項之說明。", required: true }
];

const DEFAULT_CONTENT = {
  pageTitle: "KINGWAY 自行車\n交付確認",
  pageSubtitle: "購買後自行車確認簽名表單",
  vehicleTypeNotice: "",
  vehicleTypes: {
    road: {
      value: "road",
      label: "交付確認",
      description: ""
    },
    offroad: {
      value: "offroad",
      label: "交付確認",
      description: ""
    }
  },
  deliveryNotice: "✓ 請確認以下項目後勾選。",
  deliveryCheckItems: DELIVERY_CHECK_ITEMS,
  deliveryChecks: DELIVERY_CHECK_ITEMS.filter((item) => item.required !== false).map((item) => item.value),
  staffExplanationNotice: "請確認店員已完成以下說明。",
  staffExplanationItems: EXPLANATION_CHECK_ITEMS,
  staffExplanations: EXPLANATION_CHECK_ITEMS.map((item) => item.value),
  termsTitle: "購買自行車條款與責任聲明",
  termsIntroTitle: "一、產品與使用說明",
  termsIntro: "1. 電動輔助自行車建議由年滿14歲以上者使用，未成年者應於監護人陪同與同意下使用。\n2. 本車輛未配備臺灣「閃電標章」，主要設計用於越野、私有場地或休閒騎乘用途。若於一般道路使用，請依當地交通法規行駛。違規行駛可能處新臺幣1,200元至3,600元罰鍰，若有酒駕或肇事等情形，警方亦得依職權扣留或沒入車輛。\n3. 電動輔助自行車依規定最高時速為25公里。請避免自行改裝或解除速度限制，以維持安全與合法使用。",
  vehicleTerms: {},
  commonTerms: [
    {
      title: "二、購買者責任與安全",
      items: [
        "騎乘時請配戴安全帽等護具，遵守交通規則，避免載人、超載或危險騎乘。",
        "因使用不當、自行改裝、超速或人為疏失所造成之損壞、事故或傷害，由購買者自行負責。",
        "因個人違規使用而衍生之罰款或法律責任，由購買者自行承擔。"
      ]
    },
    {
      title: "三、保固服務範圍",
      items: [
        "保固期限：自交車日起一年內。",
        "保固範圍：非人為損壞之製造缺陷（如電控系統、馬達本體故障等）。",
        "不列入保固範圍：消耗品（輪胎、煞車皮、鍊條等）、結構件（車架、前叉、輪圈等）、外觀磨損、人為損壞（改裝、超載、泡水、碰撞等）及正常使用磨損。電池自然衰減為正常現象，亦不列入保固。",
        "申請保固服務時，購買者須自行將車輛及相關零件攜帶至門市，相關運送費用由購買者自行負擔。"
      ]
    },
    {
      title: "四、各部位螺絲、螺栓固定與定期檢查說明",
      items: [
        "車輛在日常騎乘過程中，因路面震動、坑洞、減速丘、使用習慣及長時間騎乘等因素，手把、輪組、煞車、摺疊機構、座墊、踏板、腳架及其他固定螺絲、螺栓皆可能自然產生鬆動。此類鬆動屬於正常使用下之定期檢查與保養項目，並非零件本身之製造瑕疵。",
        "顧客應於每次騎乘前或至少定期檢查各主要固定部位是否鎖緊，特別是手把、前後輪、煞車系統、摺疊扣具及車架連接處。若因未定期檢查、未即時鎖緊，或在螺絲、螺栓已鬆動之狀態下繼續騎乘，導致異音、晃動、螺牙損壞、零件破損或其他安全問題，均屬使用及保養管理範圍，不屬於免費保固範圍。",
        "單純螺絲、螺栓鎖緊調整，門市得視情況提供服務協助；但若已產生螺牙磨損、零件變形、固定座損壞、手把或其他部件損壞，則須依實際檢查結果進行有償維修或零件更換。"
      ]
    },
    {
      title: "五、交車確認",
      paragraph: "完成交車並簽名領回後，恕不接受退貨或換貨，敬請於交車時詳加確認車況、配件與規格，感謝您的理解與配合。",
      items: [
        "交車前請確認車輛外觀、主要功能、規格及隨車配件皆正常無誤。",
        "確認無誤並簽名後即完成交車。"
      ]
    },
    {
      title: "六、電池與充電安全",
      items: [
        "充電器屬免費贈送之消耗品，不在保固範圍內。如因使用環境或自然耗損導致故障，請自行另行購買，本公司不負保固責任。",
        "請使用原廠充電器，避免於極端溫度環境下充電。",
        "如發現電池膨脹、漏液或過熱，請立即停止使用並與門市聯繫。"
      ]
    },
    {
      title: "七、其他",
      items: [
        "本條款適用中華民國（臺灣）法律，任何爭議雙方應優先友善協商解決。",
        "本公司保留修改本條款之權利，修改後將於官網公布。"
      ]
    }
  ],
  termsAgreement: "我已詳細閱讀並同意上述購買使用條款與責任聲明。",
  finalStatement: "本人已確認上述交付項目皆已完成，且自行檢查無誤，正式領回此自行車。",
  errors: {
    buyerName: "請完成所有必填欄位與勾選項目",
    buyerPhone: "請完成所有必填欄位與勾選項目",
    buyerIdNumber: "請輸入身份證末四碼",
    vehicleType: "請選擇車輛類型",
    signatureData: "請完成簽名",
    deliveryChecks: "請完成所有必填欄位與勾選項目",
    staffExplanations: "請完成所有必填欄位與勾選項目",
    termsAccepted: "請確認購買使用條款",
    finalConfirmationAccepted: "請完成所有必填欄位與勾選項目"
  }
};

const EMPTY_FORM = {
  buyerName: "",
  buyerPhone: "",
  buyerIdNumber: "",
  vehicleType: "offroad",
  deliveryChecks: [],
  staffExplanations: [],
  termsAccepted: false,
  finalConfirmationAccepted: false,
  signatureData: ""
};

const LEGACY_STORE_CONTEXT = {
  storeId: 1,
  storeCode: "KINGWAY_TAINAN",
  storeName: "KINGWAY 台南",
  isExplicitStore: false
};
const SIGNATURE_MAX_WIDTH = 900;
const SIGNATURE_MAX_HEIGHT = 360;
const SIGNATURE_JPEG_QUALITY = 0.75;
const SIGNATURE_MAX_DATA_URL_LENGTH = 600000;
const SIGNATURE_TOO_LARGE_MESSAGE = "簽名資料過大，請清除簽名後重新簽名，或重新整理頁面後再試一次。";
const PURCHASE_CARD_STYLE = {
  borderColor: "#d6a84f",
  boxShadow: "0 18px 42px rgba(148, 108, 34, 0.16)"
};
const SECTION_CARD_STYLE = {
  border: "1px solid rgba(214, 168, 79, 0.7)",
  borderRadius: 16,
  padding: 18,
  background: "#fffdf8"
};
const SECTION_TITLE_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: 10
};
const SECTION_BADGE_STYLE = {
  width: 30,
  height: 30,
  borderRadius: "50%",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#c8932f",
  color: "#ffffff",
  fontSize: 15,
  fontWeight: 900,
  flex: "0 0 auto"
};
const TERMS_SCROLL_STYLE = {
  maxHeight: 420,
  overflowY: "auto",
  padding: 16,
  border: "1px solid rgba(214, 168, 79, 0.7)",
  borderRadius: 12,
  background: "#ffffff"
};
const AGREEMENT_CHECK_STYLE = {
  borderColor: "rgba(22, 163, 74, 0.45)",
  background: "#ecfdf5"
};

function buildResolvedStoreContext(response, requestedStoreCode) {
  return {
    storeId: Number(response?.store?.storeId || 0) || LEGACY_STORE_CONTEXT.storeId,
    storeCode: response?.store?.storeCode || requestedStoreCode || LEGACY_STORE_CONTEXT.storeCode,
    storeName: response?.store?.storeName || LEGACY_STORE_CONTEXT.storeName,
    isExplicitStore: true
  };
}

function normalizeIdLast4(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function parseSnapshot(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function formatCompletedAt(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getDeliveryItems(content) {
  return Array.isArray(content?.deliveryCheckItems) && content.deliveryCheckItems.length
    ? content.deliveryCheckItems
    : DELIVERY_CHECK_ITEMS;
}

function getExplanationItems(content) {
  return Array.isArray(content?.staffExplanationItems) && content.staffExplanationItems.length
    ? content.staffExplanationItems
    : EXPLANATION_CHECK_ITEMS;
}

function getVehicleOptions(content) {
  const types = content?.vehicleTypes || DEFAULT_CONTENT.vehicleTypes;
  return [types.road, types.offroad].filter(Boolean);
}

function keepPurchaseConfirmPath({ isManual, token, storeCode }) {
  if (typeof window === "undefined") {
    return;
  }

  const currentPath = window.location.pathname || "";
  const currentSearch = window.location.search || "";
  const safeStoreQuery = storeCode ? `?store=${encodeURIComponent(storeCode)}` : "";
  const fallbackPath = isManual
    ? "/purchase-confirm"
    : `/purchase-confirm/${encodeURIComponent(token || "")}${safeStoreQuery || currentSearch}`;
  const nextPath = currentPath.startsWith("/purchase-confirm")
    ? `${currentPath}${currentSearch}`
    : fallbackPath;

  window.history.replaceState(window.history.state, "", nextPath);
}

function scrollToPageTop() {
  if (typeof window === "undefined") {
    return;
  }

  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

function loadImageDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("簽名圖片讀取失敗，請清除簽名後重新簽名。"));
    image.src = dataUrl;
  });
}

async function compressSignatureDataUrl(signatureData) {
  const normalizedSignatureData = String(signatureData || "").trim();
  if (!normalizedSignatureData) {
    return "";
  }

  if (typeof document === "undefined") {
    return normalizedSignatureData;
  }

  const image = await loadImageDataUrl(normalizedSignatureData);
  const sourceWidth = image.naturalWidth || image.width || SIGNATURE_MAX_WIDTH;
  const sourceHeight = image.naturalHeight || image.height || SIGNATURE_MAX_HEIGHT;
  const scale = Math.min(
    1,
    SIGNATURE_MAX_WIDTH / Math.max(sourceWidth, 1),
    SIGNATURE_MAX_HEIGHT / Math.max(sourceHeight, 1)
  );
  const targetWidth = Math.max(Math.round(sourceWidth * scale), 1);
  const targetHeight = Math.max(Math.round(sourceHeight * scale), 1);
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    return normalizedSignatureData;
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const compressedDataUrl = canvas.toDataURL("image/jpeg", SIGNATURE_JPEG_QUALITY);
  if (compressedDataUrl.length > SIGNATURE_MAX_DATA_URL_LENGTH) {
    throw new Error(SIGNATURE_TOO_LARGE_MESSAGE);
  }

  return compressedDataUrl;
}

function TermsContent({ content }) {
  return (
    <div className="purchase-terms-list" style={TERMS_SCROLL_STYLE}>
      <h3>{content.termsTitle}</h3>
      <h4>{content.termsIntroTitle}</h4>
      {String(content.termsIntro || "").split("\n").map((line) => <p key={line}>{line}</p>)}
      {(content.commonTerms || []).map((section) => (
        <div className="terms-block" key={section.title}>
          <h4>{section.title}</h4>
          {section.intro ? <p>{section.intro}</p> : null}
          {Array.isArray(section.items) ? (
            <ol>
              {section.items.map((item) => <li key={item}>{item}</li>)}
            </ol>
          ) : null}
          {section.paragraph ? <p>{section.paragraph}</p> : null}
          {section.warning ? <p className="terms-warning">{section.warning}</p> : null}
        </div>
      ))}
      <WarrantyRepairAdditionalTerms />
    </div>
  );
}

function SectionTitle({ number, title }) {
  return (
    <h2 style={SECTION_TITLE_STYLE}>
      <span style={SECTION_BADGE_STYLE}>{number}</span>
      <span>{title}</span>
    </h2>
  );
}

function PurchaseConfirmPublicPage() {
  const { token } = useParams();
  const location = useLocation();
  const isManual = !token;
  const requestedStoreCode = String(new URLSearchParams(location.search).get("store") || "").trim();
  const [data, setData] = useState(isManual ? { content: DEFAULT_CONTENT } : null);
  const [loading, setLoading] = useState(!isManual);
  const [error, setError] = useState("");
  const [storeLoading, setStoreLoading] = useState(Boolean(!isManual && requestedStoreCode));
  const [storeContext, setStoreContext] = useState(null);
  const [storeError, setStoreError] = useState("");
  const [profileName, setProfileName] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [manualSuccess, setManualSuccess] = useState(null);

  useEffect(() => {
    async function loadContent() {
      try {
        const response = await apiRequest("/purchase-confirmations/content");
        return response?.content || DEFAULT_CONTENT;
      } catch {
        return DEFAULT_CONTENT;
      }
    }

    async function loadRequestedStoreContext() {
      if (isManual || !requestedStoreCode) {
        setStoreContext(null);
        setStoreError("");
        setStoreLoading(false);
        return null;
      }

      setStoreLoading(true);
      try {
        const response = await apiRequest(`/storefront/resolve-store?store=${encodeURIComponent(requestedStoreCode)}`);
        const resolvedStoreContext = buildResolvedStoreContext(response, requestedStoreCode);
        setStoreContext(resolvedStoreContext);
        setStoreError("");
        return resolvedStoreContext;
      } catch (resolveError) {
        setStoreContext(null);
        setStoreError(resolveError.message || "找不到有效的門市資訊");
        return null;
      } finally {
        setStoreLoading(false);
      }
    }

    if (isManual) {
      async function redirectToLatestOrderConfirmation() {
        try {
          setLoading(true);
          setError("");
          const content = await loadContent();
          setData({ content });

          const lineContext = await resolveLineContext();
          if (!lineContext.isLoggedIn || lineContext.shouldLogin) {
            return;
          }

          setProfileName(lineContext.displayName || "");
        if (lineContext.lineUserId && lineContext.displayName) {
          apiRequest("/line/profile-name", {
            method: "POST",
            body: JSON.stringify({
              lineUserId: lineContext.lineUserId,
              displayName: lineContext.displayName
            })
          }).catch(() => {});
        }
          sessionStorage.setItem("lineProfileName", lineContext.displayName || "");
        setProfileName(lineContext.displayName || "");

          const response = await apiRequest("/purchase-confirmations/line/latest-order", {
            method: "POST",
            body: JSON.stringify({
              lineUserId: lineContext.lineUserId,
              displayName: lineContext.displayName || ""
            })
          });

          if (response?.url) {
            window.location.href = response.url;
            return;
          }

          setData({ content });
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
          const content = await loadContent();
          setData({ content });
        } finally {
          setLoading(false);
        }
      }

      redirectToLatestOrderConfirmation();
      return;
    }

    async function load() {
      const resolvedStoreContext = await loadRequestedStoreContext();
      if (requestedStoreCode && !resolvedStoreContext) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      try {
        const storeQuery = resolvedStoreContext?.isExplicitStore
          ? `?store=${encodeURIComponent(resolvedStoreContext.storeCode)}`
          : "";
        const response = await apiRequest(`/purchase-confirmations/public/${token}${storeQuery}`);
        const snapshot = parseSnapshot(response.htmlSnapshot);
        setData(response);
        if (response.completed) {
          setPdfUrl(response.pdfUrl || "");
        }
        setForm({
          buyerName: sessionStorage.getItem("lineProfileName") || response.buyerName || response.customerName || "",
          buyerPhone: response.buyerPhone || response.customerPhone || "",
          buyerIdNumber: normalizeIdLast4(response.idLast4 || response.buyerIdNumber || ""),
          vehicleType: response.vehicleType || snapshot.vehicleType || "offroad",
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
  }, [isManual, requestedStoreCode, token]);

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
    if (!/^\d{4}$/.test(form.buyerIdNumber.trim())) {
      alert(content.errors.buyerIdNumber);
      return;
    }
    if (!form.vehicleType) {
      alert(content.errors.vehicleType);
      return;
    }
    const requiredDeliveryValues = getDeliveryItems(content)
      .filter((item) => item.required !== false)
      .map((item) => item.value);
    const requiredExplanationValues = getExplanationItems(content)
      .filter((item) => item.required !== false)
      .map((item) => item.value);

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
      const compressedSignatureData = await compressSignatureDataUrl(form.signatureData);
      const zhPayload = {
        姓名: form.buyerName.trim(),
        身份證後四碼: form.buyerIdNumber.trim(),
        電話: form.buyerPhone.trim(),
        車輛類型: form.vehicleType,
        車輛類型名稱: content.vehicleTypes?.[form.vehicleType]?.label || "",
        外觀無損: form.deliveryChecks.includes("外觀無損") ? "✓" : "✗",
        功能正常: form.deliveryChecks.includes("功能正常") ? "✓" : "✗",
        配件齊全: form.deliveryChecks.includes("配件齊全") ? "✓" : "✗",
        規格相符: form.deliveryChecks.includes("規格相符") ? "✓" : "✗",
        條款同意: form.termsAccepted ? "✓" : "✗",
        使用方法: form.staffExplanations.includes("使用方法") ? "✓" : "✗",
        保固範圍: form.staffExplanations.includes("保固範圍與期限（1年）") ? "✓" : "✗",
        保養方法: form.staffExplanations.includes("日常維護與保養方法") ? "✓" : "✗",
        法規說明: form.staffExplanations.includes("臺灣電動自行車相關法規及速度限制") ? "✓" : "✗",
        安全事項: form.staffExplanations.includes("騎乘安全注意事項") ? "✓" : "✗",
        最終確認: form.finalConfirmationAccepted ? "✓" : "✗",
        簽名圖片: compressedSignatureData
      };

      const payload = isManual
        ? zhPayload
        : {
            buyerName: form.buyerName.trim(),
            buyerPhone: form.buyerPhone.trim(),
            buyerIdNumber: form.buyerIdNumber.trim(),
            vehicleType: form.vehicleType,
            deliveryChecks: form.deliveryChecks,
            staffExplanations: form.staffExplanations,
            termsAccepted: form.termsAccepted,
            finalConfirmationAccepted: form.finalConfirmationAccepted,
            signatureData: compressedSignatureData,
            idLast4: form.buyerIdNumber.trim(),
            vehicleTypeLabel: content.vehicleTypes?.[form.vehicleType]?.label || ""
          };

      const publicPath = !isManual && storeContext?.isExplicitStore
        ? `/purchase-confirmations/public/${token}?store=${encodeURIComponent(storeContext.storeCode)}`
        : `/purchase-confirmations/public/${token}`;
      const response = await apiRequest(isManual ? "/purchase-confirmations/manual" : publicPath, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      if (!isManual && storeContext?.isExplicitStore) {
        const storeQuery = `?store=${encodeURIComponent(storeContext.storeCode)}`;
        if (response?.pdfUrl && !String(response.pdfUrl).includes("store=")) {
          response.pdfUrl = `${response.pdfUrl}${response.pdfUrl.includes("?") ? "&" : "?"}${storeQuery.slice(1)}`;
        }
      }
      setPdfUrl(response.pdfUrl || "");
      if (isManual) {
        keepPurchaseConfirmPath({ isManual: true });
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
        scrollToPageTop();
        setForm(EMPTY_FORM);
      } else {
        keepPurchaseConfirmPath({
          isManual: false,
          token,
          storeCode: storeContext?.isExplicitStore ? storeContext.storeCode : ""
        });
        setSubmitted(true);
        scrollToPageTop();
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
      [name]: name === "buyerIdNumber" ? normalizeIdLast4(value) : type === "checkbox" ? checked : value
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

  if (!isManual && storeLoading) {
    return <div className="public-page">載入中...</div>;
  }

  if (!isManual && storeError) {
    return (
      <div className="public-page">
        <div className="public-card">
          <h1>{"購買確認書"}</h1>
          <p>{storeError}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="public-page">
        <div className="public-card">
          <h1>{"購買確認書"}</h1>
          {storeContext?.isExplicitStore ? <p>{`門市：${storeContext.storeName}`}</p> : null}
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
          {storeContext?.isExplicitStore ? <p>{`門市：${storeContext.storeName}`}</p> : null}
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

  if (!isManual && data?.completed) {
    return (
      <div className="public-page">
        <div className="public-card">
          <h1>{"已完成交付確認"}</h1>
          {storeContext?.isExplicitStore ? <p>{`門市：${storeContext.storeName}`}</p> : null}
          <p>{"您已完成本車輛交付確認，無需重複提交。"}</p>
          {data.orderNo ? <p>{`訂單：${data.orderNo}`}</p> : null}
          {data.completedAt || data.submittedAt ? (
            <p>{`完成時間：${formatCompletedAt(data.completedAt || data.submittedAt)}`}</p>
          ) : null}
          {(pdfUrl || data.pdfUrl) ? (
            <a className="primary-button" href={pdfUrl || data.pdfUrl} target="_blank" rel="noreferrer">
              {"查看/下載 PDF"}
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  const content = data.content || DEFAULT_CONTENT;
  const deliveryItems = getDeliveryItems(content);
  const explanationItems = getExplanationItems(content);

  return (
    <div className="public-page">
      <form
        className={`public-card purchase-confirm-card ${isManual ? "manual-tablet-card" : ""}`}
        style={PURCHASE_CARD_STYLE}
        onSubmit={handleSubmit}
      >
        <h1>
          {String(content.pageTitle || "").split("\n").map((line, index) => (
            <span key={line}>
              {index > 0 ? <br /> : null}
              {line}
            </span>
          ))}
        </h1>
        <p>{content.pageSubtitle}</p>
        {storeContext?.isExplicitStore ? <p>{`門市：${storeContext.storeName}`}</p> : null}
        {manualSuccess ? (
          <div className="page-section" style={SECTION_CARD_STYLE}>
            <h2>{"已完成送出"}</h2>
            <p>{manualSuccess.message}</p>
            {manualSuccess.pdfUrl ? (
              <a className="primary-button" href={manualSuccess.pdfUrl} target="_blank" rel="noreferrer">
                {"下載 PDF"}
              </a>
            ) : null}
          </div>
        ) : null}
        <div className="page-section" style={SECTION_CARD_STYLE}>
          <SectionTitle number="1" title="購買者資料" />
          <div className="grid-form compact-grid">
            <label className="form-field">
              <span>{"購買者姓名 *"}</span>
              <input name="buyerName" value={form.buyerName} onChange={handleInputChange} />
            </label>
            <label className="form-field">
              <span>{"身份證末四碼 *"}</span>
              <input
                name="buyerIdNumber"
                value={form.buyerIdNumber}
                onChange={handleInputChange}
                placeholder="請輸入身份證末四碼"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
              />
            </label>
            <label className="form-field">
              <span>{"聯絡電話 *"}</span>
              <input name="buyerPhone" value={form.buyerPhone} onChange={handleInputChange} />
            </label>
          </div>
        </div>
        <div className="page-section" style={SECTION_CARD_STYLE}>
          <SectionTitle number="2" title="交付確認" />
          <p className="muted-text">{content.deliveryNotice}</p>
          <div className="checklist-list">
            {deliveryItems.map((item) => (
              <label key={item.value} className="checklist-item" htmlFor={`delivery-${item.value}`}>
                <input
                  id={`delivery-${item.value}`}
                  type="checkbox"
                  checked={form.deliveryChecks.includes(item.value)}
                  onChange={() => toggleChecklist("deliveryChecks", item.value)}
                />
                <span><strong>{item.label}</strong>{item.description ? ` - ${item.description}` : ""}</span>
              </label>
            ))}
            {explanationItems.map((item) => (
              <label key={item.value} className="checklist-item" htmlFor={`explanation-${item.value}`}>
                <input
                  id={`explanation-${item.value}`}
                  type="checkbox"
                  checked={form.staffExplanations.includes(item.value)}
                  onChange={() => toggleChecklist("staffExplanations", item.value)}
                />
                <span><strong>{item.label}</strong>{item.description ? ` - ${item.description}` : ""}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="page-section" style={SECTION_CARD_STYLE}>
          <SectionTitle number="3" title="購買使用條款" />
          <TermsContent content={content} />
          <div className="checklist-list">
            <label className="checklist-item" htmlFor="acceptance-terms" style={AGREEMENT_CHECK_STYLE}>
              <input
                id="acceptance-terms"
                type="checkbox"
                name="termsAccepted"
                checked={form.termsAccepted}
                onChange={handleInputChange}
              />
              <span>{content.termsAgreement}</span>
            </label>
          </div>
        </div>
        <div className="page-section" style={SECTION_CARD_STYLE}>
          <SectionTitle number="4" title="確認聲明" />
          <div className="checklist-list">
            <label className="checklist-item" htmlFor="acceptance-final">
              <input
                id="acceptance-final"
                type="checkbox"
                name="finalConfirmationAccepted"
                checked={form.finalConfirmationAccepted}
                onChange={handleInputChange}
              />
              <span>{content.finalStatement}</span>
            </label>
          </div>
        </div>
        <div className="page-section" style={SECTION_CARD_STYLE}>
          <SectionTitle number="5" title="購買者簽名" />
          <SignaturePad value={form.signatureData} onChange={(value) => setForm((current) => ({ ...current, signatureData: value }))} />
        </div>
        <button type="submit" className="primary-button" disabled={submitting}>
          {submitting ? "送出中..." : "提交並儲存確認書"}
        </button>
      </form>
    </div>
  );
}

export default PurchaseConfirmPublicPage;
