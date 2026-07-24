import { useState } from "react";
import StatusBadge from "./StatusBadge";
import { apiRequest, apiUploadFile } from "../lib/api";

const LABELS = {
  NOT_REQUESTED: "尚未申請", PENDING_HEADQUARTERS: "等待總公司判定", NEED_MORE_INFORMATION: "需補充資料",
  APPROVED: "保固核准", REJECTED: "保固不成立", CANCELED: "已取消"
};

export default function WarrantyReviewPanel({ detail, repairId, canDecide, onUpdated }) {
  const status = String(detail.warranty_review_status || "NOT_REQUESTED").toUpperCase();
  const [showRequest, setShowRequest] = useState(false);
  const [files, setFiles] = useState([]);
  const [ids, setIds] = useState([]);
  const [form, setForm] = useState({ partName: "", purchaseDate: "", expirationDate: "", initialDiagnosis: detail.inspectionNotes || "", symptom: detail.issue_description || "", serialNumber: "", reviewNote: "", exteriorDamage: false, waterIngress: false, collisionDamage: false, modified: false, purchaseProofChecked: false });
  const [decision, setDecision] = useState({ decision: "APPROVED", reason: "", reference: "", customerNote: "" });
  const attachments = Array.isArray(detail.attachments) ? detail.attachments : [];

  async function uploadedIds() {
    const added = [];
    for (const file of files) {
      const result = await apiUploadFile(`/repairs/${repairId}/warranty-review/attachments`, file);
      added.push(Number(result.id));
    }
    setFiles([]);
    return [...new Set([...ids, ...added])];
  }

  async function requestReview() {
    await apiRequest(`/repairs/${repairId}/warranty-review/request`, { method: "POST", body: JSON.stringify({ ...form, attachmentIds: await uploadedIds() }) });
    setShowRequest(false);
    await onUpdated();
  }

  async function saveDecision() {
    await apiRequest(`/repairs/${repairId}/warranty-review/decision`, { method: "POST", body: JSON.stringify({ ...decision, attachmentIds: await uploadedIds() }) });
    await onUpdated();
  }

  async function supplement() {
    await apiRequest(`/repairs/${repairId}/warranty-review/supplement`, { method: "PATCH", body: JSON.stringify({ note: form.reviewNote, attachmentIds: await uploadedIds() }) });
    await onUpdated();
  }

  const setValue = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const field = (key, label, type = "text") => <label><span>{label}</span><input type={type} value={form[key]} onChange={(event) => setValue(key, event.target.value)} /></label>;
  const choose = (id) => setIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  return <section className="content-card warranty-review-panel">
    <div className="section-header"><div><h2>保固審查</h2><p className="muted-text">總公司判定前不會產生或發送正式報價。</p></div><StatusBadge tone={status === "APPROVED" ? "success" : status === "REJECTED" ? "danger" : status === "NOT_REQUESTED" ? "neutral" : "warning"}>{LABELS[status] || status}</StatusBadge></div>
    {status !== "NOT_REQUESTED" ? <div className="wizard-panel wizard-panel-yellow"><strong>此項目僅代表已受理保固審查，不代表免費維修已獲核准。</strong><div>費用：{["APPROVED", "REJECTED"].includes(status) ? "請建立最終報價" : "待總公司判定"}</div><div>審查零件：{detail.warranty_part_name || "-"}</div>{detail.warranty_review_reason ? <div>判定原因：{detail.warranty_review_reason}</div> : null}{detail.warranty_review_reference ? <div>回覆編號：{detail.warranty_review_reference}</div> : null}</div> : null}
    {status === "NOT_REQUESTED" && detail.inspectionNotes?.trim() ? <div className="action-row"><button type="button" className="secondary-button" onClick={() => setShowRequest(false)}>一般有償維修報價</button><button type="button" className="primary-button inline-submit" onClick={() => setShowRequest(true)}>送交總公司保固審查</button></div> : null}
    {showRequest ? <div className="form-grid">{field("partName", "審查零件")}{field("purchaseDate", "購買日", "date")}{field("expirationDate", "保固到期日", "date")}{field("serialNumber", "序號")}<label className="full-width"><span>初步診斷</span><textarea rows={4} value={form.initialDiagnosis} onChange={(e) => setValue("initialDiagnosis", e.target.value)} /></label><label className="full-width"><span>症狀</span><textarea rows={3} value={form.symptom} onChange={(e) => setValue("symptom", e.target.value)} /></label><label className="full-width"><span>總公司備註</span><textarea rows={3} value={form.reviewNote} onChange={(e) => setValue("reviewNote", e.target.value)} /></label>{[["exteriorDamage","外觀損傷"],["waterIngress","進水痕跡"],["collisionDamage","碰撞痕跡"],["modified","改裝"],["purchaseProofChecked","已確認購買證明"]].map(([key,label]) => <label key={key} className="checkbox-label"><input type="checkbox" checked={form[key]} onChange={(e) => setValue(key, e.target.checked)} /><span>{label}</span></label>)}</div> : null}
    {(showRequest || status === "NEED_MORE_INFORMATION" || (canDecide && ["PENDING_HEADQUARTERS", "APPROVED", "REJECTED"].includes(status))) ? <div className="stack-list"><label><span>新增照片或影片</span><input type="file" accept="image/*,video/*" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} /></label>{attachments.map((item) => <label key={item.id} className="checkbox-label"><input type="checkbox" checked={ids.includes(Number(item.id))} onChange={() => choose(Number(item.id))} /><span>{item.originalName}（{item.fileType === "video" ? "影片" : "圖片"}）</span></label>)}{showRequest ? <button type="button" className="primary-button inline-submit" onClick={requestReview}>確認送出保固審查</button> : null}{status === "NEED_MORE_INFORMATION" ? <><label><span>補充說明</span><textarea rows={3} value={form.reviewNote} onChange={(e) => setValue("reviewNote", e.target.value)} /></label><button type="button" className="primary-button inline-submit" onClick={supplement}>補充資料並重新送審</button></> : null}</div> : null}
    {canDecide && ["PENDING_HEADQUARTERS", "APPROVED", "REJECTED"].includes(status) ? <div className="form-grid"><label><span>總公司判定</span><select value={decision.decision} onChange={(e) => setDecision((c) => ({ ...c, decision: e.target.value }))}><option value="APPROVED">保固核准</option><option value="REJECTED">保固不成立</option><option value="NEED_MORE_INFORMATION">需補充資料</option></select></label><label><span>回覆或參考編號</span><input value={decision.reference} onChange={(e) => setDecision((c) => ({ ...c, reference: e.target.value }))} /></label><label className="full-width"><span>判定原因</span><textarea rows={3} value={decision.reason} onChange={(e) => setDecision((c) => ({ ...c, reason: e.target.value }))} /></label><label className="full-width"><span>客戶通知備註</span><textarea rows={3} value={decision.customerNote} onChange={(e) => setDecision((c) => ({ ...c, customerNote: e.target.value }))} /></label><button type="button" className="primary-button inline-submit" onClick={saveDecision}>儲存總公司判定</button></div> : null}
  </section>;
}
