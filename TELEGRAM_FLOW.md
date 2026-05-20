# TELEGRAM_FLOW

이 문서는 실제 mount된 `backend/src/routes/telegramWebhook.js`와 보조 service `backend/src/services/telegramService.js`를 기준으로 정리합니다. 업무 기준은 LINE-first이며, Telegram은 현재 코드상 보조 알림/공급업체/재고 명령 경로로 존재합니다.

## Mounted route

실제 mount:

- `POST /api/telegram/webhook`

Mount 위치:

- `backend/src/app.js`

Mounted file:

- `backend/src/routes/telegramWebhook.js`

주의:

- `backend/src/routes/telegram.js` 파일은 존재하지만 `backend/src/app.js`에 mount되어 있지 않습니다.

## Config

`backend/src/config.js`에서 확인된 Telegram env:

- `TELEGRAM_NOTIFY_BOT_TOKEN`
- `TELEGRAM_STOCK_BOT_TOKEN`
- `TELEGRAM_ORDER_GROUP_ID`
- `TELEGRAM_HQ_GROUP_ID`
- `TELEGRAM_STOCK_GROUP_ID`
- `TELEGRAM_REPAIR_CONFIRM_GROUP_ID`
- `TELEGRAM_ALLOWED_STAFF_IDS`
- `TELEGRAM_ALLOWED_CHAT_IDS`

Startup에서 `backend/src/server.js`가 `validateTelegramConfig()`를 호출합니다.

## Callback query

`backend/src/routes/telegramWebhook.js`에서 확인:

### Supplier callback

Callback data prefix:

- `supplier:approve:{id}`
- `supplier:reject:{id}`

동작:

- `supplier_requests` 조회
- 승인 시 `status = APPROVED`
- 반려 시 `status = REJECTED`
- return request 승인 시 `status = RETURN_CONFIRMED`
- return 승인 시 상품 stock 차감과 `inventory_movements` `OUT` 기록
- Telegram message edit
- stock group 알림 전송

### Conversation callback

Supplier callback이 아니면:

- `handleTelegramConversationCallback(BOT_NOTIFY, callbackQuery)`

이 함수는 `backend/src/services/telegramService.js`에 있습니다.

## Message commands in mounted webhook

`backend/src/routes/telegramWebhook.js`에서 확인된 command:

- `/start`
- `維修確認`
- `確認維修`
- `/supplier xlsx [supplier]`
- `/supplier monthly [supplier]`
- `/supplier excel [supplier]`
- `/supplier report [supplier]`
- `/help`
- `/po_help`
- `/supplier_help`
- `/lowstock`
- `/lowstock auto`
- `/supplier [pending] [supplier]`
- `/return-done id`
- `/receive id qty`
- `/po [supplier] SKU qty note`
- `/return [supplier] SKU qty reason`

인식되지 않은 text는 `指令未識別。輸入 /help 查看可用指令。` 메시지를 반환합니다.

## Supplier request from web

Frontend:

- `frontend/src/pages/SuppliersPage.jsx`

Backend:

- `POST /api/suppliers/requests`

File:

- `backend/src/routes/suppliers.js`

동작:

- `supplier_requests` 생성
- `supplier_request_items` 생성
- `sendSupplierDecisionRequest()`로 Telegram HQ group에 approve/reject inline keyboard 전송
- callback data는 `supplier:approve:{id}`, `supplier:reject:{id}`

## Supplier receive/return routes

Web routes:

- `GET /api/suppliers/requests`
- `POST /api/suppliers/:id/receive`
- `POST /api/suppliers/:id/return-done`
- `GET /api/suppliers/monthly`

Inventory routes:

- `GET /api/inventory/supplier-requests`
- `POST /api/inventory/supplier-requests`
- `POST /api/inventory/supplier-requests/:id/respond`
- `POST /api/inventory/supplier-requests/:id/receive`

## Telegram service legacy/session functions

`backend/src/services/telegramService.js`에서 확인되는 함수/흐름:

- `handleTelegramNotifyCommand`
- `handleTelegramConversationCallback`
- `handleStockCommand`
- `sendInternalTelegram`
- `sendOrderNotification`
- `sendPurchaseConfirmationGroupNotification`
- `sendRepairGroupAlert`
- `sendSupplierDecisionRequest`
- `sendDailyReport`

Service 내부 command/session:

- `/order`
- `/baojia`
- `/up`
- `/crm`
- `/stock`
- `/in`
- `/out`
- `/set`

그러나 `handleTelegramNotifyCommand`/`handleStockCommand`를 사용하는 `backend/src/routes/telegram.js`는 현재 app에 mount되어 있지 않습니다. 실제 운영 webhook은 `telegramWebhook.js` 기준으로 확인해야 합니다.

## sendInternalTelegram routing

`backend/src/services/telegramService.js`에서 확인된 routing:

- daily report: `orderGroupId`
- supplier action/text: `hqGroupId`
- inventory: `stockGroupId`
- text에 `維修`, `購買確認`, `google`, `評論`, `優惠券`, `交車`, `報價`가 포함되면 `repairConfirmGroupId`
- 그 외 기본값: `orderGroupId`

## Tables

Telegram 관련 table:

- `telegram_chat_sessions`

Supplier 관련 table:

- `supplier_requests`
- `supplier_request_items`
- `inventory_movements`

## LINE-first caution

`docs/KINGWAY_STORE_MASTER_SPEC.md` 기준으로 고객/직원/공급업체 핵심 승인 흐름은 LINE-first입니다. Telegram 코드는 현재 존재하지만, 신규 업무 흐름을 Telegram 중심으로 확장하는 것은 master spec과 충돌할 수 있습니다.
