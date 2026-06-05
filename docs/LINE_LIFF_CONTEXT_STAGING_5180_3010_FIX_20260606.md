# LIFF 使用者識別回復修正（Staging: 5180 / 3010 僅）

- 日期：2026-06-06
- 目的：修正 LINE 內打開時 `LinePhoneBindGate` 顯示「無法取得 LINE 使用者資料」但實際有可回復識別來源的狀況。

## 變更內容
- 新增 `frontend/src/lib/lineContext.js`
  - 封裝 LIFF 初始化 / 載入 / 識別流程。
  - 加入 `liff.isInClient()` 與 `liff.getContext()` 判斷。
  - `liff.getProfile()` 失敗時進行重試（兩次延遲重試）。
  - 回復 `lineUserId` 來源順序：
    1) URL Query
    2) sessionStorage
    3) localStorage
    4) `liff.getContext().userId`
  - 失敗時回傳可讀取的 `failureReason`。

- 更新頁面（staging 目標）
  - `frontend/src/pages/LineOrderPage.jsx`
  - `frontend/src/pages/LineCustomerPage.jsx`
  - `frontend/src/pages/LineRepairRequestPage.jsx`
  - `frontend/src/pages/LineGoogleReviewPage.jsx`
  - `frontend/src/pages/LineProgressPage.jsx`
  - 由 `resolveLineContext` 取用 line 使用者資訊。
  - `LinePhoneBindGate` 回傳缺漏原因（僅在 LIFF 內顯示詳細原因）。

- 更新綁定元件
  - `frontend/src/pages/LinePhoneBindGate.jsx`
  - 新增 `inClient`、`failureReason` props。
  - 保留既有「無法取得 LINE 使用者資料」基本提示，LIFF 內額外帶出原因。

## 驗證
- build：`npm --prefix frontend run build`
- staging frontend 只重建：
  - `docker compose -f docker-compose.staging-restore.yml build frontend`
  - `docker compose -f docker-compose.staging-restore.yml up -d --no-deps frontend`
