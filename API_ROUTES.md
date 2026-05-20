# API_ROUTES

이 문서는 `backend/src/app.js`와 `backend/src/routes/*.js`에서 확인한 실제 route 목록입니다.

## Route mount summary

`backend/src/app.js` 기준 mount:

| Prefix | File |
| --- | --- |
| `/api/settings` | `backend/src/routes/settings.js` |
| `/api/products` | `backend/src/routes/products.js` |
| `/api` | `backend/src/routes/auth.js` |
| `/api/auth` | `backend/src/routes/auth.js` |
| `/api/dashboard` | `backend/src/routes/dashboard.js` |
| `/api/staff` | `backend/src/routes/staff.js` |
| `/api/customers` | `backend/src/routes/customers.js` |
| `/api/inventory` | `backend/src/routes/inventory.js` |
| `/api/orders` | `backend/src/routes/orderItemsEdit.js` |
| `/api/orders` | `backend/src/routes/orders.js` |
| `/api/purchase-confirmations` | `backend/src/routes/purchaseConfirmations.js` |
| `/api/repairs` | `backend/src/routes/repairs.js` |
| `/api/coupons` | `backend/src/routes/coupons.js` |
| `/api/surveys` | `backend/src/routes/surveys.js` |
| `/api/suppliers` | `backend/src/routes/suppliers.js` |
| `/api/attendance` | `backend/src/routes/attendance.js` |
| `/api/kpi` | `backend/src/routes/kpi.js` |
| `/api/payroll` | `backend/src/routes/payroll.js` |
| `/api/telegram` | `backend/src/routes/telegramWebhook.js` |
| `/api/line` | `backend/src/routes/line.js` |
| `/api/debug` | `backend/src/routes/debug.js` |
| `/api/line-order` | `backend/src/routes/lineOrder.js` |
| `/files` | `backend/storage` static |

## App-level routes

`backend/src/app.js`에 직접 정의된 route:

- `GET /api/products`
- `GET /api/customer-status`
- `POST /api/customer-status/orders/:id/payment`
- `POST /api/customer-status/orders/:id/deliver`
- `POST /api/customer-status/repairs/:id/payment`
- `POST /api/customer-status/repairs/:id/pickup`
- `GET /health`

`GET /api/products`는 app-level direct route가 먼저 등록되고, 그 뒤에 `backend/src/routes/products.js`가 `/api/products`에 mount됩니다.

## Auth

File: `backend/src/routes/auth.js`

- `POST /api/login`
- `GET /api/me`
- `POST /api/auth/login`
- `GET /api/auth/me`

`/api`와 `/api/auth` 두 prefix에 같은 router가 mount되어 위 4개 route가 모두 유효합니다.

## Settings

File: `backend/src/routes/settings.js`

- `GET /api/settings/public`
- `GET /api/settings`
- `PATCH /api/settings/store`
- `PATCH /api/settings/system`

## Dashboard

File: `backend/src/routes/dashboard.js`

- `GET /api/dashboard/summary`

## Staff

File: `backend/src/routes/staff.js`

- `GET /api/staff`
- `POST /api/staff`
- `PATCH /api/staff/:id`

## Attendance

File: `backend/src/routes/attendance.js`

- `GET /api/attendance`
- `POST /api/attendance/check-in`
- `POST /api/attendance/check-out`
- `GET /api/attendance/checklist/today`
- `POST /api/attendance/checklist/:id/toggle`

## KPI

File: `backend/src/routes/kpi.js`

- `GET /api/kpi`
- `POST /api/kpi/manual-log`

## Payroll

File: `backend/src/routes/payroll.js`

- `GET /api/payroll/summary`

## Customers

File: `backend/src/routes/customers.js`

- `GET /api/customers`
- `POST /api/customers`
- `PATCH /api/customers/:id`
- `GET /api/customers/:id/detail`
- `POST /api/customers/:id/follow-up`
- `DELETE /api/customers/:id`

## Customer status

Direct app-level routes in `backend/src/app.js`:

- `GET /api/customer-status`
- `POST /api/customer-status/orders/:id/payment`
- `POST /api/customer-status/orders/:id/deliver`
- `POST /api/customer-status/repairs/:id/payment`
- `POST /api/customer-status/repairs/:id/pickup`

File `backend/src/routes/customerStatus.js` exists and defines `GET /`, but it is not mounted in `backend/src/app.js`.

## Products

File: `backend/src/routes/products.js`

- `POST /api/products/images`
- `GET /api/products/next-sku`
- `POST /api/products`
- `PATCH /api/products/:id`

Also direct app-level:

- `GET /api/products`

## Inventory

File: `backend/src/routes/inventory.js`

- `GET /api/inventory/movements`
- `POST /api/inventory/movements`
- `GET /api/inventory/low-stock`
- `GET /api/inventory/supplier-requests`
- `POST /api/inventory/supplier-requests`
- `POST /api/inventory/supplier-requests/:id/respond`
- `POST /api/inventory/supplier-requests/:id/receive`

## Suppliers

File: `backend/src/routes/suppliers.js`

- `GET /api/suppliers/requests`
- `POST /api/suppliers/requests`
- `POST /api/suppliers/:id/receive`
- `POST /api/suppliers/:id/return-done`
- `GET /api/suppliers/monthly`

## Orders

Files: `backend/src/routes/orders.js`, `backend/src/routes/orderItemsEdit.js`

- `GET /api/orders`
- `GET /api/orders/trash/list`
- `DELETE /api/orders/:id`
- `POST /api/orders/:id/restore`
- `DELETE /api/orders/:id/permanent`
- `GET /api/orders/:id`
- `POST /api/orders`
- `PATCH /api/orders/:id`
- `PUT /api/orders/:id/items`
- `POST /api/orders/:id/purchase-confirmation`
- `POST /api/orders/:id/collect-balance`
- `POST /api/orders/:id/confirm-handover`

`PUT /api/orders/:id/items`는 `orderItemsEdit.js`와 `orders.js` 양쪽에 정의되어 있고, `orderItemsEditRoutes`가 먼저 mount됩니다.

## Purchase confirmations

File: `backend/src/routes/purchaseConfirmations.js`

Public:

- `GET /api/purchase-confirmations/public/:token`
- `GET /api/purchase-confirmations/public/:token/pdf`
- `GET /api/purchase-confirmations/manual/:id/pdf`
- `POST /api/purchase-confirmations/public/:token`
- `POST /api/purchase-confirmations/manual`

Authenticated:

- `GET /api/purchase-confirmations`
- `GET /api/purchase-confirmations/pending-links`
- `POST /api/purchase-confirmations/generate-link`

## Repairs

File: `backend/src/routes/repairs.js`

- `GET /api/repairs`
- `GET /api/repairs/products`
- `GET /api/repairs/trash/list`
- `DELETE /api/repairs/:id`
- `POST /api/repairs/:id/restore`
- `DELETE /api/repairs/:id/permanent`
- `GET /api/repairs/:id`
- `POST /api/repairs`
- `POST /api/repairs/:id/reservation/respond`
- `POST /api/repairs/:id/estimate`
- `POST /api/repairs/:id/customer-response`
- `POST /api/repairs/:id/offline-complete`
- `POST /api/repairs/:id/approve`
- `POST /api/repairs/:id/reject`
- `POST /api/repairs/:id/complete`
- `POST /api/repairs/:id/phone-notified`
- `POST /api/repairs/:id/pickup`

## Coupons

File: `backend/src/routes/coupons.js`

- `GET /api/coupons`
- `POST /api/coupons/issue`
- `POST /api/coupons/request-google-review`
- `POST /api/coupons/approve-google-review/:id`
- `POST /api/coupons/reject-google-review/:id`
- `POST /api/coupons/:id/cancel`

## Surveys

File: `backend/src/routes/surveys.js`

Public:

- `GET /api/surveys/public/:token`
- `POST /api/surveys/public/:token`

Authenticated:

- `GET /api/surveys`
- `POST /api/surveys/generate-link`

## LINE

File: `backend/src/routes/line.js`

- `POST /api/line/webhook`
- `GET /api/line/groups`
- `POST /api/line/daily-report/send`
- `POST /api/line/pending-summary/send`

## LINE order

File: `backend/src/routes/lineOrder.js`

- `GET /api/line-order/customer`
- `GET /api/line-order/ebikes`
- `POST /api/line-order/create`

## Telegram

Mounted file: `backend/src/routes/telegramWebhook.js`

- `POST /api/telegram/webhook`

File `backend/src/routes/telegram.js` exists but is not mounted in `backend/src/app.js`.

## Debug

File: `backend/src/routes/debug.js`

- `GET /api/debug/repairs-visibility`

## Frontend route to API mapping

확인된 주요 frontend page와 API 사용:

| Frontend file | Main APIs |
| --- | --- |
| `frontend/src/pages/POSPage.jsx` | `/products`, `/customers`, `/orders` |
| `frontend/src/pages/OrdersPage.jsx` | `/orders`, `/orders/:id/collect-balance`, `/orders/:id/confirm-handover`, `/orders/:id/purchase-confirmation` |
| `frontend/src/pages/OrderEditPage.jsx` | `/orders/:id`, `/products`, `/orders/:id`, `/orders/:id/items` |
| `frontend/src/pages/RepairsPage.jsx` | `/repairs`, `/customers`, `/repairs/:id/reservation/respond` |
| `frontend/src/pages/RepairDetailPage.jsx` | `/repairs/:id`, `/repairs/products`, repair action routes |
| `frontend/src/pages/CustomersPage.jsx` | `/customers`, `/customers/:id/detail`, `/customers/:id/follow-up`, `/coupons`, `/surveys`, `/purchase-confirmations` |
| `frontend/src/pages/ProductsPage.jsx` | `/products`, `/products/images`, `/products/next-sku` |
| `frontend/src/pages/InventoryPage.jsx` | `/inventory/movements`, `/inventory/low-stock`, `/inventory/supplier-requests` |
| `frontend/src/pages/SuppliersPage.jsx` | `/suppliers/requests`, `/suppliers/monthly`, `/suppliers/:id/receive`, `/suppliers/:id/return-done` |
| `frontend/src/pages/LineOrderPage.jsx` | `/api/line-order/customer`, `/api/line-order/ebikes`, `/api/line-order/create` |
| `frontend/src/pages/PurchaseConfirmPublicPage.jsx` | `/purchase-confirmations/public/:token`, `/purchase-confirmations/manual` |
| `frontend/src/pages/SurveyPublicPage.jsx` | `/surveys/public/:token` |
