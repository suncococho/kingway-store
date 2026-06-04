# SaaS v1 운영 회귀 실행 Runbook (10~15분 실행형)

작성일: 2026-06-04  
브랜치: `beta/staging-architecture`  
목표: 운영자가 SaaS v1 핵심 상태를 빠르게 확인해 데모/운영 전환 판단용 근거를 남김

## 1) 목적

- `docs/SAAS_V1_FINAL_LAUNCH_CHECKLIST.md`의 staging 가용 조건,  
  `docs/SAAS_V1_REHEARSAL_FINAL_REPORT.md`의 실제 검증 결과,  
  `docs/SAAS_V1_PUBLIC_FLOW_EXCEPTION_TESTS.md`의 예외 시나리오를 근거로  
  운영자가 10~15분 안에 수동 회귀 점검을 수행할 수 있게 한다.
- 코드 수정/DB 변경/배포를 하지 않고, **read-only + 최소 생성** 수준(필요 시 기존 테스트 데이터 활용)으로 진행한다.
- 실제 LINE 메시지는 발송하지 않는다.

## 2) 실행 전 조건

1. 실행 환경 고정
- 백엔드: `http://127.0.0.1:3010`
- DB: `127.0.0.1:3310` (staging restore DB 가정)
- 프론트엔드: 운영 배포 화면이 아닌 staging 화면 기준
- production 도메인/웹훅/토큰을 호출하지 않음

2. 필수 준비
- 플랫폼 admin 계정 JWT (`/api/login` 또는 `/api/platform-auth/login` 결과)
- store owner 계정 JWT (재현 매장: store 5)
- `curl` + `jq` 또는 Postman/newman 등 API 호출 도구
- 로그 접근 권한: backend 실행 로그 확인 가능

3. 사전 금지 규칙
- `DROP/TRUNCATE/DELETE` 사용 금지
- production `LINE OA` 설정/웹훅/토큰 변경 금지
- `real LINE` 발송 금지 (staging에서 발송 억제 플래그 유지)

4. 기준 시트
- `store 1`: 기준 기준점(legacy/KINGWAY_TAINAN)
- `store 5`: 리허설 매장(코드 `KW_REHEARSAL_202606`)

## 3) 점검 순서

### 3.1 health

1) 서버 기동성
- `GET /api/health` 또는 `GET /health` 호출
- 응답 200 + 기본 상태값/버전 정보 확인

2) 스토어/기능 문맥
- 플랫폼 admin 토큰으로 `GET /api/saas-admin/stores/:id` (임의 점포)
- store owner 토큰으로 `GET /api/store-features/me`(또는 유사 endpoint)로 현재 기능 플래그 확인

### 3.2 saas-status

1) store list 정합
- 플랫폼 admin: `GET /api/saas-admin/stores`
- 필수 점검:
  - store 1, store 5가 조회되는지
  - store 5가 기존 상태와 일치(브랜치 기준)

2) store_features 정합
- `GET /api/saas-admin/stores/5/features`
- `plan=trial/free/premium` 전환 정책과 현재 상태가 기대 범위인지 기록
- 가능하면 플랫폼 admin으로 `PATCH` 변경 없이 조회만 수행 후 복구 부담 없는 상태 유지

### 3.3 platform admin login

1) 인증 확인
- `POST /api/platform-auth/login` (platform admin)
- 또는 `POST /api/login` (운영상 실제 사용 경로)

2) 확인 항목
- 토큰 발급 여부 및 만료 시간
- 권한 없는 경로 접근 시 401/403
- 스코프 관련 필수 API가 admin 권한으로 접근되는지 spot check

### 3.4 store owner login

1) owner 인증
- `POST /api/login` (rehearsal owner: `kw_rehearsal_owner` 테스트 계정)

2) owner 권한 점검
- `GET /api/store/settings` 200
- `GET /api/store/settings/line` 200
- 불일치/오류가 있으면 즉시 중단하여 재인증/계정 상태 확인

### 3.5 store settings

1) 조회/반영
- owner 토큰으로 `GET /api/store/settings`
- 수정 없이 재조회 반복

2) 기본 점검
- store name, 연락처, 영업시간, 영수증명칭 등 기본 값 정상 렌더링
- 다른 store 코드/ID로 직접 변경 API가 허용되지 않는지 확인(차단 응답 기대)

### 3.6 line settings

1) 조회
- owner 토큰: `GET /api/store/settings/line`

2) 검증
- `channelId`, `webhook_path` 존재/형식 확인
- 마스킹 응답 확인 (`****` 또는 masked label)
- `GET /api/line/settings` 같은 공개 경로 사용은 현재 가이드 기준 확인만 수행(필요 시 생략)

3) webhook 힌트 확인
- `webhook_path`에 포함된 token route 포맷 유지 확인
- legacy `/api/line/webhook`과 tokenized 경로 비교(조회만)

### 3.7 product image

1) 목록/범위
- owner token: `GET /api/products` (store 5)
- 교차 호출: store 1 토큰으로 `GET /api/products/765` 또는 샘플 store5 product id

2) 직접 접근 차단
- `GET /files/products/<known-file>` 기대 404
- 가능하면 `GET /api/products/:id/image` + owner token 사용 시:
  - 같은 store: 이미지 또는 404(파일 미존재) 허용
  - 타 store: 403/404

### 3.8 orders

1) 목록/상세
- owner token: `GET /api/orders`
- 가능한 경우 주문 상세 1건 조회

2) cross-check
- store 1 owner로 store 5 주문 id 접근 시 404/403
- store 5 owner로 타 store 주문 id 접근 시 404/403

3) 수치 확인
- 주문 상태 분포(최소 1개 필드)와 최근 변경 시간/응답코드 패턴만 기록

### 3.9 repairs

1) 목록/상세
- owner token: `GET /api/repairs`
- 상태변경 route는 현재 운영 전환 전이므로 조회 위주 실행

2) 상태 변경 점검(문자열 경로)
- `POST /api/repairs/:id/reject|complete|pickup`은 사전 준비된 rehearsal 데이터에서만, 필요 시 **1건씩** 수행
- 성공/실패 모두 200/403/404 중 정책상 정합한 값인지 기록

3) line 흐름
- `GET /api/line-repair/customer` 유효 store, invalid store, no store 조합 점검

### 3.10 purchase-confirm

1) token path 기본
- `GET /api/purchase-confirmations/public/:token` (store 5의 유효 토큰)
- `POST /api/purchase-confirmations/public/:token` 유효 시나리오
- `GET /api/purchase-confirmations/public/:token/pdf`

2) mismatch 점검
- wrong store param (`store=INVALID`) → 404 기대
- correct store param → 200 기대

3) 상태 정책
- token 소유권 mismatch가 store mismatch와 분리되어 처리되는지 확인

### 3.11 coupons

1) 정책 토글 기반 점검
- store 5 plan FREE 상태: `GET /api/coupons` → 403 기대
- plan PREMIUM 상태: `GET /api/coupons` → 200 기대

2) 저장소 격리
- store 1 토큰으로 store 5 coupon 접근 시 403/404
- store 5 토큰으로 store 1 coupon 접근 시 403/404

3) 예외 케이스
- invalid id(예: `/api/coupons/999999`) 처리: 404 또는 명시적 실패 메시지

## 4) PASS 기준

- health/인증 엔드포인트가 200~401 규칙에 맞게 동작
- platform admin과 owner 로그인 모두 성공하고 권한 불일치 경로가 차단
- store settings/line settings가 같은 매장 내에서 일관 조회되며 민감 정보 노출 없음
- product image direct path 차단(404/차단 응답), gated route는 store 일치 시 200 또는 파일없음(404)
- orders/repairs/purchase-confirm/coupons가 `store 1`/`store 5`로 분기되어 교차 침투 없음
- public flow가 예외 문서 규칙대로 동작:
  - 유효 store + token은 성공
  - invalid store는 차단
  - body 조작 storeId는 무시
- `actual LINE OA` outbound 로그가 없어야 함(또는 staging에서 suppressed/disabled 표기)

## 5) FAIL 기준

- 인증되지 않은 경로 200 응답, 또는 권한 없는 유저가 고위험 API 조회 가능
- store scope가 깨져 타 store 데이터가 노출
- public flow에서 store 파라미터만으로 정책이 바뀌거나 token mismatch 노출
- `LINE webhook` 또는 `LINE token` 관련 테스트 중 실제 발송/외부 API 호출 징후
- products/files/coupons 경로에서 직접 노출(403/404가 아닌 200)
- 반복 실행 시 에러율 증가(500, 403/404 패턴 비정상 증가)

## 6) 교차침투 확인 항목

다음 6개 조합은 각 1회씩 최소 실행한다.

1. store 1 owner token → store 5 orders list/detail 호출
2. store 1 owner token → store 5 products detail 또는 image 호출
3. store 5 owner token → store 1 purchase-confirm public token 접근
4. store 5 owner token → store 1 repair list 접근
5. store 1 owner token → store 5 coupons 호출
6. store 5 owner token → store 1 direct coupon id 호출

교차침투가 1건이라도 발생하면 즉시 rollback 판단으로 넘어간다.

## 7) 공개 flow 확인 항목

1. line-order
- `GET /api/line-order/customer`
- valid store / invalid store / no store
- query param `store`만으로 동작이 바뀌는지 확인

2. line-repair
- `GET /api/line-repair/customer`, `POST /api/line-repair/create`
- valid store / invalid store / no store / body storeId 조작값 무시

3. purchase-confirm
- `GET /api/purchase-confirmations/public/:token`
- `?store=<valid>` / `?store=<invalid>` / no store 비교

4. product image
- `/files/products/*` 직접 호출(차단)
- `/api/products/:id/image` 게이트 호출(권한/store 일치)

## 8) 로그 확인 위치

- backend 애플리케이션 로그
  - tokenized webhook 처리, route decision, suppress/blocked 이벤트
- staging backend container 로그
  - `docker logs <backend-container>`
- 웹/네트워크 로그
  - 요청 URL/Status 분포(200,401,403,404,500), 실패 케이스 시 응답 본문 메시지
- 설정/비정상 알림
- 운영적으로 raw secret/token, 사용자 credential 평문이 로그에 없는지 spot check

## 9) rollback 판단 기준

다음 중 1개라도 발생하면 즉시 시행:

1. 교차침투 1건 이상 검출
2. public flow에서 invalid store가 200으로 통과
3. 핵심 API 연쇄(orders/repairs/purchase-confirm/coupons/제품 이미지)에서 의도치 않은 500 급증
4. staging이 아닌 production endpoint로 트래픽 전환 징후
5. LINE 발송 의심 로그 출현(`api.line.me` outbound 등)

rollback 조치:
- 운영 확장 항목 중 실행된 항목을 되돌리고, tokenized/추가 기능 플래그를 보수적으로 유지
- platform admin에서 상태 변경(예: store_features) 시 즉시 이전값 복원
- 문제 흐름만 재현성 확보 후 재실행

## 10) 운영 승인 체크리스트

- [ ] 플랫폼 admin/admin-to-owner 플로우 정상
- [ ] store 1/5 기본 설정 및 line settings 검증 완료
- [ ] 제품/주문/수리/구매확인/쿠폰에서 타 store 차단(403/404) 확인
- [ ] public flow 예외 케이스(예: invalid store, wrong token/store mismatch) 모두 PASS
- [ ] `/files/products/*` 직접 접근 차단 + gated route 정상
- [ ] DB destructive 변경 없음, 라인 발송 없음 확인
- [ ] 로그 근거(요청/응답 코드, 로그 키워드) 저장

## 11) 예상 소요 시간

### 기본 실행 (읽기 위주)
- 10~15분

### 보강 실행 (교차침투 + public flow 전면)
- 15~25분

운영 회귀 일일/릴리즈 전에는 기본 실행을 우선하고, 이슈 의심 시 보강 실행만 수행한다.

## 11-1) Smoke Script 실행법

- 스크립트 경로: `scripts/regression/multitenant-smoke.sh`
- 기본 실행:

```bash
BASE_URL=http://127.0.0.1:3010 bash scripts/regression/multitenant-smoke.sh
```

- owner 계정 포함 실행:

```bash
BASE_URL=http://127.0.0.1:3010 \
STORE1_USERNAME=... \
STORE1_PASSWORD=... \
STORE5_USERNAME=... \
STORE5_PASSWORD=... \
bash scripts/regression/multitenant-smoke.sh
```

- 옵션 env
  - `PRODUCT_IMAGE_DIRECT_PATH=/files/products/<known-file>`: direct file 차단 확인용 샘플 경로
  - `STORE5_PRODUCT_ID=<id>`: gated product image cross-store 차단 확인용
  - `RUN_COUPON_CHECKS=true`: 쿠폰 상태 점검 활성화
  - `STORE5_EXPECT_COUPONS_STATUS=403|200`: 쿠폰 기대 상태코드 지정

- 출력 규칙
  - 각 항목은 `PASS` / `FAIL` / `SKIP`
  - 마지막 줄에 `Summary: PASS=n FAIL=n SKIP=n`
  - raw token/secret, 비밀번호는 출력하지 않음

- exit code
  - `FAIL` 1건 이상이면 `1`
  - `PASS`와 `SKIP`만 있으면 `0`
  - 계정 env 미입력 항목은 `SKIP`

## 12) release sign-off 항목

- [ ] 마지막 실행 24시간 내 PASS 비율 95% 이상(500은 긴급 조치 대상)
- [ ] cross-store 침투 0건
- [ ] 예외 public flow 테스트 모두 PASS
- [ ] LINE 발송 금지 조건 지속 준수(테스트 로그에 outbound 없음)
- [ ] owner onboarding/SOP 적용 전제 충족(비밀번호 교체/권한 안내/접근 검증 완료)
- [ ] blocker 항목(`production migration`, 자동회귀 잔여, `/files` 전면 보안 이슈) 별도 이슈 등록 후 관리
- [ ] 운영 승인자 승인 서명(날짜/시간/실행자) 기록

> Release sign-off는 위 항목 모두 체크 후, `docs/SAAS_V1_FINAL_LAUNCH_CHECKLIST.md`의 `production ready`/`launch ready` 판단과 함께 수행한다.
