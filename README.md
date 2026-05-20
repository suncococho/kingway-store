# KINGWAY 台南 獨立門市管理系統

이 저장소는 KINGWAY 台南 독립 매장 운영 시스템입니다. 확인 기준은 `docs/KINGWAY_STORE_MASTER_SPEC.md`, 실제 backend/frontend 코드, `docker-compose.yml`, `database/schema.sql`, 그리고 현재 MySQL 스키마입니다.

## 확인된 기술 구성

- Backend: Node.js 20 Alpine, Express, MySQL2, JWT, LINE Messaging API, Telegram Bot API 보조 알림
- Frontend: React, Vite, React Router, `frontend/src/lib/api.js`
- Database: MySQL 8.0, `utf8mb4`
- Runtime schema 보정: `backend/src/bootstrap.js`의 `ensureV2Schema()`
- File storage: `backend/storage`, `/files` static route
- Docker services: `mysql`, `backend`, `frontend`

## 핵심 업무 범위

- 직원 로그인, 권한, 출근/퇴근, KPI, 급여 요약
- 고객관리 CRM, follow-up, 쿠폰/주문/수리/설문/구매확인 이력
- 상품관리, SKU, 재고, 이미지 업로드
- POS 주문, 예약금/잔금, 구매확인서
- 주문관리, 삭제/복구, 잔금 수금, 교車 확인
- 수리예약, LINE 승인, 견적, 고객 응답, 완修, 픽업, 설문
- 재고 이동, 공급업체 요청, 입고/반품, 월별 정산
- LINE webhook, LINE 고객 플로우, 그룹 등록, 일일/대기 요약
- Telegram webhook, 공급업체 승인/반려 및 일부 재고/리포트 명령

## 주요 파일 구조

```text
.
|-- backend/
|   |-- package.json
|   |-- storage/
|   `-- src/
|       |-- app.js
|       |-- bootstrap.js
|       |-- config.js
|       |-- db.js
|       |-- routes/
|       `-- services/
|-- frontend/
|   |-- Dockerfile
|   |-- package.json
|   `-- src/
|       |-- App.jsx
|       |-- lib/
|       `-- pages/
|-- database/
|   `-- schema.sql
|-- docs/
|   `-- KINGWAY_STORE_MASTER_SPEC.md
|-- docker-compose.yml
`-- README.md
```

## 실행 요약

```bash
docker compose up --build
```

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:3000/health`
- MySQL: `127.0.0.1:3306`

`backend/src/server.js`는 시작 시 storage 디렉터리 생성, V2 schema 보정, Telegram 설정 검증, 기본 admin/staff 생성 후 서버를 시작합니다.

## 기본 계정과 역할

`backend/src/bootstrap.js` 기준 기본 admin 계정:

- Username: `admin`
- Password: `admin123`

`staff_users.role`에서 확인된 역할:

- `ADMIN`
- `MANAGER`
- `CASHIER`
- `REPAIR`
- `INVENTORY`

## 주요 문서

- `SYSTEM_ARCHITECTURE.md`: 전체 구조, 서버 시작 순서, frontend/backend 연결
- `DOCKER_COMMANDS.md`: docker compose, health, 로그, MySQL 확인 명령
- `API_ROUTES.md`: 실제 Express mount와 route 목록
- `DB_SCHEMA.md`: 실제 DB table/column/status 요약
- `LINE_FLOW.md`: LINE webhook, 키워드, 예약/쿠폰/구매확인 플로우
- `TELEGRAM_FLOW.md`: Telegram webhook, 공급업체/재고 명령, LINE-first 주의점
- `ORDER_STATUS.md`: 주문/수리/쿠폰/공급업체 status 값과 표시 라벨
- `CUSTOMER_RULES.md`: 고객 식별, CRM, follow-up, 삭제 규칙
- `POS_FLOW.md`: POS 주문 생성, 예약금/잔금, 재고 차감, 구매확인
- `REPAIR_FLOW.md`: 수리예약, 견적, 승인, 완료, 픽업, 설문
- `PRODUCT_IMAGE_UPLOAD.md`: 상품 이미지 업로드 API와 저장 경로
- `TROUBLESHOOTING.md`: 운영 중 확인 포인트와 알려진 코드 주의사항

## Source of Truth

업무 규칙은 `docs/KINGWAY_STORE_MASTER_SPEC.md`가 우선입니다. 특히 사용자에게 보이는 UI/메시지는 대만 번체 중국어를 사용해야 하며, LINE-first 흐름을 임의로 다른 채널로 대체하면 안 됩니다.

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
