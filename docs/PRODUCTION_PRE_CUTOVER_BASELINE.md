# Production Pre-Cutover Baseline

작성일: 2026-06-05  
목적: 최신 SaaS 코드를 production `5173/3000`으로 승격하기 전, 현재 production runtime baseline을 read-only로 기록

## 1. 범위

이번 확인에서 수행한 것:

- backend `3000` health 확인
- frontend `5173` 응답 확인
- 로그인 API 확인
- 현재 production runtime에서 동작하는 주요 API 확인
- 현재 repo code 기준 SaaS route 지원 범위 확인
- backup metadata 기준 production commit 과 현재 staging HEAD 차이 확인

이번 turn에서 하지 않은 것:

- code 수정
- DB write
- 배포
- LINE 발송
- production code 승격

## 2. Health 결과

### 2-1. Backend `3000`

`curl -i http://127.0.0.1:3000/health`

결과:

- HTTP `200 OK`
- body: `{"ok":true}`

판정:

- backend process 자체는 살아 있음

### 2-2. Frontend `5173`

`curl -i http://127.0.0.1:5173/`

결과:

- HTTP `200 OK`
- server: `nginx/1.27.5`
- HTML entry 응답 확인
- title: `Kingway Admin`
- asset references:
  - `/assets/index-AqzjoUEv.js`
  - `/assets/index-Bi9YBT4D.css`

판정:

- frontend static baseline 응답 정상
- 기능 smoke test까지 의미하지는 않음

## 3. 로그인 API baseline

확인 경로:

- `/api/login`
- `/api/auth/login`

결과:

- 둘 다 HTTP `500`
- sanitized error message:
  - `Unknown column 'store_id' in 'field list'`

추가 확인:

- production DB `staff_users`에는 `store_id` column이 없음

판정:

- 현재 production runtime의 login flow는 깨져 있음
- 테스트 계정으로 `200` 확인 실패
- 이것만으로도 cutover 전 핵심 blocker다

## 4. 현재 production에서 동작하는 API

주의:

- login API가 깨져 있어 정상 사용자 로그인으로 token을 획득할 수 없었다.
- 따라서 protected route 존재 여부 확인은 read-only 목적의 short-lived internal JWT로 수행했다.
- raw token / raw password는 출력하지 않았다.

### 4-1. 정상 응답 API

- `/api/products` -> `200`
  - array length `385`
- `/api/orders` -> `200`
  - array length `92`
- `/api/repairs` -> `200`
  - array length `28`
- `/api/purchase-confirmations` -> `200`
  - array length `21`

### 4-2. 실패 API

- `/api/dashboard/summary` -> `500`
  - message: `Unknown column 'store_id' in 'where clause'`
- `/api/system/saas-status` -> `404`
- `/api/store/settings` -> `404`
- `/api/store/settings/line` -> `404`
- `/api/store-features` -> `404`
- `/api/saas-admin/stores` -> `404`
- `/api/platform-auth/me` -> `404`

판정:

- core business API 일부는 동작
- SaaS 및 store-scoped baseline API는 runtime에서 미노출 또는 미동작 상태

## 5. SaaS Route 지원 여부

### 5-1. Repo code 기준

현재 repo code에서는 아래 요소가 존재한다.

- store-scoped auth
  - `backend/src/middleware/auth.js`
  - `requireStoreScope`, `requireStoreRole`
- store settings
  - `app.use("/api/store", storeSettingsRoutes)`
- line settings
  - `GET /api/store/settings/line` route source 존재
- platform admin
  - `app.use("/api/platform-auth", platformAuthRoutes)`
  - `app.use("/api/saas-admin", saasAdminRoutes)`
- store features
  - `app.use("/api/store-features", storeFeatureRoutes)`
- system saas status
  - `GET /api/system/saas-status` route source 존재

### 5-2. Runtime 기준

실제 production `3000` runtime에서는:

- login API `500`
- `/api/system/saas-status` `404`
- `/api/store/settings` `404`
- `/api/store/settings/line` `404`
- `/api/store-features` `404`
- `/api/platform-auth/me` `404`
- `/api/saas-admin/stores` `404`

판정:

- codebase에는 SaaS route가 존재
- 그러나 현재 production runtime baseline은 그 route surface를 실제로 제공하지 못하고 있음
- 즉, runtime과 filesystem code/expected route surface 사이에 불일치가 있다

## 6. Production / Staging 차이 요약

### 6-1. Commit 기준

- backup metadata 기준 production commit:
  - `fee7ab5c9048e5213c0ff17b8e85e3f4c7c013b5`
- 현재 staging HEAD:
  - `24dfc990465177c1760c91d31d5580aba25c5031`

### 6-2. Repo diff 기준

위 두 commit 사이 backend/frontend diff 통계는 작다.

변경 확인 파일:

- `backend/src/routes/lineRepair.js`
- `backend/src/routes/repairs.js`
- `backend/src/services/lineWorkflowService.js`
- `backend/src/services/staffLineNotify.js`

즉, backup metadata 기준으로는 이미 SaaS route mount가 code에 들어와 있었다.

### 6-3. Runtime 차이 해석

중요한 점:

- backup commit의 `backend/src/app.js`에도 이미 아래 route mount가 있다.
  - `/api/store`
  - `/api/system`
  - `/api/platform-auth`
  - `/api/saas-admin`
  - `/api/store-features`
  - `/api/auth`
- 그런데 실제 production `3000` runtime에서는 이들 SaaS route가 `404`다.

따라서 추론:

- 현재 production process는 repo working tree 또는 backup metadata commit과 완전히 일치하지 않을 가능성이 높다.
- 즉, 단순히 “git diff가 작다”는 이유로 승격 readiness를 판단하면 안 된다.

## 7. 현재 production에 없는 핵심 SaaS route

runtime 기준 미지원/실패 상태:

- `/api/system/saas-status`
- `/api/store/settings`
- `/api/store/settings/line`
- `/api/store-features`
- `/api/platform-auth/me`
- `/api/saas-admin/stores`
- 정상 login flow 자체
- `dashboard/summary`의 store_id scoped query

## 8. 승격 필요 여부

- `필요`

이유:

1. 현재 production baseline은 login이 깨져 있다
2. dashboard summary가 `500`이다
3. SaaS/store-scoped route가 runtime에 노출되지 않는다
4. codebase에는 해당 SaaS surface가 존재하지만, live runtime은 그 상태와 불일치하다

## 9. 승격 전 Blocker

핵심 blocker:

1. login API `500`
   - `staff_users.store_id` schema mismatch 추정
2. `/api/dashboard/summary` `500`
   - `store_id` scoped query와 runtime schema mismatch
3. SaaS route runtime `404`
   - `/api/system/saas-status`
   - `/api/store/settings`
   - `/api/store/settings/line`
   - `/api/store-features`
   - `/api/platform-auth/me`
   - `/api/saas-admin/stores`
4. runtime과 repo/backup commit baseline 불일치
5. frontend는 HTML 응답만 확인됐을 뿐, operator UAT / smoke test가 아직 없다

## 10. 결론

현재 production `5173/3000` baseline은 “일부 legacy business API는 응답하지만, SaaS cutover 기준으로는 미완성” 상태다.

요약:

1. `3000` health는 정상
2. `5173` entry 응답은 정상
3. login은 실패
4. core API 일부는 응답
5. SaaS route는 runtime에서 `404` 또는 `500`
6. production code 승격 전에는 schema/runtime mismatch와 route exposure mismatch를 먼저 해소해야 한다
