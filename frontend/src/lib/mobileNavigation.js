import { filterMenuItemsForUser } from "./permissions";
import { getMenuPermission, isOwnerUser } from "./menuPermissions";
import { canViewSalesManagement } from "./roleAccess";

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
  "/staff-scheduling": "staff_management_enabled",
  "/kpi": "staff_management_enabled",
  "/staff-kpi": "staff_management_enabled",
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
      { to: "/daily-tasks", label: "今日任務", description: "每日工作檢查、完成與逾期提醒", menuKey: "dashboard" },
      { to: "/store-cash-reports", label: "現金日報", description: "營業金盤點與每日現金收款紀錄", menuKey: "dashboard" },
      { to: "/store-visit-records", label: "來店紀錄", description: "每日來店客戶、人數與追蹤狀態", menuKey: "dashboard" },
      { to: "/sales", label: "銷售管理", description: "銷售統計、商品排行與訂單明細", menuKey: "sales_management" },
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
      { to: "/store-replenishment-requests", label: "門市請貨", description: "向本部申請補貨，不需要選擇供應商", menuKey: "store_replenishment_requests" },
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
      { to: "/staff-scheduling", label: "員工排班", description: "可排班時間、休假申請與排班草稿", menuKey: "staff_scheduling" },
      { to: "/staff-kpi", label: "KPI / 評價", description: "工作處理紀錄、分數與詳細事件", menuKey: "staff" },
      { to: "/staff-incentives", label: "我的銷售服務績效", description: "查看銷售、配件、維修檢查與支付狀態", menuKey: "staff_incentives" },
      { to: "/payroll", label: "薪資", description: "月度出勤彙整", menuKey: "staff" }
    ]
  },
  {
    heading: "系統管理",
    items: [
      { to: "/settings/store", label: "門市設定", description: "門市名稱、地址、營業時間與對外文字", menuKey: "settings" },
      { to: "/settings/manual", label: "系統使用手冊", description: "KINGWAY 操作流程、注意事項與常見錯誤", menuKey: "dashboard" },
      { to: "/line-order", label: "LINE 訂單管理", description: "LINE 訂單商品與客戶查詢", menuKey: "line" },
      { to: "/settings/line", label: "LINE 設定", description: "LINE OA、Webhook 與 LIFF 安全設定", menuKey: "line" },
      { to: "/settings/line-channels", label: "LINE Channel 管理", description: "各門市 LINE 官方帳號、Messaging API Channel 與 dry-run 測試", menuKey: "settings" },
      { to: "/settings/line-notifications", label: "LINE 通知設定", description: "員工與供應商 LINE 群組通知目標", menuKey: "settings" },
      { to: "/settings/daily-tasks", label: "每日任務設定", description: "設定每日工作項目、期限與優先級", menuKey: "settings" },
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
  const path = item.to?.split("?")[0] || "";
  if (path === "/inventory" && !canUseInventoryMain(user)) {
    return false;
  }
  if (path === "/sales" && !canViewSalesManagement(user)) {
    return false;
  }
  return getMenuPermission(permissions, item.menuKey, user).canView;
}

function canUseInventoryMain(user) {
  const role = String(user?.role || "").trim().toUpperCase();
  return isOwnerUser(user) || ["ADMIN", "MANAGER", "INVENTORY"].includes(role);
}

function isMenuItemVisibleByStoreProfile(item, storeProfile = null) {
  if (!storeProfile) return true;
  const path = item.to ? item.to.split("?")[0] : "";

  if (path === "/suppliers") {
    return storeProfile.canUseSuppliers;
  }
  if (path === "/store-replenishment-requests") {
    return true;
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
