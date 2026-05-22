# Store ID API Scope Strategy

## 1. 목적

이 문서는 KINGWAY 매장관리시스템을 multi-store 구조로 확장하기 위한 API scope 기준을 정의한다.

목적은 다음과 같다.

- multi-store 환경에서 cross-store data leakage 방지
- request 단위로 store scope 확정
- backend API와 frontend UI의 store isolation 기준 정의

## 2. 기본 원칙

- code is shared
- data is scoped by `store_id`
- 모든 business query는 `store_id` 기준으로 제한한다.
- UI 숨김만으로 보안 처리를 하지 않는다.
- backend API scope가 최종 보안 기준이다.

즉, frontend에서 메뉴나 버튼을 숨기더라도 backend API가 `store_id`를 기준으로 데이터를 제한하지 않으면 보안상 실패로 간주한다.

## 3. Request Store Context 전략

로그인 이후 모든 request는 명확한 store context를 가져야 한다.

- 로그인 후 request context에 `store_id`를 포함한다.
- JWT / session / token에 `store_id`를 포함할 수 있다.
- request middleware에서 최종 `store_id`를 확정한다.
- backend route는 직접 임의 store 값을 신뢰하지 않고 `request.store_id`를 사용한다.

권장 흐름:

1. 사용자가 로그인한다.
2. 인증 정보에서 접근 가능한 store 목록과 현재 store를 확인한다.
3. middleware가 request 단위로 `request.store_id`를 확정한다.
4. route query는 `request.store_id`를 사용해 scope를 적용한다.

## 4. 권한 모델

### super_admin

- 여러 store 접근 가능
- store switching 가능
- 전체 store 관리 및 점검 가능

### store_admin

- 자기 store만 접근 가능
- 해당 store의 staff 관리 가능
- 해당 store의 business data 관리 가능

### staff

- 자기 store만 접근 가능
- 제한된 business action 가능
- 권한이 없는 관리 작업은 backend에서 차단

## 5. API Scope 원칙

모든 business query에는 `store_id` 조건을 포함해야 한다.

적용 대상:

- `SELECT`
- `UPDATE`
- `DELETE`
- `JOIN`
- `COUNT`
- `SUM`
- dashboard query

예시:

```sql
SELECT *
FROM orders
WHERE store_id = ?;
```

```sql
UPDATE products
SET stock = stock - 1
WHERE id = ?
  AND store_id = ?;
```

`id`가 unique key처럼 보이더라도 multi-store 환경에서는 `store_id` 조건을 함께 적용하는 것을 기본 원칙으로 한다.

## 6. Dashboard Scope

dashboard aggregate query는 cross-store leakage 위험이 높다.

다음 집계는 모두 `store_id` 기준으로 제한해야 한다.

- 매출
- 수리
- 고객 수
- 재고 수량
- KPI
- payroll
- supplier statistics

예시 기준:

- total sales는 현재 store의 주문만 집계한다.
- customer count는 현재 store의 고객만 집계한다.
- repair count는 현재 store의 수리 주문만 집계한다.
- supplier statistics도 현재 store 기준으로 집계한다.

## 7. LINE / Telegram 전략

LINE-first architecture를 유지하되, webhook과 callback도 store scope를 가져야 한다.

- LINE webhook request에 store mapping이 필요하다.
- Telegram callback도 `store_id` 확인이 필요하다.
- store별 credential 분리를 권장한다.
- staging에서는 운영 credential 사용을 금지한다.

권장 방향:

- LINE channel / rich menu / webhook endpoint 또는 credential 기준으로 store를 식별한다.
- callback payload에 포함된 id만 신뢰하지 않는다.
- callback 처리 시 대상 customer / order / repair / supplier record가 같은 `store_id`에 속하는지 확인한다.

## 8. Frontend 전략

frontend는 현재 store context를 명확히 표시해야 한다.

- 현재 store 표시
- 잘못된 store 접근 시 redirect
- API 실패 시 permission error 표시
- URL만 바꿔도 다른 store 접근이 불가능해야 함

frontend store switching은 권한 모델과 backend 검증을 통과해야 한다.

UI에서 store selector를 제공하더라도 실제 데이터 접근 가능 여부는 backend API가 최종 판단한다.

## 9. Middleware 전략 초안

실행 코드는 이 문서에서 작성하지 않는다. 개념 기준은 다음과 같다.

### requireStoreScope()

- 인증된 request에서 현재 `store_id`를 확정한다.
- route handler가 사용할 `request.store_id`를 제공한다.
- store scope가 없거나 불명확하면 request를 거부한다.

### requireStoreAdmin()

- 현재 request의 사용자가 해당 store의 admin 권한을 갖는지 확인한다.
- staff 관리, store 설정, 민감한 운영 작업에 적용한다.

### requireSuperAdmin()

- super_admin 전용 작업에 적용한다.
- store switching, 전체 store 점검, global admin 작업에 사용한다.

## 10. 위험 사항

multi-store 전환 시 다음 항목은 BLOCKER 수준으로 관리해야 한다.

- `store_id` 없는 query
- admin privilege escalation
- dashboard aggregate leakage
- JOIN 시 `store_id` 누락
- websocket / realtime leakage
- cache leakage
- background job leakage

특히 aggregate query와 background job은 단일 row 조회보다 leakage를 발견하기 어려우므로 별도 audit이 필요하다.

## 11. Staged Rollout

### Phase 1: request context

- 인증 이후 request 단위 store context 확정
- `request.store_id` 기준 정의
- 권한별 store 접근 모델 정리

### Phase 2: route-by-route scope

- high-risk route부터 `store_id` scope 적용
- customers / orders / products / repairs 우선
- `SELECT`, `UPDATE`, `DELETE`, `JOIN` 모두 점검

### Phase 3: dashboard scope

- dashboard `COUNT`, `SUM`, KPI, payroll, supplier statistics 집계에 scope 적용
- aggregate leakage 테스트 추가

### Phase 4: webhook scope

- LINE webhook store mapping 적용
- Telegram callback store 확인 적용
- staging credential과 production credential 분리

### Phase 5: UI scope

- 현재 store 표시
- 잘못된 store 접근 redirect
- permission error UX 정리
- URL 변경 기반 우회 접근 차단 확인

### Phase 6: production rehearsal

- staging 환경에서 production-like rehearsal 수행
- multi-store fixture로 cross-store 접근 테스트
- query audit 재실행
- BLOCKER 해소 후 production rollout 검토

## 12. 최종 원칙

- backend scope가 최종 보안 기준이다.
- production rollout 전 staging rehearsal은 필수다.
- store isolation 실패는 BLOCKER다.
