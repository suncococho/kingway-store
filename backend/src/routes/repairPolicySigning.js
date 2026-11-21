const express = require("express");
const { storeRepairPolicySigningPdf } = require("../services/repairPolicySigningService");

const router = express.Router();
const DOCUMENT_VERSION = "2026-08-13-rev2";

router.post("/store-repair/sign", async (req, res, next) => {
  try {
    const signerName = String(req.body?.signerName || "").trim();
    const signerTitle = String(req.body?.signerTitle || "").trim();
    if (!signerName || !signerTitle) return res.status(400).json({ ok: false, message: "請填寫部門／職稱及簽署人姓名。" });
    if (signerName.length > 60 || signerTitle.length > 60) return res.status(400).json({ ok: false, message: "部門／職稱及簽署人姓名不可超過 60 個字。" });
    if (req.body?.documentVersion !== DOCUMENT_VERSION) return res.status(400).json({ ok: false, message: "文件版本不正確，請重新整理頁面後再簽署。" });
    const result = await storeRepairPolicySigningPdf({ pdfBase64: req.body?.pdfBase64, signerName });
    return res.status(201).json({ ok: true, documentId: result.documentId, filename: result.fileName, sha256: result.sha256 });
  } catch (error) { return next(error); }
});

module.exports = router;
