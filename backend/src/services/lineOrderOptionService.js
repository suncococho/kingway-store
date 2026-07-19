const DEFAULT_LINE_ORDER_OPTION_SETTINGS = {
  isEnabled: false,
  pageTitle: "選擇您需要的配件",
  pageDescription: "可依照需求選擇配件，也可以略過此步驟",
  allowSkip: true,
  showOutOfStock: true,
  showPrices: true
};

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
    allowSkip: toBool(row.allowSkip, true),
    showOutOfStock: toBool(row.showOutOfStock, true),
    showPrices: toBool(row.showPrices, true),
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

async function ensureOptionSettings(connection, storeId, staffId = null) {
  await connection.query(
    `
      INSERT INTO line_order_option_settings
        (store_id, is_enabled, page_title, page_description, allow_skip, show_out_of_stock, show_prices, created_by_staff_id, updated_by_staff_id)
      VALUES (?, 0, ?, ?, 1, 1, 1, ?, ?)
      ON DUPLICATE KEY UPDATE store_id = VALUES(store_id)
    `,
    [
      storeId,
      DEFAULT_LINE_ORDER_OPTION_SETTINGS.pageTitle,
      DEFAULT_LINE_ORDER_OPTION_SETTINGS.pageDescription,
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
  const settings = options.ensure
    ? await ensureOptionSettings(connection, storeId, options.staffId || null)
    : await getOptionSettings(connection, storeId);
  const groups = await listOptionGroups(connection, storeId, {
    includeInactive: Boolean(options.includeInactive),
    customerMode: Boolean(options.customerMode),
    settings
  });

  return { settings, groups };
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
    allowSkip: toBool(body.allowSkip, true),
    showOutOfStock: toBool(body.showOutOfStock, true),
    showPrices: toBool(body.showPrices, true)
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
    customPrice = Number(body.customPrice);
    if (!Number.isFinite(customPrice) || customPrice < 0) {
      throw Object.assign(new Error("自訂價格不可小於 0"), { statusCode: 400 });
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
  getLineOrderOptionConfig,
  ensureOptionSettings,
  listOptionGroups,
  validateLineOrderOptionSelections,
  normalizeSettingsPayload,
  normalizeGroupPayload,
  normalizeGroupProductPayload
};
