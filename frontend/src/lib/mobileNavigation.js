import { filterMenuItemsForUser } from "./permissions";

const FEATURE_ROUTE_MAP = {
  "/sales": "sales_dashboard_enabled",
  "/coupons": "coupons_enabled",
  "/suppliers": "suppliers_enabled"
};

export const mobileMenuSections = [
  {
    heading: "營運",
    items: [
      { to: "/customer-status", label: "客戶狀態", description: "電話或姓名快速查詢訂單與維修" },
      { to: "/dashboard", label: "首頁", description: "今日待確認與營業摘要" },
      { to: "/sales", label: "銷售報表", description: "銷售統計、商品排行與訂單明細" },
      { to: "/pos", label: "POS / 新訂單", description: "快速建立訂單與結帳" },
      { to: "/orders", label: "訂單管理", description: "一般訂單、預約單、維修相關" },
      { to: "/customers", label: "客戶管理", description: "CRM、歷程與跟進" },
      { to: "/repairs", label: "維修管理", description: "預約、報價與完修流程" }
    ]
  },
  {
    heading: "商品與活動",
    items: [
      { to: "/products", label: "商品管理", description: "商品、SKU、圖片與批次操作" },
      { to: "/inventory", label: "庫存管理", description: "異動、警戒值與供應商流程" },
      { to: "/suppliers", label: "發注 / 退貨", description: "供應商、入庫、退貨與月結" },
      { to: "/coupons", label: "優惠券", description: "發券、審核與使用狀態" },
      { to: "/purchase-confirmations", label: "購買確認書", description: "簽名與 PDF 管理" },
      { to: "/surveys", label: "問卷結果", description: "客戶回饋與維修問卷" }
    ]
  },
  {
    heading: "人員",
    items: [
      { to: "/staff", label: "員工管理", description: "員工資料、LINE 綁定與手動 KPI" },
      { to: "/staff-attendance", label: "出勤", description: "打卡與歷史紀錄" },
      { to: "/kpi", label: "KPI", description: "排名、趨勢與待確認" },
      { to: "/payroll", label: "薪資", description: "月度出勤彙整" }
    ]
  },
  {
    heading: "系統管理",
    items: [
      { to: "/settings?section=store", label: "門市設定", description: "門市名稱、地址、營業時間與對外文字" },
      { to: "/settings?section=system", label: "系統設定", description: "LINE 狀態、通知預設與 POS 預設" },
      { to: "/trash", label: "已刪除資料", description: "復原或永久刪除訂單 / 維修單" }
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

export function getMobileMenuSectionsForUser(user, features = {}) {
  return mobileMenuSections
    .map((section) => ({
      ...section,
      items: filterMenuItemsForUser(section.items, user).filter((item) => isMenuItemEnabledByFeatures(item, features))
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
