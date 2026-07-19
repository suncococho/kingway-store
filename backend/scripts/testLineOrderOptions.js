const assert = require("assert");
const {
  DEFAULT_LINE_ORDER_OPTION_SETTINGS,
  getLineOrderOptionConfig,
  upsertLineOrderOptionSettings,
  listLineOrderOptionProductCandidates,
  validateLineOrderOptionSelections,
  normalizeGroupProductPayload
} = require("../src/services/lineOrderOptionService");

function baseData(overrides = {}) {
  return {
    settings: {
      id: 1,
      storeId: 1,
      isEnabled: 1,
      pageTitle: "選擇配件",
      pageDescription: "請選擇需要的配件",
      allowSkip: 1,
      showOutOfStock: 1,
      showPrices: 1
    },
    groups: [
      { id: 10, storeId: 1, code: "LOCK", label: "車鎖", description: "", isRequired: 1, minSelect: 1, maxSelect: 1, sortOrder: 1, isActive: 1, deletedAt: null },
      { id: 11, storeId: 1, code: "BASKET", label: "車籃", description: "", isRequired: 0, minSelect: 0, maxSelect: 2, sortOrder: 2, isActive: 1, deletedAt: null },
      { id: 12, storeId: 1, code: "HIDDEN", label: "隱藏群組", description: "", isRequired: 0, minSelect: 0, maxSelect: 1, sortOrder: 3, isActive: 0, deletedAt: null }
    ],
    mappings: [
      { id: 100, storeId: 1, optionGroupId: 10, productId: 501, sortOrder: 1, customDisplayName: "防盜車鎖", customPrice: 888, isActive: 1 },
      { id: 101, storeId: 1, optionGroupId: 11, productId: 502, sortOrder: 1, customDisplayName: null, customPrice: null, isActive: 1 },
      { id: 102, storeId: 1, optionGroupId: 11, productId: 503, sortOrder: 2, customDisplayName: null, customPrice: 0, isActive: 0 },
      { id: 103, storeId: 1, optionGroupId: 12, productId: 504, sortOrder: 1, customDisplayName: null, customPrice: null, isActive: 1 }
    ],
    products: [
      { id: 501, storeId: 1, sku: "LOCK-1", name: "原始車鎖名稱", category: "ACCESSORY", price: 1200, stock: 5, imageUrl: null, isActive: 1, deletedAt: null },
      { id: 502, storeId: 1, sku: "BASKET-1", name: "前車籃", category: "ACCESSORY", price: 600, stock: 2, imageUrl: null, isActive: 1, deletedAt: null },
      { id: 503, storeId: 1, sku: "BASKET-2", name: "停用連結商品", category: "ACCESSORY", price: 700, stock: 2, imageUrl: null, isActive: 1, deletedAt: null },
      { id: 504, storeId: 1, sku: "HIDDEN-1", name: "隱藏商品", category: "ACCESSORY", price: 500, stock: 1, imageUrl: null, isActive: 1, deletedAt: null },
      { id: 505, storeId: 1, sku: "OLD-1", name: "已刪除商品", category: "ACCESSORY", price: 300, stock: 1, imageUrl: null, isActive: 1, deletedAt: new Date() },
      { id: 506, storeId: 1, sku: "OFF-1", name: "停用商品", category: "ACCESSORY", price: 300, stock: 1, imageUrl: null, isActive: 0, deletedAt: null },
      { id: 507, storeId: 2, sku: "OTHER-STORE", name: "其他門市商品", category: "ACCESSORY", price: 300, stock: 1, imageUrl: null, isActive: 1, deletedAt: null },
      { id: 508, storeId: 1, sku: "OOS-1", name: "缺貨配件", category: "ACCESSORY", price: 900, stock: 0, imageUrl: null, isActive: 1, deletedAt: null },
      { id: 509, storeId: 1, sku: "EB-1", name: "電動自行車本體", category: "EB", price: 39900, stock: 3, imageUrl: null, isActive: 1, deletedAt: null },
      { id: 510, storeId: 1, sku: "KIT-1", name: "改裝套件 A", category: "改裝套件", price: 2200, stock: 4, imageUrl: null, isActive: 1, deletedAt: null }
    ],
    ...overrides
  };
}

function createConnection(data) {
  data.queries = Array.isArray(data.queries) ? data.queries : [];
  data.nextSettingsId = data.nextSettingsId || 1;
  return {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      data.queries.push(normalized);
      if (normalized.startsWith("INSERT INTO line_order_option_settings")) {
        const existing = data.settings && Number(data.settings.storeId) === Number(params[0]) ? data.settings : null;
        const nextSettings = {
          id: existing?.id || data.nextSettingsId++,
          storeId: Number(params[0]),
          isEnabled: params[1],
          pageTitle: params[2],
          pageDescription: params[3],
          allowSkip: params[4],
          showOutOfStock: params[5],
          showPrices: params[6],
          createdByStaffId: existing?.createdByStaffId ?? params[7],
          updatedByStaffId: params[8],
          createdAt: existing?.createdAt || null,
          updatedAt: null
        };
        data.settings = nextSettings;
        return [{ affectedRows: existing ? 2 : 1, insertId: nextSettings.id }];
      }
      if (normalized.includes("FROM line_order_option_settings")) {
        const storeId = Number(params[0]);
        const settings = data.settings && Number(data.settings.storeId) === storeId ? data.settings : null;
        return [[settings].filter(Boolean)];
      }
      if (normalized.includes("FROM line_order_option_groups")) {
        const storeId = Number(params[0]);
        const requireActive = normalized.includes("g.is_active = 1");
        return [data.groups
          .filter((group) => Number(group.storeId) === storeId)
          .filter((group) => !group.deletedAt)
          .filter((group) => !requireActive || Number(group.isActive) === 1)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
          .map((group) => ({
            id: group.id,
            code: group.code,
            label: group.label,
            description: group.description,
            isRequired: group.isRequired,
            minSelect: group.minSelect,
            maxSelect: group.maxSelect,
            sortOrder: group.sortOrder,
            isActive: group.isActive
          }))];
      }
      if (normalized.startsWith("SELECT gp.id AS linkId")) {
        const storeId = Number(params[0]);
        const groupIds = new Set((Array.isArray(params[1]) ? params[1] : [params[1]]).map(Number));
        const requireActiveMapping = normalized.includes("gp.is_active = 1");
        const requireStock = normalized.includes("COALESCE(p.stock, 0) > 0");
        const rows = [];
        for (const mapping of data.mappings) {
          if (Number(mapping.storeId) !== storeId) continue;
          if (!groupIds.has(Number(mapping.optionGroupId))) continue;
          if (requireActiveMapping && Number(mapping.isActive) !== 1) continue;
          const product = data.products.find((item) => Number(item.id) === Number(mapping.productId));
          if (!product) continue;
          if (Number(product.storeId) !== Number(mapping.storeId)) continue;
          if (Number(product.isActive) !== 1) continue;
          if (product.deletedAt) continue;
          if (requireStock && Number(product.stock || 0) <= 0) continue;
          rows.push({
            linkId: mapping.id,
            optionGroupId: mapping.optionGroupId,
            productId: mapping.productId,
            productSortOrder: mapping.sortOrder,
            customDisplayName: mapping.customDisplayName,
            customPrice: mapping.customPrice,
            linkIsActive: mapping.isActive,
            sku: product.sku,
            name: product.name,
            category: product.category,
            price: product.price,
            stock: product.stock,
            imageUrl: product.imageUrl,
            productIsActive: product.isActive
          });
        }
        rows.sort((a, b) => a.optionGroupId - b.optionGroupId || a.productSortOrder - b.productSortOrder || a.linkId - b.linkId);
        return [rows];
      }

      if (normalized.startsWith("SELECT COUNT(*) AS total FROM products p")) {
        return [[{ total: filterCandidateProducts(data, normalized, params, false).length }]];
      }
      if (normalized.startsWith("SELECT p.id, p.sku, p.name, p.category")) {
        const limit = Number(params[params.length - 2]);
        const offset = Number(params[params.length - 1]);
        return [filterCandidateProducts(data, normalized, params, true).slice(offset, offset + limit)];
      }
      if (normalized.startsWith("SELECT DISTINCT p.category FROM products p")) {
        const storeId = Number(params[0]);
        const categories = Array.from(new Set(data.products
          .filter((product) => Number(product.storeId) === storeId)
          .filter((product) => Number(product.isActive) === 1)
          .filter((product) => !product.deletedAt)
          .filter((product) => !["EB", "EBIKE"].includes(String(product.category || "").toUpperCase()))
          .map((product) => product.category || "OTHER")))
          .sort()
          .map((category) => ({ category }));
        return [categories];
      }
      throw new Error("Unexpected query: " + normalized);
    }
  };
}

async function assertRejectsMessage(fn, pattern, label) {
  await assert.rejects(fn, (error) => {
    assert.match(error.message, pattern, label);
    assert.strictEqual(error.statusCode, 400, label + " status");
    return true;
  });
}

function stripLike(value) {
  return String(value || "").replace(/^%|%$/g, "");
}

function filterCandidateProducts(data, normalized, params, itemQuery) {
  const baseParams = itemQuery ? params.slice(1, -2) : params;
  const storeId = Number(baseParams[0]);
  let cursor = 3;
  let products = data.products
    .filter((product) => Number(product.storeId) === storeId)
    .filter((product) => Number(product.isActive) === 1)
    .filter((product) => !product.deletedAt)
    .filter((product) => !["EB", "EBIKE"].includes(String(product.category || "").toUpperCase()));

  if (normalized.includes("LOWER(p.sku) LIKE LOWER(?)")) {
    const skuSearch = stripLike(baseParams[cursor]).toLowerCase();
    const nameSearch = stripLike(baseParams[cursor + 1]);
    const categorySearch = stripLike(baseParams[cursor + 2]);
    cursor += 3;
    const hasSearchCategoryClause = normalized.includes("OR p.category IN");
    const excludeGroupCount = normalized.includes("NOT EXISTS") ? 1 : 0;
    const categoryFilterClauseCount = (normalized.match(/p.category IN/g) || []).length - (hasSearchCategoryClause ? 1 : 0);
    const searchCategoryCount = Math.max(0, baseParams.length - cursor - excludeGroupCount - categoryFilterClauseCount);
    const searchCategories = new Set(baseParams.slice(cursor, cursor + searchCategoryCount));
    cursor += searchCategoryCount;
    products = products.filter((product) => String(product.sku || "").toLowerCase().includes(skuSearch) || String(product.name || "").includes(nameSearch) || String(product.category || "").includes(categorySearch) || searchCategories.has(product.category));
  }

  if (normalized.includes("COALESCE(p.stock, 0) > 0")) {
    products = products.filter((product) => Number(product.stock || 0) > 0);
  }

  if (normalized.includes("p.category IN")) {
    const excludeGroupCount = normalized.includes("NOT EXISTS") ? 1 : 0;
    const categoryValues = baseParams.slice(cursor, baseParams.length - excludeGroupCount);
    if (categoryValues.length) {
      const categories = new Set(categoryValues);
      products = products.filter((product) => categories.has(product.category));
    }
  }

  if (normalized.includes("NOT EXISTS")) {
    const excludeGroupId = Number(baseParams[baseParams.length - 1]);
    const excludedProductIds = new Set(data.mappings
      .filter((mapping) => Number(mapping.storeId) === storeId)
      .filter((mapping) => Number(mapping.optionGroupId) === excludeGroupId)
      .map((mapping) => Number(mapping.productId)));
    products = products.filter((product) => !excludedProductIds.has(Number(product.id)));
  }

  return products
    .sort((a, b) => String(a.category || "").localeCompare(String(b.category || ""), "zh-Hant") || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant") || Number(b.id) - Number(a.id))
    .map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      price: product.price,
      stock: product.stock,
      imageUrl: product.imageUrl,
      isLinkedToGroup: 0
    }));
}

function writeQueries(data) {
  return (data.queries || []).filter((query) => /^(INSERT|UPDATE|DELETE)\b/i.test(query));
}

function optionSettingsRowCount(data, storeId = 1) {
  return data.settings && Number(data.settings.storeId) === storeId ? 1 : 0;
}

async function run() {
  {
    const data = baseData({ settings: null, groups: [], mappings: [] });
    const beforeCount = optionSettingsRowCount(data);
    const config = await getLineOrderOptionConfig(createConnection(data), 1, { includeInactive: true });
    assert.deepStrictEqual(config.settings, { id: null, ...DEFAULT_LINE_ORDER_OPTION_SETTINGS }, "admin GET without settings returns in-memory defaults");
    assert.deepStrictEqual(config.groups, [], "admin GET without settings can return an empty group list");
    assert.strictEqual(optionSettingsRowCount(data), beforeCount, "admin GET does not create settings row");
    assert.deepStrictEqual(writeQueries(data), [], "admin GET does not issue INSERT/UPDATE/DELETE");
  }

  {
    const data = baseData({ settings: null, groups: [], mappings: [] });
    const beforeCount = optionSettingsRowCount(data);
    const config = await getLineOrderOptionConfig(createConnection(data), 1, { customerMode: true });
    assert.strictEqual(config.settings.isEnabled, false, "customer GET without settings is disabled");
    assert.deepStrictEqual(config.groups, [], "customer GET without settings returns no groups");
    assert.strictEqual(optionSettingsRowCount(data), beforeCount, "customer GET does not create settings row");
    assert.deepStrictEqual(writeQueries(data), [], "customer GET does not issue INSERT/UPDATE/DELETE");
  }

  {
    const data = baseData({ settings: null, groups: [], mappings: [] });
    const beforeCount = optionSettingsRowCount(data);
    await getLineOrderOptionConfig(createConnection(data), 1, { includeInactive: true });
    assert.strictEqual(optionSettingsRowCount(data), beforeCount, "GET keeps option settings row count unchanged");
  }

  {
    const data = baseData({ settings: null, groups: [], mappings: [] });
    const connection = createConnection(data);
    const first = await upsertLineOrderOptionSettings(connection, 1, {
      isEnabled: true,
      pageTitle: "選擇您需要的配件",
      pageDescription: "可依照需求選擇配件，也可以略過此步驟",
      allowSkip: true,
      showOutOfStock: true,
      showPrices: true
    }, 7);
    assert.strictEqual(optionSettingsRowCount(data), 1, "first PUT creates one settings row");
    assert.strictEqual(first.isEnabled, true, "first PUT stores enabled setting");
    assert.strictEqual(writeQueries(data).filter((query) => query.startsWith("INSERT INTO line_order_option_settings")).length, 1, "first PUT issues one settings upsert");

    const existingId = data.settings.id;
    const beforeSecondCount = optionSettingsRowCount(data);
    const second = await upsertLineOrderOptionSettings(connection, 1, {
      isEnabled: false,
      pageTitle: "第二次設定",
      pageDescription: "第二次描述",
      allowSkip: false,
      showOutOfStock: false,
      showPrices: false
    }, 8);
    assert.strictEqual(optionSettingsRowCount(data), beforeSecondCount, "second PUT updates existing row count in place");
    assert.strictEqual(data.settings.id, existingId, "second PUT keeps the existing settings row id");
    assert.strictEqual(second.pageTitle, "第二次設定", "second PUT returns updated settings");
    assert.strictEqual(second.showPrices, false, "second PUT can update boolean settings");
    assert.strictEqual(writeQueries(data).filter((query) => query.startsWith("INSERT INTO line_order_option_settings")).length, 2, "each PUT performs the explicit settings upsert");
  }

  {
    const routeSource = require("fs").readFileSync(require("path").join(__dirname, "../src/routes/lineOrderOptions.js"), "utf8");
    assert.ok(routeSource.includes('authorize(["ADMIN", "MANAGER"])'), "admin option route allows ADMIN and MANAGER");
    assert.ok(!routeSource.includes('authorize(["ADMIN", "MANAGER", "CASHIER"])'), "admin option route does not allow CASHIER");
    assert.ok(!routeSource.includes("ensure" + ": true"), "admin GET route does not request settings creation");
  }

  {
    const data = baseData();
    const result = await listLineOrderOptionProductCandidates(createConnection(data), 1, { q: "車籃", inStock: true, limit: 30 });
    assert.deepStrictEqual(result.items.map((item) => item.productId), [502], "product name search works with Chinese text");
  }

  {
    const data = baseData();
    const result = await listLineOrderOptionProductCandidates(createConnection(data), 1, { q: "basket-1", inStock: true, limit: 30 });
    assert.deepStrictEqual(result.items.map((item) => item.sku), ["BASKET-1"], "SKU search is case insensitive");
  }

  {
    const data = baseData();
    const result = await listLineOrderOptionProductCandidates(createConnection(data), 1, { category: "改裝套件", inStock: true, limit: 30 });
    assert.deepStrictEqual(result.items.map((item) => item.sku), ["KIT-1"], "category label filter supports actual product category labels");
  }

  {
    const data = baseData();
    const result = await listLineOrderOptionProductCandidates(createConnection(data), 1, { q: "改裝", inStock: true, limit: 30 });
    assert.deepStrictEqual(result.items.map((item) => item.sku), ["KIT-1"], "search can match actual category labels");
  }

  {
    const data = baseData();
    const result = await listLineOrderOptionProductCandidates(createConnection(data), 1, { inStock: true, limit: 30 });
    assert.ok(!result.items.some((item) => item.sku === "OOS-1"), "in-stock filter excludes stock zero");
    assert.ok(!result.items.some((item) => item.sku === "EB-1"), "EB products are excluded from option candidates");
    assert.ok(!result.items.some((item) => item.sku === "OFF-1"), "inactive products are excluded");
    assert.ok(!result.items.some((item) => item.sku === "OLD-1"), "deleted products are excluded");
    assert.ok(!result.items.some((item) => item.sku === "OTHER-STORE"), "other store products are excluded");
  }

  {
    const data = baseData();
    const result = await listLineOrderOptionProductCandidates(createConnection(data), 1, { excludeGroupId: 11, inStock: false, limit: 30 });
    assert.ok(!result.items.some((item) => item.productId === 502), "excludeGroupId excludes products already linked to the current group");
    assert.ok(result.items.some((item) => item.productId === 501), "products linked to other groups can still be shown");
  }

  {
    const data = baseData();
    const result = await listLineOrderOptionProductCandidates(createConnection(data), 1, { q: "%'; DROP TABLE products; --", limit: 500 });
    assert.strictEqual(result.limit, 100, "limit is capped at 100");
    assert.ok(data.queries.every((query) => !query.includes("DROP TABLE")), "search text is not interpolated into SQL");
  }
  {
    const data = baseData({ settings: { ...baseData().settings, isEnabled: 0 } });
    const result = await validateLineOrderOptionSelections(createConnection(data), 1, [{ groupId: 10, productIds: [501] }]);
    assert.deepStrictEqual(result.items, [], "disabled feature skips option validation");
  }

  {
    const data = baseData();
    const config = await getLineOrderOptionConfig(createConnection(data), 1, { customerMode: true });
    assert.deepStrictEqual(config.groups.map((group) => group.code), ["LOCK", "BASKET"], "inactive groups are excluded for customers");
    assert.deepStrictEqual(config.groups[1].products.map((product) => product.productId), [502], "inactive mappings and inactive/deleted products are excluded");
  }

  {
    const data = baseData({ mappings: [...baseData().mappings, { id: 104, storeId: 1, optionGroupId: 11, productId: 505, sortOrder: 3, customDisplayName: null, customPrice: null, isActive: 1 }] });
    const config = await getLineOrderOptionConfig(createConnection(data), 1, { customerMode: true });
    assert.ok(!config.groups[1].products.some((product) => product.productId === 505), "deleted products are excluded");
  }

  await assertRejectsMessage(
    () => validateLineOrderOptionSelections(createConnection(baseData()), 1, []),
    /車鎖 至少需選擇 1 項/,
    "required group missing is rejected"
  );

  await assertRejectsMessage(
    () => validateLineOrderOptionSelections(createConnection(baseData()), 1, [{ groupId: 10, productIds: [501] }, { groupId: 11, productIds: [502, 503, 504] }]),
    /車籃 最多只能選擇 2 項/,
    "max select is enforced before unavailable products matter"
  );

  await assertRejectsMessage(
    () => validateLineOrderOptionSelections(createConnection(baseData({ groups: [{ ...baseData().groups[0], minSelect: 2, maxSelect: 2 }] })), 1, [{ groupId: 10, productIds: [501] }]),
    /車鎖 至少需選擇 2 項/,
    "min select is enforced"
  );

  await assertRejectsMessage(
    () => validateLineOrderOptionSelections(createConnection(baseData()), 1, [{ groupId: 10, productIds: [501] }, { groupId: 11, productIds: [999] }]),
    /車籃 包含不可選擇的商品/,
    "unlinked product is rejected"
  );

  await assertRejectsMessage(
    () => validateLineOrderOptionSelections(createConnection(baseData({ mappings: [...baseData().mappings, { id: 105, storeId: 1, optionGroupId: 11, productId: 507, sortOrder: 4, customDisplayName: null, customPrice: null, isActive: 1 }] })), 1, [{ groupId: 10, productIds: [501] }, { groupId: 11, productIds: [507] }]),
    /車籃 包含不可選擇的商品/,
    "different store product is rejected"
  );

  await assertRejectsMessage(
    () => validateLineOrderOptionSelections(createConnection(baseData()), 1, [{ groupId: 10, productIds: [501, 501] }]),
    /同一項選配商品不可重複選擇/,
    "duplicate product is rejected"
  );

  await assertRejectsMessage(
    () => validateLineOrderOptionSelections(createConnection(baseData()), 1, [{ groupId: 10, productIds: [501] }, { groupId: 10, productIds: [501] }]),
    /選配群組不可重複送出/,
    "duplicate group is rejected"
  );

  {
    const result = await validateLineOrderOptionSelections(createConnection(baseData()), 1, [
      { groupId: 10, productIds: [501], price: 1, name: "竄改名稱" },
      { groupId: 11, productIds: [502] }
    ]);
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(result.items[0].name, "防盜車鎖", "server custom display name is used");
    assert.strictEqual(result.items[0].productName, "原始車鎖名稱", "server product name snapshot source is kept");
    assert.strictEqual(result.items[0].unitPrice, 888, "server custom price overrides request payload");
    assert.strictEqual(result.items[1].unitPrice, 600, "server DB price is used");
    assert.strictEqual(result.items.reduce((sum, item) => sum + item.unitPrice, 0), 1488, "server recalculates option total");
    assert.strictEqual(
      normalizeGroupProductPayload({ productId: 501, customPrice: "" }).customPrice,
      null,
      "blank customPrice clears LINE order price"
    );
    assert.strictEqual(
      normalizeGroupProductPayload({ productId: 501, customPrice: "0" }).customPrice,
      0,
      "customPrice 0 is accepted by API payload normalization"
    );
    assert.strictEqual(
      normalizeGroupProductPayload({ productId: 501, customPrice: "1200" }).customPrice,
      1200,
      "customPrice integer amount is accepted"
    );
    assert.strictEqual(
      normalizeGroupProductPayload({ productId: 501, customPrice: "1200.25" }).customPrice,
      1200.25,
      "customPrice decimal amount with two places is accepted"
    );
    assert.throws(
      () => normalizeGroupProductPayload({ productId: 501, customPrice: "1.234" }),
      /最多 2 位小數/,
      "customPrice rejects more than two decimal places"
    );
    assert.throws(
      () => normalizeGroupProductPayload({ productId: 501, customPrice: "abc" }),
      /0 以上數字/,
      "customPrice rejects non-numeric values"
    );
    assert.throws(
      () => normalizeGroupProductPayload({ productId: 501, customPrice: "-1" }),
      /0 以上數字/,
      "customPrice rejects negative values"
    );
    assert.throws(
      () => normalizeGroupProductPayload({ productId: 501, customPrice: "10000000000" }),
      /超出可儲存範圍/,
      "customPrice rejects values beyond decimal(12,2)"
    );
    assert.deepStrictEqual(
      result.items.map((item) => ({ line_option_group_id: item.groupId, line_option_group_code: item.groupCode, line_option_group_label: item.groupLabel })),
      [
        { line_option_group_id: 10, line_option_group_code: "LOCK", line_option_group_label: "車鎖" },
        { line_option_group_id: 11, line_option_group_code: "BASKET", line_option_group_label: "車籃" }
      ],
      "option group snapshot fields are available for order_items"
    );
  }

  {
    const data = baseData({
      settings: { ...baseData().settings, showOutOfStock: 0 },
      mappings: [...baseData().mappings, { id: 106, storeId: 1, optionGroupId: 11, productId: 508, sortOrder: 5, customDisplayName: null, customPrice: null, isActive: 1 }]
    });
    await assertRejectsMessage(
      () => validateLineOrderOptionSelections(createConnection(data), 1, [{ groupId: 10, productIds: [501] }, { groupId: 11, productIds: [508] }]),
      /車籃 包含不可選擇的商品/,
      "out-of-stock product is rejected when hidden by policy"
    );
  }

  {
    const data = baseData({
      mappings: baseData().mappings.map((mapping) => mapping.id === 102 ? { ...mapping, isActive: 1 } : mapping)
    });
    const result = await validateLineOrderOptionSelections(createConnection(data), 1, [
      { groupId: 10, productIds: [501] },
      { groupId: 11, productIds: [503] }
    ]);
    const freeItem = result.items.find((item) => item.productId === 503);
    assert.strictEqual(freeItem.unitPrice, 0, "customPrice 0 is stored as zero instead of falling back to products.price");
  }

  {
    const result = await validateLineOrderOptionSelections(createConnection(baseData()), 1, [{ groupId: 10, productIds: [501] }]);
    assert.strictEqual(result.items.length, 1, "existing no-option optional groups do not require extra selection");
  }

  {
    const guestResult = await validateLineOrderOptionSelections(createConnection(baseData()), 1, [{ groupId: 10, productIds: [501] }]);
    assert.strictEqual(guestResult.items[0].productId, 501, "WEB-GUEST path uses the same store-scoped option validation contract");
  }

  {
    const lineOrderRouteSource = require("fs").readFileSync(require("path").join(__dirname, "../src/routes/lineOrder.js"), "utf8");
    assert.strictEqual(
      lineOrderRouteSource.includes("inventory_movements"),
      false,
      "LINE reservation order path does not create inventory movements; options reuse that policy"
    );
    assert.ok(
      lineOrderRouteSource.includes("const { lineUserId, productId, name, phone, displayName, optionSelections } = req.body"),
      "LINE order create does not accept client-submitted option prices"
    );
    assert.ok(
      lineOrderRouteSource.includes("optionItem.unitPrice"),
      "LINE order option order_items use server-validated unitPrice"
    );
  }

  console.log("line order option tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
