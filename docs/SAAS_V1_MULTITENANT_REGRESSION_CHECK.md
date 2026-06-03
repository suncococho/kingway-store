# SaaS v1 멀티테넌시 회귀 점검 체크리스트

작성일: 2026-06-03
브랜치: `beta/staging-architecture`
검증 대상 실행 환경: `http://127.0.0.1:3010` (현재 라이브 백엔드)

## 1) 실행 요약

- 본 점검은 DB/Docker 볼륨 삭제/초기화 없이 non-destructive 방식으로 수행
- `docs/SAAS_V1_LAUNCH_GAP_CHECK.md`, `docs/SAAS_STORE_ID_ROUTE_ENFORCEMENT_PLAN.md`, `docs/ORDERS_ISOLATION_AUDIT.md`, `docs/REPAIRS_ISOLATION_AUDIT.md`, `docs/FILES_ISOLATION_AUDIT.md` 문서 내용을 참조

## 2) 항목별 실행 결과

| # | 점검 항목 | 실행 결과 | 근거/코멘트 |
|---|---|---|---|
| 1 | store 1 admin token 확보 가능 여부 | 통과 | `/api/login` + `admin/123456`로 JWT 발급 성공 (`storeId:1`). (`admin/admin123`은 인증 오류) |
| 2 | store 4 owner token 확보 가능 여부 | 실패 | `/api/platform-auth/login` 요청 시 `401 Unauthorized`(인증 계정 미스매치 또는 미지원 경로); `/api/saas-admin` 하위 라우트는 토큰이 있어도 `401 Unauthorized`로 권한/컨텍스트 미스매치 표시 |
| 3 | store 1이 store 4 리소스 접근 차단 | 실패(유효성 미검증) | JWT `storeId`를 조작한 테스트 토큰으로 비교: `storeId=1`, `storeId=4`에서 `/api/products` 응답 본문 길이가 동일(sha1 동일), `/api/settings` 반환 storeName 동일, `/api/orders`/`/api/customers`/`/api/repairs`는 둘 다 500(`Unknown column ... store_id`) |
| 4 | store 4가 자기 리소스 접근 가능 | 부분실패/미완료 | `storeId=4` 토큰으로 `/api/products`는 200이나 동일 데이터셋 반환(격리 안 됨), `/api/settings` 도 `KINGWAY 台南門市` 동일, `/api/orders`/`/api/customers`/`/api/repairs`는 `Unknown column` 500로 실제 접근 판별 불가 |
| 5 | purchase-confirm token + wrong store 차단 | 통과 | 유효 토큰 호출: `/api/purchase-confirmations/public/10cc8...` + `store=FAKECODE`는 `404 Not Found` (`找不到有效的門市資訊`). `store=KINGWAY_TAINAN` 또는 미지정은 정상 조회 |
| 6 | line-order storeCode 조작 방어 | 실패 | `TESTLINE_A6` 대상으로
- `/api/line-order/customer?lineUserId=TESTLINE_A6` → 200
- `/api/line-order/customer?lineUserId=TESTLINE_A6&store=KINGWAY_TAINAN` → 200 동일
- `/api/line-order/customer?lineUserId=TESTLINE_A6&store=FAKECODE` / `INVALID_STORE_CODE` → `404 Not Found` |
| 7 | line-repair storeCode 조작 방어 | 실패 | `TESTLINE_A7` 대상으로
- `/api/line-repair/customer?lineUserId=TESTLINE_A7` → `{"customer":null}`
- `store=KINGWAY_TAINAN`은 200, `store=FAKECODE` / `INVALID_STORE_CODE`는 `404 Not Found` |
| 8 | file/pdf 직접 접근 차단 | 실패(차단 안됨) | `/files/pdfs/purchase-confirmation-30.pdf` → 200, `/files/products/...jpg` → 200, `/api/purchase-confirmations/manual/30/pdf` → 200 |
| 9 | Free/Premium preset route 200 | 실패 | `/api/saas-admin/stores/1/features/preset`은 라우트 존재지만 인증만으로 `401 Unauthorized` 응답. `/api/store-features/me`는 `200`(현재 인증 토큰 컨텍스트) |
| 10 | 남은 blocker | 미해결 | 아래 “현재 blocker” 참고 |

## 3) 직접 실행 못 한 항목(이유)

1. `store 4 owner` 공식 토큰 생성 경로의 전면 재현
   - `admin/123456`은 로그인 가능하나( `storeId:1` ), `store 4 owner` 계정/컨텍스트가 DB/인증 흐름에서 재현되지 않음
2. 멀티테넌트 fixture 기반 교차 조회 데이터셋(상호 이질적 storeId=1/4 테스트 데이터)
   - 런타임 DB가 store_id 기반 스키마와 어긋나 `/api/orders`, `/api/customers`, `/api/repairs`가 `Unknown column` 에러로 조기 종료됨

## 4) 사용한 fixture

- 테스트 전용 라인 사용자 ID(`TESTLINE_A6`, `TESTLINE_A7`, `TESTLINE_A3~A6` 등)로 `/api/line-order/customer`, `/api/line-repair/customer` 호출
- 테스트 규칙 준수: 임시 데이터 ID/값에 `TEST` 접두 사용

## 5) 현재 blocker (최우선)

1. `/store 4 owner`용 인증/권한 컨텍스트가 멀티스토어 구조에서 재현되지 않음(실패의 주된 blocker)
2. 주요 엔티티의 멀티테넌시 키 미적용/미존재(`o.store_id`, `c.store_id` 등)로 tenant 분기/격리가 깨짐 가능
3. `/api/line-order`, `/api/line-repair`는 현재 invalid store에서 404로 차단되지만, storeId 기반 교차 접근 검증을 위한 멀티스토어 사용자 컨텍스트가 없어 심층 검증 미완료
4. 구매확인서 public 라우트는 store parameter 조작에 대해 현재 `FAKECODE` 차단은 확인됨
5. `/files` 정적 경로와 `manual` PDF 라우트가 인증/권한 검증 없이 노출

## 6) 출시 전 반드시 고쳐야 할 항목

- 멀티테넌시 스키마 정합성(실행 DB에 `stores`, `store_id` 기반 컬럼/조인, `platform admin`/`saas-admin` 라우트와 인증 컨텍스트 정합성)
- `/api/store-features/me` 및 `saas-admin` 계열의 role/policy 정합성 정비(현재 `401` 발생 구간)
- `/files` 정적 노출 최소화 및 PDF 접근용 짧은 만료 토큰/권한 기반 라우팅 강화
- 주문/고객/수리/설정 조회 엔드포인트의 store scope 필수화
- `store 4` 토큰 발급 및 fixture 계정(OWNER) 운영 채널 안정화

## 7) 다음 구현 1순위

1) 런타임 라우트와 DB 스키마를 `docs/SAAS_STORE_ID_ROUTE_ENFORCEMENT_PLAN.md` 기준으로 정합시켜 `storeId` 경로/권한 경계를 복원하고, 동일 DB 환경에서 멀티테넌트 회귀 시나리오를 `store 1` vs `store 4`로 바로 실행 가능하게 만드는 것입니다.

## 8) 비고

- 본 점검에서 `purchase-confirm`, `line-order`, `line-repair`의 invalid store 경로는 404로 차단되며, 현재 핵심 미해결 이슈는 `store 4 owner` 및 멀티스토어 인증 컨텍스트 정합성입니다.
