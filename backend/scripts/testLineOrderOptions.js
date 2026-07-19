const assert = require("assert");
const {
  getLineOrderOptionConfig,
  validateLineOrderOptionSelections
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
      { id: 508, storeId: 1, sku: "OOS-1", name: "缺貨配件", category: "ACCESSORY", price: 900, stock: 0, imageUrl: null, isActive: 1, deletedAt: null }
    ],
    ...overrides
  };
}

function createConnection(data) {
  return {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
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
      if (normalized.includes("FROM line_order_option_group_products")) {
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

async function run() {
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
    const result = await validateLineOrderOptionSelections(createConnection(baseData()), 1, [{ groupId: 10, productIds: [501] }]);
    assert.strictEqual(result.items.length, 1, "existing no-option optional groups do not require extra selection");
  }

  {
    const guestResult = await validateLineOrderOptionSelections(createConnection(baseData()), 1, [{ groupId: 10, productIds: [501] }]);
    assert.strictEqual(guestResult.items[0].productId, 501, "WEB-GUEST path uses the same store-scoped option validation contract");
  }

  assert.strictEqual(
    require("fs").readFileSync(require("path").join(__dirname, "../src/routes/lineOrder.js"), "utf8").includes("inventory_movements"),
    false,
    "LINE reservation order path does not create inventory movements; options reuse that policy"
  );

  console.log("line order option tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
