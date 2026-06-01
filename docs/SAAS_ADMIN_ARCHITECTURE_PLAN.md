# SaaS Admin Architecture Plan

## 核心方向

SaaS 平台管理與門市 ERP 必須分離。KINGWAY_TAINAN 是 `store_id=1` 的租戶店鋪，不是 SaaS 平台本身。

目前已完成平台管理員登入、API 保護骨架，以及 `store_features` 的 DB 儲存/查詢。此階段只提供平台層級功能 ON/OFF 儲存與畫面管理，不變更 production config，不碰 LINE/Telegram token logic，也尚未套用實際業務 route enforcement。

## 身份邊界

### SaaS 本社平台管理員

- 使用 `platform_admin_users`
- 沒有 `store_id`
- 透過 `/platform-admin/login` 登入
- 使用平台 token 存取 `/api/saas-admin/*`
- 可看 SaaS 平台層級租戶店鋪總覽
- 可讀寫各租戶店鋪的 `store_features` 功能開關

### 門市管理員 / 員工

- 使用既有 `staff_users`
- 有門市/租戶範圍，KINGWAY_TAINAN 為 `store_id=1`
- 透過既有 `/login` 登入
- 使用 `/dashboard`、`/pos`、`/orders`、`/repairs`、`/settings` 等門市 ERP 頁面
- 不因 KINGWAY_TAINAN 的 `ADMIN` role 自動取得 SaaS 平台權限

## 路由規劃

平台管理：

- `/platform-admin/login`
- `/platform-admin`

既有門市 ERP：

- `/login`
- `/dashboard`
- `/pos`
- `/orders`
- `/products`
- `/repairs`
- `/settings`

舊暫時入口：

- `/saas-admin/*` 目前轉向 `/platform-admin`
- KINGWAY_TAINAN 門市 Sidebar 不再顯示 `SaaS 管理`

## API 規劃

目前已保護：

- `POST /api/platform-auth/login`
- `GET /api/saas-admin/stores`
- `GET /api/saas-admin/stores/:id/features`
- `PATCH /api/saas-admin/stores/:id/features`

`/api/saas-admin/*` 已套用 `backend/src/middleware/platformAuth.js` 的 `authenticatePlatformAdmin`，並要求平台角色屬於 `PLATFORM_OWNER`、`PLATFORM_ADMIN` 或 `SUPPORT`。middleware 會回查 `platform_admin_users`，停用帳號即使持有舊 token 也不能使用 SaaS admin API。既有 staff token 不能通過，平台 token 也不能通過門市 ERP 的既有 `authenticate`。

本階段定位為平台管理儲存與初期 enforcement 階段：已建立平台帳號、登入、token scope、API 邊界與 `store_features` 設定儲存。第一階段已套用 `sales_dashboard_enabled`、`coupons_enabled`、`suppliers_enabled` 到對應後台 API；並新增門市 staff read-only 功能查詢與前端 menu enforcement，讓門市 Sidebar / 更多頁依第一階段功能狀態隱藏銷售報表、優惠券、發注 / 供應商入口。POS、訂單、維修、庫存、LINE/Telegram 等實際業務 route enforcement 留到下一階段逐項處理。

## Phase: frontend menu enforcement for initial features

已完成：

- Backend enforcement already applied for `sales_dashboard_enabled`、`coupons_enabled`、`suppliers_enabled`。
- 新增 staff auth 專用 read-only endpoint：`GET /api/store-features/me`，只回傳目前門市的第一階段 feature 狀態。
- Frontend now hides menu items for first feature set：銷售報表、優惠券、發注 / 供應商。
- 直接 URL 進入已關閉功能時，對應 API 403 會顯示「此功能未啟用，請聯絡平台管理員。」。

Next phase：

- inventory / purchase confirmations enforcement。
- 後續逐步處理 repairs、staff management、orders、POS 與其他 feature 對應的 route 與 UI enforcement。

## Phase: second feature enforcement

已完成：

- `inventory_enabled` 已套用至 `backend/src/routes/inventory.js` 的門市庫存管理 API，並在 Sidebar / 更多頁隱藏庫存管理入口。
- `purchase_confirmations_enabled` 已套用至 `backend/src/routes/purchaseConfirmations.js` 的門市管理員 API，並在 Sidebar / 更多頁隱藏購買確認書管理入口。
- Public purchase confirmation flow continues to be allowed：`/api/purchase-confirmations/public/:token`、public PDF、manual public submit 與 LINE latest-order 入口維持在 staff auth boundary 之前，不因管理功能關閉而阻擋客戶填寫流程。
- 直接 URL 進入已關閉的庫存管理或購買確認書管理時，對應 API 403 會顯示「此功能未啟用，請聯絡平台管理員。」。

Next phase：

- `repairs_enabled`
- `staff_management_enabled`

Final phase：

- `orders_enabled`
- `pos_enabled`

## 本次保留與未做事項

已做：

- 建立 `platform_admin_users` bootstrap
- 從 `process.env` 或 `.env.staging-restore` seed 初始平台管理員
- 新增平台登入 API
- 新增平台專用 middleware
- 將 SaaS admin API 改為平台 token 專用
- 新增 `/platform-admin/login` 與 `/platform-admin`
- 移除門市 Sidebar 的 SaaS 管理入口
- 建立 `store_features` 並為所有 stores backfill 預設 ON
- 新增店鋪功能設定 GET/PATCH API
- 平台管理畫面可編輯並儲存店鋪功能開關
- 第一階段將銷售報表、優惠券、發注/供應商 API 套用 store feature enforcement
- 第一階段將銷售報表、優惠券、發注/供應商前端選單套用 store feature 狀態
- 第二階段將庫存管理、購買確認書管理 API 套用 store feature enforcement
- 第二階段將庫存管理、購買確認書管理前端選單套用 store feature 狀態
- 客戶 public 購買確認書填寫與 token/PDF 讀取流程維持可用，不受管理員功能開關阻擋

未做：

- POS、訂單、維修、員工管理等尚未套用 `store_features` route enforcement
- 訂單、維修、員工管理等門市 ERP sidebar 尚未接入 store feature 狀態；目前完成第一、第二階段功能
- 不調整 LINE/Telegram token 邏輯
- 不變更 production config
- 不改動既有門市登入與 POS/ERP 工作流

## 後續階段

1. 增加平台管理員列表與角色管理。
2. 增加平台 audit logs。
3. 將平台畫面拆到獨立 layout 與更完整的 stores 模組。
4. 如需功能設定，先設計審核與 audit，再另案建立資料模型。
5. 需要支援客服 impersonation 時，必須顯示狀態並完整稽核。
