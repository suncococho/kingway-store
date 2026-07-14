import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import SignaturePad from "../components/SignaturePad";
import WarrantyRepairAdditionalTerms from "../components/WarrantyRepairAdditionalTerms";
import { apiRequest } from "../lib/api";

const SIGNATURE_MAX_WIDTH = 900;
const SIGNATURE_MAX_HEIGHT = 360;
const SIGNATURE_JPEG_QUALITY = 0.75;
const SIGNATURE_MAX_DATA_URL_LENGTH = 600000;
const SIGNATURE_TOO_LARGE_MESSAGE = "簽名資料過大，請清除簽名後重新簽名，或重新整理頁面後再試一次。";

const EMPTY_FORM = {
  confirmationChecks: [],
  termsAccepted: false,
  finalConfirmationAccepted: false,
  signatureData: ""
};

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
  if (!normalizedSignatureData || typeof document === "undefined") {
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

function formatAmount(value) {
  return `NT$${Number(value || 0).toFixed(0)}`;
}

function formatMileageKm(value) {
  if (value === undefined || value === null || value === "") {
    return "未確認";
  }
  const mileage = Number(value);
  return Number.isFinite(mileage) ? `${mileage.toFixed(0)} km` : "未確認";
}

function formatDateTime(value) {
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

function TermsContent({ content }) {
  return (
    <div className="terms-block">
      {(content.terms || []).map((section) => (
        <div key={section.title} className="terms-section">
          <h3>{section.title}</h3>
          {section.intro ? <p>{section.intro}</p> : null}
          {section.paragraph ? <p>{section.paragraph}</p> : null}
          {Array.isArray(section.items) ? (
            <ol>
              {section.items.map((item) => <li key={item}>{item}</li>)}
            </ol>
          ) : null}
        </div>
      ))}
      <p className="warning-text">{content.warning}</p>
      <WarrantyRepairAdditionalTerms />
    </div>
  );
}

function RepairConfirmPublicPage() {
  const { token: pathToken } = useParams();
  const location = useLocation();
  const token = pathToken || String(new URLSearchParams(location.search).get("token") || "").trim();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");

  useEffect(() => {
    async function load() {
      if (!token) {
        setError("缺少維修完成確認書連結");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      try {
        const response = await apiRequest(`/repair-confirmations/public/${token}`);
        setData(response);
        setPdfUrl(response?.pdfUrl || "");
      } catch (loadError) {
        setError(loadError.message || "載入維修完成確認書失敗");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [token]);

  function toggleChecklist(item) {
    setForm((current) => {
      const exists = current.confirmationChecks.includes(item);
      return {
        ...current,
        confirmationChecks: exists
          ? current.confirmationChecks.filter((value) => value !== item)
          : [...current.confirmationChecks, item]
      };
    });
  }

  function handleCheckboxChange(event) {
    const { name, checked } = event.target;
    setForm((current) => ({ ...current, [name]: checked }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const content = data?.content || {};
    const requiredChecks = content.confirmationChecks || [];
    const checkedSet = new Set(form.confirmationChecks);

    if (!requiredChecks.every((item) => checkedSet.has(item))) {
      alert(content.errors?.confirmationChecks || "請完成所有確認項目");
      return;
    }
    if (!form.termsAccepted) {
      alert(content.errors?.termsAccepted || "請確認條款");
      return;
    }
    if (!form.finalConfirmationAccepted) {
      alert(content.errors?.finalConfirmationAccepted || "請完成最終確認");
      return;
    }
    if (!form.signatureData) {
      alert(content.errors?.signatureData || "請完成簽名");
      return;
    }

    setSubmitting(true);
    try {
      const compressedSignatureData = await compressSignatureDataUrl(form.signatureData);
      const response = await apiRequest(`/repair-confirmations/public/${token}/submit`, {
        method: "POST",
        body: JSON.stringify({
          confirmationChecks: form.confirmationChecks,
          termsAccepted: form.termsAccepted,
          finalConfirmationAccepted: form.finalConfirmationAccepted,
          signatureData: compressedSignatureData
        })
      });
      setData(response);
      setPdfUrl(response?.pdfUrl || "");
      setSubmitted(true);
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    } catch (submitError) {
      alert(submitError.message || "送出失敗");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="public-page">載入中...</div>;
  }

  if (error) {
    return (
      <div className="public-page">
        <div className="public-card">
          <h1>維修完成確認書</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="public-page">
        <div className="public-card">
          <h1>維修完成確認書</h1>
          <p>目前無法取得維修確認資料。</p>
        </div>
      </div>
    );
  }

  const content = data.content || {};
  const completed = submitted || data.completed || data.status === "COMPLETED";

  if (completed) {
    return (
      <div className="public-page">
        <div className="public-card">
          <h1>已完成維修確認</h1>
          <p>您已完成本次維修完成確認，無需重複提交。</p>
          {data.repairOrderId ? <p>{`維修單號：#${data.repairOrderId}`}</p> : null}
          {data.submittedAt ? <p>{`完成時間：${formatDateTime(data.submittedAt)}`}</p> : null}
          {pdfUrl ? (
            <a className="primary-button" href={pdfUrl} target="_blank" rel="noreferrer">
              查看維修確認書 PDF
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="public-page">
      <form className="public-card purchase-confirm-card" onSubmit={handleSubmit}>
        <h1>{content.pageTitle || "KINGWAY 維修完成確認書"}</h1>
        <p>{content.pageSubtitle || "維修完成取車確認與簽名表單"}</p>

        <div className="page-section">
          <h2>A. 顧客與車輛資料</h2>
          <div className="grid-form compact-grid">
            <div className="field-item"><div className="field-label">顧客姓名</div><div className="field-value">{data.customerName || "-"}</div></div>
            <div className="field-item"><div className="field-label">電話</div><div className="field-value">{data.customerPhone || "-"}</div></div>
            <div className="field-item"><div className="field-label">維修單號</div><div className="field-value">#{data.repairOrderId}</div></div>
            <div className="field-item"><div className="field-label">車款 / 車輛資訊</div><div className="field-value">{data.vehicleModel || "-"}</div></div>
            <div className="field-item"><div className="field-label">目前行駛里程</div><div className="field-value">{formatMileageKm(data.mileageKm)}</div></div>
            <div className="field-item form-field-wide"><div className="field-label">送修問題</div><div className="field-value">{data.issue || "-"}</div></div>
            <div className="field-item form-field-wide"><div className="field-label">本次維修內容</div><div className="field-value">{data.repairSummary || "-"}</div></div>
            <div className="field-item"><div className="field-label">維修費用</div><div className="field-value">{formatAmount(data.amountTotal)}</div></div>
            <div className="field-item"><div className="field-label">付款狀態</div><div className="field-value">{data.paymentStatus || "-"}</div></div>
          </div>
        </div>

        <div className="page-section">
          <h2>B. 本次維修內容確認</h2>
          <div className="checklist-list">
            {(content.confirmationChecks || []).map((item) => (
              <label key={item} className="checklist-item" htmlFor={`repair-check-${item}`}>
                <input
                  id={`repair-check-${item}`}
                  type="checkbox"
                  checked={form.confirmationChecks.includes(item)}
                  onChange={() => toggleChecklist(item)}
                />
                <span>{item}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="page-section">
          <h2>C. 維修完成確認條款</h2>
          <TermsContent content={content} />
          <div className="checklist-list">
            <label className="checklist-item" htmlFor="repair-terms-accepted">
              <input
                id="repair-terms-accepted"
                type="checkbox"
                name="termsAccepted"
                checked={form.termsAccepted}
                onChange={handleCheckboxChange}
              />
              <span>我已閱讀並同意上述維修完成條款、保固範圍與非保固範圍。</span>
            </label>
            <label className="checklist-item" htmlFor="repair-final-accepted">
              <input
                id="repair-final-accepted"
                type="checkbox"
                name="finalConfirmationAccepted"
                checked={form.finalConfirmationAccepted}
                onChange={handleCheckboxChange}
              />
              <span>{content.finalStatement}</span>
            </label>
          </div>
        </div>

        <div className="page-section">
          <h2>D. 顧客簽名</h2>
          <SignaturePad value={form.signatureData} onChange={(signatureData) => setForm((current) => ({ ...current, signatureData }))} />
        </div>

        <button type="submit" className="primary-button full-width-button" disabled={submitting}>
          {submitting ? "送出中，請稍候…" : "送出維修確認"}
        </button>
      </form>
    </div>
  );
}

export default RepairConfirmPublicPage;
