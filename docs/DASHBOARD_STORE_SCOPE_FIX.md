# Dashboard Store Scope Fix

## Problem
- `frontend/src/pages/DashboardPage.jsx` calls `GET /api/dashboard/summary`.
- `backend/src/routes/dashboard.js` already scoped totals by `req.storeId`.
- `backend/src/services/taskService.js` was still counting pending purchase confirmations, repairs, Google review approvals, and surveys without any store filter.
- Because `summary.pendingTasks` was global, a new store owner could still see KINGWAY 台南門市 pending counts on the dashboard.

## Fix
- Keep `GET /api/dashboard/summary` behind `authenticate + requireStoreScope()`.
- Add an explicit safe guard in `backend/src/routes/dashboard.js` for missing `req.storeId`.
- Change `getPendingTaskCounts(storeId)` to require store scope and filter every dashboard pending count by the current store.
- Applied store scope to:
  - `purchase_confirmations.store_id`
  - `repair_orders.store_id`
  - `coupons.store_id` for Google review pending approvals
  - `surveys` via `customers.store_id`

## Dashboard API References
- Frontend dashboard summary API: `frontend/src/pages/DashboardPage.jsx`
- Backend summary route: `backend/src/routes/dashboard.js`
- Backend pending count service: `backend/src/services/taskService.js`

## Validation
- `node --check backend/src/routes/dashboard.js`
- `node --check backend/src/services/taskService.js`
- `npm --prefix frontend run build`
- staging deploy via `scripts/deploy-staging.sh`
- backend recreate via `sudo docker compose -f docker-compose.staging-restore.yml up -d --force-recreate backend`
- compared `GET /api/dashboard/summary` results by store-scoped token for store `1`, store `5`, and a newly provisioned store (`4`)
