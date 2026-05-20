export const PRODUCT_CATEGORY_LABELS = {
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

export const PRODUCT_CATEGORY_ORDER = ["EB", "RP", "PT", "AC", "TR", "LT", "LK", "SE", "HB", "CR", "OT"];
export const PRODUCT_CATEGORY_OPTIONS = PRODUCT_CATEGORY_ORDER.map((value) => ({
  key: value,
  label: PRODUCT_CATEGORY_LABELS[value]
}));

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

export function normalizeProductCategoryCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return PRODUCT_CATEGORY_ALIASES[normalized] || normalized;
}

export function normalizeProductSku(value) {
  return String(value || "").trim().toUpperCase();
}

export function parseProductSku(value) {
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

export function deriveProductCategoryFromSku(value) {
  const parsed = parseProductSku(value);
  return parsed ? parsed.category : "OT";
}

export function normalizeProductCategory(value) {
  const normalized = normalizeProductCategoryCode(value);
  return PRODUCT_CATEGORY_LABELS[normalized] ? normalized : "OT";
}

export function isValidProductSku(value) {
  return Boolean(parseProductSku(value));
}

export function buildProductSku({ region = DEFAULT_PRODUCT_REGION, category = "OT", sequence = 1, shelf = DEFAULT_PRODUCT_SHELF } = {}) {
  const normalizedRegion = String(region || DEFAULT_PRODUCT_REGION).trim().toUpperCase() || DEFAULT_PRODUCT_REGION;
  const normalizedCategory = PRODUCT_CATEGORY_LABELS[String(category || "").trim().toUpperCase()] ? String(category || "").trim().toUpperCase() : "OT";
  const normalizedShelf = String(shelf || DEFAULT_PRODUCT_SHELF).trim().toUpperCase() || DEFAULT_PRODUCT_SHELF;
  const normalizedSequence = String(Number(sequence || 0) || 0).padStart(3, "0").slice(-3);

  return `${normalizedRegion}-${normalizedCategory}-${normalizedSequence}-${normalizedShelf}`;
}
