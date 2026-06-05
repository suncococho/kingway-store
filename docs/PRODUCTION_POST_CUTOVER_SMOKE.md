# Production Post-Cutover Smoke Test Result

## 1) Test Context

- Target: `https://pos.kingway.tw`
- Time (UTC+8): 2026-06-05
- Branch: `beta/staging-architecture`
- No code changes, no DB writes, no deploy, no LINE sends.

## 2) Checks

| Check | Result | Notes |
|---|---|---|
| `https://pos.kingway.tw/login` 접근 | PASS | `200` 응답, SPA 진입 HTML 반환 |
| `/api/system/saas-status` | PASS | `customerCount=158`, `orderCount=92`, `repairCount=22` |
| `POST /api/login` | PASS | `admin / 123456` 요청에 `200` 및 JWT 발급 |
| `GET /api/dashboard/summary` (auth) | PASS | `200`, totals 내 `customers=158`, `products=385`, `orders=92` |
| `GET /api/products` (auth) | PASS | `200`, 목록 길이 `385` |
| `GET /api/orders` (auth) | PASS | `200`, 목록 길이 `92` |
| `GET /api/repairs` (auth) | PASS | `200`, 목록 길이 `28` |
| `GET /api/purchase-confirmations` (auth) | PASS | `200`, 목록 길이 `21` |
| `GET /api/store/settings` (auth) | PASS | `200` |
| `GET /api/store-features/me` (auth) | PASS | `200`, feature flag 객체 반환 |

## 3) pos.kingway.tw 데이터 기준

- `customerCount`: 158 (요구값 일치)
- `orderCount`: 92 (요구값 일치)
- `repairCount`: 22 (요구값 일치)
- dashboard totals:
  - `customers=158`
  - `products=385`
- 주문/상품/수리 목록 모두 응답은 정상이며 비정상 빈값 없이 로드됨.
- 추가 지표:
  - dashboard API에서 `repair` 목록 총 개수는 `28` (상태 정합성 확인 필요 시 추가 점검 대상)

## 4) 로그인 결과

- `/api/login` with `admin / 123456`:
  - HTTP: `200`
  - Response: JWT token and user payload returned.
  - 사용한 토큰으로 보호 API 7개 경로 모두 `200` 확인.

## 5) 남은 이슈

1. `/api/system/saas-status`의 `ports` 값이 `frontend=5180`, `backend=3010`로 노출되어 있으며, 요청한 `5173/3000/3306` 운영 포트 고정 상태 표기와 상이함.
2. `environment`가 `development`로 노출되어 production 가시성/운영 분기 상의 확인 필요.
3. `/api/dashboard/summary`와 `/api/system/saas-status`에서 보이는 수치/집계 기준(전체 대시보드 기준 vs 목록 조회 기준) 차이가 일부 존재할 가능성(예: repairs: 22 vs 목록 길이 28) 확인 필요.

