# 前端設計

## 資訊架構

建議新增主路由 `/staff-scheduling`，在同一手機優先工作台提供：`我的班表`、`可上班時間`、`換班`、`A~E 分數`。管理者另見 `排班草稿`、`可用時段`、`公平性`、`政策與稽核`。

既有 `/staff-attendance` 保留，顯示當日正式班次、應打卡時間與異常；`/staff-kpi` 保留營運事件明細。避免把三個領域再合成巨型 `StaffPage.jsx`。

## 核心畫面

1. 我的班表：週視圖與今日卡片，顯示日期、時間、同班者、確認狀態與大尺寸換班按鈕。
2. 可上班時間：先顯示截止時間，一日一列大按鈕，支援複製上週、整日不可與時段編輯。
3. 管理 heatmap：橫軸時間、縱軸員工，清楚標示週一休店、平日需 1、週末需 2 與缺口。
4. 草稿編輯器：桌面 grid、手機逐日卡片；每次拖放後即時顯示 constraint，不以顏色作唯一訊息。
5. 公平面板：8 週週六/週日班次、eligible 次數、機會債務、偏好滿足率與解釋。
6. 分數詳情：A~E、overall、期間、confidence、來源摘要與「提出異議」。
7. 換班中心：我的申請、待我接受、待管理者核准、歷史。

## 元件與檔案建議

- `frontend/src/pages/StaffSchedulingPage.jsx`
- `frontend/src/lib/staffSchedulingApi.js`
- `components/scheduling/AvailabilityEditor.jsx`
- `ScheduleWeekGrid.jsx`、`ScheduleDayCards.jsx`
- `ConstraintPanel.jsx`、`ScoreBreakdown.jsx`、`WeekendFairnessPanel.jsx`、`ShiftSwapDrawer.jsx`

沿用 `PageHeader`、`SectionTabs`、`AdminSectionHeader`、`StatusBadge`、既有 API/auth/error pattern 與 responsive card/table pattern。

## UX 規則

- 所有 visible copy 為 zh-TW，例如 `我的班表`、`可上班時間`、`排班缺口`、`提出換班`。
- 發布前顯示摘要與影響人數；發布是具意義動作，需 confirm dialog。
- 無解時把日期、時間、需求與候選數放在頁面上方，提供可採取動作。
- 私人理由只顯示 `已核准不可上班`，不在 heatmap 洩漏內容。
- accessibility：鍵盤可調整、ARIA label、文字+icon status、觸控目標至少 44px。
- loading、empty、offline、409 version conflict 與 retry 均有明確狀態。

