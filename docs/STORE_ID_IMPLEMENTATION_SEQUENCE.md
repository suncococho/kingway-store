# Store ID Implementation Sequence

## 1. 목적

이 문서는 store_id multi-tenant 실제 구현 전 안전한 implementation sequence를 정의한다.

목적은 다음과 같다.

- 실제 코드/DB 변경 전 안전한 구현 순서 정의
- production 영향 없이 staging 기준으로 단계별 진행
- store_id SaaS 전환의 작업 순서 고정

## 2. 현재 완료된 준비

- staging restore environment 구축 완료
- restore rehearsal 성공
- store_id migration design 작성 완료
- migration SQL draft 작성 완료
- query audit checklist / result 작성 완료
- API scope strategy 작성 완료
- permission model 작성 완료
- auth context audit 작성 완료

## 3. 구현 기본 원칙

- production 직접 수정 금지
- staging rehearsal 우선
- nullable `store_id` 먼저
- backfill 후 query scope
- backend scope가 최종 보안 기준
- store isolation 실패는 BLOCKER

## 4. Phase 1: staging migration rehearsal

- `stores` 테이블 생성
- 1차 business tables에 nullable `store_id` 추가
- `KINGWAY 台南` 기본 store 생성
- 기존 데이터 `store_id=1` backfill
- row count 검증
- rollback 기준 확인

## 5. Phase 2: staff/store relation

- `staff_users.store_id` nullable 추가
- 기존 staff `store_id=1` backfill
- `staff_store_access` 후보 검토
- 기존 role enum과 SaaS role mapping 검토

## 6. Phase 3: auth/token context

- login response에 `store_id` 포함
- JWT payload에 `current_store_id` 추가 검토
- accessible stores 구조 검토
- `display_name` 컬럼 사용 주의

## 7. Phase 4: middleware

- `requireAuth` existing 구조 확인
- `requireStoreScope` 추가
- `requireStoreAdmin` 추가
- `requireSuperAdmin` 추가
- URL / body `store_id` 직접 신뢰 금지

## 8. Phase 5: high-risk route scope

우선순위:

- `dashboard.js`
- `customers.js`
- `orders.js`
- `products.js`
- `repairs.js`
- `inventory.js`
- `suppliers.js`
- `purchaseConfirmations.js`

## 9. Phase 6: webhook/callback scope

- LINE webhook store mapping
- Telegram callback store check
- supplier stock callback store check
- notification credential store별 분리

## 10. Phase 7: frontend store context

- 현재 store 표시
- permission error 표시
- store selector는 `super_admin`만
- URL 변경 우회 차단 확인

## 11. Phase 8: cross-store test

- A store / B store fixture 생성
- A staff가 B customer / order / product 접근 불가 확인
- dashboard aggregate leakage 확인
- direct API call leakage 확인
- webhook mismatch 테스트

## 12. Phase 9: production rollout 준비

- 최신 production backup
- checksum 기록
- staging restore rehearsal 재실행
- migration dry run
- smoke test
- rollback plan 확인

## 13. 절대 금지

- production DB 직접 migration
- `store_id` 없는 bulk update
- UI 숨김만으로 보안 처리
- API scope 없이 multi-store 오픈
- LINE / Telegram production credential staging 사용
- 코드 복사본으로 매장별 분기

## 14. 최종 판정 기준

- staging PASS
- query audit PASS
- cross-store leakage test PASS
- notification isolation PASS
- rollback rehearsal PASS
