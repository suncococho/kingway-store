# A~E 評分引擎設計

## 原則

- 分數是排班建議的可解釋輸入，不是懲處或薪資依據。
- 每次計算固定 `policy_version`、期間、來源事件與結果快照；重新計算不得覆寫舊快照。
- 缺資料採中立值或降低 confidence，不得當成 0 分。
- 管理者調整必填理由，原始值、調整值與操作者均留 audit。

## 五項定義（每項 0~100）

| 項目 | 定義 | 既有來源 | 建議權重 |
|---|---|---|---:|
| A 出勤可靠度 | 準時、完整打卡、核准異常 | `staff_attendance`；未來 shift attendance exceptions | 25% |
| B 任務完成度 | 必要任務完成、逾期率 | `staff_task_instances`、`staff_kpi_events` | 20% |
| C 服務與營運品質 | 訂單/維修/供應商處理與有效完成 | `staff_kpi_events`、既有 workflow ref | 20% |
| D 協作與責任 | 換班履約、通知處理、經核實評價 | 未來 swap；`staff_notifications`、`staff_evaluation_notes` | 15% |
| E 技能與班次適配 | 角色、技能、開關店/維修等資格 | `staff_users.role`；未來 staff skills | 20% |

`overall = round(A×0.25 + B×0.20 + C×0.20 + D×0.15 + E×0.20, 2)`。

## 正規化

- A：`100 - 遲到扣分 - 未核准缺卡扣分 - 無故缺勤扣分`，核准請假不扣分。
- B：`按時完成必要任務 / 到期必要任務 × 100`；至少有最小樣本才形成正式分數。
- C：事件型別以 policy table 給分，依可比工作機會做 rate normalization，避免排班多的人天然較高。
- D：以履約率與已核實協作事件計算；主觀 note 不直接計分，須轉為具名、可申訴事件。
- E：對候選班次動態計算 suitability；總覽 E 為期間內適配平均，不可把非本職角色視為低績效。

## 信心與例外

- 每項輸出 `score`、`confidence`、`sample_size`、`reason_codes`。
- 新進員工採 `NEW_STAFF_NEUTRAL`，以公平輪替取得機會。
- 系統/LINE/打卡設備故障標記為 excluded event。
- 分數相同時依週末債務、近期班數較少、偏好、固定 seed 決勝，不使用隨機黑箱。

## 防止 gaming

- `staff_kpi_events` 的 unique ref 延伸為事件來源冪等。
- 單純 read/view 不算完成；沿用 `StaffKpiPage.jsx` 所述「實際處理動作」。
- 同一工作多人參與時記 contributor 與權重，不重複給滿分。
- 異常高頻事件、短時間批次完成進入人工審核。

