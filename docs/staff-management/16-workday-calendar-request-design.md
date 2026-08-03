# 員工工作日月曆申請設計（Phase B）

## 範圍與資料模型

本階段讓員工在月曆提出「希望工作日」，不建立最終班次、不發布班表。`staff_workday_requests` 是員工與排班期間唯一的申請表頭，`staff_workday_request_days` 保存逐日狀態；score tier、員工 override、immutable snapshot 與 audit log 分開保存，所有資料均以 `store_id` 隔離。

## 功能開關與權限

`staff_workday_selection_enabled` 是獨立、門市層級且預設關閉的開關。既有 `staff_management_enabled` 不變；新 tab 隱藏時，後端仍以 middleware 回傳 `FEATURE_DISABLED`。self API 從登入者取得員工 ID；owner/admin 可設定級距、容量與個人上限，manager 只可依既有排班管理政策審核申請。

## API

員工 API：`GET /me/workday-calendar`、`GET /me/workday-summary`、`PUT /me/workday-selection`、`POST /me/workday-selection/submit`、`DELETE /me/workday-selection/:date`、`GET /me/workday-requests`。

管理 API：`GET /admin/workday-calendar`、`GET /admin/workday-requests`、`PATCH /admin/workday-requests/:id/review`、`POST /admin/workday-requests/bulk-review`、`PUT /admin/capacity/:date`、`GET/PUT /admin/score-tier-rules`、`PUT /admin/staff/:staffUserId/weekly-limit`。所有寫入使用 store scope、版本檢查與穩定 error code。

## 每週上限

時區固定 Asia/Taipei，以週一至週日為一週，跨月週仍合併計數。同日不因多班次重複。DRAFT、PENDING、APPROVED、仍有效的 ADJUSTED，以及政策指定需計入的管理員指派會計數；REJECTED/CANCELLED 不計。超限回傳 409 `WEEKLY_SELECTION_LIMIT_EXCEEDED` 與 weekStart、attemptedDate、existingDays、selectedDays、totalDays、maxSelectableDays、tierName、scoreStatus。

## 分數政策

來源依序為有效 snapshot、員工週上限 override、管理員指定 snapshot/tier、門市中性預設。不得使用獎金金額或原始 KPI total，不推測分數。資料不足時 `score=null`、顯示「分數資料不足」，仍套用中性級距；override 只改上限，不製造分數。

## 容量與隱私

未覆寫時採 calendar `required_headcount`：週一 0、週二至週五 1、週末 2。預設 pending 不保留容量，approved 才消耗容量。員工只收到人數、容量、自己狀態、開放/鎖定/期限，不收到其他員工姓名或 ID。關閉、鎖定、逾期、額滿分別回傳 `STORE_CLOSED`、`DATE_LOCKED`、`REQUEST_DEADLINE_PASSED`、`DATE_CAPACITY_FULL`。

## 稽核與 UI

送出、取消、核准、拒絕、日期調整、個人上限、容量、鎖定、級距異動均留 actor/store/reason/old/new/entity/timestamp。員工 UI 為可點整格月曆、文字 badge、ARIA label、已選 chips 與手機 sticky action；管理 UI 顯示每日 approved/pending/capacity、審核、容量與政策設定 foundation，不含發布。
