# SaaS v1 리허설 최종 보고서

작성일: 2026-06-04  
브랜치: `beta/staging-architecture`  
버전: v1 (Rehearsal 기준)

## 1) 테스트 매장 정보
- 대상 스토어: `store_id=5`
- 코드: `KW_REHEARSAL_202606`
- 이름: `KINGWAY Rehearsal Test Store`
- Owner: `kw_rehearsal_owner`
- 환경: `staging_restore` (`backend:3010`, `mysql:3310`)

## 2) Step 1 매장 생성 결과
- 상태: 완료
- 매장 생성/기본 조회 결과: 완료
- store scope 기반 접근: owner가 `storeId=5`로 로그인 성공
- `GET /api/store/settings`: `200`

## 3) Step 2 Store/LINE settings 결과
- Store settings 조회/수정/재조회: 완료
- LINE settings 조회/수정/재조회: 완료
- raw credential 노출 없음 (`channelSecret`, `channelAccessToken` 미출력)
- 생성된 LINE 설정은 store 5에만 반영되고 store 1 설정은 변경 없음

4) Step 3 상품 생성 결과
- 스테이징 상품 생성: 완료
- 생성 상품: `id=765`, `sku=KW_REHEARSAL_BIKE_001`, `store_id=5`
- owner 스코프 상품 목록: store 5 상품 노출
- store 1 직접 접근 시 해당 상품 미노출 (`404`)
- 기존 store 1 상품 데이터 미변경 확인

## 5) Step 4 주문/POS 결과
- 주문 생성: 완료
- 생성 주문: `id=198`, `orderNo=POS-20260604-113516-561`, `store_id=5`
- 고객 생성/연동: `id=155`, `name=KW_REHEARSAL_CUSTOMER`, `store_id=5`
- 주문 아이템: `id=386`, `product_id=765`, `quantity=1`, `line_total=36000`
- stock movement 기록으로 store 5 재고 변경 확인 (`3 -> 2`)
- owner 주문 조회/상세 접근 성공
- store 1 주문 상세 조회 `404`

## 6) Step 5 수리예약 결과
- 수리예약 생성: 완료
- 생성 건: `id=83`, `store_id=5`, `source=WEB`, `status=reserved`
- 고객 연계: `id=156`, `name=KW_REHEARSAL_REPAIR_CUSTOMER`, `store_id=5`
- owner 수리예약 목록/상세 조회 성공
- store 1 상세 조회 `404`
- staging에서 수리예약 staff LINE notify가 억제되는 동작 확인

## 7) Step 6 purchase-confirm 결과
- `purchase_confirmations_enabled` 활성화 후 검증 진행
- 주문 생성: `id=199`, `store_id=5`, `final_payment_status=PAID`
- EBIKE 조건 충족: order item `id=387`, `product_id=766`, `product_category_snapshot=EB`
- purchase confirmation: `id=42`, `store_id=5`, 토큰 생성 및 공개 submit 사용 후 사용 처리됨
- public route 검증:
  - token only: `200`
  - `store=KW_REHEARSAL_202606`: `200`
  - 잘못된 store: `404`
- PDF 조회:
  - matching store: `200`
  - 잘못된 store: `404`
- store 1에서 order `199` 접근/연동 노출 없음

## 8) Step 7 Free/Premium 결과
- store 5에 대해 `FREE -> PREMIUM -> PREMIUM` 토글 재실행 완료
- `stores.plan`: `trial -> free -> premium -> premium`
- 기능 플래그/메뉴 정책 정합성 확인:
  - FREE에서 `coupons`, `suppliers`, `purchase_confirmations`, `sales_dashboard`, `staff_management`는 차단
  - PREMIUM에서 상기 기능 활성
- 기능 상태와 policy 반영 정합성:
  - FREE: `/api/coupons` 포함 403
  - PREMIUM: `/api/coupons` 200
- FREE 상태에서 `/api/coupons`가 차단되어 정책 동작 유지 확인
- store 1 데이터가 store 5 결과에 유입되지 않음

## 9) 발견된 문제 및 수정 완료 항목
- coupon SQL binding
  - 상태: 발견→수정 완료
  - 내용: `GET /api/coupons` 조회 SQL에서 `?` placeholder 2개에 대해 params 1개 전달되어 500 syntax error 발생
  - 조치: `backend/src/routes/coupons.js`에서 params를 `[storeId, storeId]`로 정합
- staging repair notify suppression
  - 상태: 확인 완료
  - 내용: staging 환경 플래그 기준으로 staff LINE 알림 스테이징 억제 동작 확인
- product category SKU 파생 이슈
  - 상태: 확인/관찰 필요
  - 내용: SKU/카테고리 파생/표시 규칙이 일부 테스트 흐름에서 운영 정책과 완전 일치하는지 최종 기준 확정 필요

## 10) 남은 TODO
- `/api/coupons` 예외 케이스(빈 데이터/오류 케이스) 회귀 테스트 문서화
- owner 최초 onboarding 및 비밀번호 전달/교체 SOP 운영 정합성 확정
- store 간 교차침투 회귀 테스트 자동화(제품/주문/수리/설정/구매확인)
- `/files` 접근 제어 점검 및 보완
- store scope 기반 공개 flow 파라미터 정책(특히 `store` 파라미터 동작) 최종 확정

## 11) v1 launch ready 여부
- staging/demo readiness: `YES`  
  - 최종 smoke regression 결과: `PASS=16 FAIL=0 SKIP=0`
- production ready: `NOT READY (별도 승인 필요)`
- 근거 (production):  
  - owner onboarding 및 운영 SOP 미보완 항목
  - `/files` 접근 제어 강화 미완료
  - 공개 flow store 파라미터 정책 최종 확정/예외 재정리 보완
  - 멀티테넌시 회귀 자동회귀 테스트 미구현

## 12) 실제 매장 데모 순서
1. platform admin 로그인 → 테스트 매장/owner 확인
2. store settings + LINE settings 저장/조회
3. product 등록 후 owner 목록에서 노출 확인
4. 주문 생성 및 주문 상세, POS 흐름(기본 재고/이력) 확인
5. 수리예약 생성 후 승인/조회 흐름 및 메시지 억제(스테이징) 확인
6. purchase-confirm 발급/공개 제출/토큰-매장 조합으로 접근/차단 테스트
7. FREE/PREMIUM 토글 후 메뉴/API 접근 비교
8. store 1/타사 데이터 미노출(교차침투 차단) 확인
