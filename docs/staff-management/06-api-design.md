# API 設計

## 路由邊界

建議新增 `backend/src/routes/staffScheduling.js` 與 `backend/src/services/staffSchedulingService.js`，掛載 `/api/staff-scheduling`；求解器獨立 `staffSchedulingEngine.js`。沿用 `authenticate`、`requireStoreScope()` 與既有 error middleware，不在既有 `attendance.js` 塞入排班責任。

## 員工 API

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/staff-scheduling/periods/current` | 本週/下週期間與截止狀態 |
| GET | `/api/staff-scheduling/me/availability?periodId=` | 自己的可用時段 |
| PUT | `/api/staff-scheduling/me/availability/:periodId` | 截止前保存 draft |
| POST | `/api/staff-scheduling/me/availability/:periodId/submit` | 提交 revision |
| GET | `/api/staff-scheduling/me/schedule?periodId=` | 自己的正式班表 |
| POST | `/api/staff-scheduling/assignments/:id/confirm` | 確認已讀 |
| POST | `/api/staff-scheduling/swaps` | 提出換班 |
| POST | `/api/staff-scheduling/swaps/:id/accept` | 接班人同意 |
| POST | `/api/staff-scheduling/swaps/:id/cancel` | 申請者取消 |
| GET | `/api/staff-scheduling/me/scores?periodId=` | A~E 與解釋 |
| POST | `/api/staff-scheduling/score-appeals` | 提出異議 |

## 管理 API

| Method | Path | 用途 |
|---|---|---|
| GET/POST | `/api/staff-scheduling/periods` | 查詢/建立週期 |
| GET/PUT | `/api/staff-scheduling/calendars/:periodId` | 週一休店與 daily coverage |
| GET | `/api/staff-scheduling/availability/overview` | heatmap 與未提交名單 |
| POST | `/api/staff-scheduling/scores/calculate` | 建立不可變 score snapshot |
| GET | `/api/staff-scheduling/fairness` | 週末 ledger 與指標 |
| POST | `/api/staff-scheduling/revisions/generate` | 非同步/同步產生草稿 |
| GET | `/api/staff-scheduling/revisions/:id` | 草稿、指派、constraints、解釋 |
| PATCH | `/api/staff-scheduling/revisions/:id/assignments` | 人工調整，需 expectedVersion |
| POST | `/api/staff-scheduling/revisions/:id/validate` | 完整 constraint 驗證 |
| POST | `/api/staff-scheduling/revisions/:id/publish` | 原子發布 |
| POST | `/api/staff-scheduling/swaps/:id/approve` | 核准並建新 revision |
| POST | `/api/staff-scheduling/swaps/:id/reject` | 拒絕並留理由 |
| GET | `/api/staff-scheduling/audit-logs` | 稽核查詢 |

## 契約規則

- request/response 使用 camelCase，DB 使用 snake_case，沿用現有 mapping pattern。
- 寫入帶 `Idempotency-Key`；發布/調整帶 `expectedVersion`。
- 錯誤碼：`SCHEDULE_INPUT_CLOSED`、`COVERAGE_GAP`、`SHIFT_OVERLAP`、`REST_VIOLATION`、`SKILL_MISSING`、`REVISION_CONFLICT`、`SWAP_NOT_ELIGIBLE`。
- 422 回傳 `violations[]`，包含 `code/date/start/end/message`（zh-TW）與安全 details。
- 管理列表必須 page/limit，export 另設上限；不得回傳私人休假原因。

## 既有 API 整合

- `/api/attendance/check-in|check-out` 後續可解析當下正式 shift 並回傳 match 結果，舊 client 無 shiftId 仍可運作。
- `/api/staff-kpi/summary|events` 作分數來源與查證，不直接改其 response。
- `/api/staff-notifications` 與 `/api/staff-dashboard/unread-summary` 消費排班通知。
- `/api/permissions/menu` 提供 menu visibility；排班 action permission 由後端獨立驗證。

