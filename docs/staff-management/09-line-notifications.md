# LINE 通知設計

## 原則

LINE 是主要營運通知通道，但正式狀態以 DB 為準。重用 `lineGroupNotificationService.js`、`staffLineNotificationService.js`、`storeLineChannelService.js` 與門市 LINE token resolver；不得硬編碼 token/groupId，不得重新引入 Telegram。

## 事件

| 事件 | 對象 | 內容/動作 |
|---|---|---|
| availability 截止提醒 | 尚未提交員工，可用個人 LINE 時才個別送 | 截止時間、開啟 web/LIFF |
| 草稿有 coverage gap | 管理者群組 | 日期時間、缺幾人、開啟排班 |
| 班表發布 | 員工群組 + POS 個人通知 | 週期、revision、查看與確認 |
| 正式班次變更 | 受影響員工 + 管理者群組 | before/after、原因、確認 |
| 換班申請/接受 | 候選人或指定接班人 | 班次摘要、接受/拒絕連結 |
| 換班待核准 | 管理者群組 | 雙方、constraint 通過狀態、核准/拒絕 |
| 緊急缺勤缺口 | 合格候補 + 管理者 | 日期時間、原子 claim 連結 |
| 未確認提醒 | 未確認員工/管理者摘要 | 不含私人理由 |

## 發送安全

- transaction 內建立 outbox/notification event，commit 後非同步發送；LINE 실패不回滾班表。
- idempotency key 建議 `schedule:{revisionId}:{event}:{recipientScope}`。
- webhook/action token 短效、單次、綁定 store/user/action；核准時重新驗證權限與 revision。
- 群組訊息不顯示 A~E 分數、休假原因、申訴或出勤敏感細節。
- 429/5xx 採退避重試與 delivery log；達上限轉 POS urgent notification。
- 訊息與按鈕均使用 zh-TW，按鈕例：`查看班表`、`確認已讀`、`接受換班`、`拒絕`。

## Phase 0 限制

本階段不發送任何 LINE。後續 staging 先用 dry-run/fake sender 驗證 payload、冪等與 store channel resolution，取得明確批准後才做真實測試。

