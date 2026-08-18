const DEFAULT_LINE_ORDER_OPTION_SETTINGS = {
  isEnabled: false,
  pageTitle: "選擇您需要的配件",
  pageDescription: "可依照需求選擇配件，也可以略過此步驟",
  allowSkip: true,
  showOutOfStock: false,
  showPrices: true
};

const CATEGORY_LABELS = {
  EB: "電動自行車",
  EBIKE: "電動自行車",
  PT: "配件",
  ACCESSORY: "配件",
  RP: "維修",
  REPAIR: "維修",
  OTHER: "其他"
};

const EXCLUDED_OPTION_CATEGORIES = ["EB", "EBIKE"];

function toBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return Boolean(Number(value));
}

function toPositiveInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function toNonNegativeInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function normalizeText(value, maxLength = 255) {
  const text = String(value || "").trim();
  return text.slice(0, maxLength);
}

function normalizeNullableText(value, maxLength = 255) {
  const text = normalizeText(value, maxLength);
  return text || null;
}

function mapSettings(row) {
  if (!row) {
    return {
      id: null,
      ...DEFAULT_LINE_ORDER_OPTION_SETTINGS
    };
  }

  return {
    id: row.id,
    storeId: row.storeId,
    isEnabled: toBool(row.isEnabled),
    pageTitle: row.pageTitle || DEFAULT_LINE_ORDER_OPTION_SETTINGS.pageTitle,
    pageDescription: row.pageDescription || DEFAULT_LINE_ORDER_OPTION_SETTINGS.pageDescription,
    allowSkip: toBool(row.allowSkip, DEFAULT_LINE_ORDER_OPTION_SETTINGS.allowSkip),
    showOutOfStock: toBool(row.showOutOfStock, DEFAULT_LINE_ORDER_OPTION_SETTINGS.showOutOfStock),
    showPrices: toBool(row.showPrices, DEFAULT_LINE_ORDER_OPTION_SETTINGS.showPrices),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

function mapProduct(row, settings = DEFAULT_LINE_ORDER_OPTION_SETTINGS) {
  const customPrice = row.customPrice === null || row.customPrice === undefined ? null : Number(row.customPrice);
  const basePrice = Number(row.price || 0);
  const displayPrice = customPrice === null ? basePrice : customPrice;
  return {
    id: row.linkId || null,
    linkId: row.linkId || null,
    productId: row.productId || row.id,
    sku: row.sku || "",
    name: row.customDisplayName || row.name || "",
    productName: row.name || "",
    displayName: row.customDisplayName || row.name || "",
    customDisplayName: row.customDisplayName || "",
    category: row.category || "OTHER",
    price: settings.showPrices === false ? null : displayPrice,
    basePrice,
    customPrice,
    stock: Number(row.stock || 0),
    imageUrl: row.imageUrl || null,
    sortOrder: Number(row.productSortOrder ?? row.sortOrder ?? 0),
    isActive: toBool(row.productIsActive ?? row.isActive, true),
    linkIsActive: toBool(row.linkIsActive ?? row.isActive, true),
    isOutOfStock: Number(row.stock || 0) <= 0
  };
}

function mapCandidateProduct(row) {
  return {
    id: row.id,
    productId: row.id,
    sku: row.sku || "",
    name: row.name || "",
    category: row.category || "OTHER",
    categoryLabel: CATEGORY_LABELS[row.category] || row.category || "其他",
    price: Number(row.price || 0),
    stock: Number(row.stock || 0),
    imageUrl: row.imageUrl || null,
    isLinkedToGroup: toBool(row.isLinkedToGroup),
    isOutOfStock: Number(row.stock || 0) <= 0
  };
}

function mapGroup(row, products = []) {
  return {
    id: row.id,
    code: row.code || "",
    label: row.label || "",
    description: row.description || "",
    isRequired: toBool(row.isRequired),
    minSelect: Number(row.minSelect || 0),
    maxSelect: Number(row.maxSelect || 1),
    sortOrder: Number(row.sortOrder || 0),
    isActive: toBool(row.isActive, true),
    products
  };
}

async function getOptionSettings(connection, storeId) {
  const [rows] = await connection.query(
    `
      SELECT
        id,
        store_id AS storeId,
        is_enabled AS isEnabled,
        page_title AS pageTitle,
        page_description AS pageDescription,
        allow_skip AS allowSkip,
        show_out_of_stock AS showOutOfStock,
        show_prices AS showPrices,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM line_order_option_settings
      WHERE store_id = ?
      LIMIT 1
    `,
    [storeId]
  );
  return mapSettings(rows[0]);
}

async function upsertLineOrderOptionSettings(connection, storeId, payload, staffId = null) {
  const settings = normalizeSettingsPayload(payload || {});
  await connection.query(
    `
      INSERT INTO line_order_option_settings
        (store_id, is_enabled, page_title, page_description, allow_skip, show_out_of_stock, show_prices, created_by_staff_id, updated_by_staff_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        is_enabled = VALUES(is_enabled),
        page_title = VALUES(page_title),
        page_description = VALUES(page_description),
        allow_skip = VALUES(allow_skip),
        show_out_of_stock = VALUES(show_out_of_stock),
        show_prices = VALUES(show_prices),
        updated_by_staff_id = VALUES(updated_by_staff_id)
    `,
    [
      storeId,
      settings.isEnabled ? 1 : 0,
      settings.pageTitle,
      settings.pageDescription,
      settings.allowSkip ? 1 : 0,
      settings.showOutOfStock ? 1 : 0,
      settings.showPrices ? 1 : 0,
      staffId,
      staffId
    ]
  );
  return getOptionSettings(connection, storeId);
}

async function listOptionGroups(connection, storeId, options = {}) {
  const includeInactive = Boolean(options.includeInactive);
  const customerMode = Boolean(options.customerMode);
  const settings = options.settings || await getOptionSettings(connection, storeId);
  const groupWhere = ["g.store_id = ?", "g.deleted_at IS NULL"];
  const params = [storeId];

  if (!includeInactive) {
    groupWhere.push("g.is_active = 1");
  }

  const [groupRows] = await connection.query(
    `
      SELECT
        g.id,
        g.code,
        g.label,
        g.description,
        g.is_required AS isRequired,
        g.min_select AS minSelect,
        g.max_select AS maxSelect,
        g.sort_order AS sortOrder,
        g.is_active AS isActive
      FROM line_order_option_groups g
      WHERE ${groupWhere.join(" AND ")}
      ORDER BY g.sort_order ASC, g.id ASC
    `,
    params
  );

  if (!groupRows.length) {
    return [];
  }

  const groupIds = groupRows.map((group) => group.id);
  const productWhere = [
    "gp.store_id = ?",
    "gp.option_group_id IN (?)",
    "p.store_id = gp.store_id",
    "p.is_active = 1",
    "p.deleted_at IS NULL"
  ];
  const productParams = [storeId, groupIds];

  if (!includeInactive) {
    productWhere.push("gp.is_active = 1");
  }
  if (customerMode && settings.showOutOfStock === false) {
    productWhere.push("COALESCE(p.stock, 0) > 0");
  }

  const [productRows] = await connection.query(
    `
      SELECT
        gp.id AS linkId,
        gp.option_group_id AS optionGroupId,
        gp.product_id AS productId,
        gp.sort_order AS productSortOrder,
        gp.custom_display_name AS customDisplayName,
        gp.custom_price AS customPrice,
        gp.is_active AS linkIsActive,
        p.sku,
        p.name,
        p.category,
        p.price,
        p.stock,
        p.image_url AS imageUrl,
        p.is_active AS productIsActive
      FROM line_order_option_group_products gp
      INNER JOIN products p ON p.id = gp.product_id
      WHERE ${productWhere.join(" AND ")}
      ORDER BY gp.option_group_id ASC, gp.sort_order ASC, gp.id ASC
    `,
    productParams
  );

  const productsByGroup = new Map();
  productRows.forEach((row) => {
    if (!productsByGroup.has(row.optionGroupId)) {
      productsByGroup.set(row.optionGroupId, []);
    }
    productsByGroup.get(row.optionGroupId).push(mapProduct(row, settings));
  });

  return groupRows.map((row) => mapGroup(row, productsByGroup.get(row.id) || []));
}

async function getLineOrderOptionConfig(connection, storeId, options = {}) {
  const settings = await getOptionSettings(connection, storeId);
  const groups = await listOptionGroups(connection, storeId, {
    includeInactive: Boolean(options.includeInactive),
    customerMode: Boolean(options.customerMode),
    settings
  });

  return { settings, groups };
}

function categoryFilterValues(value) {
  const text = normalizeText(value, 80);
  if (!text) return [];
  const normalized = text.toUpperCase();
  const values = new Set([text, normalized]);
  Object.entries(CATEGORY_LABELS).forEach(([code, label]) => {
    if (label === text || code === normalized) {
      values.add(code);
    }
  });
  return Array.from(values).filter((item) => !EXCLUDED_OPTION_CATEGORIES.includes(String(item).toUpperCase()));
}

function searchCategoryValues(search) {
  const text = normalizeText(search, 80).toLowerCase();
  if (!text) return [];
  return Object.entries(CATEGORY_LABELS)
    .filter(([code, label]) => code.toLowerCase().includes(text) || label.toLowerCase().includes(text))
    .map(([code]) => code)
    .filter((code) => !EXCLUDED_OPTION_CATEGORIES.includes(code));
}

function normalizeProductSearchOptions(options = {}) {
  const limit = Math.min(Math.max(toPositiveInt(options.limit, 30), 1), 100);
  const page = toPositiveInt(options.page);
  const offset = options.offset !== undefined && options.offset !== null
    ? toNonNegativeInt(options.offset)
    : page > 0 ? (page - 1) * limit : 0;
  return {
    q: normalizeText(options.q ?? options.search, 120),
    categoryValues: categoryFilterValues(options.category),
    inStock: options.inStock === true || options.inStock === "true" || options.inStock === "1" || options.inStock === 1,
    excludeGroupId: toPositiveInt(options.excludeGroupId),
    limit,
    offset
  };
}

async function listLineOrderOptionProductCandidates(connection, storeId, options = {}) {
  const filters = normalizeProductSearchOptions(options);
  const baseWhere = [
    "p.store_id = ?",
    "p.is_active = 1",
    "p.deleted_at IS NULL",
    "UPPER(COALESCE(p.category, '')) NOT IN (?, ?)"
  ];
  const baseParams = [storeId, ...EXCLUDED_OPTION_CATEGORIES];

  if (filters.q) {
    const searchCategories = searchCategoryValues(filters.q);
    const searchWhere = ["LOWER(p.sku) LIKE LOWER(?)", "p.name LIKE ?", "p.category LIKE ?"];
    const searchParams = [`%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`];
    if (searchCategories.length) {
      searchWhere.push(`p.category IN (${searchCategories.map(() => "?").join(", ")})`);
      searchParams.push(...searchCategories);
    }
    baseWhere.push(`(${searchWhere.join(" OR ")})`);
    baseParams.push(...searchParams);
  }

  if (filters.categoryValues.length) {
    baseWhere.push(`p.category IN (${filters.categoryValues.map(() => "?").join(", ")})`);
    baseParams.push(...filters.categoryValues);
  }

  if (filters.inStock) {
    baseWhere.push("COALESCE(p.stock, 0) > 0");
  }

  if (filters.excludeGroupId) {
    baseWhere.push(`
      NOT EXISTS (
        SELECT 1
        FROM line_order_option_group_products gp
        WHERE gp.store_id = p.store_id
          AND gp.product_id = p.id
          AND gp.option_group_id = ?
      )
    `);
    baseParams.push(filters.excludeGroupId);
  }

  const whereSql = baseWhere.join(" AND ");
  const [countRows] = await connection.query(
    `
      SELECT COUNT(*) AS total
      FROM products p
      WHERE ${whereSql}
    `,
    [...baseParams]
  );

  const [itemRows] = await connection.query(
    `
      SELECT
        p.id,
        p.sku,
        p.name,
        p.category,
        p.price,
        p.stock,
        p.image_url AS imageUrl,
        CASE WHEN gp_current.id IS NULL THEN 0 ELSE 1 END AS isLinkedToGroup
      FROM products p
      LEFT JOIN line_order_option_group_products gp_current
        ON gp_current.store_id = p.store_id
       AND gp_current.product_id = p.id
       AND gp_current.option_group_id = ?
      WHERE ${whereSql}
      ORDER BY p.category ASC, p.name ASC, p.id DESC
      LIMIT ? OFFSET ?
    `,
    [filters.excludeGroupId || 0, ...baseParams, filters.limit, filters.offset]
  );

  const [categoryRows] = await connection.query(
    `
      SELECT DISTINCT p.category
      FROM products p
      WHERE p.store_id = ?
        AND p.is_active = 1
        AND p.deleted_at IS NULL
        AND UPPER(COALESCE(p.category, '')) NOT IN (?, ?)
      ORDER BY p.category ASC
    `,
    [storeId, ...EXCLUDED_OPTION_CATEGORIES]
  );

  return {
    items: itemRows.map(mapCandidateProduct),
    total: Number(countRows[0]?.total || 0),
    limit: filters.limit,
    offset: filters.offset,
    categories: categoryRows.map((row) => ({
      value: row.category || "OTHER",
      label: CATEGORY_LABELS[row.category] || row.category || "其他"
    }))
  };
}

function normalizeSelections(optionSelections) {
  if (!Array.isArray(optionSelections)) {
    return [];
  }

  return optionSelections
    .map((selection) => ({
      groupId: toPositiveInt(selection.groupId || selection.optionGroupId),
      productIds: Array.isArray(selection.productIds)
        ? selection.productIds.map((id) => toPositiveInt(id)).filter(Boolean)
        : []
    }))
    .filter((selection) => selection.groupId > 0);
}

async function validateLineOrderOptionSelections(connection, storeId, optionSelections = []) {
  const config = await getLineOrderOptionConfig(connection, storeId, { customerMode: true });
  if (!config.settings.isEnabled) {
    return { config, items: [], summary: "" };
  }

  const normalizedSelections = normalizeSelections(optionSelections);
  const seenGroups = new Set();
  const seenProducts = new Set();
  for (const selection of normalizedSelections) {
    if (seenGroups.has(selection.groupId)) {
      throw Object.assign(new Error("選配群組不可重複送出，請重新整理頁面"), { statusCode: 400 });
    }
    seenGroups.add(selection.groupId);

    for (const productId of selection.productIds) {
      if (seenProducts.has(productId)) {
        throw Object.assign(new Error("同一項選配商品不可重複選擇"), { statusCode: 400 });
      }
      seenProducts.add(productId);
    }
  }

  const hasAnySelectedProduct = normalizedSelections.some((selection) => selection.productIds.length > 0);
  const hasRequiredSelectionRule = config.groups.some((group) => {
    const minSelect = group.isRequired ? Math.max(1, Number(group.minSelect || 0)) : Number(group.minSelect || 0);
    return minSelect > 0;
  });
  if (config.settings.allowSkip && !hasAnySelectedProduct && !hasRequiredSelectionRule) {
    return { config, items: [], summary: "" };
  }

  const selectedByGroup = new Map(normalizedSelections.map((selection) => [selection.groupId, new Set(selection.productIds)]));
  const selectedItems = [];

  for (const group of config.groups) {
    const selectedProductIds = selectedByGroup.get(group.id) || new Set();
    const count = selectedProductIds.size;
    const minSelect = group.isRequired ? Math.max(1, Number(group.minSelect || 0)) : Number(group.minSelect || 0);
    const maxSelect = Number(group.maxSelect || 0);

    if (count < minSelect) {
      throw Object.assign(new Error(`${group.label} 至少需選擇 ${minSelect} 項`), { statusCode: 400 });
    }
    if (maxSelect > 0 && count > maxSelect) {
      throw Object.assign(new Error(`${group.label} 最多只能選擇 ${maxSelect} 項`), { statusCode: 400 });
    }

    for (const productId of selectedProductIds) {
      const product = group.products.find((item) => Number(item.productId) === Number(productId));
      if (!product) {
        throw Object.assign(new Error(`${group.label} 包含不可選擇的商品`), { statusCode: 400 });
      }
      selectedItems.push({
        groupId: group.id,
        groupCode: group.code,
        groupLabel: group.label,
        productId: product.productId,
        sku: product.sku,
        name: product.displayName || product.productName,
        productName: product.productName,
        category: product.category,
        unitPrice: Number(product.price === null ? product.basePrice : product.price),
        stock: product.stock
      });
    }
  }

  const configuredGroupIds = new Set(config.groups.map((group) => group.id));
  for (const selection of normalizedSelections) {
    if (!configuredGroupIds.has(selection.groupId) && selection.productIds.length) {
      throw Object.assign(new Error("選配資料已更新，請重新整理頁面"), { statusCode: 400 });
    }
  }

  return {
    config,
    items: selectedItems,
    summary: selectedItems.map((item) => `${item.groupLabel}：${item.name}`).join("、")
  };
}

function normalizeSettingsPayload(body = {}) {
  return {
    isEnabled: toBool(body.isEnabled),
    pageTitle: normalizeText(body.pageTitle, 150) || DEFAULT_LINE_ORDER_OPTION_SETTINGS.pageTitle,
    pageDescription: normalizeText(body.pageDescription, 500) || DEFAULT_LINE_ORDER_OPTION_SETTINGS.pageDescription,
    allowSkip: toBool(body.allowSkip, DEFAULT_LINE_ORDER_OPTION_SETTINGS.allowSkip),
    showOutOfStock: toBool(body.showOutOfStock, DEFAULT_LINE_ORDER_OPTION_SETTINGS.showOutOfStock),
    showPrices: toBool(body.showPrices, DEFAULT_LINE_ORDER_OPTION_SETTINGS.showPrices)
  };
}

function normalizeGroupPayload(body = {}) {
  const code = normalizeText(body.code, 40).toUpperCase();
  const label = normalizeText(body.label, 120);
  const isRequired = toBool(body.isRequired);
  const minSelect = toNonNegativeInt(body.minSelect, isRequired ? 1 : 0);
  const maxSelect = toNonNegativeInt(body.maxSelect, 1);
  if (!code) {
    throw Object.assign(new Error("請輸入群組代碼"), { statusCode: 400 });
  }
  if (!label) {
    throw Object.assign(new Error("請輸入群組名稱"), { statusCode: 400 });
  }
  if (maxSelect > 0 && minSelect > maxSelect) {
    throw Object.assign(new Error("最少選擇數不可大於最多選擇數"), { statusCode: 400 });
  }
  return {
    code,
    label,
    description: normalizeNullableText(body.description, 500),
    isRequired,
    minSelect,
    maxSelect,
    sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    isActive: toBool(body.isActive, true)
  };
}

function normalizeGroupProductPayload(body = {}) {
  const productId = toPositiveInt(body.productId);
  if (!productId) {
    throw Object.assign(new Error("請選擇商品"), { statusCode: 400 });
  }

  let customPrice = null;
  if (body.customPrice !== undefined && body.customPrice !== null && String(body.customPrice).trim() !== "") {
    const customPriceText = String(body.customPrice).trim();
    if (!/^\d+(\.\d{1,2})?$/.test(customPriceText)) {
      throw Object.assign(new Error("LINE訂購價只能輸入 0 以上數字，且最多 2 位小數"), { statusCode: 400 });
    }
    customPrice = Number(customPriceText);
    if (!Number.isFinite(customPrice) || customPrice < 0 || customPrice > 9999999999.99) {
      throw Object.assign(new Error("LINE訂購價超出可儲存範圍"), { statusCode: 400 });
    }
  }

  return {
    productId,
    sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    customDisplayName: normalizeNullableText(body.customDisplayName, 150),
    customPrice,
    isActive: toBool(body.isActive, true)
  };
}

module.exports = {
  DEFAULT_LINE_ORDER_OPTION_SETTINGS,
  CATEGORY_LABELS,
  getLineOrderOptionConfig,
  upsertLineOrderOptionSettings,
  listOptionGroups,
  listLineOrderOptionProductCandidates,
  validateLineOrderOptionSelections,
  normalizeSettingsPayload,
  normalizeGroupPayload,
  normalizeGroupProductPayload
};
