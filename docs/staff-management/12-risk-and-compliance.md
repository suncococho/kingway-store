# 風險與合規

| 風險 | 影響 | 控制 |
|---|---|---|
| 人力不足造成無解 | 營業空班 | hard fail、衝突解釋、候補與升級，不偷放寬 |
| 分數偏見/歷史優勢 | 不公平排班 | rate normalization、confidence、新人中立、公平 cap、申訴 |
| 敏感休假原因洩漏 | 隱私與勞資風險 | 最小收集、欄位隔離、action permission、遮罩與保存期 |
| 跨店資料洩漏 | tenant breach | 每查詢 `store_id`、membership 驗證、跨店攻擊測試 |
| 打卡舊資料誤 backfill | 錯誤薪資/紀錄 | nullable rollout、dry-run report、只自動匹配高信心資料 |
| 兩位管理者覆蓋 | 班表遺失 | optimistic version、transaction、append-only revision |
| LINE 重複/誤發 | 員工困惑/隱私 | outbox、冪等鍵、resolver、dry-run、內容最小化 |
| KPI gaming | 分數失真 | 實際完成事件、unique ref、異常頻率審核 |
| 自動化被視為人事決策 | 合規/信任 | decision support only、人工發布、理由與 appeal |
| 時區/夏令/跨午夜 | 錯班 | Asia/Taipei 明示、UTC/本地策略、boundary tests |
| migration 失敗 | 營運中斷 | staging rehearsal、backup、rollback、feature flag |
| 發布後頻繁變更 | 員工生活受影響 | stability penalty、通知、變更理由與指標 |

## 台灣勞動規範注意

實作前應由具資格的人資/法律顧問確認最新《勞動基準法》對正常工時、延長工時、休息、例假/休息日、輪班間隔、出勤紀錄保存與部分工時的適用要求。系統政策必須可版本化，不應把本文數值當成法律結論。

## 公平與人權 guardrails

- 禁止使用性別、年齡、婚育、身心狀況、族群、宗教、家庭照顧等受保護/敏感屬性排序。
- 核准請假與不可上班不作負面績效；只有「在符合資格且表示可上班的機會集合」內比較公平。
- 員工可取得自己的分數、資料期間、理由、調整紀錄與申訴管道。
- 不公開個人排名，不讓 LINE 群組成為績效羞辱工具。

## 資安與資料治理

- least privilege、audit request ID、輸出欄位 allowlist、export watermark/權限。
- 私人原因設定明確保存期限；audit 需保存但 sensitive payload 可 token/reference 化。
- 備份、log、error monitoring 也不得含私人原因或 LINE token。
- production 任何 DB 寫入、migration、部署或真實 LINE 發送均需另行明確批准。

