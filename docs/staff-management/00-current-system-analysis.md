# Phase 0 現況系統分析

## 分析基準

- 基準 commit：`663200791f97244580e215ae6d4fadaae671f770`
- branch：`feature/staff-autonomy-scheduling`
- 本文件僅做 Phase 0 分析，不修改應用程式、migration、DB、Docker 或 LINE 設定。
- 顯示文字採台灣繁體中文；現有 LINE-first、多門市 scope 與權限模型必須保留。

## 已有能力

| 能力 | 實際實作 | 可重用程度 |
|---|---|---|
| 員工帳號與角色 | `backend/src/routes/staff.js`、`staff_users`、`store_memberships` | 高 |
| 選單權限 | `menuPermissionService.js`、`store_role_menu_permissions`、`store_user_menu_permissions`、`GET /api/permissions/menu` | 高，但需新增排班 menu key |
| 出退勤 | `routes/attendance.js`、`staff_attendance`、`StaffAttendancePage.jsx`、`/staff-attendance` | 中；缺排班對照、異常與更正流程 |
| 固定每日確認 | `operational_checklists`、`GET /api/attendance/checklist/today` | 中 |
| 可設定每日任務 | `dailyStaffTaskService.js`、`daily_staff_tasks`、`staff_task_instances`、`/daily-tasks` | 高，可承接班次任務 |
| KPI 舊版 | `kpi.js`、`kpiService.js`、`staff_kpi_logs`、`KPIPage.jsx` | 低至中；分數模型過於簡單 |
| KPI 事件版 | `staffKpi.js`、`staffKpiService.js`、`staff_kpi_events`、`StaffKpiPage.jsx` | 高，可作 A~E 原始事件來源 |
| 評價備註 | `staffEvaluationService.js`、`staff_evaluation_notes`、`/api/staff-evaluations/notes` | 中 |
| POS 通知 | `staffNotificationService.js`、`staff_notifications`、`/api/staff-notifications` | 高 |
| LINE 群組通知 | `lineGroupNotificationService.js`、`staffLineNotificationService.js`、門市 LINE channel/settings | 高，但排班事件需獨立事件型別與冪等鍵 |
| 薪資參考 | `PayrollPage.jsx` 與 `/api/payroll` | 中；只能消費核准後出勤，不應直接決定薪資 |

## 現有 API 與畫面

- 後端掛載：`app.js` 的 `/api/staff`、`/api/attendance`、`/api/kpi`、`/api/staff-kpi`、`/api/staff-evaluations`、`/api/daily-staff-tasks`、`/api/staff-notifications`、`/api/staff-dashboard`。
- 前端路由：`/staff`、`/staff-attendance`、`/attendance` redirect、`/kpi`、`/staff-kpi`、`/payroll`、`/daily-tasks`、`/settings/daily-tasks`。
- 全部員工角色目前可呼叫多數 attendance/KPI API；管理權限主要由 service context 或 store role 判斷，未形成排班專用 action permission。
- `MENU_CATALOG` 只有 `staff`，尚無 `scheduling`。

## 關鍵缺口

1. 無 `work_schedules`、`work_shifts`、休假偏好、可上班時段、交班/換班、發布版本、鎖定與 audit log。
2. 無「週一休店、平日 1 人、週末 2 人、不得空班」的可執行 constraint engine。
3. 無 A~E 分數定義、權重版本、計算快照、申訴與人工調整稽核。
4. 無週末優先權 ledger；若只用總分排序，會強化歷史優勢而不公平。
5. `staff_attendance` 沒有 `store_id`、`shift_id`、異常原因、核准者；現有列表亦未依門市過濾，屬設計前必須處理的隔離風險。
6. `operational_checklists` 與舊 `staff_kpi_logs` 是基礎 schema，`daily_staff_tasks` 與 `staff_kpi_events` 是較新的多門市模型；新設計應以前者資料相容、後者為主要整合點。
7. 無草稿/發布/變更通知流程，無員工確認已讀。

## 建議邊界

- 第一版以「單店每週排班」為 bounded context；排班引擎輸入只讀既有員工、出勤、任務與 KPI。
- 產生結果永遠先存草稿，管理者發布後才成為正式班表。
- 分數只用於透明的優先順序與建議，不得自動形成懲處、薪資扣減或解僱判斷。
- 所有查詢與唯一鍵都含 `store_id`；production migration 必須另階段備份、dry-run、回滾演練。

