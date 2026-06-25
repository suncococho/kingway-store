import { filterMenuItemsForUser } from "./permissions";
import { getMenuPermission } from "./menuPermissions";

const FEATURE_ROUTE_MAP = {
  "/sales": "sales_dashboard_enabled",
  "/pos": "pos_enabled",
  "/coupons": "coupons_enabled",
  "/suppliers": "suppliers_enabled",
  "/store-transfers": "store_transfers_enabled",
  "/store-replenishment-requests": "store_transfers_enabled",
  "/hq-replenishment-requests": "store_transfers_enabled",
  "/hq-transfer-report": "store_transfers_enabled",
  "/inbound-transfers": "store_transfers_enabled",
  "/company-store-settlements": "company_store_settlements_enabled",
  "/headquarters": "headquarters_enabled",
  "/inventory": "inventory_enabled",
  "/purchase-confirmations": "purchase_confirmations_enabled",
  "/repairs": "repairs_enabled",
  "/orders": "orders_enabled",
  "/staff": "staff_management_enabled",
  "/staff-attendance": "staff_management_enabled",
  "/kpi": "staff_management_enabled",
  "/payroll": "staff_management_enabled"
};

export const mobileMenuSections = [
  {
    heading: "營運",
    items: [
      { to: "/customer-status", label: "客戶狀態", description: "電話或姓名快速查詢訂單與維修", menuKey: "dashboard" },
      { to: "/dashboard", label: "首頁", description: "今日待確認與營業摘要", menuKey: "dashboard" },
      { to: "/notifications", label: "通知中心", description: "系統通知、待處理提醒與完成紀錄", menuKey: "dashboard" },
      { to: "/messages", label: "訊息中心", description: "本部與門市訊息、公告與讀取紀錄", menuKey: "dashboard" },
      { to: "/sales", label: "銷售報表", description: "銷售統計、商品排行與訂單明細", menuKey: "dashboard" },
      { to: "/pos", label: "POS / 新訂單", description: "快速建立訂單與結帳", menuKey: "pos" },
      { to: "/orders", label: "訂單管理", description: "一般訂單、預約單、維修相關", menuKey: "orders" },
      { to: "/customers", label: "客戶管理", description: "CRM、歷程與跟進", menuKey: "customers" },
      { to: "/repairs", label: "維修管理", description: "預約、報價與完修流程", menuKey: "repairs" }
    ]
  },
  {
    heading: "商品與活動",
    items: [
      { to: "/products", label: "商品管理", description: "商品、SKU、圖片與批次操作", menuKey: "products" },
      { to: "/inventory", label: "庫存管理", description: "異動、警戒值與供應商流程", menuKey: "inventory" },
      { to: "/store-replenishment-requests", label: "門市請貨", description: "向本部申請補貨，送出後由本部出貨", menuKey: "inbound_transfers" },
      { to: "/inbound-transfers", label: "門市入庫", description: "確認本部出貨到店的實收數量", menuKey: "inbound_transfers" },
      { to: "/suppliers", label: "供應商管理", description: "供應商資料、商品供應價、發注與退貨", menuKey: "suppliers" },
      { to: "/coupons", label: "優惠券", description: "發券、審核與使用狀態", menuKey: "coupons" },
      { to: "/purchase-confirmations", label: "購買確認書", description: "簽名與 PDF 管理", menuKey: "orders" },
      { to: "/surveys", label: "問卷結果", description: "客戶回饋與維修問卷", menuKey: "repairs" }
    ]
  },
  {
    heading: "人員",
    items: [
      { to: "/staff", label: "員工管理", description: "員工資料、LINE 綁定與手動 KPI", menuKey: "staff" },
      { to: "/staff-attendance", label: "出勤", description: "打卡與歷史紀錄", menuKey: "staff" },
      { to: "/kpi", label: "KPI", description: "排名、趨勢與待確認", menuKey: "staff" },
      { to: "/payroll", label: "薪資", description: "月度出勤彙整", menuKey: "staff" }
    ]
  },
  {
    heading: "系統管理",
    items: [
      { to: "/settings/store", label: "門市設定", description: "門市名稱、地址、營業時間與對外文字", menuKey: "settings" },
      { to: "/settings/line", label: "LINE 設定", description: "LINE OA、Webhook 與 LIFF 安全設定", menuKey: "line" },
      { to: "/settings?section=system", label: "系統設定", description: "LINE 狀態、通知預設與 POS 預設", menuKey: "settings" },
      { to: "/trash", label: "已刪除資料", description: "復原或永久刪除訂單 / 維修單", menuKey: "settings" }
    ]
  }
];

function isMenuItemEnabledByFeatures(item, features) {
  const path = item.to ? item.to.split("?")[0] : "";
  const featureKey = FEATURE_ROUTE_MAP[path];
  if (!featureKey) {
    return true;
  }

  return features?.[featureKey] !== false;
}

function isMenuItemVisibleByPermissions(item, permissions, user) {
  if (!item.menuKey) {
    return true;
  }
  return getMenuPermission(permissions, item.menuKey, user).canView;
}

function isMenuItemVisibleByStoreProfile(item, storeProfile = null) {
  if (!storeProfile) return true;
  const path = item.to ? item.to.split("?")[0] : "";

  if (path === "/suppliers") {
    return storeProfile.canUseSuppliers;
  }
  if (path === "/store-replenishment-requests") {
    return storeProfile.canUseStoreReplenishment;
  }
  if (path === "/inbound-transfers") {
    return storeProfile.canUseInboundTransfers;
  }

  return true;
}

export function getMobileMenuSectionsForUser(user, features = {}, menuPermissions = null, storeProfile = null) {
  return mobileMenuSections
    .map((section) => ({
      ...section,
      items: filterMenuItemsForUser(section.items, user)
        .filter((item) => isMenuItemEnabledByFeatures(item, features))
        .filter((item) => isMenuItemVisibleByPermissions(item, menuPermissions, user))
        .filter((item) => isMenuItemVisibleByStoreProfile(item, storeProfile))
    }))
    .filter((section) => section.items.length > 0);
}

export function getSettingsSectionFromSearch(search) {
  const params = new URLSearchParams(search || "");
  return params.get("section") === "system" ? "system" : "store";
}

export function isMenuItemActive(itemTo, pathname, search) {
  if (!itemTo) {
    return false;
  }

  const [itemPath, itemQuery = ""] = itemTo.split("?");
  if (itemPath !== pathname) {
    return false;
  }

  if (itemPath !== "/settings") {
    return true;
  }

  return getSettingsSectionFromSearch(`?${itemQuery}`) === getSettingsSectionFromSearch(search);
}
