# SaaS v1 Public Flow Exception Tests (coupon/line/purchase-confirm/product image)

작성일: 2026-06-04  
브랜치: `beta/staging-architecture`
기준 문서:
- `docs/PUBLIC_FLOW_STORE_PARAMETER_POLICY.md`
- `docs/SAAS_V1_REHEARSAL_FINAL_REPORT.md`
- `docs/SAAS_V1_FINAL_LAUNCH_CHECKLIST.md`
- `docs/FILES_ACCESS_CONTROL_RECHECK.md`

## 1. 테스트 목적

- `coupon`, `line-order`, `line-repair`, `purchase-confirm` 공개 flow에서 스토어 경계/권한/예외 동작이 의도대로 동작하는지 회귀 확인.
- FREE/PREMIUM 기능 토글, store 파라미터 mismatch, token 소유권 mismatch, cross-store 직접 ID 접근, 공개 파일 경로 우회 가능성을 조기에 탐지.
- `node` 코드의 실제 미들웨어 동작(`requireStoreFeature`, `resolvePublicStoreContext`, `assertPurchaseConfirmationStoreMatch`) 기준으로 실패 조건을 고정.

## 2. coupon 예외 케이스

- 대상: `GET /api/coupons`
- 기본 가정
  - staff/admin JWT `Authorization: Bearer ...` 필요
  - `requireStoreScope` + `requireStoreFeature("coupons_enabled")` 적용
- 케이스
  - `FREE`에서 GET /api/coupons
    - `stores.plan = free`
    - 기대: `403`
  - `PREMIUM`에서 GET /api/coupons
    - `stores.plan = premium`
    - 기대: `200` (JSON 배열)
  - store 1 coupon 이 store 5에 노출되지 않음
    - store 1 staff token으로 `GET /api/coupons`
    - 기대: store 1 데이터만 노출, store 5 coupon id 미포함
    - 반대 방향( store 5 token )도 동일 확인
  - invalid coupon id 접근
    - `POST /api/coupons/:id/cancel` with non-existing id (예: `/api/coupons/999999/cancel`)
    - 기대: `404` (`找不到優惠券`)
  - cross-store coupon id 접근
    - store A staff token으로 store B의 유효 id 취득 후 `/api/coupons/<B_ID>/cancel`
    - 기대: `404` (`找不到優惠券`)

## 3. line-order 예외 케이스

- 대상: `GET /api/line-order/customer`, `GET /api/line-order/ebikes`, `POST /api/line-order/create`
- store 파라미터 정책 근거: `getRequestedStoreCode`로 `store`/`storeCode`/`store_code`만 resolver 힌트로 사용, `req.body.storeId` 미사용
- 케이스
  - valid store
    - 요청: `?store=KW_REHEARSAL_202606`
    - 기대: 200, `line-order`가 해당 store 스코프로 동작
  - invalid store
    - 요청: `?store=INVALID`
    - 기대: `404 { message: "找不到有效的門市代碼" }`
  - no store legacy
    - 요청: store 파라미터 없이 호출
    - 기대: resolver fallback 결과에 따라 `store_id=1` 기반 동작(legacy 호환)
  - body storeId 조작 무시
    - 요청 body에 `storeId=5` 또는 임의의 값 포함 + 다른/없음 storeCode
    - 기대: `storeId` body는 무시되고, `store` 쿼리나 legacy 동작만 적용되어 라우트가 바뀌지 않음

## 4. line-repair 예외 케이스

- 대상: `GET /api/line-repair/customer`, `POST /api/line-repair/create`
- resolver 동작 차이: store 미지정 시 LINE 채널/LIFF 맵 기반으로 `resolveLineWorkflowStoreContext` 사용(최종적으로 `req.publicStoreContext` 기반 fallback 동작 가능)
- 케이스
  - valid store
    - `GET /api/line-repair/customer?store=KW_REHEARSAL_202606&lineUserId=...`
    - `POST /api/line-repair/create` 동일 store 파라미터
    - 기대: store 5 스코프에서 정상 조회/생성
  - invalid store
    - `?store=INVALID`
    - 기대: `404 { message: "找不到有效的門市代碼" }`
  - no store legacy
    - store 파라미터 없이 `/api/line-repair/customer`/`/api/line-repair/create`
    - 기대: legacy 또는 resolver fallback로 store 1 또는 lineUserId 바인딩 경로 기반 동작(기존 호환 유지)
  - body storeId 조작 무시
    - `create` body에 `storeId` 조작값 포함
    - 기대: `storeId`는 resolver/lineUserId 기반 store 결정에 영향 없음

## 5. purchase-confirm 예외 케이스

- 대상: `GET /api/purchase-confirmations/public/:token`, `POST /api/purchase-confirmations/public/:token`, `GET /api/purchase-confirmations/public/:token/pdf`
- 핵심 규칙: 공개 라우트는 token 소유권 우선, `store`는 추가 검사 힌트
- 케이스
  - valid token no store
    - `store` 미지정
    - GET/POST `/api/purchase-confirmations/public/:token`
    - 기대: token 소유 store에서 200
  - valid token matching store
    - token owner store와 일치 `store=KW_REHEARSAL_202606`
    - 기대: GET/POST 200
  - valid token wrong store
    - 같은 token + 다른 store 쿼리(예: store=STORE_1)
    - 기대: `404` (`找不到購買確認連結` 또는 store mismatch 흐름)
  - invalid store
    - `store=INVALID` + 유효 token
    - 기대: `404 { message: "找不到有效的門市資訊" }` 또는 `找不到購買確認連結` 규격
  - PDF matching/wrong store
    - Matching: `GET /api/purchase-confirmations/public/:token/pdf` 200/파일 응답
    - Wrong store: 동일 token + `store=wrong` 404

## 6. product image 예외 케이스

- 대상: `/files/products/*`, `/api/products/:id/image`
- 적용 근거: `backend/src/routes/products.js`에서 store 스코프 게이트 라우트(`/:id/image`) 추가 및 `/files/products/*` 직접 404 정책
- 케이스
  - `/files/products` 직접 차단
    - 예: `GET /files/products/<known-file>`
    - 기대: `404`
  - gated route same store
    - 인증된 staff token(store owner/admin)으로 `GET /api/products/:id/image`
    - 대상 상품이 파일을 보유하고 요청 store가 일치
    - 기대: 이미지 또는 `404`(파일 부재) 중 허용 범위
  - gated route cross store
    - store A token으로 store B 상품 id에 접근
    - 기대: `404 { message: "找不到商品" }`

## 7. PASS/FAIL 기준

- PASS
  - 모든 케이스가 위 규칙/예상 상태코드대로 동작
  - store 경계 밖 접근이 404/403으로 차단
  - `line`/`repair` 공개 라우트에서 `store` 파라미터는 힌트 이상으로 쓰이지 않음
  - `purchase-confirm` token mismatch가 store mismatch로 정확히 분리
  - product image가 `/files/products/*` 직접 접근 불가 및 `store` 조건으로 `/api/products/:id/image` 분기
- FAIL
  - free에서 coupons 접근 200
  - 잘못된 store에서 유효 데이터 접근 200
  - body로 넣은 storeId가 스코프를 바꾸는 동작
  - purchase token mismatch 시 데이터 노출

## 8. 실행 순서

1. 환경 확인: `staging_restore` 또는 지정 테스트 환경
2. 스토어 준비: store 5(테스트), store 1(참조)
3. coupon 기능 토글 검증
   1. store 5 plan free → `/api/coupons`
   2. store 5 plan premium → `/api/coupons`
4. line-order 예외 케이스 실행
5. line-repair 예외 케이스 실행
6. purchase-confirm 토큰 수집 후 예외 케이스 실행
7. product image 예외 케이스 실행 (`/files/products`, `/api/products/:id/image`)
8. 실패 항목은 로그(요청/응답 본문/상태코드) 저장 후 원인 분류

## 9. 자동화 스크립트 후보

- `bash + curl + jq` 기반 회귀 스크립트
  - 토큰/plan/쿼리/상태코드를 csv 기반으로 반복 실행
  - 성공/실패 분기별 스냅샷 저장
- `postman/newman` 스크립트
  - 환경 변수(`store5`, `store1`, `tokenStore5Admin`, `tokenStore1Admin`) 기반 Collection으로 케이스 자동화
- `pytest + requests` 또는 `mocha` 통합 테스트
  - route별 계약 테스트로 메시지(404 body message)까지 assertions

## 10. launch blocker 판단 기준

- 아래 중 하나라도 실패 시 v1 pre-launch blocker로 판단
  - FREE에서 `/api/coupons` 미차단(200)
  - invalid store 요청에서 200/필터 누락
  - `line-order`, `line-repair`에서 store mismatch 접근 허용
  - `line`/`repair`에서 body `storeId`로 store 전환이 발생
  - purchase-confirm token mismatch에서 잘못된 store 데이터 노출
  - `/files/products/*` 직접 노출 재개
- PASS 조건 충족 시 문서화 항목 기준에 따라 다음 단계 자동화 리허설로 이행 가능
