# 測試計畫

## 測試層級

### 單元測試

- A~E 正規化、缺資料中立值、confidence、權重與 rounding。
- 週末 debt 更新、拒絕/不可用/新進員工規則。
- 週一休店、平日 1 人、週末 2 人的 slot 生成。
- overlap、休息、工時、技能與 deterministic tie-break。
- permission resolver、隱私遮罩、idempotency key。

### property/constraint 測試

對隨機員工/availability 產生 1,000 組案例，凡引擎回傳 feasible，必須滿足：週一 0 班；Tue–Fri 每 slot 1 人；Sat–Sun 每 slot 2 人；無 gap、重疊、超時、無資格指派。相同 input hash/seed 結果必須相同。

### API/整合測試

- auth、store scope、角色/action permission 與跨店 ID 攻擊。
- availability deadline/revision conflict。
- generate→validate→publish transaction 與 concurrent publish。
- swap concurrent accept 只能一人成功。
- attendance 對 shift match 與未排班 backward compatibility。
- POS notification/outbox；LINE fake sender 成功、429、5xx、重試與冪等。
- 缺表/feature disabled 行為與既有 `/api/staff-kpi`、`/api/daily-staff-tasks` 回歸。

### 前端/E2E

- 員工手機提交 availability、查看班表、確認、換班。
- 管理者看到缺口、調整、重新驗證、發布。
- 409 conflict 時保留本地變更並提示 refresh/compare。
- private reason 不出現在 heatmap、同事頁、export、LINE。
- zh-TW、鍵盤操作、screen reader label、44px touch target、窄螢幕。

## 必要情境

1. 正常週：4 個平日各 1 人、週末各 2 人，零違規。
2. 所有人週日不可用：明確無解，不產生假成功。
3. 唯一維修人員超時：回傳技能與工時衝突。
4. 同分員工：週末 debt 高者優先且 reason 可解釋。
5. 高分者已連續多週週末：fairness cap 生效。
6. 新進員工零資料：不被當作 0 分排除。
7. 發布後緊急缺勤：只重排 affected slots。
8. 核准換班造成休息不足：拒絕。
9. 打卡設備故障：事件 excluded，不扣 A。
10. 兩管理者同時發布：一方 409。

## staging gate

- migration dry-run/rollback、schema indexes 與 explain plan。
- anonymized fixture，不讀寫 production。
- build/lint/test 全通過；現有員工、出勤、KPI、通知回歸通過。
- LINE 一律 dry-run/fake；正式發送另行批准。

