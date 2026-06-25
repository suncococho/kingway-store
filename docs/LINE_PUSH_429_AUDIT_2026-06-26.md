# KINGWAY LINE 客戶 Push 429 Monthly Limit Audit

Date: 2026-06-26
Scope: audit only. No code changes, no DB writes, no deployment, no LINE test send.

## 1. Summary

Production POS notification, popup, and KPI flows are working:

- LINE repair reservation creates `staff_notifications.LINE_REPAIR_CREATED`.
- LINE order reservation creates `staff_notifications.LINE_ORDER_CREATED`.
- Staff can mark notifications DONE.
- `staff_kpi_events.NOTIFICATION_DONE` is created.
- Staff/supplier LINE group notification is not sending actual group push.

The remaining issue is separate: a customer LINE push failed because the LINE Messaging API monthly quota was exceeded.

Observed production log:

```text
[line-order customer notify failed] LINE push failed: 429 {"message":"You have reached your monthly limit."}
```

This log points to the customer-facing order reservation completion push in `backend/src/routes/lineOrder.js`, not to the new staff/supplier group notification system.

## 2. Evidence: Customer Push vs Group Notification

### Customer push path

Customer push uses `sendLineMessage()` from `backend/src/utils/line` or the wrapper in `lineWorkflowService`.

Confirmed 429 path:

- `backend/src/routes/lineOrder.js`
  - after LINE order creation
  - sends customer text: "已收到您的訂單，門市將盡快與您聯繫確認。"
  - error log: `[line-order customer notify failed]`

### Staff/supplier group notification path

Phase 5 group notification MVP is dry-run by design:

- `backend/src/services/lineGroupNotificationService.js`
  - `sendStaffGroupNotification()` returns `dryRunStaffGroupNotification()`.
  - `sendSupplierGroupNotification()` returns `dryRunSupplierGroupNotification()`.

Operational event integration also uses dry-run helpers:

- `backend/src/services/notificationEventService.js`
  - uses `dryRunStaffGroupNotification()`
  - uses `dryRunSupplierGroupNotification()`

Legacy/staff group notifier has suppression checks:

- `backend/src/services/staffLineNotify.js`
  - logs `order_reservation_notify_skipped`
  - logs `repair_notify_skipped`
  - production currently skipped staff group sends during the observed tests.

Conclusion: the 429 is from customer push, not staff/supplier group notification.

## 3. Customer Push Call Sites

Runtime files with active customer push calls:

| Area | Code location | Current behavior | 429 risk | Notes |
|---|---|---:|---:|---|
| LINE order reservation completion | `backend/src/routes/lineOrder.js` around customer notify block | Pushes customer "order received" message after order row creation | High | This is the observed 429 source. Customer page already returns success, and POS notification is created. |
| Purchase confirmation link | `backend/src/routes/orders.js` `pushPurchaseConfirmationLineMessage()` | Pushes purchase confirmation signing link | Medium | Important if staff explicitly sends confirmation link. Should remain, but avoid duplicate sends. |
| Purchase confirmation link from confirmation route | `backend/src/routes/purchaseConfirmations.js` | Pushes purchase confirmation link after creating confirmation | Medium | Same class as above. Keep if customer needs signing link. |
| Collect balance/payment completed notice | `backend/src/routes/orders.js` collect-balance path | Pushes payment/repair payment completion notice | Medium | Useful, but not always urgent. Could become optional/manual. |
| Repair reservation approval/reject customer notice | `backend/src/routes/repairs.js` approval decision path | Pushes repair reservation decision/customer message | Medium | Customer-facing status change. Keep or convert to reply only when triggered from LINE. |
| Repair completed pickup notice | `backend/src/routes/repairs.js` complete path | Pushes pickup notice and survey link | High value | Should remain because customer needs pickup notification. |
| Repair quote confirmation link | `backend/src/services/lineWorkflowService.js` `sendRepairQuoteConfirmationIfNeeded()` | Pushes repair estimate confirmation link | High value | Important customer action. Keep, but on quota failure show/copy link to staff. |
| Repair estimate customer messages | `backend/src/services/lineWorkflowService.js` | Pushes repair estimate to customer | High value | Customer must approve/reject estimate. Keep. |
| Customer follow-up | `backend/src/routes/customers.js` follow-up endpoint | Pushes manual follow-up message | Optional | Staff-initiated. Keep as explicit manual action, but expose quota failure clearly. |
| Survey request | `backend/src/routes/surveys.js` | Pushes survey link | Low/optional | Can be delayed, batched, or disabled under quota pressure. |

## 4. Event-by-Event Policy Table

| Event | Push? | Reply? | POS notification? | 429 risk | Customer necessity | Recommended action |
|---|---:|---:|---:|---:|---|---|
| LINE order reservation created | Yes, currently | Public API response, not LINE reply | Yes, `LINE_ORDER_CREATED` | High | Low if page already shows success | Disable customer push or convert to reply/success UI only. POS notification is enough for staff. |
| LINE repair reservation created | No customer push observed in `lineRepair.js`; staff group notify skipped, POS notification created | Public API response, not LINE reply | Yes, `LINE_REPAIR_CREATED` | Low | Low | Keep current: success response + POS notification. |
| Purchase confirmation link created/sent | Yes | Not usually reply | Yes on submission event | Medium | High, because customer needs link | Keep, but prevent duplicates and add quota fallback instructions. |
| Purchase confirmation submitted by customer | No customer push required | Public page response | Yes, `PURCHASE_CONFIRMATION_SUBMITTED` | Low | Low | Do not add customer push. POS notification is enough. |
| Repair completion confirmation submitted | No customer push required | Public page response | Yes, `REPAIR_CONFIRMATION_SUBMITTED` | Low | Low | Do not add customer push. POS notification is enough. |
| Repair completed / pickup notice | Yes | Not usually reply | Optional POS event | Medium | High | Keep. This is one of the few customer pushes worth quota. |
| Repair quote / estimate confirmation | Yes | Sometimes LINE workflow reply exists for staff command; customer needs link | Staff/internal logs | Medium | High | Keep. On 429, show copyable link and staff task. |
| Order completed / handover notice | Some payment/handover paths push | Not usually reply | POS order state | Medium | Medium | Keep only for explicit staff action; avoid automatic duplicate pushes. |
| Google review / survey | Yes for survey | Not usually reply | Not critical | Medium | Low | Make optional or disable when quota is constrained. |
| Notification center / message center / daily tasks | No customer push | N/A | Yes | None | Internal only | No LINE customer push. |
| Staff LINE group notification | Dry-run/skipped | N/A | Yes | None currently | Internal only | No action for 429. |
| Supplier LINE group notification | Dry-run | N/A | Yes/POS supplier flow | None currently | Supplier-facing future feature | No action for 429. |

## 5. Policy Conflicts

Current policy is "customer push minimal, reply first, POS notification central".

Conflicts found:

1. `lineOrder.js` sends a customer push for reservation completion even though:
   - customer already receives a successful HTTP/page response,
   - POS notification is created,
   - staff notification/KPI workflow is now operational.

2. Survey/follow-up pushes are useful but lower priority than transactional links.

3. Several customer push paths are explicit staff actions. These are less problematic than automatic push-after-create, but should surface quota failure clearly.

## 6. Immediate Disable Candidates

1. LINE order reservation completion push in `backend/src/routes/lineOrder.js`.
   - Reason: observed 429 source.
   - Replacement: rely on customer success page and POS `LINE_ORDER_CREATED` notification.

2. Automatic low-value survey push in `backend/src/routes/surveys.js`.
   - Reason: not operationally critical.
   - Replacement: manual send or later batch once quota is available.

3. Any duplicate customer confirmation push when `purchase_confirmation_sent_at` or equivalent sent log already exists.
   - Reason: duplicate prevention is already partly present; keep enforcing it.

## 7. Reply Conversion Candidates

Convert to LINE reply only when the action originates inside a LINE webhook and `replyToken` is available:

- immediate "received" responses,
- menu/help/status actions,
- customer self-service flows.

Do not push for a response that can be shown on the LINE LIFF/web page after form submission.

## 8. POS Notification Replacement Candidates

Use POS notification instead of customer push for staff-facing events:

- LINE order reservation created,
- LINE repair reservation created,
- purchase confirmation submitted,
- repair confirmation submitted,
- internal staff reminders,
- daily tasks,
- message center,
- supplier purchase/return operational alerts.

These already map well to `staff_notifications` and KPI.

## 9. Pushes To Keep

Keep customer push for high-value customer state changes:

1. Repair pickup notice.
   - Customer needs to know the repair is ready.

2. Repair estimate / quote confirmation link.
   - Customer must approve/reject before work continues.

3. Purchase confirmation signing link.
   - Customer must sign before handover/confirmation is complete.

4. Explicit staff-initiated follow-up.
   - Keep because it is intentional, not automatic, but show failure clearly.

## 10. Quota Failure Fallback

When LINE push returns 429:

- Do not fail order/repair/confirmation creation.
- Keep POS notification creation.
- Keep customer success page response.
- Log a concise error without raw token or full group/customer identifiers.
- For required customer links, show staff a copyable fallback URL in POS.
- For optional notifications, mark as skipped or failed without retry storm.

The current observed order flow already preserved the order and POS notification despite 429, which is correct.

## 11. Recommended Implementation Priority

Priority 1:

- Disable `lineOrder.js` customer "order received" push.
- Keep POS `LINE_ORDER_CREATED` and customer success page.

Follow-up implementation:

- `backend/src/routes/lineOrder.js` order completion customer push was disabled after this audit.
- POS `LINE_ORDER_CREATED` notification remains active.
- Customer-facing order success response remains active.
- Required customer pushes such as pickup notice, repair quote confirmation, purchase confirmation link, and explicit staff follow-up are unchanged.

Collect-balance follow-up implementation:

- `backend/src/routes/orders.js` collect-balance "尾款已完成收款" customer push was disabled after production testing showed 429 quota failures.
- The collect-balance API still updates order balance/payment state.
- The purchase confirmation link push remains active because it is the customer action link.
- POS/staff operational notifications and KPI flows are unchanged.

Priority 2:

- Add a central customer LINE push policy helper:
  - `shouldSendCustomerPush(eventType, context)`
  - supports event allowlist and quota-disabled mode.

Priority 3:

- Add explicit failure visibility for high-value pushes:
  - purchase confirmation link send failed,
  - repair quote link send failed,
  - pickup notice send failed.

Priority 4:

- Review optional survey/follow-up pushes and make them manual or quota-aware.

## 12. Production Impact

Current production impact:

- Customer order reservation was still created successfully.
- POS notification and KPI worked.
- LINE group notification was not involved.
- Customer may not receive automatic LINE push due to quota exhaustion.

No rollback is needed for the notification system.

## 13. No-Change Items

No change recommended for:

- `staff_notifications`
- POS central popup
- KPI event generation
- staff/supplier group notification dry-run service
- Telegram existing notifications

## 14. Work Performed In This Audit

- Read production logs.
- Read source code only.
- No code changes except this documentation file.
- No DB writes.
- No migrations.
- No deployment.
- No LINE test sends.
- No MySQL restart.
