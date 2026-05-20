"use strict";

const PRODUCT_CATEGORY_LABELS = {
  EB: "電動自行車",
  RP: "維修",
  PT: "配件",
  AC: "改裝套件",
  TR: "輪胎",
  LT: "燈具",
  LK: "鎖具",
  SE: "椅子",
  HB: "車把握把腳踏",
  CR: "載具",
  OT: "其他"
};

const PRODUCT_CATEGORY_ORDER = ["EB", "RP", "PT", "AC", "TR", "LT", "LK", "SE", "HB", "CR", "OT"];
const DEFAULT_PRODUCT_REGION = "C";
const DEFAULT_PRODUCT_SHELF = "S1";
const PRODUCT_CATEGORY_ALIASES = {
  EBIKE: "EB",
  REPAIR: "RP",
  ACCESSORY: "PT",
  OTHER: "OT",
  FK: "PT",
  BG: "PT",
  CL: "PT",
  FP: "PT",
  EX: "OT",
  TN: "AC",
  ST: "SE",
  LT: "LT",
  TY: "OT",
  HG: "HB",
  CR: "CR",
  TR: "TR",
  LC: "LK"
};

function normalizeProductCategoryCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return PRODUCT_CATEGORY_ALIASES[normalized] || normalized;
}

function normalizeProductSku(value) {
  return String(value || "").trim().toUpperCase();
}

function parseProductSku(value) {
  const sku = normalizeProductSku(value);
  if (!sku) {
    return null;
  }

  const parts = sku.split("-");
  if (parts.length !== 4) {
    return null;
  }

  const [region, rawCategory, sequence, shelf] = parts.map((part) => String(part || "").trim().toUpperCase());
  const category = normalizeProductCategoryCode(rawCategory);
  if (!region || !PRODUCT_CATEGORY_LABELS[category] || !/^\d{3}$/.test(sequence) || !shelf) {
    return null;
  }

  return {
    region,
    category,
    sequence,
    shelf,
    sku: `${region}-${category}-${sequence}-${shelf}`
  };
}

function deriveProductCategoryFromSku(value) {
  const parsed = parseProductSku(value);
  return parsed ? parsed.category : "OT";
}

function normalizeProductCategory(value) {
  const normalized = normalizeProductCategoryCode(value);
  return PRODUCT_CATEGORY_LABELS[normalized] ? normalized : "OT";
}

function isValidProductSku(value) {
  return Boolean(parseProductSku(value));
}

function buildProductSku({ region = DEFAULT_PRODUCT_REGION, category = "OT", sequence = 1, shelf = DEFAULT_PRODUCT_SHELF } = {}) {
  const normalizedRegion = String(region || DEFAULT_PRODUCT_REGION).trim().toUpperCase() || DEFAULT_PRODUCT_REGION;
  const normalizedCategory = PRODUCT_CATEGORY_LABELS[String(category || "").trim().toUpperCase()] ? String(category || "").trim().toUpperCase() : "OT";
  const normalizedShelf = String(shelf || DEFAULT_PRODUCT_SHELF).trim().toUpperCase() || DEFAULT_PRODUCT_SHELF;
  const normalizedSequence = String(Number(sequence || 0) || 0).padStart(3, "0").slice(-3);

  return `${normalizedRegion}-${normalizedCategory}-${normalizedSequence}-${normalizedShelf}`;
}

module.exports = {
  PRODUCT_CATEGORY_LABELS,
  PRODUCT_CATEGORY_ORDER,
  DEFAULT_PRODUCT_REGION,
  DEFAULT_PRODUCT_SHELF,
  buildProductSku,
  deriveProductCategoryFromSku,
  isValidProductSku,
  normalizeProductSku,
  normalizeProductCategory,
  normalizeProductCategoryCode,
  parseProductSku
};
