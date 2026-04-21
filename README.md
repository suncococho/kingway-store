# KINGWAY LINE-Only Store Management System

Independent store management system for KINGWAY built with:

- Node.js + Express backend
- MySQL database
- React + Vite admin frontend
- Docker Compose
- LINE Messaging API integration

No WordPress. No WooCommerce. No Telegram.

## Current Scope

This repo now includes one integrated system with these modules:

- Staff login with JWT and roles
- Customer management
- Product management
- Inventory movement management
- POS order creation
- LINE group registration
- Daily settlement report
- Purchase confirmations for eligible EBIKE orders
- Repair reservations / estimate / approval / pickup flow
- Coupons
- Surveys
- Staff attendance
- KPI summary
- Payroll summary

## Roles

Supported roles:

- `ADMIN`
- `MANAGER`
- `CASHIER`
- `REPAIR`
- `INVENTORY`

## Project Structure

```text
.
|-- backend/
|   |-- package.json
|   |-- storage/
|   `-- src/
|-- frontend/
|   |-- package.json
|   `-- src/
|-- database/
|   `-- schema.sql
|-- docker-compose.yml
|-- .env.example
`-- README.md
```

## Run Instructions

1. Copy `.env.example` to `.env`
2. Fill in at least:
   - `JWT_SECRET`
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `LINE_CHANNEL_SECRET`
   - `FRONTEND_BASE_URL`
3. Start services:

```bash
docker compose up --build
```

4. Open:
   - frontend: `http://localhost:5173`
   - backend health: `http://localhost:3000/health`

## Default Admin Account

- Username: `admin`
- Password: `admin123`

The backend creates this account on first start if it does not already exist.

## Frontend Pages

Sidebar pages:

- Dashboard
- Customers
- Products
- Inventory
- Orders
- POS
- Purchase Confirmations
- Repairs
- Coupons
- Surveys
- Staff Attendance
- KPI
- Payroll

Public pages:

- `/purchase-confirm/:token`
- `/survey/:token`

## Main API Routes

Auth:

- `POST /api/login`
- `POST /api/auth/login`
- `GET /api/auth/me`

Dashboard:

- `GET /api/dashboard/summary`

Customers:

- `GET /api/customers`
- `POST /api/customers`
- `PATCH /api/customers/:id`

Products:

- `GET /api/products`
- `POST /api/products`
- `PATCH /api/products/:id`

Inventory:

- `GET /api/inventory/low-stock`
- `GET /api/inventory/movements`
- `POST /api/inventory/movements`

Orders / POS:

- `GET /api/orders`
- `POST /api/orders`

Purchase Confirmations:

- `GET /api/purchase-confirmations`
- `GET /api/purchase-confirmations/pending-links`
- `POST /api/purchase-confirmations/generate-link`
- `GET /api/purchase-confirmations/public/:token`
- `POST /api/purchase-confirmations/public/:token`

Repairs:

- `GET /api/repairs`
- `GET /api/repairs/:id`
- `POST /api/repairs`
- `POST /api/repairs/:id/estimate`
- `POST /api/repairs/:id/approve`
- `POST /api/repairs/:id/reject`
- `POST /api/repairs/:id/complete`
- `POST /api/repairs/:id/pickup`

Coupons:

- `GET /api/coupons`
- `POST /api/coupons/issue`
- `POST /api/coupons/request-google-review`
- `POST /api/coupons/approve-google-review/:id`

Surveys:

- `GET /api/surveys`
- `POST /api/surveys/generate-link`
- `GET /api/surveys/public/:token`
- `POST /api/surveys/public/:token`

Attendance / KPI / Payroll:

- `GET /api/attendance`
- `POST /api/attendance/check-in`
- `POST /api/attendance/check-out`
- `GET /api/kpi`
- `GET /api/payroll/summary`

LINE:

- `POST /api/line/webhook`
- `GET /api/line/groups`
- `POST /api/line/daily-report/send`
- `POST /api/line/pending-summary/send`

## LINE Commands

Group or room registration commands:

- `/register admin`
- `/register staff`
- `/register repair`
- `/register inventory`
- `/register daily`

Staff attendance through LINE:

- `/checkin`
- `/checkout`

## Repair Rules

Allowed reservation days:

- Tuesday
- Wednesday
- Sunday

Customer-facing notice:

- `非保固維修需收取基本檢查/工資 NT$400`
- `除非常簡單的調整外，車輛需留店檢查`
- `維修完成通知後，超過 3 日未取車，每日收取保管費 NT$80`

## Notes

- Purchase confirmation PDF files are written under `backend/storage/pdfs`
- Daily settlement report runs at `21:00 Asia/Taipei`
- Stock deduction is automatic when POS orders are created
- Google review coupons require approval
- Survey and purchase confirmation public links depend on `FRONTEND_BASE_URL`

## Production TODO

You still need real production values for:

- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `JWT_SECRET`
- `FRONTEND_BASE_URL`

Recommended production follow-ups:

- Put backend behind HTTPS
- Use a reverse proxy
- Replace default admin credentials
- Move secrets to a proper secret manager
- Add stronger validation and audit logs before real store rollout
