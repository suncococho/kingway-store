# Staff LINE Group Notification Plan

## Scope

This task keeps the existing Telegram staff notification flow and adds one parallel staff LINE group push for repair reservation reception only.

Applied now:

- `backend/src/routes/repairs.js` web/admin repair reservation creation path.
- `backend/src/routes/lineRepair.js` LINE repair page creation path.
- `backend/src/services/lineWorkflowService.js` LINE conversation wizard creation path.
- Existing Telegram delivery through `sendToGroupsWithResult(["repair", "admin"], ...)` remains unchanged.
- Staff LINE group delivery runs immediately after each successful repair reservation creation and after the existing group notification result handling.

Not applied in this task:

- Bicycle order LINE notifications.
- POS order notification changes.
- Customer LINE webhook, LIFF, rich menu, `replyToLine`, or existing `sendLineMessage` behavior.
- `sendToGroups` / `sendToGroupsWithResult` shared functions.

## Group ID Source

Staff LINE delivery reuses the existing DB group registration structure. No new Group ID table or storage structure is added.

Lookup table:

- `line_group_registrations`

Lookup policy:

1. Active `repair` group
2. Active `daily` group
3. Active `admin` group
4. Active `staff` group

The helper selects one active target ordered by the policy above, then newest registration. This matches the daily-report group registration path and falls back to the `daily` group so the kw-mini test group can receive repair reservation notices when no `repair` group exists.

Current group registration is created by the existing LINE group `/register` flow in `backend/src/routes/line.js`.

## Helper

Helper file:

- `backend/src/services/staffLineNotify.js`

Behavior:

- Reads active LINE group registrations from DB.
- Uses the existing LINE channel token already loaded by `backend/src/config.js`.
- Sends a text push to the selected LINE group.
- Does not print raw token values.
- Masks LINE group id in failure logs.
- Isolates failures with `try/catch` so repair reservation creation and Telegram delivery are not affected.

## Message

The staff LINE text is zh-TW and includes:

- Title: `🔧 維修預約接收`
- Repair id
- Customer name
- Phone number
- Reservation date/time
- Bike model / repair content
- `store_id`
- Admin text link when available

## Rollback Plan

1. Remove the `notifyRepairReservationCreated` imports and calls from `backend/src/routes/repairs.js`, `backend/src/routes/lineRepair.js`, and `backend/src/services/lineWorkflowService.js`.
2. Remove `backend/src/services/staffLineNotify.js`.
3. Keep existing Telegram notification code unchanged.
4. Keep existing LINE group registration DB rows unchanged.
