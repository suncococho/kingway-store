# 權限矩陣

## 角色模型

既有工作角色為 `ADMIN/MANAGER/CASHIER/REPAIR/INVENTORY`，門市 membership 角色為 `owner/admin/staff`。沿用 `menuPermissionService.js` 的 role default + user override，但新增 action-level permission，避免只有 menu 可見性卻能直接呼叫敏感 API。

| 動作 | 一般員工 | MANAGER | store admin | owner |
|---|---:|---:|---:|---:|
| 查看自己的班表/分數 | ✓ | ✓ | ✓ | ✓ |
| 編輯自己的 availability | ✓ | ✓ | ✓ | ✓ |
| 提出/接受自己的換班 | ✓ | ✓ | ✓ | ✓ |
| 查看全店 availability（隱私遮罩） | - | ✓ | ✓ | ✓ |
| 代填 availability | - | 授權時 | ✓ | ✓ |
| 產生/編輯草稿 | - | ✓ | ✓ | ✓ |
| 發布班表 | - | 授權時 | ✓ | ✓ |
| 核准換班/出勤異常 | - | ✓ | ✓ | ✓ |
| 設定 A~E 權重/工時政策 | - | - | ✓ | ✓ |
| 查看全員分數明細 | - | ✓ | ✓ | ✓ |
| 人工調整分數 | - | - | 授權時 | ✓ |
| 查看 audit log | 自己相關 | 門市 | 門市 | 門市 |
| hard delete audit/score snapshot | - | - | - | - |

## 權限鍵建議

- menu key：`staff_scheduling`。
- actions：`schedule.view_own`、`availability.manage_own`、`schedule.view_store`、`schedule.generate`、`schedule.edit`、`schedule.publish`、`swap.approve`、`attendance.correct`、`score.view_store`、`score.adjust`、`policy.manage`、`audit.view`。
- 後端每個 action 同時驗證 authenticated user、有效 membership、`store_id` 與 permission；前端隱藏按鈕不是安全控制。
- owner override 仍不可跨 store 或修改 append-only audit。

## 隱私

- 同事只看公開班表所需姓名/顯示名，不看 A~E 明細、availability 原因、異議內容。
- manager heatmap 只看可用/不可用狀態；醫療、家庭等原因限獲授權人員。
- export 與 LINE 通知遵循相同欄位最小化。

