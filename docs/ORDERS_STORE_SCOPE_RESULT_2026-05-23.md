# Orders Store Scope Result - 2026-05-23

## Branch

`beta/staging-architecture`

## Commit Range

아직 미커밋 상태 기준 초안.

완료 commit 범위는 실제 commit 후 아래 형식으로 확정한다.

- From: `TBD`
- To: `TBD`

## Completed Scope

`backend/src/routes/orders.js` 기준으로 Orders store_id scope 적용을 진행했다.

완료 항목:

- `GET /orders` 목록 조회
  - `orders.store_id` 기준 목록 scope 적용
  - 삭제되지 않은 주문만 조회 유지

- `POST /orders` 생성
  - `orders.store_id` 저장
  - 신규 customer 생성 시 `customers.store_id` 저장
  - customer lookup에 `store_id` scope 적용
  - products lookup에 `store_id` scope 적용
  - `order_items.store_id` 저장
  - `inventory_movements.store_id` 저장
  - products stock 차감 update에 `store_id` scope 적용

- `GET /orders/:id` 상세 조회
  - order detail query에 `o.store_id = ?` 적용
  - order_items 조회에 `store_id = ?` 적용
  - response shape 유지

- `PATCH /orders/:id`
  - 최초 order 조회에 `store_id` scope 적용
  - order_items sum query에 `store_id` scope 적용
  - orders update WHERE에 `store_id` scope 적용
  - updated order select에 `store_id` scope 적용
  - payment/reservation 계산 로직은 유지

- 삭제 / 복구 / Trash
  - `GET /trash/list`에 `o.store_id = ?` 적용
  - soft delete에 `store_id` scope 적용
  - restore에 `store_id` scope 적용
  - permanent delete parent check에 `store_id` scope 적용
  - permanent delete final orders delete에 `store_id` scope 적용
  - child delete/update 로직은 변경하지 않음

- Stock helper
  - `deductOrderStockOnce`에서 `orders.store_id` 조회
  - helper 내부 order_items 조회에 `store_id` scope 적용
  - helper 내부 products update에 `store_id` scope 적용
  - helper 내부 `stock_deducted_at` update에 `store_id` scope 적용
  - 중복 차감 정책은 변경하지 않음

- Supplier auto request
  - `createAutoSupplierRequestForZeroStockOrder` 내부에서 `orders.store_id` 조회
  - `storeId` 없으면 `null` return
  - zero-stock query에 `oi.store_id = ?` 및 `p.store_id = ?` 적용
  - `supplier_requests.store_id` 저장
  - `supplier_request_items`는 현재 schema에 `store_id`가 없으므로 수정하지 않음
  - Telegram notification 내용과 group routing은 변경하지 않음

## Runtime Verification

확인 완료 항목:

- `POST /orders` runtime 검증 성공
- `orders.store_id` 저장 확인
- `customers.store_id` 저장 확인
- products lookup scope 동작 확인
- `order_items.store_id` 저장 확인
- `inventory_movements.store_id` 저장 확인
- `GET /orders/:id` detail scope 적용 후 response shape 유지 확인
- `PATCH /orders/:id` scope 적용 후 payment/reservation flow 유지 확인
- trash/delete/restore/permanent route는 permanent delete destructive 특성상 runtime hard-delete test 제외

추가 확인 필요:

- 다른 store 계정으로 cross-store order 접근 시 404/empty response 확인
- legacy rows with null `store_id` 처리 결과 확인
- supplier auto-request 발생 조건에서 `supplier_requests.store_id` 저장 확인
- `deductOrderStockOnce` 실제 호출 경로 존재 여부 및 호출 시 store scope 동작 확인

## Remaining Audit Items

아직 별도 audit가 필요한 항목:

- `PUT /orders/:id/items`
  - order scope
  - product lookup scope
  - order_items delete/insert scope
  - payment recalculation side effect

- `POST /orders/:id/collect-balance`
  - order lookup/update scope
  - order_items repair/EBIKE checks scope
  - LINE notification side effect

- `POST /orders/:id/purchase-confirmation`
  - order ownership scope는 service 내부 확인 필요

- `POST /orders/:id/confirm-handover`
  - order update scope
  - auto purchase order helper scope
  - supplier request creation scope

- `createKingwayAutoPurchaseOrderOnHandover`
  - `supplier_requests.store_id` 적용 여부
  - `supplier_request_items.store_id`는 현재 schema 부재로 제외 필요

- Cross-module services
  - `createPurchaseConfirmationForOrder`
  - `logWorkflowEvent`
  - supplier/LINE workflow service 내부 order lookup
  - Telegram legacy service imports and side effects

- Schema/data audit
  - existing `orders.store_id` null rows
  - existing `order_items.store_id` null rows
  - existing `inventory_movements.store_id` null rows
  - supplier request historical rows

## Production Apply Blockers

아래 조건이 충족되기 전 production 적용 금지:

- staging DB에서 `orders`, `customers`, `products`, `order_items`, `inventory_movements`, `supplier_requests`의 `store_id` 컬럼 존재 확인
- `supplier_request_items.store_id`는 현재 없음으로 확인되었으므로 관련 insert에 추가하지 않는 상태 유지
- legacy null `store_id` rows에 대한 backfill/dry-run report 완료
- cross-store access regression test 완료
- destructive permanent delete는 production에서 직접 runtime test 금지
- backup 또는 rollback plan 없이 production DB 적용 금지
- LINE/Telegram notification routing 변경 없이 store scope만 적용되었는지 확인
- purchase confirmation, coupon, supplier workflow의 side effect audit 완료

## Recommended Next Steps

1. `PUT /orders/:id/items` store scope audit
   - 현재 order item replacement route가 아직 별도 scope 정리가 필요하다.
   - stock logic은 건드리지 않고 order/product/item/payment query scope부터 검토한다.

2. `collect-balance` route store scope audit
   - payment completion과 purchase confirmation trigger가 연결되어 있어 side effect 중심으로 검토한다.

3. handover / auto purchase order flow audit
   - `createKingwayAutoPurchaseOrderOnHandover`는 supplier request 생성이 있으므로 `supplier_requests.store_id` 적용 여부를 별도 검토한다.
   - `supplier_request_items.store_id`는 schema 부재로 계속 제외한다.

4. service-level order lookup audit
   - `lineWorkflowService`와 purchase confirmation service 내부에서 order id만으로 조회하는 구간을 확인한다.

5. staging-only regression test
   - same-store 정상 조회/수정
   - cross-store 404 또는 empty response
   - legacy null store rows
   - supplier auto-request creation
   - notification message unchanged
