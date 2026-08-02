# 實作階段

## Phase 0：分析（本次）

交付本目錄 00~14 文件；不改 code、migration、DB、Docker、LINE，不 commit/push。

## Phase 1：資料與讀取骨架

- 經審核後建立 forward/rollback migrations、feature flag、repository/service skeleton。
- 加入 period/calendar/availability/policy/audit；僅 staging migration。
- 建 read APIs 與 store/action permission tests。
- Exit：migration rollback 成功、跨店測試通過、production 無變更。

## Phase 2：員工自主輸入

- availability/time-off API、手機 UI、截止與 revision。
- POS notification 提醒；LINE 保持 fake/dry-run。
- Exit：員工只能管理自己，管理 heatmap 不洩漏理由。

## Phase 3：分數與公平 ledger

- 以 `staff_kpi_events`、`staff_task_instances`、出勤建立 A~E snapshot。
- score explanation、confidence、申訴、weekend ledger。
- Exit：fixtures 可重現，缺資料/請假/故障 guardrail 通過。

## Phase 4：排班草稿引擎

- coverage slot、hard/soft constraints、deterministic solver、無解解釋。
- 管理草稿 UI 與 validation。
- Exit：property tests 保證 hard constraints；50 人一週性能達標。

## Phase 5：發布、換班與出勤整合

- revision publish、確認、swap state machine、shift-attendance match。
- 保持 `/api/attendance` 相容。
- Exit：並發發布/claim、audit、歷史 revision tests 通過。

## Phase 6：LINE staging rollout

- outbox、idempotency、門市 channel resolver、fake→approved staging real send。
- Exit：無跨店/重複發送，429/5xx fallback 通過。

## Phase 7：有限 rollout

- 單店 shadow mode：引擎建議不自動發布，與人工班表比較 4 週。
- 審查 coverage、公平、申訴、變更率後才考慮 production。
- production 前必須明確批准、備份、migration rehearsal、rollback 與監控窗口。

## 每階段共通 gate

針對性 commit、無 production DB、無 deploy/push（除非另有明確指令）、zh-TW、mobile、store scope、audit、docs/API contract 同步。

