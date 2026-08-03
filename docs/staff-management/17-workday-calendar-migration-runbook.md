# 員工工作日月曆 migration runbook

## 安全前提

Phase B 交付只建立 SQL，不在本工作執行。禁止對 Production/Staging 執行、禁止從既有 assignment 回填 request。先備份、確認 target、確認現有 9 張排班表與 FK 均為 `BIGINT UNSIGNED`，並在隔離 Staging dry run。

## Forward 順序

1. `20260804_create_staff_workday_request_core.sql`
2. `20260804_create_scheduling_score_policy.sql`
3. `20260804_extend_scheduling_calendar_and_revisions.sql`
4. `20260804_create_scheduling_audit_logs.sql`
5. `20260804_add_staff_workday_selection_feature.sql`

欄位預設必須保持 `staff_workday_selection_enabled=0`、`pending_reserves_capacity=0`。migration 完成後仍不得啟用，直到 Staging 驗收通過。

## Staging 測試計畫

- 先以只讀 schema/count/FK/collation 檢查確認所有新表 store scoped。
- 建立中性 tier 測試資料，驗證 score 不足不受懲罰。
- 驗證週一邊界、跨月週、2/3 日上限與同日去重。
- 驗證店休、鎖定、截止、額滿、pending competition、最後名額併發與 optimistic version conflict。
- 用兩間 store 驗證隔離與員工 privacy；普通員工不可呼叫管理 API。
- 回歸 leave conflict、shift overlap、weekly-hour warning、staff incentive integration。
- 前端桌面/手機驗證 44px touch target、文字 badge、鍵盤與螢幕閱讀器標示。

## Rollback 順序與限制

完整回退採 5→1 反序：feature、audit、calendar/revision extension、score policy、request core。個別 rollback 檔內依 FK dependency 反序。只要已有真實申請、稽核或 published revision lineage，就不得 drop；改採停用 feature flag、保留資料並另做 forward repair migration。

## Production 與 RC

本功能不屬於 immutable RC `3ca63c2`，不得修改該 artifact 或舊 release plan。未完成 Staging 備份、dry run、併發測試、權限/隱私驗收與 rollback 決策前，不可建立新 release artifact、不可部署、不可啟用門市 flag。
