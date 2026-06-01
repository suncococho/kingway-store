# Platform Admin Auth Design

## 目的

SaaS 平台管理員身份必須與門市員工身份分離。KINGWAY_TAINAN 只是 `store_id=1` 的租戶店鋪，不是 SaaS 平台本身。

本次第一版已建立平台管理員登入骨架，且不新增 `store_features`，不做功能 ON/OFF 儲存。

## 身份資料表

### `platform_admin_users`

平台管理員使用獨立資料表：

- `id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY`
- `email VARCHAR(190) NOT NULL UNIQUE`
- `password_hash VARCHAR(255) NOT NULL`
- `display_name VARCHAR(120) NOT NULL`
- `role ENUM('PLATFORM_OWNER','PLATFORM_ADMIN','SUPPORT') NOT NULL DEFAULT 'PLATFORM_ADMIN'`
- `is_active TINYINT(1) NOT NULL DEFAULT 1`
- `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
- `updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`

`platform_admin_users` 沒有 `store_id`。平台管理員不屬於任何單一門市。

### `staff_users`

`staff_users` 仍然是門市 ERP 的員工帳號來源，並且是門市/租戶範圍身份。既有門市登入 `/login`、`/dashboard`、`/pos`、`/orders` 等流程保持不變。

## 初始帳號 Seed

Backend bootstrap 會讀取以下環境值：

- `PLATFORM_ADMIN_EMAIL`
- `PLATFORM_ADMIN_PASSWORD`
- `PLATFORM_ADMIN_NAME`

讀取來源優先使用 `process.env`，若缺少則可從 repo 根目錄 `.env.staging-restore` 讀取。三個值都存在時，且 email 尚未存在，才建立一筆 `PLATFORM_OWNER`。密碼使用既有 `backend/src/utils/passwords.js` 的 bcrypt hash，禁止儲存明文密碼。

若任一值不存在，seed 會跳過，backend 不應因此啟動失敗。

## Token 邊界

平台登入 API：`POST /api/platform-auth/login`

成功回傳平台 JWT，payload 包含：

- `type: "platform_admin"`
- `scope: "platform_admin"`
- `id`
- `email`
- `displayName`
- `role`

既有門市 staff token 不包含平台 scope，不能通過 `authenticatePlatformAdmin`。平台 token 也會被既有 `authenticate` 擋下，不能混入門市 ERP API。

## Middleware

新增平台專用 middleware：

- `authenticatePlatformAdmin`
- `requirePlatformRole`

本次已將 `/api/saas-admin/*` 實際套用 `authenticatePlatformAdmin`，因此必須使用平台 token 存取。

## 前端路由

- `/platform-admin/login`：SaaS 本社平台管理員登入
- `/platform-admin`：SaaS 平台管理中心
- `/saas-admin/*`：暫時轉向 `/platform-admin`

既有 `/login` 是門市管理員/員工登入，不是平台登入。
