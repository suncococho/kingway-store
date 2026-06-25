# KINGWAY 系統使用手冊・通知中心・訊息中心・每日任務・LINE群組通知 整合設計

Date: 2026-06-25
Scope: read-only audit and design only. No code implementation, no DB write, no migration, no deployment.

## 1. Audit Summary

### Current frontend structure

Checked areas:

- `frontend/src/App.jsx`
- `frontend/src/components/Sidebar.jsx`
- `frontend/src/components/ProtectedLayout.jsx`
- `frontend/src/lib/mobileNavigation.js`
- `frontend/src/lib/menuPermissions.js`
- `frontend/src/lib/storeOperationProfile.js`
- `frontend/src/pages/SettingsPage.jsx`
- `frontend/src/pages/StaffPage.jsx`
- `frontend/src/pages/KPIPage.jsx`
- `frontend/src/pages/SuppliersPage.jsx`
- `frontend/src/pages/StoreReplenishmentRequestsPage.jsx`
- `frontend/src/pages/HqReplenishmentRequestsPage.jsx`
- `frontend/src/pages/HeadquartersPage.jsx`
- `frontend/src/pages/InboundTransfersPage.jsx`
- `frontend/src/pages/CompanyStoreSettlementsPage.jsx`
- `frontend/src/pages/HqTransferReportPage.jsx`
- `frontend/src/pages/OrdersPage.jsx`
- `frontend/src/pages/RepairsPage.jsx`
- `frontend/src/pages/POSPage.jsx`

Current findings:

- Routes are registered in `frontend/src/App.jsx`.
- Authenticated pages are mounted under `ProtectedLayout`.
- Sidebar and mobile navigation are generated from `Sidebar.jsx` and `mobileNavigation.js`.
- Store operation type restrictions already exist in `ProtectedLayout` through `buildStoreOperationProfile`.
- Existing global processing UI exists as `GlobalProcessingOverlay`, but there is no DB-backed global notification popup yet.
- `SettingsPage` already has `系統設定` tabs for LINE and notification summary, but no full manual, notification center, message center, daily task settings, or group notification settings.
- Staff KPI pages exist (`StaffPage`, `KPIPage`), but KPI is not yet unified with notification/message/daily-task completion events.

### Current backend structure

Checked areas:

- `backend/src/app.js`
- `backend/src/routes/settings.js`
- `backend/src/routes/staff.js`
- `backend/src/routes/kpi.js`
- `backend/src/routes/lineOrder.js`
- `backend/src/routes/lineRepair.js`
- `backend/src/routes/purchaseConfirmations.js`
- `backend/src/routes/repairConfirmations.js`
- `backend/src/routes/storeReplenishmentRequests.js`
- `backend/src/routes/storeTransfers.js`
- `backend/src/routes/companyStoreSettlements.js`
- `backend/src/routes/supplierPurchases.js`
- `backend/src/routes/supplierReturns.js`
- `backend/src/routes/telegramWebhook.js`
- `backend/src/services/staffLineNotify.js`
- `backend/src/services/storeReplenishmentNotificationService.js`
- `backend/src/services/telegramService.js`
- `backend/src/services/lineWorkflowService.js`
- `backend/src/services/taskService.js`
- `backend/src/services/kpiService.js`

Current findings:

- Route registration is centralized in `backend/src/app.js`.
- Existing staff LINE group notifications are partly implemented in `staffLineNotify.js` for repair reservation, order reservation, and payment inquiry style events.
- Current store replenishment notification service sends direct LINE push to staff `line_user_id` and has safe fallback behavior.
- Telegram delivery is centralized in `telegramService.js` and existing Telegram commands/notifications must remain.
- LINE workflow events and customer LINE flow are large and sensitive; new staff/supplier group notification should not change customer-facing LINE message behavior.
- There is no dedicated DB-backed `staff_notifications`, `internal_messages`, `daily_staff_tasks`, or `staff_kpi_events` system yet.

### Current DB structure relevant to design

Read-only schema audit confirmed:

- `stores` has store identity, plan, status, trial/subscription fields, but no store-level LINE group notification columns.
- `suppliers` has `owner_type`, `owner_store_id`, `owner_company_id`, `visibility`, contact fields, and `line_contact`, but no supplier LINE group setting table.
- `staff_users` has `line_user_id`, `telegram_user_id`, `telegram_username`, `role`, `store_id`.
- `store_memberships` maps staff to stores with `owner/admin/staff` role.
- `company_stores` maps stores to companies with `HEADQUARTERS`, `WAREHOUSE`, `DIRECT_STORE`, `FRANCHISE_STORE`.
- There is no existing table matching `staff_notifications` / `internal_messages` / `daily_staff_tasks` / `supplier_notification_settings`.

## A. 功能整體概覽

The target is a unified staff operation system inside KINGWAY POS:

- `系統使用手冊`: staff-facing operation manual inside POS.
- `使用說明` buttons: page-level help modal on important management pages.
- `通知中心`: DB-backed staff notifications, tasks, reminders, and workflow alerts.
- `訊息中心`: internal headquarters/store messaging.
- `每日任務`: daily checklist and required recurring tasks.
- `POS中央彈窗`: global popup for new notifications and messages.
- Sidebar unread badge: visual unread counts for notifications, messages, urgent alerts, and daily tasks.
- LINE staff group notification: store-specific staff group push, not customer LINE.
- LINE supplier group notification: supplier/store-specific group push.
- Telegram integration: keep existing Telegram notification and command flows, then add DB notification hooks where safe.

Key principle:

- DB notification creation is the source of truth.
- LINE/Telegram delivery is secondary and must not break the core business transaction if it fails.
- Group IDs must be configured per store and per supplier/store combination.
- A single global group ID is not sufficient.

## B. Menu Structure Design

### Sidebar additions

Add:

- `通知中心`
  - route: `/notifications`
  - unread count badge, e.g. `通知中心 3`
  - urgent state: red dot or red numeric badge

- `訊息中心`
  - route: `/messages`
  - unread message badge, e.g. `訊息中心 2`
  - urgent message highlight

Optional:

- `今日任務`
  - route: `/notifications?tab=today`
  - can be shown as a badge under `通知中心` instead of a separate menu in MVP.

### System settings additions

Under `系統設定`:

- `系統使用手冊`
- `LINE 通知設定`
- `每日任務設定`
- `供應商 LINE 設定`
- `通知 / 訊息設定`

Recommended routes:

- `/settings/manual`
- `/settings/line-notifications`
- `/settings/daily-tasks`
- `/settings/supplier-line`
- `/settings/notifications`

For MVP, these can be tabs inside `SettingsPage` to avoid too many pages.

## C. 系統使用手冊 Design

Route:

- `/settings/manual`

Page name:

- `系統使用手冊`

Content sections:

1. Store type menu explanation
2. `供應商管理`
3. `門市請貨`
4. `本部請貨管理`
5. `本部出貨`
6. `門市入庫`
7. `本部月結`
8. `本部出貨明細`
9. `供應商發注`
10. `供應商退貨`
11. Telegram commands
12. LINE customer flows
13. Purchase confirmation / repair completion confirmation
14. Daily task checklist
15. Common mistakes

Recommended source:

- Start from `docs/KINGWAY_STORE_OPERATION_FLOW_2026-06-25.md`.
- Convert it into UI-friendly sections with short cards and quick reference tables.

## D. 使用說明 Button Design

Add a `使用說明` button near `PageHeader` on high-risk pages.

Target pages:

- `/suppliers` - `供應商管理`
- `/store-replenishment-requests` - `門市請貨`
- `/hq-replenishment-requests` - `本部請貨管理`
- `/store-transfers` - `本部出貨`
- `/inbound-transfers` - `門市入庫`
- `/company-store-settlements` - `本部月結`
- `/hq-transfer-report` - `本部出貨明細`
- `/inventory` - `庫存管理`
- `/orders` - `訂單管理`
- `/repairs` - `維修管理`
- `/pos` - POS

Component candidates:

- `frontend/src/components/PageHelpButton.jsx`
- `frontend/src/components/PageHelpModal.jsx`

Example help text:

- `本部出貨`: `此頁是實際出貨確認頁。按下確認出貨後，本部庫存會立即扣除。`
- `門市入庫`: `確認入庫後，門市庫存會增加。`
- `門市請貨`: `此頁用於門市向本部申請補貨。`
- `本部請貨管理`: `建立本部出貨單不扣庫存；建立並確認出貨會立即扣本部庫存。`
- `供應商管理`: `供應商發注、入庫、退貨與月結集中在此頁。`

MVP approach:

- Hardcode page help content in a frontend map.
- Later move help content to DB or markdown if operation staff need to edit it.

## E. 通知中心 Design

Route:

- `/notifications`

Tabs:

- `未處理`
- `今日任務`
- `已確認`
- `已完成`
- `全部紀錄`

Fields shown:

- Notification type
- Title
- Message
- Related store
- Related customer / supplier
- Created time
- Due time
- Priority
- Status
- Target URL

Actions:

- `前往處理`
- `已確認`
- `完成`
- `稍後提醒`
- `忽略`

Status meaning:

- `UNREAD`: not seen yet.
- `READ`: acknowledged, not completed.
- `DONE`: completed.
- `DISMISSED`: ignored.
- `SNOOZED`: hidden until `snoozed_until`.

Important rule:

- `已確認` is read acknowledgment.
- `完成` means the staff completed the actual work or the system verified completion.

## F. 訊息中心 Design

Route:

- `/messages`

Functions:

- Headquarters to all stores announcement.
- Headquarters to specific store message.
- Store to headquarters message.
- Store asks headquarters about stock, repairs, customers, or operation issues.
- Read receipt.
- Unread badge.
- Important / urgent priority.

Permissions:

`HEADQUARTERS` / `WAREHOUSE`:

- Send to all stores.
- Send to a specific store.
- Read all company store messages.
- Archive messages.

`DIRECT_STORE` / `FRANCHISE_STORE`:

- Send to headquarters.
- Read only own store messages.
- Cannot read other stores' messages.

`INDEPENDENT`:

- Internal store messages only.
- No headquarters/franchise structure.

Message types:

- `ANNOUNCEMENT`
- `STORE_TO_HQ`
- `HQ_TO_STORE`
- `INTERNAL`

## G. POS中央彈窗 Design

Global component:

- `frontend/src/components/StaffNotificationPopup.jsx`
- Alternative: `frontend/src/components/GlobalAlertModal.jsx`

Mount location:

- `ProtectedLayout.jsx`
- Exclude public LINE/customer pages.
- Exclude login/platform public pages.

Polling:

- MVP: every 30 seconds.
- Urgent mode can poll every 15 seconds only while POS/admin layout is active.
- Later improvement: WebSocket/SSE.

Popup behavior:

- Centered large card.
- Background dim.
- Type badge: `NOTIFICATION` / `MESSAGE` / `DAILY_TASK`.
- Priority badge.
- Title and message.
- `target_url` button.

Buttons:

- `前往處理`
- `查看訊息`
- `已確認`
- `完成`
- `稍後提醒`

Rules:

- Notification and message use the same popup system.
- `URGENT` priority uses stronger visual emphasis.
- Prevent popup spam by showing one item at a time and respecting snooze.

## H. Sidebar Unread Badge Design

API:

- `GET /api/staff-dashboard/unread-summary`

Response:

```json
{
  "notifications": 3,
  "messages": 2,
  "urgent": 1,
  "dailyTasks": 4
}
```

Sidebar display:

- `通知中心 3`
- `訊息中心 2`
- `今日任務 4`
- urgent badge uses red highlight.

Refresh:

- On app load.
- After marking notification/message read or done.
- During global popup polling.

## I. DB Design

This section is a design only. Do not run migration before staging approval and production backup.

### 1. `staff_notifications`

Purpose:

- System-generated staff notifications.
- LINE reservation alerts.
- Missing purchase/repair confirmations.
- Daily task reminders.
- Headquarters/store/supplier workflow events.

Columns:

- `id`
- `company_id`
- `store_id` nullable
- `staff_user_id` nullable
- `type`
- `title`
- `message`
- `target_url`
- `ref_type`
- `ref_id`
- `priority`: `LOW` / `NORMAL` / `IMPORTANT` / `URGENT`
- `status`: `UNREAD` / `READ` / `DONE` / `DISMISSED` / `SNOOZED`
- `due_at` nullable
- `snoozed_until` nullable
- `created_at`
- `read_at`
- `done_at`
- `read_by_staff_user_id` nullable
- `done_by_staff_user_id` nullable

Indexes:

- `(company_id, store_id, status, created_at)`
- `(staff_user_id, status, created_at)`
- `(priority, status, created_at)`
- `(ref_type, ref_id)`

Duplicate prevention:

- Consider unique key on `(type, ref_type, ref_id, store_id)`.
- Daily tasks need date-based uniqueness, likely through `staff_task_instances`.

### 2. `internal_messages`

Purpose:

- Headquarters/store direct messages.

Columns:

- `id`
- `company_id`
- `from_store_id` nullable
- `to_store_id` nullable
- `to_all_stores` boolean
- `from_staff_user_id`
- `title`
- `body`
- `priority`: `NORMAL` / `IMPORTANT` / `URGENT`
- `status`: `SENT` / `ARCHIVED`
- `created_at`
- `updated_at`

Indexes:

- `(company_id, created_at)`
- `(to_store_id, created_at)`
- `(from_store_id, created_at)`
- `(priority, created_at)`

### 3. `internal_message_reads`

Purpose:

- Per-staff read receipt.

Columns:

- `id`
- `message_id`
- `staff_user_id`
- `store_id`
- `read_at`

Unique:

- `(message_id, staff_user_id)`

### 4. `daily_staff_tasks`

Purpose:

- Recurring daily task definitions.

Columns:

- `id`
- `company_id` nullable
- `store_id` nullable
- `store_type` nullable
- `title`
- `description`
- `due_time`
- `repeat_rule`
- `is_required`
- `priority`
- `enabled`
- `created_at`
- `updated_at`

Task examples:

- Store cleaning / organizing.
- Display vehicle organization.
- Test ride vehicle inspection.
- Battery charging check.
- Charger and cable organization.
- POS / LINE / Telegram pending item check.
- Pending repair reservation check.
- Pending order reservation check.
- Headquarters shipping / inbound receiving check.
- Supplier receiving / return check.
- Closing payment / cash check.
- Closing battery charging connection.
- Door lock / power check.

### 5. `staff_task_instances`

Purpose:

- Actual daily task state by store/date.

Columns:

- `id`
- `task_id`
- `store_id`
- `task_date`
- `status`: `PENDING` / `DONE` / `SKIPPED`
- `completed_by_staff_user_id`
- `completed_at`
- `note`
- `created_at`

Unique:

- `(task_id, store_id, task_date)`

### 6. `store_notification_settings`

Purpose:

- Store-level staff LINE/Telegram notification target settings.

Columns:

- `id`
- `store_id`
- `channel_type`: `LINE` / `TELEGRAM`
- `purpose`: `STAFF_GROUP` / `DAILY_TASK` / `SYSTEM_ALERT`
- `target_id`
- `enabled`
- `notify_order_reservation`
- `notify_repair_reservation`
- `notify_purchase_confirmation`
- `notify_repair_confirmation`
- `notify_replenishment`
- `notify_transfer`
- `notify_inbound`
- `notify_daily_tasks`
- `created_at`
- `updated_at`

Security:

- Avoid printing full `target_id` in logs.
- Store masked target ID in UI.

### 7. `supplier_notification_settings`

Purpose:

- Supplier LINE group settings by supplier and store.

Important:

- The same supplier can have different LINE groups per store.
- Therefore key must include both `supplier_id` and `store_id`.

Columns:

- `id`
- `supplier_id`
- `store_id`
- `line_group_id`
- `enabled`
- `notify_purchase_order`
- `notify_return`
- `notify_settlement`
- `created_at`
- `updated_at`

Unique:

- `(supplier_id, store_id)`

## J. LINE groupId Collection / Settings Design

### Method 1: manual input

Screens:

- `系統設定 -> LINE 通知設定`
- `供應商管理 -> 供應商 LINE 設定`

Fields:

- Store staff LINE group ID.
- Store Telegram target ID if needed.
- Supplier LINE group ID by supplier/store.

### Method 2: automatic groupId detection

Flow:

1. Add LINE Bot to group.
2. Group sends `KINGWAY 登錄` or similar message.
3. Webhook receives event `source.groupId`.
4. Store groupId temporarily as pending registration.
5. Admin links the groupId to store or supplier in settings.

MVP:

- Manual input first.
- Automatic detection in a later phase.

## K. Notification Event Mapping

### 1. LINE order reservation created

Targets:

- POS popup for that store.
- `通知中心`.
- Store staff LINE group.
- Telegram staff group.

Target URL:

- `/orders` or order detail route.

### 2. LINE repair reservation created

Targets:

- POS popup for that store.
- `通知中心`.
- Store staff LINE group.
- Telegram staff group.

Target URL:

- `/repairs` or repair detail route.

### 3. Purchase confirmation submitted

Targets:

- Store POS popup.
- `通知中心`.
- Store staff LINE group.
- Telegram if enabled.

Target URL:

- `/purchase-confirmations` or customer/order page.

### 4. Repair completion confirmation submitted

Targets:

- Store POS popup.
- `通知中心`.
- Store staff LINE group.
- Telegram if enabled.

Target URL:

- `/repairs`

### 5. Completed paid order missing purchase confirmation

Condition:

- Order is completed or paid.
- Includes EBIKE category product.
- No purchase confirmation exists.

Targets:

- POS popup.
- `通知中心`.
- Daily/reminder notification.

### 6. Completed repair missing repair completion confirmation

Condition:

- Repair is completed or ready.
- No repair confirmation exists.

Targets:

- POS popup.
- `通知中心`.

### 7. Store replenishment request submitted

Condition:

- `DIRECT_STORE` / `FRANCHISE_STORE` submits request.

Targets:

- Headquarters POS popup.
- Headquarters `通知中心`.
- Headquarters staff LINE group.
- Telegram headquarters group.

Target URL:

- `/hq-replenishment-requests`

### 8. Headquarters shipment completed

Condition:

- Store transfer status changes to `SHIPPED`.

Targets:

- Target store POS popup.
- Target store `通知中心`.
- Target store staff LINE group.
- Telegram if enabled.

Target URL:

- `/inbound-transfers`

### 9. Store inbound completed

Condition:

- Store transfer status changes to `RECEIVED`.

Targets:

- Headquarters POS popup or headquarters `通知中心`.
- Headquarters staff LINE group if enabled.

Target URL:

- `/company-store-settlements` or `/hq-transfer-report`

### 10. Supplier purchase order created

Targets:

- Store POS notification.
- Store staff LINE group.
- Supplier LINE group.
- Telegram if enabled.

Target URL:

- `/suppliers` or future purchase order detail route.

Supplier LINE message:

```text
【KINGWAY 發注通知】
門市：{store}
供應商：{supplier}
發注單號：{po_no}
商品：{sku/name}
數量：{qty}
請協助確認是否可出貨，謝謝。
```

### 11. Supplier return created / shipped

Targets:

- Store POS notification.
- Store staff LINE group.
- Supplier LINE group.

Supplier LINE message:

```text
【KINGWAY 退貨通知】
門市：{store}
供應商：{supplier}
退貨單號：{return_no}
商品：{sku/name}
數量：{qty}
原因：{reason}
請協助確認收件，謝謝。
```

### 12. Daily task unfinished

Targets:

- Store POS popup.
- `通知中心 -> 今日任務`.
- Staff LINE group if enabled.

## L. Backend Service Design

Service candidate:

- `backend/src/services/notificationService.js`

Functions:

- `createStaffNotification()`
- `markRead()`
- `markDone()`
- `snooze()`
- `dismiss()`
- `sendTelegramIfEnabled()`
- `sendLineStaffGroupIfEnabled()`
- `sendLineSupplierGroupIfEnabled()`
- `createInternalMessage()`
- `getUnreadSummary()`
- `createKpiEventIfNeeded()`

Principles:

- DB notification creation is the central operation.
- LINE/Telegram failures must not roll back core business transactions.
- External delivery should happen after the main DB transaction commits, or through a queued retry process.
- Raw LINE token must never be logged.
- Full groupId should not be printed in logs; mask it.
- Existing Telegram notification paths must remain stable.

Delivery status optional table:

- `notification_deliveries`
- columns: `notification_id`, `channel_type`, `target_type`, `target_id_masked`, `status`, `attempt_count`, `last_error`, `sent_at`, `created_at`.

This can be Phase 5+ if MVP needs delivery audit.

## M. API Design

### Staff notifications

- `GET /api/staff-notifications/pending`
- `GET /api/staff-notifications`
- `GET /api/staff-notifications/unread-count`
- `POST /api/staff-notifications/:id/read`
- `POST /api/staff-notifications/:id/done`
- `POST /api/staff-notifications/:id/snooze`
- `POST /api/staff-notifications/:id/dismiss`

### Dashboard summary

- `GET /api/staff-dashboard/unread-summary`

### Internal messages

- `GET /api/internal-messages`
- `GET /api/internal-messages/unread-count`
- `POST /api/internal-messages`
- `POST /api/internal-messages/:id/read`
- `POST /api/internal-messages/:id/archive`

### Daily tasks

- `GET /api/daily-staff-tasks/today`
- `POST /api/daily-staff-tasks/:instanceId/done`
- `POST /api/daily-staff-tasks/:instanceId/skip`
- `GET /api/daily-staff-tasks/settings`
- `POST /api/daily-staff-tasks/settings`

### Notification settings

- `GET /api/store-notification-settings`
- `PATCH /api/store-notification-settings`
- `GET /api/supplier-notification-settings`
- `PATCH /api/supplier-notification-settings`

## N. Frontend Design

New page candidates:

- `frontend/src/pages/SystemManualPage.jsx`
- `frontend/src/pages/NotificationsPage.jsx`
- `frontend/src/pages/MessagesPage.jsx`
- `frontend/src/pages/DailyTasksSettingsPage.jsx`
- `frontend/src/pages/LineNotificationSettingsPage.jsx`

New component candidates:

- `frontend/src/components/PageHelpButton.jsx`
- `frontend/src/components/PageHelpModal.jsx`
- `frontend/src/components/StaffNotificationPopup.jsx`
- `frontend/src/components/UnreadBadge.jsx`
- `frontend/src/components/NotificationBell.jsx`

Expected modified files:

- `frontend/src/App.jsx`
- `frontend/src/components/Sidebar.jsx`
- `frontend/src/components/ProtectedLayout.jsx`
- `frontend/src/lib/mobileNavigation.js`
- `frontend/src/pages/SettingsPage.jsx`
- `frontend/src/pages/SuppliersPage.jsx`
- `frontend/src/pages/StoreReplenishmentRequestsPage.jsx`
- `frontend/src/pages/HqReplenishmentRequestsPage.jsx`
- `frontend/src/pages/HeadquartersPage.jsx`
- `frontend/src/pages/InboundTransfersPage.jsx`
- `frontend/src/pages/CompanyStoreSettlementsPage.jsx`
- `frontend/src/pages/HqTransferReportPage.jsx`
- `frontend/src/pages/InventoryPage.jsx`
- `frontend/src/pages/OrdersPage.jsx`
- `frontend/src/pages/RepairsPage.jsx`
- `frontend/src/pages/POSPage.jsx`

## O. Permission Design

### `HEADQUARTERS` / `WAREHOUSE`

Can:

- See all headquarters notifications.
- See all company/store messages.
- Send announcement to all stores.
- Send to a specific store.
- Configure headquarters staff LINE group.
- Configure company/HQ supplier LINE settings.
- View staff KPI across company scope, subject to role.

### `DIRECT_STORE`

Can:

- See own store notifications.
- See own store messages.
- Send messages to headquarters.
- Configure own store staff LINE group only if owner/admin.

Cannot:

- See other stores' messages.
- Configure headquarters group.
- Use supplier LINE settings unless a future direct supplier feature is explicitly enabled.

### `FRANCHISE_STORE`

Can:

- See own store notifications.
- Send messages to headquarters.
- See own store messages.

Cannot:

- Use supplier LINE settings by default.
- See headquarters-only alerts except messages addressed to that store.

### `INDEPENDENT`

Can:

- See own store notifications and messages.
- Configure own store staff LINE group.
- Configure own supplier LINE groups.

Cannot:

- Use headquarters/franchise notification structure.

## P. Implementation Plan

### Phase 1: Design only

- Write this document.
- Complete read-only audit.
- Draft migration design only.
- No migration execution.

### Phase 2: notifications MVP

- Add `staff_notifications` table/API.
- Add `StaffNotificationPopup`.
- Add `通知中心`.
- Add Sidebar unread badge.
- Connect LINE order/repair reservation notifications to DB notifications.

### Phase 3: internal messages

- Add `internal_messages`.
- Add `internal_message_reads`.
- Add `訊息中心`.
- Add headquarters/store message send/read flows.
- Add message unread badge/popup.

### Phase 4: daily staff tasks

- Add `daily_staff_tasks`.
- Add `staff_task_instances`.
- Add `今日任務`.
- Add daily task completion actions.
- Add unfinished task reminders.

### Phase 5: LINE/Telegram group settings

- Add `store_notification_settings`.
- Add `supplier_notification_settings`.
- Add store staff LINE group settings.
- Add supplier LINE group settings.
- Add safe LINE staff/supplier group delivery.
- Keep existing Telegram delivery paths intact.

### Phase 6: automatic conditional notifications

- Missing purchase confirmation.
- Missing repair completion confirmation.
- `SHIPPED` but inbound not completed.
- Supplier receiving not completed.
- Supplier return not completed.
- Daily closing reminder.

### Phase 7: staff KPI event integration

- Add `staff_kpi_events`.
- Create KPI events when notification/daily task/workflow is actually completed.
- Add staff KPI summary API.
- Add staff KPI summary screen.

### Phase 8: manager evaluation and reports

- Add `staff_evaluation_notes`.
- Add weekly/monthly evaluation reports.
- Add Excel export.
- Add staff-level detailed work log.

## Q. Risks and Warnings

- LINE groupId collection must be controlled and verified.
- LINE push cost and rate limits require notification rules and opt-in settings.
- Telegram and LINE duplicate delivery can overwhelm staff.
- Duplicate DB notifications must be prevented with unique keys.
- Store permission bugs could expose another store's notification/message.
- Too many POS中央彈窗 interruptions can hurt work flow.
- Snooze is required.
- `URGENT` and `NORMAL` priority must be separated.
- DB transaction and external LINE/Telegram delivery must be separated.
- Production migration requires backup and rollback plan.
- MySQL restart is forbidden.
- Existing Telegram legacy alerts and commands must not break.
- Supplier LINE group delivery must not send customer private data.
- Staff evaluation/KPI data is sensitive and must be role-restricted.

## R. Staff KPI / Evaluation Integration Design

### 1. KPI work types

The following completed work should be recorded by staff member and used for KPI/evaluation.

- LINE order reservation review and processing.
- LINE repair reservation review and processing.
- Purchase confirmation completion check.
- Repair completion confirmation check.
- Daily task checklist completion.
- Store cleaning/organizing completion.
- Battery charging check completion.
- Test ride/display vehicle inspection completion.
- Headquarters replenishment request processing.
- Headquarters shipment confirmation.
- Store inbound confirmation.
- Supplier purchase order creation.
- Supplier receiving confirmation.
- Supplier return handling.
- Customer/internal message reply.
- Unresolved notification completion.
- Closing checklist completion.

### 2. KPI metric design

Basic metrics:

- Total completed tasks.
- Completed tasks today.
- Completed tasks this week.
- Completed tasks this month.
- On-time completion rate.
- Late handled count.
- Open notifications count.
- Read but not completed count.
- Urgent notification response time.
- Average handling time.
- Message response count.
- Average message response time.

Work-type metrics:

- Order reservation handled count.
- Repair reservation handled count.
- Purchase confirmation checked count.
- Repair completion confirmation checked count.
- Inventory in/out handled count.
- Supplier purchase/receiving/return handled count.
- Daily task completion rate.
- Store cleaning checklist completion rate.
- Battery charging checklist completion rate.

### 3. Evaluation scoring design

Example score model:

- Task completed: `+1`
- Completed before due time: `+1`
- Urgent notification handled within 10 minutes: `+2`
- All daily tasks completed: `+3`
- Late handling: `-1`
- Unhandled at closing: `-2`
- Wrong operation requiring correction: manager review before deduction.

Important:

- Do not over-automate penalties.
- MVP should focus on records and statistics.
- KPI score is a management reference, not an automatic final HR decision.
- Final evaluation should allow manager notes.

### 4. KPI DB additions

Existing planned fields:

- `staff_task_instances.completed_by_staff_user_id`
- `staff_task_instances.completed_at`
- `staff_notifications.read_by_staff_user_id`
- `staff_notifications.done_by_staff_user_id`
- `staff_notifications.read_at`
- `staff_notifications.done_at`

Additional table candidate: `staff_kpi_events`

Columns:

- `id`
- `company_id`
- `store_id`
- `staff_user_id`
- `event_type`
- `ref_type`
- `ref_id`
- `title`
- `score`
- `occurred_at`
- `due_at` nullable
- `completed_at` nullable
- `is_late` boolean
- `metadata_json` nullable
- `created_at`

Purpose:

- Centralize all KPI events.
- Allow weekly/monthly staff evaluation regardless of source table.
- Keep original workflow tables unchanged while making KPI reporting simple.

Duplicate prevention:

- Consider unique key on `(event_type, ref_type, ref_id, staff_user_id)`.
- Avoid double score when the same work is completed through notification and direct workflow action.

### 5. Staff management KPI / evaluation UI

Recommended area:

- `員工管理 -> KPI / 評價`

Summary columns:

- Staff name.
- Store.
- Completed tasks today.
- Completed tasks this week.
- Completed tasks this month.
- Daily task completion rate.
- Notification completion rate.
- Average handling time.
- Late count.
- KPI score.
- Detail button.

Detail view:

- Work log by date.
- Notification handling history.
- Message response history.
- Daily task checklist history.
- Late/open items.
- Manager notes.

### 6. Manager notes / manual evaluation

Additional table candidate: `staff_evaluation_notes`

Columns:

- `id`
- `staff_user_id`
- `evaluator_staff_user_id`
- `store_id`
- `period_start`
- `period_end`
- `rating` nullable
- `note`
- `created_at`

Purpose:

- KPI data should not be the only evaluation source.
- Managers can record attitude, customer handling, correction of mistakes, and qualitative feedback.

### 7. KPI API additions

- `GET /api/staff-kpi/summary`
  - query: `startDate`, `endDate`, `storeId`, `staffUserId`
  - returns staff KPI summary.

- `GET /api/staff-kpi/events`
  - returns detailed KPI event log.

- `POST /api/staff-evaluations/notes`
  - manager evaluation note.

- `GET /api/staff-evaluations/notes`
  - evaluation note history.

### 8. KPI permission design

`HEADQUARTERS` / `company_owner`:

- Can view all company staff KPI.
- Can write evaluation notes for all company staff.

Store manager / owner:

- Can view own store staff KPI.
- Can write own store staff evaluation notes.

General staff:

- Optionally view own KPI summary only.
- Cannot view other staff KPI.

`DIRECT_STORE` / `FRANCHISE_STORE`:

- Own store staff only.

`INDEPENDENT`:

- Own store staff only.

### 9. Notification handling and KPI connection rules

- `已確認` creates read history but low/no KPI score.
- `完成` or actual workflow status change creates KPI event.
- Clicking `前往處理` does not count as task completion.
- Actual order/repair/inbound/shipment/supplier status change is required for completion KPI.
- Daily task is completed through `完成`.
- Messages distinguish read and reply.
- Message reply creates response KPI event.

### 10. KPI risks

- Staff may press completion without doing real work.
- Reading notification must be separated from completing work.
- Strict scoring can create staff resistance.
- MVP should focus on history/statistics before penalties.
- Manager manual notes and final review are needed.
- Wrong operation correction should be reviewed by manager, not automatically penalized.
- KPI/evaluation data is sensitive personal staff data and must be permission-restricted.

## S. Rollback and Production No-Go

This phase creates documentation only.

No-go:

- No production deploy.
- No production DB write.
- No migration execution.
- No backend/frontend recreate.
- No MySQL restart.
- No actual LINE/Telegram notification send.

Future production migration rules:

- Full database backup before migration.
- Staging rehearsal before production.
- Rollback SQL prepared before production.
- Existing customer LINE flows and Telegram commands must be smoke-tested.

