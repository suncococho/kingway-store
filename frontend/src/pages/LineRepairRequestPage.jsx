import { useEffect, useRef, useState } from "react";
import liff from "@line/liff";
import { apiRequest, apiUploadFile } from "../lib/api";
import { resolveLineContext } from "../lib/lineContext";
import LinePhoneBindGate from "./LinePhoneBindGate";
import {
  DEFAULT_LINE_BINDING_STORE_CODE,
  cacheLineCustomerToObject,
  fetchLineBindingSnapshot,
  getLineBindingCache,
  saveLineBindingCache
} from "../lib/lineBindingRecovery";

const LEGACY_STORE_CONTEXT = {
  storeId: 1,
  storeCode: "KINGWAY_TAINAN",
  storeName: "KINGWAY 台南",
  customerOaName: "KINGWAY 台南門市 LINE",
  isExplicitStore: false
};

const REPAIR_WARRANTY_VERSION = "KINGWAY_REPAIR_WARRANTY_V2026_06";
const REPAIR_WARRANTY_ERROR_MESSAGE = "請先確認保固維修範圍說明";
const MAX_REPAIR_ATTACHMENTS = 5;
const IMAGE_SIZE_LIMIT = 10 * 1024 * 1024;
const VIDEO_SIZE_LIMIT = 80 * 1024 * 1024;
const ALLOWED_REPAIR_ATTACHMENT_TYPES = new Map([
  ["image/jpeg", { label: "圖片", maxSize: IMAGE_SIZE_LIMIT }],
  ["image/png", { label: "圖片", maxSize: IMAGE_SIZE_LIMIT }],
  ["image/webp", { label: "圖片", maxSize: IMAGE_SIZE_LIMIT }],
  ["image/heic", { label: "圖片", maxSize: IMAGE_SIZE_LIMIT }],
  ["image/heif", { label: "圖片", maxSize: IMAGE_SIZE_LIMIT }],
  ["video/mp4", { label: "影片", maxSize: VIDEO_SIZE_LIMIT }],
  ["video/quicktime", { label: "影片", maxSize: VIDEO_SIZE_LIMIT }],
  ["video/webm", { label: "影片", maxSize: VIDEO_SIZE_LIMIT }]
]);
const REPAIR_ATTACHMENT_ACCEPT = Array.from(ALLOWED_REPAIR_ATTACHMENT_TYPES.keys()).join(",");


const WARRANTY_APPLIES_ITEMS = [
  "交車日起一年內，於正常使用情況下發生之非人為製造缺陷。",
  "電控系統、控制器、馬達本體等主要零件於正常使用下發生之製造性故障。",
  "經本公司或授權技師檢查後，確認非因人為、外力、泡水、改裝或不當使用所造成之故障。"
];

const WARRANTY_EXCLUDED_ITEMS = [
  "消耗品磨耗：輪胎、內胎、煞車皮、煞車碟盤、鍊條、飛輪、腳踏板、握把套、座墊、燈泡、保險絲、土除、鑰匙等。",
  "外觀損耗：刮傷、掉漆、氧化、貼紙磨損、塑膠件破損等。",
  "非電控系統與車體結構件因外力、使用磨耗、摔車、碰撞、鏽蝕、變形或非製造缺陷造成之損壞。",
  "人為損壞：摔車、碰撞、撞擊、泡水、進水、超載、不當搬運、不當保管、錯誤充電。",
  "擅自改裝：解除速限、改裝控制器、馬達、電池、線路或其他電子控制裝置。",
  "違反法規或非正常用途使用：超速、違規道路使用、競速、越野、載人、營業租賃或其他非一般正常使用。",
  "電池容量自然衰退、正常耗損或因使用習慣造成之性能下降。",
  "火災、地震、泡水、天災或其他不可歸責於本公司之因素造成之損壞。",
  "非本公司或非授權人員維修、拆修、改裝造成之故障。",
  "因正常騎乘、磨耗、機械摩擦所產生，且經檢查非品質瑕疵之異音。",
  "車輛送修、搬運、拖吊、到府收送或運送費用，除本公司另有書面同意外，均由購買者自行負擔。"
];

function buildCustomerOaName(response, fallbackStoreName) {
  const configured = String(response?.lineSettings?.customerOaName || "").trim();
  if (configured) {
    return configured;
  }

  const baseName = String(response?.store?.storeName || fallbackStoreName || LEGACY_STORE_CONTEXT.storeName).trim();
  return baseName ? `${baseName} LINE` : LEGACY_STORE_CONTEXT.customerOaName;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function isPlaceholderCustomerName(value) {
  const normalized = normalizeText(value);
  return !normalized || normalized === "LINE 客戶" || normalized === "LINE Customer";
}

function formatFileSize(size) {
  const bytes = Number(size || 0);
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function inferRepairAttachmentMimeType(file) {
  const explicitType = String(file?.type || "").toLowerCase();
  if (explicitType) {
    return explicitType;
  }
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".heic")) return "image/heic";
  if (name.endsWith(".heif")) return "image/heif";
  if (name.endsWith(".mp4")) return "video/mp4";
  if (name.endsWith(".mov") || name.endsWith(".qt")) return "video/quicktime";
  if (name.endsWith(".webm")) return "video/webm";
  return "";
}

function validateRepairAttachmentFiles(files) {
  if (files.length > MAX_REPAIR_ATTACHMENTS) {
    return `最多可上傳 ${MAX_REPAIR_ATTACHMENTS} 個檔案。`;
  }

  for (const file of files) {
    const rule = ALLOWED_REPAIR_ATTACHMENT_TYPES.get(inferRepairAttachmentMimeType(file));
    if (!rule) {
      return "請上傳 JPG、PNG、WEBP、HEIC、HEIF、MP4、MOV 或 WEBM 檔案。";
    }
    if (Number(file.size || 0) > rule.maxSize) {
      return rule.label === "圖片" ? "圖片不可超過 10MB。" : "影片不可超過 80MB。";
    }
  }

  return "";
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

function LineRepairRequestPage() {
  const [loading, setLoading] = useState(true);
  const [storeLoading, setStoreLoading] = useState(true);
  const [storeContext, setStoreContext] = useState(LEGACY_STORE_CONTEXT);
  const [storeError, setStoreError] = useState("");
  const [customer, setCustomer] = useState(null);
  const [profileName, setProfileName] = useState("");
  const [lineUserId, setLineUserId] = useState("");
  const [form, setForm] = useState({
    bikeModel: "",
    reservationDate: "",
    issueDescription: "",
    repairWarrantyAccepted: false
  });
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const submitLockRef = useRef(false);
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

  useEffect(() => {
    async function loadStoreContext() {
      const params = new URLSearchParams(window.location.search);
      const storeCode = String(params.get("store") || "").trim();

      if (!storeCode) {
        setStoreContext(LEGACY_STORE_CONTEXT);
        setStoreError("");
        setStoreLoading(false);
        return LEGACY_STORE_CONTEXT;
      }

      try {
        const response = await apiRequest(`/storefront/resolve-store?store=${encodeURIComponent(storeCode)}`);
        const nextStoreContext = {
          storeId: Number(response?.store?.storeId || 0) || LEGACY_STORE_CONTEXT.storeId,
          storeCode: response?.store?.storeCode || storeCode,
          storeName: response?.store?.storeName || LEGACY_STORE_CONTEXT.storeName,
          customerOaName: buildCustomerOaName(response, response?.store?.storeName),
          isExplicitStore: true
        };
        setStoreContext(nextStoreContext);
        setStoreError("");
        return nextStoreContext;
      } catch (resolveError) {
        setStoreError(resolveError.message || "找不到有效的門市資訊");
        return null;
      } finally {
        setStoreLoading(false);
      }
    }

    async function init() {
      const resolvedStoreContext = await loadStoreContext();
      if (!resolvedStoreContext) {
        setLoading(false);
        return;
      }

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
            setCustomer(cachedCustomer);
          }
          return;
        }

        const storeCode = resolvedStoreContext.isExplicitStore
          ? resolvedStoreContext.storeCode
          : DEFAULT_LINE_BINDING_STORE_CODE;
        const data = await fetchLineBindingSnapshot({
          lineUserId: context.lineUserId,
          displayName: context.displayName || "",
          endpoint: "/line-repair/customer",
          storeCode
        });

        if (data?.customer) {
          setCustomer(data.customer || null);
          saveLineBindingCache({
            lineUserId: context.lineUserId,
            customer: data.customer,
            storeCode
          });
        } else {
          const cachedCustomer = cacheLineCustomerToObject(
            getLineBindingCache(context.lineUserId)
          );
          if (cachedCustomer) {
            setCustomer(cachedCustomer);
          }
        }
      } catch (err) {
        if (String(err.message || "").includes("access token expired")) {
          try { liff.logout(); } catch (e) {}
          liff.login();
          return;
        }
        setError(err.message || "讀取客戶資料失敗");
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateAttachments(event) {
    const files = Array.from(event.target.files || []);
    const validationError = validateRepairAttachmentFiles(files);
    if (validationError) {
      setError(validationError);
      event.target.value = "";
      setAttachments([]);
      return;
    }
    setError("");
    setAttachments(files);
  }

  async function uploadRepairAttachments(repairId) {
    if (!attachments.length) {
      return [];
    }

    setUploadingAttachments(true);
    try {
      const storeQuery = storeContext.isExplicitStore
        ? `&store=${encodeURIComponent(storeContext.storeCode)}`
        : "";
      const uploaded = [];
      for (const file of attachments) {
        const response = await apiUploadFile(
          `/line-repair/${repairId}/attachments?lineUserId=${encodeURIComponent(lineUserId)}${storeQuery}` ,
          file,
          { "X-Line-User-Id": lineUserId, "Content-Type": inferRepairAttachmentMimeType(file) }
        );
        uploaded.push(response?.attachment || response);
      }
      return uploaded;
    } finally {
      setUploadingAttachments(false);
    }
  }



  async function submit(event) {
    event.preventDefault();

    if (submitLockRef.current) {
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setError("");

    if (!customer?.id) {
      setError("尚未找到綁定資料，請先回 LINE 對話輸入手機號碼完成綁定。");
      setSubmitting(false);
      submitLockRef.current = false;
      return;
    }

    if (!form.bikeModel.trim()) {
      setError("請填寫車款 / 車種。");
      setSubmitting(false);
      submitLockRef.current = false;
      return;
    }

    if (!form.issueDescription.trim()) {
      setError("請填寫問題描述。");
      setSubmitting(false);
      submitLockRef.current = false;
      return;
    }

    if (!form.repairWarrantyAccepted) {
      setError(REPAIR_WARRANTY_ERROR_MESSAGE);
      setSubmitting(false);
      submitLockRef.current = false;
      return;
    }

    try {
      const storeQuery = storeContext.isExplicitStore
        ? `?store=${encodeURIComponent(storeContext.storeCode)}`
        : "";
      const data = await apiRequest(`/line-repair/create${storeQuery}`, {
        method: "POST",
        body: JSON.stringify({
          lineUserId,
          displayName: profileName,
          bikeModel: form.bikeModel,
          reservationDate: form.reservationDate || null,
          issueDescription: form.issueDescription,
          warrantyTermsAccepted: true,
          repairWarrantyAccepted: true,
          warrantyTermsVersion: REPAIR_WARRANTY_VERSION,
          storeCode: storeContext.isExplicitStore ? storeContext.storeCode : undefined
        })
      });

      let uploadedAttachments = [];
      let attachmentUploadError = "";
      if (attachments.length && data?.repairId) {
        try {
          uploadedAttachments = await uploadRepairAttachments(data.repairId);
        } catch (uploadError) {
          attachmentUploadError = uploadError.message || "附件上傳失敗，維修預約已建立，請聯繫門市補傳。";
        }
      }

      setSubmitResult({
        ...(data || {}),
        uploadedAttachments,
        attachmentUploadError
        });
      setDone(true);
    } catch (err) {
      setError(err.message || "送出失敗");
      setSubmitting(false);
      submitLockRef.current = false;
    }
  }

  if (loading) {
    return (
      <div className="line-customer-page">
        {!storeLoading ? (
          <section className="line-customer-summary">
            <div className="line-customer-summary-title">{storeError ? "門市資訊" : storeContext.storeName}</div>
            <div>{storeError ? storeError : storeContext.customerOaName}</div>
          </section>
        ) : null}
        <section className="line-customer-summary">資料讀取中...</section>
      </div>
    );
  }

  if (done) {
    return (
      <div className="line-customer-page">
        <section className="line-customer-hero">
          <div className="line-customer-brand">KINGWAY</div>
          <h1>維修預約已送出</h1>
          <p>
            {submitResult?.duplicate || submitResult?.reusedExisting
              ? "維修預約已建立，請勿重複送出。"
              : "門市收到後會確認內容，並透過 LINE 或電話與您聯繫。"}
            {submitResult?.repairId ? ` 維修單號：${submitResult.repairId}` : ""}
          </p>
          {submitResult?.uploadedAttachments?.length ? (
            <p>已上傳 {submitResult.uploadedAttachments.length} 個照片 / 影片附件。</p>
          ) : null}
          {submitResult?.attachmentUploadError ? (
            <div className="error-banner">{submitResult.attachmentUploadError}</div>
          ) : null}
        </section>
        <button className="line-customer-close" onClick={() => liff.isInClient() ? liff.closeWindow() : window.location.href = "/line-customer"}>
          關閉
        </button>
      </div>
    );
  }

  return (
    <div className="line-customer-page">
      <section className="line-customer-hero">
        <div className="line-customer-brand">KINGWAY</div>
        <h1>維修預約</h1>
        <p>請填寫車款、希望到店日期與問題描述。</p>
      </section>

      {!storeLoading ? (
        <section className="line-customer-summary">
          <div className="line-customer-summary-title">{storeError ? "門市資訊" : storeContext.storeName}</div>
          <div>{storeError ? storeError : `目前 OA：${storeContext.customerOaName}`}</div>
        </section>
      ) : null}

      {storeError ? null : (!customer || !customer.phone) ? (
        <LinePhoneBindGate
          lineUserId={lineUserId}
          displayName={profileName}
          inClient={lineInClient}
          failureReason={lineContextFailureReason}
          lineContextDebug={lineContextDebug}
          onBound={async (phone) => {
            const storeCode = storeContext.isExplicitStore ? storeContext.storeCode : DEFAULT_LINE_BINDING_STORE_CODE;
            const restored = await fetchLineBindingSnapshot({
              lineUserId,
              displayName: profileName,
              endpoint: "/line-repair/customer",
              storeCode
            });

            if (restored?.customer) {
              setCustomer(restored.customer);
              saveLineBindingCache({
                lineUserId,
                customer: restored.customer,
                storeCode
              });
              return;
            }

            setCustomer((current) => {
              const next = { ...(current || {}), phone };
              saveLineBindingCache({
                lineUserId,
                customer: next,
                storeCode
              });
              return next;
            });
          }}
        />
      ) : (
          <>
          <section className="line-customer-summary">
            <div className="line-customer-summary-title">{resolveDisplayName(profileName, customer?.name)}</div>
            <div>電話：<strong>{customer?.phone}</strong></div>
          </section>

          {error ? <div className="error-banner">{error}</div> : null}
          {submitting ? (
            <section className="line-customer-summary">
              <div className="line-customer-summary-title">正在送出維修預約，請不要重複點擊</div>
              <div>{uploadingAttachments ? "附件上傳中，請稍候..." : "送出中，請稍候..."}</div>
            </section>
          ) : null}

          <form className="line-customer-summary" onSubmit={submit}>
        <label className="form-field">
          <span>車款 / 車種</span>
          <input value={form.bikeModel} onChange={(e) => update("bikeModel", e.target.value)} placeholder="例如 Fatbike / 電動自行車 / 車款名稱" disabled={submitting} />
        </label>

        <label className="form-field">
          <span>希望到店日期</span>
          <input type="date" value={form.reservationDate} onChange={(e) => update("reservationDate", e.target.value)} disabled={submitting} />
        </label>

        <label className="form-field">
          <span>問題描述</span>
          <textarea rows="5" value={form.issueDescription} onChange={(e) => update("issueDescription", e.target.value)} placeholder="請描述故障情況，例如無法啟動、煞車異音、電池問題、控制器問題等" disabled={submitting} />
        </label>

        <label className="form-field">
          <span>照片 / 影片附件（選填，最多 5 個）</span>
          <input type="file" accept={REPAIR_ATTACHMENT_ACCEPT} multiple onChange={updateAttachments} disabled={submitting || uploadingAttachments} />
        </label>
        {attachments.length ? (
          <div className="line-attachment-list">
            {attachments.map((file) => (
              <div className="line-attachment-item" key={`${file.name}-${file.size}-${file.lastModified}` }>
                <span>{inferRepairAttachmentMimeType(file).startsWith("video/") ? "影片" : "圖片"}</span>
                <strong>{file.name}</strong>
                <small>{formatFileSize(file.size)}</small>
              </div>
            ))}
          </div>
        ) : null}

        <div className="line-warranty-terms">
          <div className="line-customer-summary-title">保固維修範圍確認</div>
          <p>請於送修前詳閱以下保固維修說明。本公司一年保固僅限正常使用下之非人為製造缺陷，並非所有故障或損壞皆屬免費保固。</p>

          <h3>保固可能適用之情形：</h3>
          <ol>
            {WARRANTY_APPLIES_ITEMS.map((item) => <li key={item}>{item}</li>)}
          </ol>

          <h3>不屬於免費保固範圍之情形：</h3>
          <ol>
            {WARRANTY_EXCLUDED_ITEMS.map((item) => <li key={item}>{item}</li>)}
          </ol>

          <h3>非保固檢修費：</h3>
          <p>非保固範圍之車輛，無論是否維修，檢修費用為 NT$400 元。</p>

          <h3>進口商品或零件：</h3>
          <p>進口商品或進口零件維修，因材料需進口，維修完成日期無法事先保證，將於確認後另行通知。</p>

          <h3>報價與取車期限：</h3>
          <p>維修報價後，顧客應於 7 日內確認是否維修。若選擇不維修，請於 7 日內取車。逾期未取車者，本公司得安排配送，運費到付；如無法配送或顧客未取車，將收取 NT$80 元／日之保管費。</p>

          <h3>維修完成後取車期限：</h3>
          <p>維修完成後，本公司將通知顧客取車。顧客應於通知後 7 日內取車；逾期未取車者，將收取 NT$80 元／日之保管費。</p>

          <h3>提醒：</h3>
          <p>經檢查後若不屬於保固範圍，本公司將提供維修報價；顧客同意後才會進行維修。顧客不得以購買未滿一年為由，要求所有維修均免費處理。</p>

          <label className="checklist-item" htmlFor="repair-warranty-accepted">
            <input
              id="repair-warranty-accepted"
              type="checkbox"
              checked={form.repairWarrantyAccepted}
              onChange={(e) => update("repairWarrantyAccepted", e.target.checked)}
              disabled={submitting}
            />
            <span>我已閱讀並了解上述保固維修範圍、非保固檢修費、報價確認期限及逾期保管費規定，並同意是否屬於保固須以本公司檢查判定為準；若不屬於保固範圍，維修費用、檢修費、運送費及保管費由本人自行負擔。</span>
          </label>
        </div>

        <button className="line-customer-close" type="submit" disabled={submitting || !form.repairWarrantyAccepted}>
          {uploadingAttachments ? "附件上傳中..." : submitting ? "送出中，請稍候..." : "送出維修預約"}
        </button>
          </form>
        </>
      )}
    </div>
  );
}

export default LineRepairRequestPage;
