# KINGWAY SaaS v1 Launch Gap Check (Pre-Release)

Date: 2026-06-03  
Branch: `beta/staging-architecture`  
Owner: Platform staging validation for 1-week operability

## 1) 상태 점검 항목 (현재 기준)

1. 새 매장 생성 가능 여부
- 완료: `POST /api/saas-admin/stores` 기반 신규 매장 온보딩 API가 구현되어 있으며, 스토어/owner/store_features를 한 트랜잭션으로 생성하고 있다.  
- 상태: 완전 운영 전환 전 단계, but `slug` 실물 컬럼 부재 등 스키마 미비는 문서에서 보완 필요로 남아있음.

2. owner 계정 생성/로그인 가능 여부
- 완료: owner 계정 생성과 임시 비밀번호 발급 흐름이 계획/구현에 포함되어 있으며, 기존 직원 인증(`staff_users`)으로 접속 경로가 존재한다.
- 상태: owner bootstrap 기능은 동작 가능하나, 배포/운영 기준 절차(비밀번호 전달 SOP, 초기 비번 만료/재설정 안내)는 미완성.

3. Free/Premium preset 가능 여부
- 완료: `store_features` 기반 preset 개념은 문서화 및 일부 구현(플랜/프리셋 적용 API 연동)으로 존재.
- 상태: 실제 운영에서 Free/Premium 즉시 전환/표시/검증 UX를 단일 화면으로 정리한 운영 절차는 미완료.

4. Store settings 가능 여부
- 완료: Store/Admin API 스코프(`GET /api/store/settings`, `PATCH /api/store/settings`)가 문서화/구현되어 있고,
  platform admin 대상 `stores/:id/settings`도 가용.
- 상태: 화면 전면 검증(권한 분기, 폼 유효성, 언어/시간대/공개데이터 일관성)은 테스트가 필요.

5. Store LINE settings 가능 여부
- 완료: `store_line_settings` 저장/조회 및 마스킹 응답 구조는 구현되어 있고, line secret/token raw 미노출이 원칙으로 반영.
- 상태: 런타임 토큰 분기(매장별 send/reply/push, 직원 OA 분리)는 아직 배포 전 단계.

6. 상품 등록/수정 store isolation 상태
- 완료: 상품 데이터 구조는 멀티테넌시 기준 `store_id`와 기능 분기 기반 설계를 따르고 있음.
- 상태: 상시 API에 대한 상호 매장 침투 테스트(직접 URL + API 조합)가 launch 체크리스트 형태로 남아있어 실운영 미인증.

7. 주문/POS store isolation 상태
- 완료: 주문/POS 관련 필드 및 기본 조회/생성 경로는 store-scoped 설계를 기반으로 동작 중.
- 상태: 현재는 점검 항목이 문서 단계이며, 자동 회귀 테스트로 교차 매장 침투를 실데이터로 보장한 기록은 부족.

8. 수리예약 store isolation 상태
- 완료: LIFF create 경로에서 store context(`storeCode`)를 받아 `line-repair` 생성 시 store_id 적용 로직이 추가됨.
- 상태: 수리 접수/승인/완료의 staff UI 경로까지 end-to-end 격리 동작은 아직 운영 검증 미완료.

9. LIFF order/repair store context 상태
- 완료:  
  - `/line-order?store=<storeCode>`  
  - `/repair-reservation?store=<storeCode>`  
  - `/purchase-confirm/:token?store=<storeCode>`  
  - resolver API(`GET /api/storefront/resolve-store`) 연동 완료.
- 상태: order/repair/purchase-confirm 공개 진입의 기본 store context 연결은 완료. purchase-confirm entry LIFF 및 운영 QA는 추가 검증 필요.

10. LINE webhook/tokenized route 상태
- 완료:  
  - `POST /api/line/webhook/:webhookPathToken` 라우트는 등록 및 token lookup 기반 501 safe response까지 구현
  - signature 검증은 store settings의 secret 참조 기반으로 준비
- 상태: 실제 이벤트 처리/분기/매장별 tokenized reply/push 전환은 다음 단계.

11. 실 운영 blocker
- 현재 1주 출시 관점에서의 핵심 blocker: `Free/Premium` 정책의 실제 운영 UI 확정, `purchase-confirm` 공개 흐름의 store-context 일치, 멀티스토어 교차침투 자동 테스트 미완료.

## 2) 완료 항목

- platform admin 로그인 및 SaaS 관리 권한 기본 체계
- 새 매장 자동 생성 API 기본 동작(스토어 + owner + store_features)
- `store_features` 기반 기본 기능 on/off 프레임
- `/api/store/settings` / `/api/saas-admin/stores/:id/settings` 기초 구현
- LINE setting 저장·조회 마스킹 및 raw token/secret 노출 금지
- store-scoped webhook skeleton + signature 검증 단계
- LIFF store resolver 도입 및 order/repair create에서 trusted context 반영
- LINE send/reply context 인자 전달 구조(동작 불변)

## 3) 미완료 항목

- storefront/매장 관리자 화면에서 Free/Premium preset 변경의 완전 UX 정합성
- 멀티테넌시 교차 침투 테스트 자동화(상품/주문/POS/수리)
- 실제 운영에서 store별 LINE runtime 토큰 분리 적용(4B~4D)
- owner 비밀번호 전달/회수/초기 안내 SOP 완결
- 메뉴 노출과 API 접근 제어의 최종 사용자 QA 문서 및 운영 기준 적용

## 4) 블로커

1. 매장별 라인 토큰/채널 격리와 staff 그룹 메시징 분리는 아직 실행 전 상태여서 “완전 SaaS형 운영” 보증이 미흡.
2. v1 출시 전 자동화된 멀티테넌시 회귀(교차 매장 침투) 테스트가 부족.
3. purchase-confirm entry LIFF와 운영 링크 배포 규칙은 추가 QA가 필요.

## 5) 7일 안에 꼭 해야 하는 것

1. Free/Premium preset 적용/표시/롤백(검증 가능한 운영 버튼/상태) 정리.
2. 신규 owner 온보딩 SOP + 비밀번호 전달/회수 정책 확정.
3. purchase-confirm entry LIFF 및 배포 링크 패턴 QA 완료.
4. 멀티스토어 침투 테스트 10개 항목(상품/주문/POS/수리/setting/line flow) 실행.
5. webhook legacy 보존 하에 store tokenized route의 운영 경계 문서화 및 대응 시나리오 확정.

## 6) 나중으로 미룰 수 있는 것

- Advanced KPI/role matrix 고도화
- 자동 과금/구독 연동
- 대규모 템플릿 마이그레이션 자동화
- Telegram/이력 추적 확장 고도화

## 7) 다음 구현 1순위

- 멀티테넌시 침투 테스트 배치와 purchase-confirm entry LIFF QA 마감.

## 8) 모델 추천 (Spark / 5.4 구분)

- Spark로 가능한 항목: 문서 정합화, API 호출 문구 정리, 정책/체크리스트 정리, 라우트 상태 문서 동기화.
- 5.4가 필요한 항목: store tokenized runtime(4B~4D), 대규모 멀티테넌시 회귀 검증 스크립트, launch 안정성 기준 고도화.
