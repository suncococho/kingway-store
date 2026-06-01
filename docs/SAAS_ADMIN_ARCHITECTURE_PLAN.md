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

本階段定位為平台管理儲存與逐步 enforcement 階段：已建立平台帳號、登入、token scope、API 邊界與 `store_features` 設定儲存。第一階段已套用 `sales_dashboard_enabled`、`coupons_enabled`、`suppliers_enabled` 到對應後台 API；並新增門市 staff read-only 功能查詢與前端 menu enforcement，讓門市 Sidebar / 更多頁依第一階段功能狀態隱藏銷售報表、優惠券、發注 / 供應商入口。第二至最終階段已完成庫存、購買確認書管理、維修、員工管理、訂單管理與 POS enforcement。LINE/Telegram 與 public/LIFF 客戶流程需維持獨立邊界，不因門市後台功能開關而阻擋客戶流程。

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

Later phases：

- `orders_enabled`
- `pos_enabled`

## Phase: third feature enforcement

已完成：

- `repairs_enabled` 已套用至 `backend/src/routes/repairs.js` 的門市維修管理 API，並在 Sidebar / 更多頁隱藏維修管理入口。
- `staff_management_enabled` 已套用至員工、出勤、KPI、薪資管理 API：`backend/src/routes/staff.js`、`attendance.js`、`kpi.js`、`payroll.js`，並在 Sidebar / 更多頁隱藏員工管理、出勤、KPI、薪資入口。
- LINE/public repair flow continues to be allowed：LINE 客戶水路維持在 `/api/line-repair/*` 等 public/LIFF route，不因管理功能關閉而阻擋客戶送出水路預約。
- 直接 URL 進入已關閉的維修或員工管理相關頁面時，對應 API 403 會顯示「此功能未啟用，請聯絡平台管理員。」。

Next phase：

- `orders_enabled`

Final phase：

- `pos_enabled`

## Phase: fourth feature enforcement

已完成：

- `orders_enabled` 已套用至 `backend/src/routes/orders.js` 的門市訂單管理 API：列表、垃圾桶、刪除/復原、詳細、修改、品項編輯、購買確認書重送、尾款收取、交車確認與 invoice 讀取。
- `backend/src/routes/orderItemsEdit.js` 屬於訂單品項管理編輯路徑，已套用 `orders_enabled`。
- Sidebar / 更多頁已依 `orders_enabled` 隱藏「訂單管理」入口；直接 URL 進入時，訂單管理 API 403 會顯示「此功能未啟用，請聯絡平台管理員。」。
- POS/order boundary：POS 建單 `POST /api/orders` 本階段刻意不套用 `orders_enabled`，避免把 POS 功能誤判為訂單管理功能。`pos_enabled` 仍需獨立設計與測試。
- Public purchase confirmation flow 與 LINE/public LIFF 客戶流程未調整，維持可用。

Final remaining phase：

- `pos_enabled`

## Phase: final feature enforcement

已完成：

- `pos_enabled` 已套用至 `backend/src/routes/orders.js` 的 POS 建單 API：`POST /api/orders`。此路徑是 POS 畫面完成付款或建立訂單時的保存流程。
- Sidebar / 更多頁已依 `pos_enabled` 隱藏「POS / 新訂單」入口；直接 URL 進入 POS 頁面時顯示「此功能未啟用，請聯絡平台管理員。」。
- orders/POS boundary：`orders_enabled` 繼續負責訂單列表、詳情、修改、刪除、尾款與交車等管理 API；`pos_enabled` 只負責 POS 新訂單建立/結帳保存流程。
- Public purchase confirmation flow、LINE/public repair/order LIFF flow 維持可用，不套用 `pos_enabled` 或 `orders_enabled`。

Feature enforcement phase complete：

- 初始核心 feature set 已完成 backend route enforcement 與門市前端 menu/page enforcement。

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
- 第三階段將維修管理 API 套用 store feature enforcement，LINE/public repair flow 維持可用
- 第三階段將員工管理、出勤、KPI、薪資 API 套用 store feature enforcement
- 第三階段將維修管理、員工管理、出勤、KPI、薪資前端選單套用 store feature 狀態
- 第四階段將訂單管理 API 套用 store feature enforcement，但 POS 建單 `POST /api/orders` 維持可用
- 第四階段將訂單管理前端選單套用 store feature 狀態
- 最終階段將 POS 建單 `POST /api/orders` 套用 `pos_enabled`，並將 POS 前端入口與直接頁面接入 store feature 狀態

未做：

- 不再保留核心 feature enforcement 階段；目前核心 feature set 已套用完畢
- 訂單管理與 POS 邊界已拆分：管理 API 使用 `orders_enabled`，POS 建單使用 `pos_enabled`
- 不調整 LINE/Telegram token 邏輯
- 不變更 production config
- 不改動既有門市登入與 POS/ERP 工作流

## 後續階段

1. 增加平台管理員列表與角色管理。
2. 增加平台 audit logs。
3. 將平台畫面拆到獨立 layout 與更完整的 stores 模組。
4. 如需功能設定，先設計審核與 audit，再另案建立資料模型。
5. 需要支援客服 impersonation 時，必須顯示狀態並完整稽核。

## Staging Tenant Isolation Test（當前任務）

目標：建立第二個測試店鋪 `KINGWAY_KAOHSIUNG`（`store_id=2`），並驗證租戶隔離。

已完成項目（預期）：

- `stores`: 新增 `KINGWAY_KAOHSIUNG`，`name=KINGWAY 高雄`，`status=active`，`plan=single_store`。
- `store_features`: 針對 `store_id=2` 建立預設 row，全部 feature 欄位預設為 `1`（全開）。
- `staff_users`: 建立 `kaohsiung_owner`，`store_id=2`，`is_active=1`，`role=ADMIN`。
- `products`: 建立樣本 `KH-TEST-001 / 高雄測試商品`，`store_id=2`。
- `customers`: 建立樣本 `高雄測試客戶 / 0900000002`，`customer_type=OFFLINE_WITH_PHONE`，`store_id=2`。

隔離驗證要點：

- `GET /api/saas-admin/stores`（platform token）應回傳 `totalStores >= 2`，並同時顯示 `KINGWAY_TAINAN`、`KINGWAY_KAOHSIUNG`。
- `store_id=2` staff token 呼叫 `GET /api/products` 應可見 `KH-TEST-001`。
- `store_id=1` staff token 呼叫 `GET /api/products` 不應看到 `KH-TEST-001`。

Next phase：

- 店長管理 UI / tenant owner 操作 flow。
- 禁止員工跨店切換。
- 店鋪整合設定（integration settings）補齊。
