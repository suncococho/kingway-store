const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { createError } = require("../utils/errors");
const { getActiveIncentivePlan } = require("./staffIncentiveService");

const STORAGE_ROOT = path.resolve(
  process.env.STAFF_INCENTIVE_AGREEMENT_STORAGE_DIR ||
    path.join(
      __dirname,
      "..",
      "..",
      "storage",
      "staff-incentive-agreements"
    )
);
const SIGNATURE_DIR = path.join(STORAGE_ROOT, "signatures");
const PDF_DIR = path.join(STORAGE_ROOT, "pdfs");
const FONT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "assets",
  "fonts",
  "NotoSansCJKtc-Regular.ttf"
);
const PUBLIC_STORAGE_PREFIX = "/staff-incentive-agreements/";
const REQUIRED_CHECK_KEYS = Object.freeze([
  "completionStandards",
  "caseOwnership",
  "truthfulRecords",
  "ordinaryWorkDuty",
  "pendingUntilComplete",
  "exceptionReporting",
  "policyAccepted"
]);
const CHECK_LABELS = Object.freeze({
  completionStandards: "我已閱讀並了解車輛銷售、交車、配件、維修檢查及售後追蹤之完成標準。",
  caseOwnership: "我了解接受案件或被指定為負責人後，應持續處理至本人負責階段完成，或完成明確交接。",
  truthfulRecords: "我了解系統紀錄必須與實際工作一致，不得虛報、代簽、倒填或提前標示完成。",
  ordinaryWorkDuty: "我了解未設績效獎金之一般工作仍屬本人職務，不得拒絕、拖延或消極處理。",
  pendingUntilComplete: "我了解案件尚未符合完成條件時，相關績效得維持待確認，補正完成後再予認定。",
  exceptionReporting: "我了解遇有異常、安全疑慮、顧客爭議或無法完成時，應立即回報主管並留下紀錄。",
  policyAccepted: "我同意遵守 KINGWAY 案件完成責任及銷售服務績效制度。"
});

function normalizePositiveId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError(`${label}格式錯誤`, 400);
  }
  return id;
}

function ensureStorage() {
  fs.mkdirSync(SIGNATURE_DIR, { recursive: true });
  fs.mkdirSync(PDF_DIR, { recursive: true });
  if (!fs.existsSync(FONT_PATH)) {
    throw createError("找不到績效同意書 PDF 字型", 500);
  }
}

function parseSignatureData(signatureData) {
  const value = String(signatureData || "").trim();
  const match = value.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) {
    throw createError("請完成有效的電子簽名", 400);
  }
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) {
    throw createError("簽名圖片大小不正確", 400);
  }
  return {
    buffer,
    extension: match[1].toLowerCase() === "image/jpeg" ? "jpg" : "png"
  };
}

function normalizeRequiredChecks(value) {
  const checks = value && typeof value === "object" ? value : {};
  const normalized = {};
  for (const key of REQUIRED_CHECK_KEYS) {
    normalized[key] = checks[key] === true;
    if (!normalized[key]) {
      throw createError("請逐項確認績效辦法與同意內容", 400);
    }
  }
  return normalized;
}

function safeFilePart(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "agreement";
}

function formatTaipeiDateTime(value = new Date()) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(value);
}

function buildAgreementNumber(storeId, planId, staffUserId) {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `KWI-${storeId}-${planId}-${staffUserId}-${timestamp}-${random}`;
}

async function loadStaffProfile(connection, storeId, staffUserId) {
  const [rows] = await connection.query(
    `
      SELECT
        su.id,
        COALESCE(NULLIF(TRIM(su.display_name), ''), su.username) AS displayName,
        su.username,
        su.role,
        s.name AS storeName
      FROM staff_users su
      INNER JOIN store_memberships sm
        ON sm.staff_user_id = su.id
       AND sm.store_id = ?
       AND sm.status = 'active'
      LEFT JOIN stores s ON s.id = sm.store_id
      WHERE su.id = ? AND su.is_active = 1
      LIMIT 1
    `,
    [storeId, staffUserId]
  );
  if (!rows[0]) {
    throw createError("找不到目前門市的員工資料", 404);
  }
  return {
    id: Number(rows[0].id),
    displayName: rows[0].displayName,
    username: rows[0].username,
    role: rows[0].role,
    storeName: rows[0].storeName || `Store ${storeId}`
  };
}

async function loadSignedAgreement(
  connection,
  { storeId, staffUserId, planVersionId, agreementId = null }
) {
  const where = [
    "a.store_id = ?",
    "a.staff_user_id = ?",
    "a.status = 'SIGNED'"
  ];
  const params = [storeId, staffUserId];
  if (planVersionId) {
    where.push("a.plan_version_id = ?");
    params.push(planVersionId);
  }
  if (agreementId) {
    where.push("a.id = ?");
    params.push(agreementId);
  }
  const [rows] = await connection.query(
    `
      SELECT
        a.id,
        a.store_id AS storeId,
        a.staff_user_id AS staffUserId,
        a.plan_version_id AS planVersionId,
        a.agreement_number AS agreementNumber,
        a.status,
        a.required_checks_json AS requiredChecksJson,
        a.signature_path AS signaturePath,
        a.pdf_path AS pdfPath,
        a.document_hash AS documentHash,
        a.authentication_method AS authenticationMethod,
        a.signed_at AS signedAt,
        COALESCE(NULLIF(TRIM(su.display_name), ''), su.username) AS staffDisplayName,
        p.version AS planVersion
      FROM staff_incentive_agreements a
      LEFT JOIN staff_users su ON su.id = a.staff_user_id
      LEFT JOIN staff_incentive_plan_versions p ON p.id = a.plan_version_id
      WHERE ${where.join(" AND ")}
      ORDER BY a.signed_at DESC, a.id DESC
      LIMIT 1
    `,
    params
  );
  if (!rows[0]) return null;
  return {
    id: Number(rows[0].id),
    storeId: Number(rows[0].storeId),
    staffUserId: Number(rows[0].staffUserId),
    planVersionId: Number(rows[0].planVersionId),
    agreementNumber: rows[0].agreementNumber,
    status: rows[0].status,
    requiredChecksJson: rows[0].requiredChecksJson || null,
    signaturePath: rows[0].signaturePath || null,
    pdfPath: rows[0].pdfPath || null,
    documentHash: rows[0].documentHash || null,
    authenticationMethod: rows[0].authenticationMethod || null,
    signedAt: rows[0].signedAt || null,
    staffDisplayName: rows[0].staffDisplayName || null,
    planVersion: rows[0].planVersion || null
  };
}

function writeText(doc, text, options = {}) {
  doc.font("NotoSansTC").fontSize(options.fontSize || 10.5).text(String(text || ""), {
    lineGap: options.lineGap ?? 3,
    align: options.align || "left"
  });
}

function writeRule(doc, label, value) {
  writeText(doc, `${label}：${value}`, { fontSize: 10.5 });
}

function renderAgreementPdf({
  agreementNumber,
  storeId,
  staff,
  plan,
  requiredChecks,
  signatureBuffer,
  signedAt
}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: {
        Title: "KINGWAY 員工銷售服務績效與案件完成責任同意書",
        Author: "KINGWAY",
        Subject: "員工銷售服務績效與案件完成責任同意書",
        Creator: "KINGWAY Store"
      }
    });
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("NotoSansTC", FONT_PATH);
    doc.font("NotoSansTC");

    doc.fontSize(18).text("KINGWAY 員工銷售服務績效與案件完成責任同意書", { align: "center" });
    doc.moveDown(0.5);
    writeRule(doc, "同意書編號", agreementNumber);
    writeRule(doc, "門市", `${staff.storeName}（#${storeId}）`);
    writeRule(doc, "員工", `${staff.displayName}（#${staff.id} / ${staff.role}）`);
    writeRule(doc, "辦法版本", plan.version);
    writeRule(doc, "生效日", formatTaipeiDateTime(new Date(plan.effectiveFrom)));
    writeRule(doc, "簽署時間", formatTaipeiDateTime(signedAt));

    doc.moveDown(0.7);
    doc.fontSize(13).text("一、績效計算辦法");
    doc.moveDown(0.25);
    writeText(doc, `1. 車輛銷售完整績效共 NT$${Number(plan.bikeSaleAmount + plan.bikeHandoverAmount + plan.bikeFollowupAmount).toFixed(0)}：完成付款 NT$${Number(plan.bikeSaleAmount).toFixed(0)}、完成交車 NT$${Number(plan.bikeHandoverAmount).toFixed(0)}、完成售後追蹤 NT$${Number(plan.bikeFollowupAmount).toFixed(0)}。`);
    writeText(doc, "2. 共同銷售須事前指定，主銷售 70%、協助銷售 30%，總額不增加。");
    writeText(doc, `3. 配件績效按每一個配件品項的實際成交金額 ${Number(plan.accessoryRate * 100).toFixed(0)}% 計算；取消、退款、免費贈品、內部或測試交易不列入。`);
    writeText(doc, "4. 一般自行車零件、維修零件、工資、安裝費、檢查費、運費及車體本身不列入配件績效。");
    writeText(doc, `5. 維修初步檢查於顧客實際支付檢查費 NT$400、初步診斷完成且符合條件時，績效為 NT$${Number(plan.repairInspectionAmount).toFixed(0)}；免費、保固、重複或未收款案件不列入。`);
    writeText(doc, "6. 已核准或已支付的績效不會自動扣回；如需更正，應透過有原因、申請人、核准人及時間紀錄的調整程序處理。");
    writeText(doc, "7. 未設績效的日常工作仍屬職務內容，員工不得因未設績效而拒絕執行。");

    if (plan.agreementText) {
      doc.moveDown(0.6);
      doc.fontSize(13).text("二、案件完成責任與門市辦法");
      doc.moveDown(0.25);
      writeText(doc, plan.agreementText);
    }

    doc.moveDown(0.6);
    doc.fontSize(13).text("三、員工逐項確認");
    doc.moveDown(0.25);
    for (const key of REQUIRED_CHECK_KEYS) {
      writeText(doc, `[已確認] ${CHECK_LABELS[key]}`);
    }

    doc.moveDown(0.7);
    doc.fontSize(13).text("四、電子簽名");
    doc.moveDown(0.25);
    writeText(doc, `簽署人：${staff.displayName}`);
    writeText(doc, `驗證方式：登入帳號工作階段（PASSWORD_SESSION）`);
    doc.moveDown(0.2);
    const signatureY = doc.y;
    doc.image(signatureBuffer, doc.x, signatureY, { fit: [230, 110] });
    doc.y = signatureY + 120;
    writeText(doc, "本人確認以上資料與電子簽名為本人意思表示，並同意依本辦法完成本人所承接或被指定之案件責任。後續版本如有變更，應另行閱讀並依系統要求重新確認。", { fontSize: 9.5 });
    doc.end();
  });
}

function relativeStoragePath(absolutePath) {
  const relative = path.relative(STORAGE_ROOT, absolutePath).split(path.sep).join("/");
  return `${PUBLIC_STORAGE_PREFIX}${relative}`;
}

function resolveAgreementStoragePath(storedPath) {
  const value = String(storedPath || "").trim();
  if (!value.startsWith(PUBLIC_STORAGE_PREFIX)) return null;
  const relative = value.slice(PUBLIC_STORAGE_PREFIX.length);
  const resolved = path.resolve(STORAGE_ROOT, relative);
  const root = path.resolve(STORAGE_ROOT) + path.sep;
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

async function signIncentiveAgreement(
  connection,
  {
    storeId,
    staffUserId,
    planVersionId,
    signatureData,
    requiredChecks,
    signerIp,
    signerUserAgent,
    signedAt = new Date()
  }
) {
  const normalizedStoreId = normalizePositiveId(storeId, "門市");
  const normalizedStaffUserId = normalizePositiveId(staffUserId, "員工");
  const normalizedPlanVersionId = normalizePositiveId(planVersionId, "績效辦法版本");
  const checks = normalizeRequiredChecks(requiredChecks);
  const signature = parseSignatureData(signatureData);
  ensureStorage();

  const [staff, plan] = await Promise.all([
    loadStaffProfile(connection, normalizedStoreId, normalizedStaffUserId),
    getActiveIncentivePlan(connection, normalizedStoreId, signedAt)
  ]);
  if (!plan || Number(plan.id) !== normalizedPlanVersionId) {
    throw createError("此績效辦法已不是目前可簽署的生效版本，請重新整理後再試", 409);
  }

  const existing = await loadSignedAgreement(connection, {
    storeId: normalizedStoreId,
    staffUserId: normalizedStaffUserId,
    planVersionId: plan.id
  });
  if (existing) {
    return { agreement: existing, alreadySigned: true };
  }

  const agreementNumber = buildAgreementNumber(
    normalizedStoreId,
    plan.id,
    normalizedStaffUserId
  );
  const fileBase = safeFilePart(agreementNumber);
  const signaturePath = path.join(SIGNATURE_DIR, `${fileBase}.${signature.extension}`);
  const pdfPath = path.join(PDF_DIR, `${fileBase}.pdf`);
  let signatureWritten = false;
  let pdfWritten = false;

  try {
    fs.writeFileSync(signaturePath, signature.buffer, { flag: "wx" });
    signatureWritten = true;
    const pdfBuffer = await renderAgreementPdf({
      agreementNumber,
      storeId: normalizedStoreId,
      staff,
      plan,
      requiredChecks: checks,
      signatureBuffer: signature.buffer,
      signedAt
    });
    fs.writeFileSync(pdfPath, pdfBuffer, { flag: "wx" });
    pdfWritten = true;
    const documentHash = crypto.createHash("sha256").update(pdfBuffer).digest("hex");

    const [result] = await connection.query(
      `
        INSERT INTO staff_incentive_agreements (
          store_id,
          staff_user_id,
          plan_version_id,
          agreement_number,
          status,
          required_checks_json,
          signature_path,
          pdf_path,
          document_hash,
          authentication_method,
          signer_ip,
          signer_user_agent,
          signed_at
        ) VALUES (?, ?, ?, ?, 'SIGNED', ?, ?, ?, ?, 'PASSWORD_SESSION', ?, ?, ?)
      `,
      [
        normalizedStoreId,
        normalizedStaffUserId,
        plan.id,
        agreementNumber,
        JSON.stringify(checks),
        relativeStoragePath(signaturePath),
        relativeStoragePath(pdfPath),
        documentHash,
        String(signerIp || "").slice(0, 100) || null,
        String(signerUserAgent || "").slice(0, 500) || null,
        signedAt
      ]
    );

    return {
      agreement: await loadSignedAgreement(connection, {
        storeId: normalizedStoreId,
        staffUserId: normalizedStaffUserId,
        planVersionId: plan.id,
        agreementId: result.insertId
      }),
      alreadySigned: false
    };
  } catch (error) {
    if (pdfWritten) {
      try { fs.unlinkSync(pdfPath); } catch (_cleanupError) {}
    }
    if (signatureWritten) {
      try { fs.unlinkSync(signaturePath); } catch (_cleanupError) {}
    }
    if (error?.code === "ER_DUP_ENTRY") {
      const duplicate = await loadSignedAgreement(connection, {
        storeId: normalizedStoreId,
        staffUserId: normalizedStaffUserId,
        planVersionId: plan.id
      });
      if (duplicate) return { agreement: duplicate, alreadySigned: true };
    }
    throw error;
  }
}

async function getAgreementPdfForStaff(
  connection,
  { storeId, staffUserId, agreementId = null }
) {
  const normalizedStoreId = normalizePositiveId(storeId, "門市");
  const normalizedStaffUserId = normalizePositiveId(staffUserId, "員工");
  const agreement = await loadSignedAgreement(connection, {
    storeId: normalizedStoreId,
    staffUserId: normalizedStaffUserId,
    agreementId: agreementId ? normalizePositiveId(agreementId, "同意書") : null
  });
  if (!agreement) throw createError("找不到本人已簽署的績效同意書", 404);
  const absolutePath = resolveAgreementStoragePath(agreement.pdfPath);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    throw createError("找不到績效同意書 PDF", 404);
  }
  return { agreement, absolutePath };
}

async function getAgreementPdfForAdmin(connection, { storeId, agreementId }) {
  const normalizedStoreId = normalizePositiveId(storeId, "門市");
  const normalizedAgreementId = normalizePositiveId(agreementId, "同意書");
  const [rows] = await connection.query(
    `
      SELECT
        a.id,
        a.staff_user_id AS staffUserId,
        a.agreement_number AS agreementNumber,
        a.pdf_path AS pdfPath,
        a.status
      FROM staff_incentive_agreements a
      WHERE a.id = ? AND a.store_id = ? AND a.status = 'SIGNED'
      LIMIT 1
    `,
    [normalizedAgreementId, normalizedStoreId]
  );
  if (!rows[0]) throw createError("找不到此門市的績效同意書", 404);
  const absolutePath = resolveAgreementStoragePath(rows[0].pdfPath);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    throw createError("找不到績效同意書 PDF", 404);
  }
  return {
    agreement: {
      id: Number(rows[0].id),
      staffUserId: Number(rows[0].staffUserId),
      agreementNumber: rows[0].agreementNumber,
      pdfPath: rows[0].pdfPath,
      status: rows[0].status
    },
    absolutePath
  };
}

module.exports = {
  REQUIRED_CHECK_KEYS,
  CHECK_LABELS,
  normalizeRequiredChecks,
  parseSignatureData,
  resolveAgreementStoragePath,
  signIncentiveAgreement,
  getAgreementPdfForStaff,
  getAgreementPdfForAdmin
};
