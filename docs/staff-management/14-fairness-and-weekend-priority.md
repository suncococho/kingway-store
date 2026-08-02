# 公平性與週末優先權

## 問題定義

週末每日需要 2 人，通常也是較受歡迎或較重要的機會。若純粹以綜合分數排序，排班多的人取得更多事件與分數，再獲得更多週末班，會形成 feedback loop。公平機制必須和績效適配分離。

## 候選集合

只在下列員工間比較：該時段明確可上班、無核准休假、工時/休息合法、具必要技能、有效 membership。不可用者不因「沒排到」受罰，敏感原因不進演算法。

## 8 週 ledger

每位員工分別記錄：

- `eligible_weekend_slots`：有資格且表示可上班的 slot。
- `assigned_weekend_slots`：實際正式指派。
- `voluntary_declines`：主動拒絕已提供機會。
- `involuntary_misses`：有資格可上班但因容量未指派。
- `weekend_debt`：應得機會與實得機會的差。

建議期望份額：`staff eligible slots / all eligible staff slots × total assigned weekend slots`；`debt = expected - assigned`，並對較舊週次作適度衰減。週六、週日另計，再提供合併視圖。

## 排序與限制

1. hard constraints 先過濾。
2. 高週末 debt 優先。
3. 在可設定小幅範圍內使用班次 E 適配與 overall score。
4. 平衡近期總工時與開/關店負擔。
5. 滿足偏好。
6. deterministic seed tie-break。

設定 dominance cap：分數優勢不可無限抵銷 fairness debt；同一人連續週末上限、8 週最大/最小分布差距均為 soft constraint，除非 coverage 無解才允許並標記例外。

## 新人、低樣本與改善機會

- 新人以中立分數與 0 debt 起步，並在前數週提供最低合理曝光，不因沒有 KPI 歷史被排除。
- 低分員工仍須在合格範圍獲得改善機會；若技能不符，提供培訓/搭班路徑而非永久排除。
- 自願長期不排週末者可設定 preference，公平報表分母必須排除其不可用 slot。

## 透明度與申訴

員工看到自己的 8 週週末 eligible/assigned、debt 趨勢與本次理由，例如「近 8 週可排 6 次、已排 1 次，本週優先補足機會」。不公開他人分數或私人 availability 原因。管理 override 必須顯示前後排序、理由與核准人，員工可提出更正。

## 監控指標

- 週六/週日 assigned 的 max-min、Gini（僅合格可用集合）。
- preference satisfaction rate。
- involuntary miss aging。
- 新人首次週末機會等待週數。
- score decile 對週末機會的差異；異常時檢查 feedback loop。
- 管理 override 比率與原因分布。

公平不等於每人絕對相同班數；目標是在資格、可用性與營運 coverage 下，機會分配可解釋、可修正且不形成永久優勢。

