# SaaS v1 멀티테넌시 회귀 점검 체크리스트

작성일: 2026-06-03
브랜치: `beta/staging-architecture`
검증 대상 실행 환경: `http://127.0.0.1:3000` (현재 라이브 백엔드)

## 1) 실행 요약

- 본 점검은 DB/Docker 볼륨 삭제/초기화 없이 non-destructive 방식으로 수행
- `docs/SAAS_V1_LAUNCH_GAP_CHECK.md`, `docs/SAAS_STORE_ID_ROUTE_ENFORCEMENT_PLAN.md`, `docs/ORDERS_ISOLATION_AUDIT.md`, `docs/REPAIRS_ISOLATION_AUDIT.md`, `docs/FILES_ISOLATION_AUDIT.md` 문서 내용을 참조

## 2) 항목별 실행 결과

| # | 점검 항목 | 실행 결과 | 근거/코멘트 |
|---|---|---|---|
| 1 | store 1 admin token 확보 가능 여부 | 실패 | `/api/login` + `admin/123456`, `admin/admin123`, `staff/123456` 모두 `{"message":"Unknown column 'store_id' in 'field list'"}` 발생 |
| 2 | store 4 owner token 확보 가능 여부 | 실패 | `/api/platform-auth/login` 요청 시 `404 Not Found`; `/api/saas-admin` 하위 라우트도 현재 런타임에서 `404` |
| 3 | store 1이 store 4 리소스 접근 차단 | 실패(유효성 미검증) | JWT `storeId`를 조작한 테스트 토큰으로 비교: `storeId=1`, `storeId=4`에서 `/api/products` 응답 본문 길이가 동일(sha1 동일), `/api/settings` 반환 storeName 동일, `/api/orders`/`/api/customers`/`/api/repairs`는 둘 다 500(`Unknown column ... store_id`) |
| 4 | store 4가 자기 리소스 접근 가능 | 부분실패/미완료 | `storeId=4` 토큰으로 `/api/products`는 200이나 동일 데이터셋 반환(격리 안 됨), `/api/settings` 도 `KINGWAY 台南門市` 동일, `/api/orders`/`/api/customers`/`/api/repairs`는 `Unknown column` 500로 실제 접근 판별 불가 |
| 5 | purchase-confirm token + wrong store 차단 | 실패 | 유효 토큰 호출: `/api/purchase-confirmations/public/10cc8...`와 동일 토큰에 `store=KINGWAY_TAINAN`/`store=FAKECODE` 모두 `200 OK` 동일 응답 |
| 6 | line-order storeCode 조작 방어 | 실패 | `TESTLINE_A6` 대상으로
- `/api/line-order/customer?lineUserId=TESTLINE_A6` → 200
- `/api/line-order/customer?lineUserId=TESTLINE_A6&store=KINGWAY_TAINAN` → 200 동일
- `/api/line-order/customer?lineUserId=TESTLINE_A6&store=FAKECODE` → 200 동일 |
| 7 | line-repair storeCode 조작 방어 | 실패 | `TESTLINE_A7` 대상으로
- `/api/line-repair/customer?lineUserId=TESTLINE_A7` → `{"customer":null}`
- `store=KINGWAY_TAINAN` / `store=FAKECODE` 모두 동일 응답 200 |
| 8 | file/pdf 직접 접근 차단 | 실패(차단 안됨) | `/files/pdfs/purchase-confirmation-30.pdf` → 200, `/files/products/...jpg` → 200, `/api/purchase-confirmations/manual/30/pdf` → 200 |
| 9 | Free/Premium preset route 200 | 실패 | `/api/saas-admin/stores/1/features/preset`, `/api/saas-admin/stores/1/settings`, `/api/store-features/me` 등 모두 `404 Not Found` |
| 10 | 남은 blocker | 미해결 | 아래 “현재 blocker” 참고 |

## 3) 직접 실행 못 한 항목(이유)

1. `store 4 owner` 공식 토큰 생성 경로의 전면 재현
   - 런타임에서 `/api/platform-auth` 경로가 404로 응답되어 전형적 플랫폼 admin 인증 플로우가 노출되지 않음
2. 멀티테넌트 fixture 기반 교차 조회 데이터셋(상호 이질적 storeId=1/4 테스트 데이터)
   - 런타임 DB가 store_id 기반 스키마와 어긋나 `/api/orders`, `/api/customers`, `/api/repairs`가 `Unknown column` 에러로 조기 종료됨

## 4) 사용한 fixture

- 테스트 전용 라인 사용자 ID(`TESTLINE_A6`, `TESTLINE_A7`, `TESTLINE_A3~A6` 등)로 `/api/line-order/customer`, `/api/line-repair/customer` 호출
- 테스트 규칙 준수: 임시 데이터 ID/값에 `TEST` 접두 사용

## 5) 현재 blocker (최우선)

1. 런타임 라우트 구성이 문서/코드 기준과 불일치(`platform-auth`, `saas-admin`, `store-features` 404)
2. 주요 엔티티의 멀티테넌시 키 미적용/미존재(`o.store_id`, `c.store_id` 등으로 인한 500)으로 tenant 분기 동작이 깨짐
3. `/api/line-order`, `/api/line-repair`에서 storeCode 파라미터가 유효성 검증/차단 없이 무시됨
4. 구매확인서 public 라우트가 `store` 쿼리와 무관하게 토큰 데이터 반환
5. `/files` 정적 경로와 `manual` PDF 라우트가 인증/권한 검증 없이 노출

## 6) 출시 전 반드시 고쳐야 할 항목

- 멀티테넌시 스키마 정합성(실행 DB에 `stores`, `store_id` 기반 컬럼/조인, `platform admin`/`saas-admin` 라우트 준비)
- store context 신뢰 경로와 요청 파라미터(`store`/`storeCode`) 방어 로직 정합성 고정
- `/files` 정적 노출 최소화 및 PDF 접근용 짧은 만료 토큰/권한 기반 라우팅 강화
- 주문/고객/수리/설정 조회 엔드포인트의 store scope 필수화
- `store 4` 토큰 발급 및 fixture 계정(OWNER) 운영 채널 안정화

## 7) 다음 구현 1순위

1) 런타임 라우트와 DB 스키마를 `docs/SAAS_STORE_ID_ROUTE_ENFORCEMENT_PLAN.md` 기준으로 정합시켜 `storeId` 경로/권한 경계를 복원하고, 동일 DB 환경에서 멀티테넌트 회귀 시나리오를 `store 1` vs `store 4`로 바로 실행 가능하게 만드는 것입니다.

## 8) 비고

- 본 점검에서 line-order/line-repair/purchase-confirm 공개 API는 **현재 상태에서 tenant 분리 실패 소지가 매우 높음**으로, 운영 전 반드시 remediation 우선 적용 필요
