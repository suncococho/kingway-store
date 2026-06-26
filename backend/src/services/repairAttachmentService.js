const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pool } = require("../db");
const { createError } = require("../utils/errors");

const MAX_REPAIR_ATTACHMENTS = 5;
const IMAGE_SIZE_LIMIT = 10 * 1024 * 1024;
const VIDEO_SIZE_LIMIT = 80 * 1024 * 1024;
const storageRoot = path.join(__dirname, "..", "..", "storage");
const repairAttachmentStorageDir = path.join(storageRoot, "repair-attachments");

const ALLOWED_ATTACHMENT_TYPES = {
  "image/jpeg": { fileType: "image", extension: ".jpg", maxSize: IMAGE_SIZE_LIMIT },
  "image/png": { fileType: "image", extension: ".png", maxSize: IMAGE_SIZE_LIMIT },
  "image/webp": { fileType: "image", extension: ".webp", maxSize: IMAGE_SIZE_LIMIT },
  "image/heic": { fileType: "image", extension: ".heic", maxSize: IMAGE_SIZE_LIMIT },
  "image/heif": { fileType: "image", extension: ".heif", maxSize: IMAGE_SIZE_LIMIT },
  "video/mp4": { fileType: "video", extension: ".mp4", maxSize: VIDEO_SIZE_LIMIT },
  "video/quicktime": { fileType: "video", extension: ".mov", maxSize: VIDEO_SIZE_LIMIT },
  "video/webm": { fileType: "video", extension: ".webm", maxSize: VIDEO_SIZE_LIMIT }
};

function normalizeMimeType(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function sanitizeOriginalName(value) {
  const normalized = String(value || "attachment")
    .normalize("NFKD")
    .replace(/[^\w.\-\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
  return normalized || "attachment";
}

function normalizeAttachmentRow(row) {
  return {
    id: row.id,
    storeId: row.storeId,
    repairOrderId: row.repairOrderId,
    uploadedBy: row.uploadedBy,
    fileType: row.fileType,
    originalName: row.originalName,
    storedName: row.storedName,
    mimeType: row.mimeType,
    fileSize: Number(row.fileSize || 0),
    storagePath: row.storagePath,
    publicUrl: row.publicUrl,
    createdAt: row.createdAt
  };
}

async function ensureRepairOrderAttachmentsSchema(connection = pool) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS repair_order_attachments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      store_id BIGINT UNSIGNED NOT NULL,
      repair_order_id BIGINT UNSIGNED NOT NULL,
      uploaded_by VARCHAR(40) NOT NULL DEFAULT 'customer',
      file_type ENUM('image','video') NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      stored_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      file_size BIGINT UNSIGNED NOT NULL,
      storage_path VARCHAR(500) NOT NULL,
      public_url VARCHAR(500) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_repair_order_attachments_repair (store_id, repair_order_id, created_at),
      INDEX idx_repair_order_attachments_store_created (store_id, created_at)
    )
  `);
}

async function listRepairAttachments(repairOrderId, storeId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT
        id,
        store_id AS storeId,
        repair_order_id AS repairOrderId,
        uploaded_by AS uploadedBy,
        file_type AS fileType,
        original_name AS originalName,
        stored_name AS storedName,
        mime_type AS mimeType,
        file_size AS fileSize,
        storage_path AS storagePath,
        public_url AS publicUrl,
        created_at AS createdAt
      FROM repair_order_attachments
      WHERE repair_order_id = ?
        AND store_id = ?
      ORDER BY id ASC
    `,
    [repairOrderId, storeId]
  );

  return rows.map(normalizeAttachmentRow);
}

async function countRepairAttachments(repairOrderId, storeId, connection = pool) {
  const [[row]] = await connection.query(
    `
      SELECT COUNT(*) AS count
      FROM repair_order_attachments
      WHERE repair_order_id = ?
        AND store_id = ?
    `,
    [repairOrderId, storeId]
  );
  return Number(row?.count || 0);
}

function validateAttachmentPayload(contentType, buffer) {
  const mimeType = normalizeMimeType(contentType);
  const rule = ALLOWED_ATTACHMENT_TYPES[mimeType];
  if (!rule) {
    throw createError("請上傳 JPG、PNG、WEBP、HEIC、HEIF、MP4、MOV 或 WEBM 檔案", 400);
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw createError("請選擇要上傳的照片或影片", 400);
  }
  if (buffer.length > rule.maxSize) {
    throw createError(rule.fileType === "image" ? "圖片不可超過 10MB" : "影片不可超過 80MB", 400);
  }

  return {
    ...rule,
    mimeType,
    fileSize: buffer.length
  };
}

async function saveRepairAttachment({
  storeId,
  repairOrderId,
  uploadedBy = "customer",
  originalName,
  contentType,
  buffer
}, connection = pool) {
  const scopedStoreId = Number(storeId);
  const scopedRepairOrderId = Number(repairOrderId);
  if (!Number.isSafeInteger(scopedStoreId) || scopedStoreId <= 0 || !Number.isSafeInteger(scopedRepairOrderId) || scopedRepairOrderId <= 0) {
    throw createError("維修單資料不正確", 400);
  }

  const attachmentRule = validateAttachmentPayload(contentType, buffer);
  const currentCount = await countRepairAttachments(scopedRepairOrderId, scopedStoreId, connection);
  if (currentCount >= MAX_REPAIR_ATTACHMENTS) {
    throw createError("每筆維修預約最多可上傳 5 個檔案", 400);
  }

  const storedName = `${crypto.randomUUID()}${attachmentRule.extension}`;
  const relativeDir = path.join("repair-attachments", `store-${scopedStoreId}`, `repair-${scopedRepairOrderId}`);
  const absoluteDir = path.join(storageRoot, relativeDir);
  const absolutePath = path.join(absoluteDir, storedName);
  const storagePath = path.posix.join(
    "repair-attachments",
    `store-${scopedStoreId}`,
    `repair-${scopedRepairOrderId}`,
    storedName
  );
  const publicUrl = `/files/${storagePath}`;

  await fs.promises.mkdir(absoluteDir, { recursive: true });
  await fs.promises.writeFile(absolutePath, buffer);

  const [result] = await connection.query(
    `
      INSERT INTO repair_order_attachments (
        store_id,
        repair_order_id,
        uploaded_by,
        file_type,
        original_name,
        stored_name,
        mime_type,
        file_size,
        storage_path,
        public_url
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      scopedStoreId,
      scopedRepairOrderId,
      String(uploadedBy || "customer").trim() || "customer",
      attachmentRule.fileType,
      sanitizeOriginalName(originalName),
      storedName,
      attachmentRule.mimeType,
      attachmentRule.fileSize,
      storagePath,
      publicUrl
    ]
  );

  return {
    id: result.insertId,
    storeId: scopedStoreId,
    repairOrderId: scopedRepairOrderId,
    uploadedBy: String(uploadedBy || "customer").trim() || "customer",
    fileType: attachmentRule.fileType,
    originalName: sanitizeOriginalName(originalName),
    storedName,
    mimeType: attachmentRule.mimeType,
    fileSize: attachmentRule.fileSize,
    storagePath,
    publicUrl,
    createdAt: null
  };
}

module.exports = {
  ALLOWED_ATTACHMENT_TYPES,
  IMAGE_SIZE_LIMIT,
  MAX_REPAIR_ATTACHMENTS,
  VIDEO_SIZE_LIMIT,
  ensureRepairOrderAttachmentsSchema,
  listRepairAttachments,
  saveRepairAttachment,
  validateAttachmentPayload,
  repairAttachmentStorageDir
};
