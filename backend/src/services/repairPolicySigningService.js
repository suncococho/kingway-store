const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const outputDir = path.join(__dirname, "..", "..", "uploads", "repair-policy-signing");
const MAX_PDF_BYTES = 5 * 1024 * 1024;

function sanitizeSignerName(value) {
  return String(value || "").trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/\s+/g, "_").slice(0, 60);
}

function formatTaipeiTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).formatToParts(date).reduce((result, part) => { result[part.type] = part.value; return result; }, {});
  return parts.year + parts.month + parts.day + "_" + parts.hour + parts.minute + parts.second;
}

function decodePdfDataUri(pdfBase64) {
  const match = String(pdfBase64 || "").match(/^data:application\/pdf(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) { const error = new Error("PDF 資料格式不正確。"); error.status = 400; throw error; }
  const buffer = Buffer.from(match[1], "base64");
  if (!buffer.length || buffer.length > MAX_PDF_BYTES || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    const error = new Error(buffer.length > MAX_PDF_BYTES ? "PDF 檔案超過 5 MB 限制。" : "PDF 檔案內容不正確。");
    error.status = 400; throw error;
  }
  return buffer;
}

async function storeRepairPolicySigningPdf({ pdfBase64, signerName }) {
  const safeSignerName = sanitizeSignerName(signerName);
  if (!safeSignerName) { const error = new Error("請填寫簽署人姓名。"); error.status = 400; throw error; }
  const pdf = decodePdfDataUri(pdfBase64);
  await fs.promises.mkdir(outputDir, { recursive: true });
  const timestamp = formatTaipeiTimestamp();
  let fileName = "repair-policy_" + safeSignerName + "_" + timestamp + ".pdf";
  let absolutePath = path.join(outputDir, fileName);
  let suffix = 1;
  while (fs.existsSync(absolutePath)) {
    fileName = "repair-policy_" + safeSignerName + "_" + timestamp + "_" + suffix + ".pdf";
    absolutePath = path.join(outputDir, fileName); suffix += 1;
  }
  await fs.promises.writeFile(absolutePath, pdf, { flag: "wx", mode: 0o640 });
  const sha256 = crypto.createHash("sha256").update(pdf).digest("hex");
  return { documentId: sha256.slice(0, 16), fileName, absolutePath, sha256 };
}

module.exports = { storeRepairPolicySigningPdf };
