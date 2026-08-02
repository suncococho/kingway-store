# 既有功能重用對照

| 新需求 | 既有檔案/路由/資料 | 重用方式 | 不應做的事 |
|---|---|---|---|
| 員工候選名單 | `routes/staff.js`、`staff_users`、`store_memberships` | 讀啟用且屬於 store 的員工 | 不另建第二套員工帳號 |
| 工作/門市角色 | `staff.js`、auth middleware | 保留雙角色語義 | 不把 STAFF role 與 store role 混為一談 |
| menu 權限 | `menuPermissionService.js`、`/api/permissions/menu`、`useMenuPermissions.js` | 新增 `staff_scheduling` menu key | 不只靠前端隱藏 |
| action 權限 | `authenticate`、`requireStoreScope()`、`authorize()` | 增加排班 action policy | 不把所有員工 authorize 等同可發布 |
| 出退勤 | `routes/attendance.js`、`staff_attendance`、`StaffAttendancePage.jsx` | 兼容式加 shift match/exception | 不破壞既有 check-in/out contract |
| 固定 checklist | `operational_checklists` | 保留今日確認 | 不拿來存正式班表 |
| 每日任務 | `dailyStaffTaskService.js`、`staff_task_instances`、`/daily-tasks` | 班次可觸發/關聯任務 | 不複製任務引擎 |
| KPI 事件 | `staffKpiService.js`、`staff_kpi_events`、`/api/staff-kpi` | 作 A~D 原始事件與查證 | 不直接把 totalScore 當綜合分數 |
| 舊 KPI | `kpiService.js`、`staff_kpi_logs`、`/api/kpi` | backward compatibility | 不雙重計分 |
| 評價 | `staffEvaluationService.js`、`staff_evaluation_notes` | 人工 context/註記 | 不讓自由文字直接改分 |
| POS 通知 | `staffNotificationService.js`、`staff_notifications`、`NotificationsPage.jsx` | 發布/換班/缺口事件 | 不另建重複通知中心 |
| dashboard 摘要 | `/api/staff-dashboard/unread-summary` | 加入排班待處理統計 | 不在 request 中同步大量求解 |
| LINE 群組 | `lineGroupNotificationService.js`、`storeLineChannelService.js` | store-scoped 發送 | 不硬編碼 group/token |
| LINE delivery | `staffLineNotificationService.js` | 借鏡冪等/claim/delivery 狀態 | 不混用客戶通知狀態語義 |
| 前端路由 | `frontend/src/App.jsx` | 新增 `/staff-scheduling` | 不塞進 821 行 `StaffPage.jsx` |
| UI pattern | `StaffAttendancePage.jsx`、`StaffKpiPage.jsx` | PageHeader/tabs/table-card responsive pattern | 不新增英文 visible UI |
| 薪資摘要 | `PayrollPage.jsx`、`/api/payroll` | 只消費核准出勤 | 不由排班建議直接算薪資 |
| feature flag | `requireStoreFeature("staff_management_enabled")` 等既有機制 | rollout gate | 不一次全店開啟 |
| schema rollout | `schemaGuardService.js`、既有 migration/runbook | warn/verify、staging rehearsal | 不在 runtime 隨意建正式表 |

## 建議新增檔案邊界

- Backend：`routes/staffScheduling.js`、`services/staffSchedulingService.js`、`staffScoreEngine.js`、`staffSchedulingEngine.js`、`staffFairnessService.js`。
- Frontend：`pages/StaffSchedulingPage.jsx`、`lib/staffSchedulingApi.js` 與 `components/scheduling/`。
- Database：經核准後按 period/input、score/fairness、schedule/swap 分批 migration，均含 rollback。

