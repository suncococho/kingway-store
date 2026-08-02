# 資料庫設計

## 重用與新增策略

保留 `staff_users`、`store_memberships`、`staff_attendance`、`daily_staff_tasks`、`staff_task_instances`、`staff_kpi_events`、`staff_evaluation_notes`、`staff_notifications` 與既有 menu permission tables。新表全部含 `store_id`、時間戳與必要索引；不在 Phase 0 建立 migration。

## 建議實體

| 表 | 核心欄位/用途 |
|---|---|
| `staff_schedule_periods` | `id, store_id, starts_on, ends_on, input_deadline_at, status, timezone, version` |
| `store_business_calendars` | `store_id, business_date, is_open, opens_at, closes_at, required_headcount, policy_version`；週一 closed，平日 1，週末 2 |
| `staff_availability_submissions` | 員工每週 submission header、狀態、revision、submitted_at |
| `staff_availability_windows` | `submission_id, starts_at, ends_at, preference, reason_visibility` |
| `staff_time_off_requests` | 休假/不可上班與核准狀態；敏感原因分離或加密 |
| `staff_skills` | 員工技能、等級、有效期、核准者 |
| `schedule_policy_versions` | A~E 權重、工時、休息、fairness window、JSON policy hash |
| `staff_score_snapshots` | period/staff/policy 的 A~E、overall、confidence、source cutoff |
| `staff_score_components` | snapshot 項目、source ref、normalized value、reason code |
| `staff_weekend_fairness_ledgers` | staff、window、eligible/opportunity/assigned/refused counts、debt |
| `work_schedule_revisions` | period、revision_no、status、input_hash、seed、engine_version、發布資訊 |
| `work_shifts` | revision、business_date、starts_at、ends_at、slot_type、required_skill、lock state |
| `work_shift_assignments` | shift、staff、status、reason codes、score snapshot、confirmed_at |
| `schedule_constraint_results` | revision、constraint_code、severity、slot、details JSON |
| `shift_swap_requests` | assignment、requester、target/open、status、理由、期限 |
| `shift_swap_actions` | append-only propose/accept/approve/reject/cancel actions |
| `attendance_exceptions` | shift、attendance、異常類型、原值、更正值、核准者 |
| `schedule_notification_deliveries` | event、channel、recipient scope、idempotency、delivery status |
| `staff_schedule_audit_logs` | actor、action、entity、before/after JSON、reason、request ID |

## 關聯與約束

- `UNIQUE(store_id, starts_on, ends_on)` 防止重複週期。
- `UNIQUE(period_id, revision_no)`；同一 period 只能有一個 active published revision（以 transaction/lock 保證）。
- `UNIQUE(revision_id, staff_user_id, shift_id)`；assignment 不得重複。
- DB 可用 overlap 查詢與 service transaction 防重疊；MySQL 無 exclusion constraint，必須在 service 鎖定候選員工期間。
- `store_id` 必須與 referenced membership/store 一致，跨 tenant ID 不可只靠前端阻擋。
- audit 與 score snapshot 不做 hard delete；業務資料以 soft archive/status 保存。

## 現有 schema 修正議題

- `staff_attendance` 現況只有 `staff_user_id/check_in_at/check_out_at`，未含 store/shift。後續 migration 應先 nullable 加欄、以安全 membership/time match dry-run，再逐步約束；不可覆寫不確定資料。
- `staff_kpi_logs` 與 `staff_kpi_events` 並存；新評分只讀事件版，舊版留相容，避免雙寫造成重複分數。
- 所有新表使用 utf8mb4，中文異常先驗證 stored bytes。

## migration 原則

每個 forward migration 配 rollback 或明確不可逆說明；先 staging schema diff、fixture migration、回滾演練。production 必須先依 `docs/PRODUCTION_MIGRATION_BACKUP_RUNBOOK.md` 備份並取得明確批准。

