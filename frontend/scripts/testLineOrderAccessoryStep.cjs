const assert = require("node:assert/strict");
const path = require("node:path");
const { build } = require("esbuild");

const componentPath = path.resolve(__dirname, "../src/pages/LineOrderPage.jsx");

async function compileComponent() {
  const result = await build({
    entryPoints: [componentPath],
    bundle: true,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    write: false,
    plugins: [{
      name: "line-order-test-mocks",
      setup(build) {
        build.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "test-mock" }));
        build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: "jsx-runtime", namespace: "test-mock" }));
        build.onResolve({ filter: /^@line\/liff$/ }, () => ({ path: "liff", namespace: "test-mock" }));
        build.onResolve({ filter: /^\.\.\/lib\/(api|lineContext|lineBindingRecovery)$/ }, (args) => ({
          path: args.path,
          namespace: "test-mock"
        }));
        build.onLoad({ filter: /.*/, namespace: "test-mock" }, (args) => {
          if (args.path === "react") {
            return {
              loader: "js",
              contents: `
                export function useEffect() {}
                export function useRef(initialValue) { return { current: initialValue }; }
                export function useState(initialValue) {
                  const index = globalThis.__lineOrderHookIndex++;
                  const overrides = globalThis.__lineOrderHookOverrides || {};
                  const value = Object.prototype.hasOwnProperty.call(overrides, index) ? overrides[index] : initialValue;
                  const setter = (nextValue) => {
                    const resolved = typeof nextValue === "function" ? nextValue(value) : nextValue;
                    globalThis.__lineOrderStateUpdates.push({ index, value: resolved });
                  };
                  return [value, setter];
                }
              `
            };
          }
          if (args.path === "jsx-runtime") {
            return {
              loader: "js",
              contents: `
                export const Fragment = Symbol.for("test.fragment");
                export function jsx(type, props, key) { return { type, props: props || {}, key }; }
                export const jsxs = jsx;
              `
            };
          }
          if (args.path === "liff") {
            return { loader: "js", contents: "export default { isInClient: () => false, closeWindow() {} };" };
          }
          if (args.path === "../lib/api") {
            return { loader: "js", contents: "export async function apiRequest() { return {}; }" };
          }
          if (args.path === "../lib/lineContext") {
            return { loader: "js", contents: "export async function resolveLineContext() { return {}; }" };
          }
          return {
            loader: "js",
            contents: `
              export const DEFAULT_LINE_BINDING_STORE_CODE = "KINGWAY_TAINAN";
              export async function fetchLineBindingSnapshot() { return null; }
              export function saveLineBindingCache() {}
            `
          };
        });
      }
    }]
  });

  const moduleUnderTest = { exports: {} };
  const evaluate = new Function("module", "exports", "require", "__filename", "__dirname", result.outputFiles[0].text);
  evaluate(moduleUnderTest, moduleUnderTest.exports, require, componentPath, path.dirname(componentPath));
  return moduleUnderTest.exports.default;
}

let LineOrderPage;
const bike = { id: 101, name: "測試車款", price: 39800, stock: 2, imageUrl: null };
const accessory = {
  productId: 501,
  displayName: "防盜車鎖",
  basePrice: 1200,
  customPrice: 888,
  stock: 5,
  imageUrl: null
};
const optionGroup = {
  id: 10,
  code: "LOCK",
  label: "車鎖",
  description: "測試配件群組",
  isRequired: true,
  minSelect: 1,
  maxSelect: 1,
  products: [accessory]
};
const enabledOptions = {
  settings: {
    isEnabled: true,
    allowSkip: true,
    showPrices: true,
    pageTitle: "選擇您需要的配件",
    pageDescription: "可依照需求選擇配件，也可以略過此步驟"
  },
  groups: [optionGroup]
};

function state(overrides = {}) {
  return {
    0: false,
    1: false,
    4: "U-test",
    5: "測試客戶",
    6: "0912345678",
    10: [bike],
    11: enabledOptions,
    12: "101",
    13: {},
    14: "bike",
    15: false,
    16: null,
    17: "",
    ...overrides
  };
}

function render(overrides = {}) {
  globalThis.__lineOrderHookIndex = 0;
  globalThis.__lineOrderHookOverrides = state(overrides);
  globalThis.__lineOrderStateUpdates = [];
  return LineOrderPage();
}

function visit(node, callback) {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    node.forEach((child) => visit(child, callback));
    return;
  }
  if (typeof node !== "object") return;
  callback(node);
  visit(node.props?.children, callback);
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}

function findButton(tree, label) {
  let match = null;
  visit(tree, (node) => {
    if (!match && node.type === "button" && textOf(node).includes(label)) match = node;
  });
  assert.ok(match, `button not found: ${label}`);
  return match;
}

function assertText(tree, label) {
  assert.ok(textOf(tree).includes(label), `text not found: ${label}`);
}

function assertNoSubmitButton(tree) {
  const labels = [];
  visit(tree, (node) => {
    if (node.type === "button") labels.push(textOf(node));
  });
  assert.equal(labels.some((label) => label.includes("送出預約訂單")), false, "submit button is hidden before confirm step");
}

async function run() {
  LineOrderPage = await compileComponent();
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ orderId: 9001, orderNo: "LINE-TEST" }) };
  };

  let tree = render({ 12: "" });
  assertNoSubmitButton(tree);
  await findButton(tree, "測試車款").props.onClick();
  assert.equal(requests.length, 0, "selecting a bike does not create an order");
  assert.deepEqual(globalThis.__lineOrderStateUpdates.find((update) => update.index === 12)?.value, "101", "bike selection is retained in state");

  tree = render();
  assertNoSubmitButton(tree);
  await findButton(tree, "下一步").props.onClick();
  assert.equal(requests.length, 0, "moving from bike to options does not create an order");
  assert.deepEqual(globalThis.__lineOrderStateUpdates.find((update) => update.index === 14)?.value, "options", "enabled options open the accessory step");

  tree = render({ 14: "options" });
  assertNoSubmitButton(tree);
  assertText(tree, "步驟 2：選擇配件");
  assertText(tree, "LOCK / 車鎖");
  assertText(tree, "防盜車鎖");
  assertText(tree, "LINE價 NT$ 888");
  await findButton(tree, "防盜車鎖").props.onClick();
  assert.deepEqual(globalThis.__lineOrderStateUpdates.find((update) => update.index === 13)?.value, { 10: [501] }, "accessory can be selected");
  assert.equal(requests.length, 0, "selecting an accessory does not create an order");

  tree = render({ 14: "options", 13: { 10: [501] } });
  await findButton(tree, "確認選配").props.onClick();
  assert.equal(requests.length, 0, "confirming options does not create an order");
  assert.deepEqual(globalThis.__lineOrderStateUpdates.find((update) => update.index === 14)?.value, "confirm", "valid options advance to final confirmation");

  tree = render({ 14: "options" });
  await findButton(tree, "略過選配").props.onClick();
  assert.equal(requests.length, 0, "skipping options does not create an order");
  assert.deepEqual(globalThis.__lineOrderStateUpdates.find((update) => update.index === 14)?.value, "confirm", "skip advances to final confirmation");

  tree = render({ 14: "options", 13: { 10: [501] } });
  await findButton(tree, "返回車款").props.onClick();
  assert.equal(requests.length, 0, "returning to bike step does not create an order");
  assert.deepEqual(globalThis.__lineOrderStateUpdates.find((update) => update.index === 14)?.value, "bike", "back returns to the bike step");
  assert.equal(globalThis.__lineOrderStateUpdates.some((update) => update.index === 12), false, "back does not clear the selected bike");

  tree = render({ 13: { 10: [501] }, 14: "confirm" });
  assertText(tree, "最後確認");
  const submit = findButton(tree, "送出預約訂單");
  const firstSubmit = submit.props.onClick();
  const duplicateSubmit = submit.props.onClick();
  await Promise.all([firstSubmit, duplicateSubmit]);
  assert.equal(requests.length, 1, "final submit creates exactly one order despite a duplicate click");
  assert.match(requests[0].url, /^\/api\/line-order\/create\?store=/, "create API is only called from final submit");
  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.productId, 101, "selected bike is included in create payload");
  assert.deepEqual(payload.optionSelections, [{ groupId: 10, productIds: [501] }], "optionSelections are included in create payload");

  const failedRequests = [];
  globalThis.fetch = async (url, options) => {
    failedRequests.push({ url, options });
    return { ok: false, json: async () => ({ message: "建立訂單失敗" }) };
  };
  tree = render({ 13: { 10: [501] }, 14: "confirm" });
  await findButton(tree, "送出預約訂單").props.onClick();
  assert.equal(failedRequests.length, 1, "failed create is attempted once");
  assert.equal(globalThis.__lineOrderStateUpdates.some((update) => [12, 13, 14].includes(update.index)), false, "failed create preserves bike, option, and step state");

  console.log("line order accessory step component tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
