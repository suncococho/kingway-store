# Production System Status Fix Result

작성일: 2026-06-05
브랜치: `beta/staging-architecture`

## 실행 항목

1. staging 검증된 `/api/system/saas-status` 표시값 수정을 production 백엔드에 반영
2. `sudo docker restart kingway-backend`
3. production endpoint 헬스/로그인/API 스모크 확인

## 검증 환경

- Backend: `http://127.0.0.1:3000`
- Public API: `https://pos.kingway.tw`
- Credentials: `admin / 123456`

## 1) git status 확인

- 실행 결과: `git status --short`에서 untracked 파일이 존재해 clean 상태 아님
- 확인된 파일: `?? docs/POST_CUTOVER_NON_BLOCKING_ISSUES.md`

## 2) backend/src/routes/systemStatus.js 커밋 반영 확인

- 반영 커밋: `7bb7d4a`
- 메시지: `fix: report runtime environment in saas status`

## 3) production backend 재시작

- 실행: `sudo docker restart kingway-backend`
- 결과: 성공 (`kingway-backend` 재시작 완료)

## 4) 생산 헬스 확인

- `curl http://127.0.0.1:3000/health`
- 결과: `{"ok":true}`

## 5) `/api/system/saas-status` 확인

요청: `https://pos.kingway.tw/api/system/saas-status`

결과:
- `environment`: `production`
- `ports.frontend`: `5173`
- `ports.backend`: `3000`
- `counts.customerCount`: `158`
- `counts.orderCount`: `92`
- `counts.repairCount`: `22`

## 6) 인증/대시보드 스모크

- `POST /api/login` (admin/123456): 200
- `GET /api/dashboard/summary`: 200

## 7) core API 스모크

다음 엔드포인트 모두 200:
- `GET /api/products`
- `GET /api/orders`
- `GET /api/repairs`
- `GET /api/customers`
- `GET /api/coupons`

## 비고

- LINE 발송 관련 설정은 변경하지 않았고 실제 전송 동작이 개입되지 않았습니다.
- reverse proxy/frontend/DB 변경은 수행하지 않았습니다.
