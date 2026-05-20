const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const purchaseConfirmationContent = require("../content/purchaseConfirmationContent.json");

const storageDir = path.join(__dirname, "..", "..", "storage", "pdfs");
const fontPath = path.join(__dirname, "..", "..", "assets", "fonts", "NotoSansCJKtc-Regular.ttf");

function ensureFontExists() {
  if (!fs.existsSync(fontPath)) {
    throw new Error(`Missing purchase confirmation PDF font: ${fontPath}`);
  }
}

function parseDataUriImage(dataUri) {
  const matched = String(dataUri || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!matched) {
    return null;
  }

  return {
    mimeType: matched[1],
    buffer: Buffer.from(matched[2], "base64")
  };
}

function buildChecklistLine(selectedItems, item) {
  return `${selectedItems.includes(item) ? "[已確認]" : "[未確認]"} ${item}`;
}

function createPdfDocument() {
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    info: {
      Title: "KINGWAY 購買確認書",
      Author: "KINGWAY 台南",
      Subject: "購買確認書",
      Creator: "KINGWAY Store"
    }
  });

  doc.registerFont("NotoSansTC", fontPath);
  doc.font("NotoSansTC");
  doc.on("pageAdded", () => {
    doc.font("NotoSansTC").fontSize(11);
  });

  return doc;
}

function writeSectionTitle(doc, title) {
  doc.moveDown(0.6);
  doc.font("NotoSansTC").fontSize(14).text(title, { align: "left" });
  doc.moveDown(0.3);
}

function writeBodyText(doc, text, options = {}) {
  doc.font("NotoSansTC").fontSize(options.fontSize || 11).text(String(text || ""), {
    width: options.width,
    align: options.align || "left",
    lineGap: options.lineGap ?? 3
  });
}

function writePurchaseConfirmationContent(doc, payload) {
  const {
    confirmationId,
    orderNo,
    customerName,
    customerPhone,
    buyerIdNumber,
    deliveryChecks,
    staffExplanations,
    submittedAt,
    signatureData
  } = payload;

  doc.font("NotoSansTC").fontSize(20).text("KINGWAY 購買確認書", { align: "center" });
  doc.moveDown(0.5);
  writeBodyText(doc, `確認書編號：${confirmationId}`);
  writeBodyText(doc, `訂單編號：${orderNo}`);
  writeBodyText(doc, `提交時間：${submittedAt}`);

  writeSectionTitle(doc, "1. 購買者資料");
  writeBodyText(doc, `客戶姓名：${customerName || "-"}`);
  writeBodyText(doc, `電話：${customerPhone || "-"}`);
  writeBodyText(doc, `證件號碼或末四碼：${buyerIdNumber || "-"}`);

  writeSectionTitle(doc, "2. 自行車交付檢查");
  purchaseConfirmationContent.deliveryChecks.forEach((item) => {
    writeBodyText(doc, buildChecklistLine(deliveryChecks, item));
  });

  writeSectionTitle(doc, "3. 店員說明確認");
  purchaseConfirmationContent.staffExplanations.forEach((item) => {
    writeBodyText(doc, buildChecklistLine(staffExplanations, item));
  });

  writeSectionTitle(doc, "4. 購買條款");
  purchaseConfirmationContent.terms.forEach((term, index) => {
    writeBodyText(doc, `${index + 1}. ${term}`);
    doc.moveDown(0.2);
  });

  writeSectionTitle(doc, "5. 最終確認");
  writeBodyText(doc, purchaseConfirmationContent.finalStatement);
  writeBodyText(doc, "簽名狀態：已完成電子簽名");

  writeSectionTitle(doc, "6. 客戶簽名");
  const signatureImage = parseDataUriImage(signatureData);
  if (signatureImage) {
    const startX = doc.x;
    writeBodyText(doc, "電子簽名：");
    const imageY = doc.y + 4;
    doc.image(signatureImage.buffer, startX, imageY, {
      fit: [220, 110],
      align: "left",
      valign: "top"
    });
    doc.y = imageY + 120;
  } else {
    writeBodyText(doc, "電子簽名：已完成");
  }
}

async function writePurchaseConfirmationPdf({
  confirmationId,
  orderNo,
  customerName,
  customerPhone,
  buyerIdNumber,
  deliveryChecks,
  staffExplanations,
  submittedAt,
  signatureData
}) {
  ensureFontExists();
  fs.mkdirSync(storageDir, { recursive: true });
  const fileName = `purchase-confirmation-${confirmationId}.pdf`;
  const absolutePath = path.join(storageDir, fileName);

  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(absolutePath);
    const doc = createPdfDocument();

    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);

    doc.pipe(stream);
    writePurchaseConfirmationContent(doc, {
      confirmationId,
      orderNo,
      customerName,
      customerPhone,
      buyerIdNumber,
      deliveryChecks,
      staffExplanations,
      submittedAt,
      signatureData
    });
    doc.end();
  });

  return {
    absolutePath,
    publicPath: `/files/pdfs/${fileName}`
  };
}

module.exports = {
  writePurchaseConfirmationPdf
};
