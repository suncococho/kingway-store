# SaaS v1 첫 파일럿 자전거 매장 데모 시나리오

작성일: 2026-06-04  
브랜치: `beta/staging-architecture`

본 문서는 첫 파일럿 자전거 매장을 대상으로 한 SaaS v1 데모를 위해 `docs/SAAS_OWNER_ONBOARDING_SOP.md`, `docs/SAAS_V1_FINAL_LAUNCH_CHECKLIST.md`, `docs/SAAS_V1_REHEARSAL_FINAL_REPORT.md`, `docs/SAAS_REGRESSION_EXECUTION_RUNBOOK.md` 기준으로 정리한 운영용 스크립트입니다.  
제약 준수 항목: production `LINE OA` 토큰/`.env` 수정 금지, DB DROP/TRUNCATE/DELETE 금지, 실제 LINE 메시지 발송 금지.

## 1) 데모 목적

신규 파일럿 매장 오너가 운영에서 쓰기 전, 점포 생성부터 주문/수리/구매확인까지 SaaS v1 핵심 흐름을 한 번에 체감하고, 운영에서 발생할 수 있는 권한·격리·토큰 파라미터 이슈를 미리 확인한다.  
staging 기준 smoke regression 결과는 `PASS=16 FAIL=0 SKIP=0`으로 수치 상 확인되어 있으며, 이를 데모 품질 지표로 제시한다.

## 2) 데모 대상

1. 대상 매장: 첫 파일럿 자전거 매장(예시 `KW_REHEARSAL_202606`와 동일한 데모 기준 환경)
2. 대상 사용자: 플랫폼 운영자, 매장 사장, 매장 담당 관리자
3. 대상 환경: staging 데모 환경 (`backend:3010`, DB `127.0.0.1:3310`)  
4. 대상 계정 예시:  
  `platform admin`(매장 생성/기능 토글용)  
  `kw_rehearsal_owner`(store 5 owner)와 동일 권한 구조

## 3) 10분 데모 순서

1. 데모 목표와 제한 조건(실제 LINE 발송 없음, 생산 토큰 미사용, 민감정보 미노출)을 안내한다.
2. 플랫폼 운영자가 `POST /api/saas-admin/stores` 방식으로 점포 생성 화면(또는 API)과 결과 요약을 설명한다.
3. owner 임시 비밀번호 전달 원칙과 최초 로그인 절차를 안내한다.
4. owner 로그인 후 `GET /api/store/settings`, `GET /api/store/settings/line` 응답으로 매장 스코프 연동을 확인한다.
5. 상품 1건 등록 후 목록 즉시 반영을 확인한다.
6. 주문 1건 생성 데모를 실행하고 주문 상세 조회까지 보여준다.
7. 수리예약 1건 생성 데모를 실행하고 스토어 분리 조회 규칙을 확인한다.
8. 구매확인 토큰 기반 공개 링크(정상/잘못된 store) 동작을 확인한다.
9. Free/Premium 차이 화면 및 권한/메뉴 제약을 보여준다.
10. 최종 요약: smoke regression `PASS=16 FAIL=0 SKIP=0` 기록과 다음 단계 협의.

## 4) 30분 상세 데모 순서

1. 환경/제약 공지: staging 전용, 실제 발송 제한, `raw token/secret` 미표시 원칙을 사전 고지한다.
2. owner 계정 생성 및 전달 흐름 설명: 생성 직후 `owner_username`, `store_code`, 초기 임시 비밀번호 전달 정책을 설명한다.
3. owner 최초 로그인 확인: `/api/login`으로 로그인 성공, `user.storeId=5` 형태로 점포 스코프가 맞는지 확인한다.
4. store settings 데모:
  - `GET /api/store/settings` 조회
  - 상호/연락처/영업시간/영수증명칭 최소값 입력 후 `PATCH /api/store/settings`
  - 재조회해서 반영 확인
5. LINE settings 데모:
  - `GET /api/store/settings/line` 조회
  - `channelId`, `webhook_path`, 마스킹 응답 확인
  - tokenized webhook 경로 개념만 설명, 원문 시크릿 미노출
6. 상품 등록 데모:
  - 상품 1건 입력(이름/가격/카테고리/SKU)
  - 이미지 업로드 항목 확인(있다면 업로드/미리보기/저장)
  - 목록에서 매장 스코프 노출 확인
7. 주문/POS 데모:
  - 테스트 주문 생성
  - 주문 목록/상세 확인
  - 재고 이동/금액 흐름 요약
8. 수리예약 데모:
  - 고객 정보·연락처·증상·예약일시 입력
  - 예약 생성 후 목록/상세 접근
  - 타 매장 접근 차단(개념 확인) 안내
9. 구매확인 데모:
  - 토큰 생성/공개 링크 확인
  - `token only` 성공, `store=INVALID` 차단 동작 설명
10. Free/Premium 차이 데모:
  - Free 상태에서 제한 메뉴(`coupons`, `suppliers`, `purchase_confirmations`, `sales_dashboard`, `staff_management`)와 API 응답 차단 흐름 확인
  - Premium 전환 후 점검 항목으로 메뉴·API 접근 변화 시연
11. smoke check 핵심 요약:
  - `health`, `store settings`, `line settings`, `coupon status`, `direct file 차단`, `public store resolver` 등에서 PASS 결과 중심으로 브리핑
12. 실제 운영 이전 리스크 정리 및 다음 액션 확정.

## 5) 보여줄 기능

1. 매장 생성: `POST /api/saas-admin/stores` 기반 생성/요약 조회
2. owner 로그인: `/api/login`으로 owner 토큰 획득 및 스토어 권한 확인
3. 매장 설정: `GET/PATCH /api/store/settings`
4. LINE 설정: `GET/PATCH /api/store/settings/line` 및 마스킹 응답 검증
5. 상품 등록: 상품 1건 생성, 매장 목록 반영
6. 주문/POS: 주문 생성, 주문 목록/상세 조회
7. 수리예약: 수리예약 등록, 목록 조회, 상태 분리 규칙
8. 구매확인: 공개 토큰 조회/제출, store mismatch 차단 시나리오
9. Free/Premium 차이: 기능/메뉴/권한 노출 차이, rollback 시나리오

## 6) 보여주면 안 되는 것

1. production LINE token 원문
2. production `.env` 값
3. 실제 고객 정보(실명/실연락처/실 주문 데이터)
4. raw password/token 로그 출력
5. 운영용 채팅/메일 첨부에 민감값 직접 노출

## 7) 사장에게 설명할 포인트

1. 점포 단위로 데이터가 완전히 분리되며, 다른 매장 데이터가 보이지 않는다.
2. owner 임시 비밀번호는 1회성 전달 후 즉시 변경하도록 설계되어 있다.
3. 운영 전까지 실제 LINE 발송이 금지된 상태로, 토큰화된 구조는 검증 단계에서만 사용한다.
4. Free와 Premium은 메뉴 접근권한이 다르며, 업그레이드 시 점검 필요 포인트가 분명하다.
5. 현재 스테이징 데모는 `PASS=16 FAIL=0 SKIP=0` 수치로 흐름 검증 상태가 맞다.

## 8) 데모 후 피드백 질문

1. 사장님은 매장 생성 후 어느 단계가 가장 먼저 필요한지 우선순위를 어디로 보시나요?
2. 매장 세팅에서 빠르게 수정해야 할 필수 항목이 있나요? (연락처/영업시간/상호명)
3. 주문/POS 화면에서 추가로 보고 싶은 주문 상태 항목이 있나요?
4. 수리예약 승인·안내 흐름에서 사전 안내 문구가 충분했나요?
5. 구매확인 버튼 기반 처리 방식이 기존 프로세스와 충돌하지 않나요?
6. Free 단계에서 먼저 운영해도 되는지, Premium 전환 시점을 언제로 볼지 결정 가능한지?

## 9) 파일럿 매장 도입 조건

1. 스테이징 데모 회귀가 `PASS=16 FAIL=0 SKIP=0`으로 재확인되어야 한다.
2. owner 온보딩 SOP(임시 비밀번호 전달, 최초 로그인, 설정 체크)가 준수되어야 한다.
3. 매장 설정, LINE 설정, 상품, 주문/POS, 수리예약, 구매확인에서 핵심 동작이 데모에서 재현되어야 한다.
4. `production LINE token`, `production .env` 미공개를 문서화하고 실제 발송 전환 승인 체계를 갖춰야 한다.
5. 매장 데이터 격리(타 매장 노출 없음)와 교차침투 점검이 데모에서 입증되어야 한다.

## 10) 다음 액션

1. 데모 피드백을 기반으로 파일럿 매장 맞춤 메뉴얼(교육 슬라이드)로 정리한다.
2. 운영 전환 전, production blocker 4종(파일럿 운영 정책·자동회귀·보안 강화·LINE 실운영 승인)을 별도 이행 계획으로 등록한다.
3. 데모 완료 후 24시간 내 플랫폼 운영자 검수 회의를 통해 스테이징 로그와 체크리스트를 공유한다.
4. 최종 파일럿 승인 여부를 사장 결재 후, 다음 주차부터 정식 온보딩 일정으로 연결한다.
