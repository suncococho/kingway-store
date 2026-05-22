# Store Permission Model Design

## 1. 목적

이 문서는 KINGWAY multi-store SaaS 전환을 위한 store permission model 기준을 정의한다.

목적은 다음과 같다.

- multi-store 구조에서 `staff` / `store_admin` / `super_admin` 권한 기준 정의
- `store_id` 기반 데이터 접근 통제 기준 수립
- cross-store data leakage 방지

## 2. 기본 원칙

- `store_id` scope와 staff permission은 분리해서 설계한다.
- 일반 staff는 자기 store 데이터만 접근할 수 있다.
- `store_admin`은 자기 store를 관리할 수 있다.
- `super_admin`만 여러 store에 접근할 수 있다.
- backend permission check가 최종 기준이다.

`store_id` scope는 “어느 매장의 데이터인가”를 제한하고, staff permission은 “그 매장 안에서 어떤 행동을 할 수 있는가”를 제한한다.

## 3. 역할 정의

### super_admin

- 여러 store 접근 가능
- store switching 가능
- 전체 store 조회 가능
- global 설정 및 전체 운영 점검 가능

### store_admin

- 자기 store만 접근 가능
- 자기 store의 staff 관리 가능
- 자기 store의 주요 business data 관리 가능
- store settings 일부 변경 가능

### manager

- 자기 store만 접근 가능
- 주문, 수리, 고객, 재고 등 주요 업무 처리 가능
- staff 관리나 store settings 변경은 제한 가능

### staff

- 자기 store만 접근 가능
- 제한된 business action 가능
- 고객 응대, 주문 생성, 수리 접수 등 실무 중심 권한

### readonly / auditor

- 자기 store 또는 허용된 store의 데이터 조회 가능
- 수정, 삭제, 승인, 설정 변경 불가
- 감사 및 운영 확인 목적

## 4. 권한 매트릭스

| 기능 | super_admin | store_admin | manager | staff | readonly/auditor |
| --- | --- | --- | --- | --- | --- |
| 고객 조회 | 가능 | 자기 store 가능 | 자기 store 가능 | 자기 store 가능 | 자기 store 가능 |
| 고객 수정 | 가능 | 자기 store 가능 | 자기 store 가능 | 제한 가능 | 불가 |
| 주문 생성 | 가능 | 자기 store 가능 | 자기 store 가능 | 자기 store 가능 | 불가 |
| 주문 수정 | 가능 | 자기 store 가능 | 자기 store 가능 | 제한 가능 | 불가 |
| 주문 삭제 | 가능 | 자기 store 가능 | 제한 가능 | 불가 | 불가 |
| 수리 접수 | 가능 | 자기 store 가능 | 자기 store 가능 | 자기 store 가능 | 불가 |
| 수리 견적 처리 | 가능 | 자기 store 가능 | 자기 store 가능 | 제한 가능 | 불가 |
| 수리 완료 처리 | 가능 | 자기 store 가능 | 자기 store 가능 | 제한 가능 | 불가 |
| 상품/재고 수정 | 가능 | 자기 store 가능 | 자기 store 가능 | 제한 가능 | 불가 |
| 쿠폰 발급 | 가능 | 자기 store 가능 | 제한 가능 | 불가 또는 제한 가능 | 불가 |
| 쿠폰 승인 | 가능 | 자기 store 가능 | 제한 가능 | 불가 | 불가 |
| staff 관리 | 가능 | 자기 store 가능 | 불가 또는 제한 가능 | 불가 | 불가 |
| payroll/KPI 조회 | 가능 | 자기 store 가능 | 제한 가능 | 본인 또는 제한 가능 | 조회 가능 범위 제한 |
| store settings 변경 | 가능 | 자기 store 가능 | 불가 | 불가 | 불가 |
| LINE/Telegram 설정 관리 | 가능 | 자기 store 가능 | 불가 또는 제한 가능 | 불가 | 불가 |
| 전체 store 조회 | 가능 | 불가 | 불가 | 불가 | 제한된 감사 권한만 가능 |

세부 권한은 실제 route enforcement 단계에서 더 세분화할 수 있다. 단, 어떤 역할이든 `super_admin`이 아닌 경우 기본적으로 자기 store 밖의 데이터 접근은 불가하다.

## 5. Store Access Model

- `staff_users`에 기본 `store_id`를 연결한다.
- 여러 매장 접근이 필요한 경우 `staff_store_access` 별도 테이블을 후보로 둔다.
- `current_store_id`는 request context에서 확정한다.
- 일반 staff는 store switching이 불가하다.
- `super_admin`만 store switching이 가능하다.

권장 흐름:

1. staff가 로그인한다.
2. backend가 staff의 기본 store와 접근 가능한 store 목록을 확인한다.
3. request middleware가 `current_store_id`를 확정한다.
4. route는 `request.store_id`와 role permission을 함께 검증한다.

## 6. 테이블 설계 후보

### staff_users.store_id

기본 store를 단순하게 표현하는 필드다.

- 기존 staff가 어느 store 소속인지 표시
- single-store staff의 기본 scope로 사용
- multi-store 접근이 필요 없는 대부분의 staff에 적합

### staff_store_access

여러 store 접근 또는 store별 role 분리가 필요할 경우 사용할 수 있는 후보 테이블이다.

필드 후보:

- `id`
- `staff_id`
- `store_id`
- `role`
- `is_default`
- `created_at`
- `updated_at`

예상 용도:

- `super_admin` 또는 regional admin의 여러 store 접근
- 한 staff가 특정 store에서는 `manager`, 다른 store에서는 `readonly`인 경우
- store switching 가능 여부 판단
- 기본 store 결정

## 7. 인증/토큰 전략

- login 성공 후 accessible stores를 확인한다.
- token / session에 `role`과 `current_store_id`를 포함할 수 있다.
- backend middleware가 매 요청마다 권한을 검증한다.
- frontend에서 전달된 값만 신뢰하지 않는다.

토큰에 포함된 `store_id`는 편의상 사용할 수 있지만, 민감 작업에서는 backend가 DB 기준으로 staff-store relation을 재확인할 수 있어야 한다.

## 8. Middleware 개념

실행 코드는 이 문서에서 작성하지 않는다. 개념 기준은 다음과 같다.

### requireAuth()

- 로그인된 사용자 여부를 확인한다.
- staff identity와 role 정보를 request context에 제공한다.

### requireStoreScope()

- request 단위의 `current_store_id`를 확정한다.
- 사용자가 해당 store에 접근 가능한지 확인한다.
- route handler가 사용할 `request.store_id`를 제공한다.

### requireRole(role)

- 특정 role 이상 또는 특정 role만 허용할 때 사용한다.
- 예: `manager` 이상, `store_admin` 이상

### requireStoreAdmin()

- 현재 store에 대한 `store_admin` 권한을 확인한다.
- staff 관리, store settings, 민감한 store-level action에 적용한다.

### requireSuperAdmin()

- `super_admin` 전용 작업에 적용한다.
- 전체 store 조회, store switching, global 설정에 사용한다.

## 9. 위험 사항

multi-store permission 설계에서 다음 항목은 BLOCKER 수준으로 관리해야 한다.

- staff 권한과 store scope 혼동
- `super_admin` 권한 남용
- URL parameter `store_id` 신뢰
- frontend-only permission
- dashboard aggregate leakage
- webhook / callback 권한 누락

특히 `store_id`를 URL parameter나 request body에서 받는 경우, 그 값을 그대로 신뢰하면 cross-store 접근 취약점이 될 수 있다.

## 10. Staged Rollout

### Phase 1: permission 문서화

- 역할 정의 확정
- 권한 매트릭스 확정
- store scope와 staff permission의 책임 분리

### Phase 2: staff/store relation migration draft

- `staff_users.store_id` 적용 방안 작성
- `staff_store_access` 후보 설계
- dry-run 기준 정리

### Phase 3: auth token strategy

- login 후 accessible stores 확인 방식 정의
- token / session payload 기준 정의
- `current_store_id` 확정 방식 정의

### Phase 4: backend middleware

- `requireAuth()`
- `requireStoreScope()`
- `requireRole(role)`
- `requireStoreAdmin()`
- `requireSuperAdmin()`

### Phase 5: route-by-route enforcement

- high-risk route부터 적용
- customers / orders / products / repairs 우선
- dashboard, webhook, supplier callback 별도 점검

### Phase 6: staging cross-store test

- multi-store fixture 구성
- URL 변경 기반 접근 테스트
- dashboard aggregate leakage 테스트
- webhook / callback store mismatch 테스트

### Phase 7: production rollout 검토

- staging rehearsal 결과 확인
- BLOCKER 이슈 해소 확인
- production 적용 여부 최종 검토

## 11. 최종 원칙

- store isolation 실패는 BLOCKER다.
- backend permission이 최종 기준이다.
- production 적용 전 staging rehearsal은 필수다.
