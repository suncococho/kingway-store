# Repair 상태 변경/estimate postback store scope 감사

작성일: 2026-06-04
브랜치: `beta/staging-architecture`
범위: `backend/src/routes/repairs.js`, `backend/src/routes/lineRepair.js`, `backend/src/services/repairReservationService.js`, `backend/src/services/lineWorkflowService.js`

## 위험 route

1. `POST /api/repairs/:id/estimate`  
   - fixed (2026-06-04): route에서 `storeId`를 명시 전달하고, `sendRepairEstimateQuotation`/`getRepairOrderForQuotation`가 `repair_orders.id + repair_orders.store_id`를 함께 사용하도록 수정됨.
2. `POST /api/repairs/:id/customer-response`  
   - fixed (2026-06-04): route에서 `storeId`를 명시 전달하고, `applyRepairEstimateCustomerResponse` 내부 조회/갱신/linked order update가 `repair_orders.id + repair_orders.store_id` 및 `orders.id + orders.store_id`를 함께 사용하도록 수정됨.
3. `POST /api/repairs/:id/reject`  
   - fixed (2026-06-04): route 내부 `SELECT/UPDATE repair_orders`가 `id = ? AND store_id = ?`를 함께 사용하도록 수정됨.
4. `POST /api/repairs/:id/complete`  
   - fixed (2026-06-04): `repair_orders` 조회/상태 업데이트/`survey_id` 후처리 모두 `id = ? AND store_id = ?`를 함께 사용하도록 수정됨.
5. `POST /api/repairs/:id/pickup`  
   - fixed (2026-06-04): `repair_orders` 조회/픽업 업데이트와 연계 `orders` 업데이트 모두 `store_id` scope를 직접 조건화함.
6. LINE postback `repair_reservation_approve` / `repair_reservation_reject`  
   - `lineWorkflowService.js`에서 `resolveLineWorkflowStoreContext` 결과 기반으로 서비스 호출하지만, resolver는 staff/line-context로 추론할 때 다가맡음/중첩 매장인 경우 기본값 `1` 폴백이 가능.
7. LINE postback `repair_estimate_approve` / `repair_estimate_reject`  
   - fixed (2026-06-04): line postback/text/web 모두 `applyRepairEstimateCustomerResponse(..., { storeId })`를 명시 전달하도록 정리됨.
8. linked order 생성/수정 경로  
   - fixed (2026-06-04): `ensureRepairJobOrder` / `findLinkedRepairJobOrder` / `applyRepairEstimateCustomerResponse`가 explicit `storeId`를 요구하고, linked `orders` 생성 시 source repair의 `store_id`를 저장하며 update는 `orders.id + orders.store_id`를 함께 사용하도록 수정됨.
9. `WHERE id = ?`만 남아있는 update/delete/select  
   - `backend/src/routes/repairs.js`: `:id/reject`(update), `:id/complete`(select/update/survey link), `:id/pickup`(update), 일부 상태 조회 및 삭제 전처리(로그/서베이)는 id 단독.
   - `backend/src/services/lineWorkflowService.js`: `sendRepairEstimateQuotation`(update), `getRepairOrderForQuotation`(select), `notifyRepairCustomer`(select) 등.
10. customer join만 믿고 `repair_orders.store_id` 조건이 없는 경로  
    - `assertRepairBelongsToStore`는 `repair_orders`와 `customers` 조인으로 판별(`...INNER JOIN customers c ON ... c.store_id = ? AND ro.id = ?`),  
      그러나 이후 update/delete/insert/후속 조회에서 `ro.id = ?` 단독이 반복되어 의존성이 약함.

## 현재 store scope 방식

1. 라우트 공통 미들웨어: `authenticate + requireStoreScope + feature guard`.
2. 다수 경로에서 `assertRepairBelongsToStore(req.params.id, req.storeId)` 선검증.
3. 핵심 서비스(`repairReservationService`, `lineWorkflowService`)는 `store_id`를 옵션 파라미터로 받되 전달되지 않으면(`null`) 조건이 완화되는 형태.
4. LINE postback은 `line_user_id` / staff store / postback storeId를 조합해 `resolveLineWorkflowStoreContext`로 store를 추정.
5. `resolveLineWorkflowStoreContext`는 실패시 `store_id=1` legacy fallback까지 수행(보존성 정책 영향으로 위험도 상승).

## 약한 부분

- `applyRepairReservationDecision`/`applyRepairEstimateCustomerResponse`는 `scopedStoreId`가 null일 수 있어, 호출부 실수나 우회 시 `ro.id`/`line_customer` 탐색이 store 경계를 약화시킬 수 있음.
- `/api/repairs/:id/reject`, `/complete`, `/pickup`에서 `assert` 통과 후에도 최종 DML/SELECT가 id-only라서 “권한 경계가 데이터 경계와 분리”되는 구조.
- LINE postback에서 staff가 멀티스토어로 보이는 케이스 또는 fallback 1 상태에서 오작동 시 타 store mutation이 성립 가능한 추적 불가능 지점 존재.
- estimate 경로(`sendRepairEstimateQuotation`, `applyRepairEstimateCustomerResponse`)는 서비스 내부 store filter가 약함.
- 주문 연동 업데이트가 `repair_order_id` 또는 서브쿼리만으로 전파되어 tenant guard가 약함.

## 수정 필요 파일/함수

1. `backend/src/routes/repairs.js`
   - `sendRepairEstimateQuotation` 호출 지점 (`router.post("/:id/estimate")`)  
     - `storeId` 전달 추가.
   - `router.post("/:id/customer-response")`  
     - `applyRepairEstimateCustomerResponse(..., { storeId: req.storeId })` 전달.
   - `router.post("/:id/reject")`  
     - `UPDATE repair_orders ... WHERE id = ?`에 `store_id = ?` 추가.
   - `router.post("/:id/complete")`  
     - 상태 조회/select와 업데이트 모두 `store_id` 조건 추가.
   - `router.post("/:id/pickup")`  
     - `UPDATE repair_orders ... WHERE id = ?` 및 연계 `UPDATE orders ...`에 `store_id` 조건 추가.
   - `/:id/phone-notified` 등 일부 후속 조회도 동일 패턴 정리.

2. `backend/src/services/lineWorkflowService.js`
   - `getRepairOrderForQuotation(repairId, connection, storeId)` store filter 추가.
   - `sendRepairEstimateQuotation(..., storeId)` 내부에서 `getRepairOrderForQuotation`에 `storeId` 전달.
   - `applyRepairEstimateCustomerResponse(..., options)`가 null storeId로 호출되지 않도록 호출부 정렬(현재 line/web 모두 explicit 전달 유도).
   - `notifyRepairCustomer(repairId, text, storeId)` 도입 후 `WHERE ro.id = ? AND ro.store_id = ?` 보강(옵션: `customers` join).
   - `handleLinePostback`: `repair_reservation_*`, `repair_estimate_*`에서 `postbackStoreId`와 `staffStoreId` 불일치 시 거부.

3. `backend/src/services/repairReservationService.js`
   - `applyRepairReservationDecision(..., options)`에서 `options.storeId` 누락 시 안전 실패 옵션 고려(기본 null 허용 제거 또는 caller contract 명시).
   - 동일 계약을 docs 주석/타입 레벨로 고정.

4. `backend/src/routes/lineRepair.js`
   - 공개 store code 없음 시 `resolveLineWorkflowStoreContext` 반환이 store=1 폴백되는 경우를 경고/차단(기능 영향 검토).

## HIGH / MEDIUM / LOW

### HIGH
- `POST /api/repairs/:id/reject`, `/complete`, `/pickup`의 store 미기재 update/delete/after-update 연계.
- `sendRepairEstimateQuotation`에서 store scope 없이 `repair_orders` 직접 갱신.
- LINE postback에서 store 추론 실패/ambiguous/legacy fallback(특히 `storeId=1`)을 통해 cross-store 행위를 유도할 수 있는 점.
- `applyRepairEstimateCustomerResponse`/`sendRepairEstimateQuotation` 호출에서 storeId 누락이 가능한 구조.

### MEDIUM
- `/api/repairs/:id/customer-response`에서 `assert` 후 service에 store 미전달.
- `notifyRepairCustomer`, `getRepairOrderForQuotation`가 id-only 조회로 설계되어 있으나 현재는 제어흐름상 안전, 유지보수 시 위험 잔존.
- `resolveLineWorkflowStoreContext`에서 staff/line 기반 매장 추정 의존도가 높은 구조.

### LOW
- 이미 `assertRepairBelongsToStore`로 다단계 검증되지만, 내부 DML이 store_id를 중복 검증하지 않아 구조적 보강 필요.
- 주문 연동 `repair_orders.customer_id` 조인 기반 정합성은 정상 데이터에서는 안전.

## 안전한 수정 순서

1. **1단계: 라우트 DML/SELECT에서 `id` + `store_id` 동시 조건화**
   - `repairs.js`의 `/reject`, `/complete`, `/pickup` 및 연계 주문 업데이트(예: `orders`)를 우선 수정.

2. **2단계: estimate 서비스 체인에 store context 고정 주입**
   - `/estimate`, `/customer-response` route에서 `storeId`를 service로 전달하고, `lineWorkflowService`에 store-aware 버전 적용.

3. **3단계: 서비스 함수 contract 경직**
   - `applyRepairReservationDecision`, `applyRepairEstimateCustomerResponse`의 store 미전달 사용을 제한.
   - 라인 postback/웹 경로 call-site에서 모두 storeId를 명시하도록 정비.

4. **4단계: postback 안전성 강화**
   - `repair_reservation_*`/`repair_estimate_*`에서 `postbackStoreId`와 `staffStoreId` 불일치 시 즉시 차단 또는 경고.

5. **5단계: 회귀 테스트 반영**
   - store 1/5 교차 호출 스크립트에 `/repair` 상태 변경 + line postback 시나리오 및 타 store mutation 실패 검증을 추가.

## 테스트 계획

1. **교차 토큰 테스트**
   - store 1 owner token으로 store 5의 `/api/repairs/:id/estimate|customer-response|reject|complete|pickup` 호출 시 404/403 기대.
   - store 5 owner token으로 store 1 동일 호출 시 동일 기대.

2. **직접 id 조작 테스트**
   - 각 endpoint에서 상대 store에서 실제 존재하는 ID를 전달했을 때 타 store 노출/변경 없는지 검증.

3. **LINE postback 테스트(비실행 경로)**
   - `repair_reservation_*`, `repair_estimate_*` 데이터 payload의 `action id` 조합으로 타 store repair id와 storeId 조작 대응 확인.
   - `postbackStoreId` 없음/오류/일치불일치 모두 테스트.

4. **linked order 경로 테스트**
   - estimate approve → 주문 생성(`orders`) 연동, reject/complete/pickup 후 주문 상태 변경에서 store 일치 여부 확인.

5. **회귀 감사**
   - `docs/REPAIRS_ISOLATION_AUDIT.md`와 신규 `SAAS_MULTITENANT_REGRESSION_AUTOMATION_PLAN.md`의 교차침투 항목이 PASS인지 재검증.

## 다음 구현 1순위

`repairs.js`의 `complete`, `pickup`, `reject`를 포함한 상태 변경 DML에 `store_id`를 항상 동시조건으로 강제하고, `lineWorkflowService`의 estimate 처리 함수군(`getRepairOrderForQuotation`, `sendRepairEstimateQuotation`, `applyRepairEstimateCustomerResponse`)에 `storeId`를 필수 파라미터로 정규화하여 멀티테넌시 우회 지점을 제거하는 것입니다.

## 1차 수정 완료

- `backend/src/routes/repairs.js`
  - `POST /api/repairs/:id/reject`: `repair_orders` 조회/업데이트에 `store_id = req.storeId` 강제.
  - `POST /api/repairs/:id/complete`: 대상 조회, 상태 확인, 완수 업데이트, `survey_id` 연결 업데이트에 `store_id = req.storeId` 강제.
  - `POST /api/repairs/:id/pickup`: 대상 조회, 픽업 업데이트, 연계 `orders` 완료 처리에 `store_id = req.storeId` 강제.
- `assertRepairBelongsToStore`도 `repair_orders.store_id`를 직접 확인하도록 보강.
- `lineWorkflowService` estimate/customer-response 체인은 이번 단계에서 미수정.
  
## 2차 수정 완료

- `backend/src/routes/repairs.js`
  - `POST /api/repairs/:id/estimate`: `sendRepairEstimateQuotation(..., { storeId: req.storeId })` 전달.
  - `POST /api/repairs/:id/customer-response`: 상태 조회에 `store_id = req.storeId`를 추가하고 `applyRepairEstimateCustomerResponse(..., { storeId: req.storeId })` 전달.
- `backend/src/services/lineWorkflowService.js`
  - `getRepairOrderForQuotation`, `sendRepairEstimateQuotation`, `applyRepairEstimateCustomerResponse`, `findLinkedRepairJobOrder`, `ensureRepairJobOrder`에 explicit store scope 강제.
  - web/LINE text/LINE postback/staff LINE estimate wizard 모두 estimate/customer-response 호출 시 `storeId`를 명시 전달.
  - linked `orders` update는 `orders.id + orders.store_id`를 함께 사용.
- `backend/src/services/repairReservationService.js`
  - `notifyRepairCustomer`가 `repair_orders.store_id`를 기준으로 고객 LINE 대상을 조회하도록 보강.
