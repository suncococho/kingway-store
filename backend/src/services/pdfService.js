const fs = require("fs");
const path = require("path");

const storageDir = path.join(__dirname, "..", "..", "storage", "pdfs");

function escapePdfText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, "?");
}

function buildPdfBuffer(lines) {
  const content = [
    "BT",
    "/F1 12 Tf",
    "50 760 Td",
    ...lines.flatMap((line, index) => {
      const safeText = escapePdfText(line);
      if (index === 0) {
        return [`(${safeText}) Tj`];
      }
      return ["0 -18 Td", `(${safeText}) Tj`];
    }),
    "ET"
  ].join("\n");

  const objects = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
  objects.push("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj");
  objects.push(
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj"
  );
  objects.push("4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj");
  objects.push(`5 0 obj << /Length ${Buffer.byteLength(content, "utf8")} >> stream\n${content}\nendstream\nendobj`);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${object}\n`;
  }

  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";

  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

async function writePurchaseConfirmationPdf({ confirmationId, orderNo, customerName, customerPhone, submittedAt }) {
  fs.mkdirSync(storageDir, { recursive: true });
  const fileName = `purchase-confirmation-${confirmationId}.pdf`;
  const absolutePath = path.join(storageDir, fileName);
  const buffer = buildPdfBuffer([
    "KINGWAY Purchase Confirmation",
    `Confirmation ID: ${confirmationId}`,
    `Order No: ${orderNo}`,
    `Customer: ${customerName || "-"}`,
    `Phone: ${customerPhone || "-"}`,
    `Submitted At: ${submittedAt}`
  ]);
  fs.writeFileSync(absolutePath, buffer);

  return {
    absolutePath,
    publicPath: `/files/pdfs/${fileName}`
  };
}

module.exports = {
  writePurchaseConfirmationPdf
};
