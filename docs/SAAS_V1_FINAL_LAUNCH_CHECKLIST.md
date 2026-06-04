# KINGWAY SaaS v1 출시 전 최종 체크리스트 (v1 final)

작성일: 2026-06-04
브랜치: `beta/staging-architecture`
목표: KINGWAY SaaS v1 출시 전 운영 승인용 체크리스트

## 1) 현재 완료된 기능

1. SaaS 플랫폼 관리 뼈대 완성
- 플랫폼 관리자 로그인/권한(`platform_admin_users`, `platform-auth`)와 SaaS admin 진입 체계
- 점포 생성 API(`POST /api/saas-admin/stores`)가 점포 + owner + `store_features`를 한 트랜잭션으로 생성
- `store_features` 조회/수정 API 기초 구현(`GET/PATCH /api/saas-admin/stores/:id/features`)

2. 멀티테넌시 기반 API/화면의 핵심 축
- 핵심 업무 화면/API가 스토어 스코프 개념을 전제로 동작
- `sales_dashboard`, `orders`, `inventory`, `repairs`, `staff_management`, `purchase_confirmations`, `coupons` 등 메뉴/직접 URL 제어
- 다국어/메뉴 문구에 대한 부분 정비는 진행 중이나, 기본 동작 체계는 기획 문서 기준 구현

3. 고객 공개 흐름 기본 분리
- LIFF 저장소 분리 진입점 준비
  - `/line-order?store=<storeCode>`
  - `/repair-reservation?store=<storeCode>`
  - `/purchase-confirm/:token?store=<storeCode>`
- 공개 정답 토큰 라우팅(`resolve-store`) 연동 기반 반영

4. LINE 설정/스토어 스코프 준비
- `store_line_settings` 저장/조회(마스킹) API 기본 구조 완료
- `env:` 참조 및 직접 값 입력 저장 지원
- raw token/secret 노출 방지 원칙 적용

5. Tokenized webhook 기반 준비
- `POST /api/line/webhook/:webhookPathToken` 경로에서 store 맵핑 + signature + credentials 상태 추적
- `POST /api/line/webhook` legacy 경로는 기존 동작 유지

6. 문서 정합성
- Free/Premium 정책, 론칭 갭, 멀티테넌시 회귀 항목이 동일 브랜치 기준으로 정리됨

7. 리허설 기반 store end-to-end 완료
- `docs/SAAS_V1_REHEARSAL_FINAL_REPORT.md` 기준으로 store 5 생성/설정/상품/주문/수리예약/구매확인 흐름을 통합 검증 완료
- store 1 직접 접근은 404/403으로 차단되어 store 경계가 수치로 확인됨

8. Repair 상태 변경 scope 하드닝 완료
- `POST /api/repairs/:id/reject`, `/complete`, `/pickup`의 `repair_orders` DML/SELECT에서 `id + store_id` 조건 강제
- `docs/REPAIR_STATE_SCOPE_AUDIT.md`에 1차 수정 완료 반영

9. Repair estimate/customer-response scope 하드닝 완료
- `POST /api/repairs/:id/estimate`, `/customer-response` 체인에서 `storeId` 명시 전달
- `lineWorkflowService`의 estimate/linked order 조회/수정 흐름에 `repair_orders.id + repair_orders.store_id`, `orders.id + orders.store_id` 조건 적용
- `docs/REPAIR_STATE_SCOPE_AUDIT.md`에 2차 수정 완료 반영

10. Product image 직접 접근 차단 + 게이트 라우트 완료
- `/files/products/*` 직접 접근 404 처리
- 인증/권한 경유 `GET /api/products/:id/image`로 store-scoped 파일 제공
- `docs/FILES_ACCESS_CONTROL_RECHECK.md`에 구현 반영

11. 공개 flow store 파라미터 정책 확정
- `/line-order`, `/repair-reservation`, `/purchase-confirm/:token`, `/api/storefront/resolve-store` 정책 문서 확정
- `docs/PUBLIC_FLOW_STORE_PARAMETER_POLICY.md` 작성 및 공유

12. 예외 케이스 회귀 테스트 문서화
- 쿠폰 / line-order / line-repair / purchase-confirm / product image 예외 시나리오 정리
- `docs/SAAS_V1_PUBLIC_FLOW_EXCEPTION_TESTS.md` 작성

## 2) 출시 가능 조건

- 필수 전환 동의
  - 플랫폼 admin과 점포 owner 계정 권한 분리가 명확해야 함
  - Free/Premium 기능 ON/OFF가 운영에서 예측 가능해야 함
- 멀티테넌시 최소 보증
  - 점포 간 데이터 침투 차단이 수치로 확인되어야 함
  - 리허설/문서 근거 기반으로 storeId 경로 및 권한 분기 정합성 보증
- 공개 흐름 안정성
  - `purchase-confirm`, `line-order`, `line-repair`, `product image`가 정책/예외 케이스 기준으로 정리됨
- LINE 운영 기준 준수
  - tokenized webhook만 제한 조건 하에서 확장하고, legacy webhook는 영향 유지
  - raw token/secret 노출 없음
- 문서 기반 운영 승인 조건
  - 정책 문서 4종이 최신 상태여야 함
    - `docs/SAAS_V1_FINAL_LAUNCH_CHECKLIST.md`
    - `docs/SAAS_V1_REHEARSAL_FINAL_REPORT.md`
    - `docs/PUBLIC_FLOW_STORE_PARAMETER_POLICY.md`
    - `docs/SAAS_V1_PUBLIC_FLOW_EXCEPTION_TESTS.md`

## 3) 아직 production 전환 금지 항목

- 실제 LINE OA 실운영 메시지 발송 제한 (`real LINE OA live test`는 제한된 범위에서만)
- legacy `KINGWAY_TAINAN` migration 미실행 상태
- full 자동 회귀 테스트 패키지 미구현 (교차침투 + public flow + 파일 접근)
- `/files` 정적 자원 전면 통제 미완료 (`/files` open 상태 자체는 남아 있음)
- owner 계정 온보딩/비밀번호 전달·회수·초기 안내 SOP의 운영 표준화 미완료
- store settings / 구매확인/LINE 설정 운영 UI 가이드가 수동 점검 전환 필요

## 4) 실제 매장 테스트 절차

1. 테스트 환경 고정
- 스테이징 backend `:3010` 및 DB `127.0.0.1:3310` 기준으로만 수행
- legacy와 tokenized webhook 동선 분리로 404/401/503/200 응답 규칙을 사전 스냅샷

2. 계정/권한 준비
- platform admin 계정, store owner(신규/기존) 로그인 경로 점검
- owner 비밀번호 전달/초기 재설정 규칙과 접근성 점검
- `store_features` 상태를 통해 메뉴/직접 URL 제약이 실제로 반영되는지 확인

3. 매장 격리 테스트
- store=1, store=5(리허설) 기준으로 product/orders/customers/repairs/settings/purchase-confirm/public route를 분리 조회
- 한 store의 token/storeCode를 조작해 404/403/정상 분기 동작 점검
- staff token과 platform token 역할 분기 확인

4. 공개 LIFF 흐름 테스트
- `line-order`, `line-repair`, `purchase-confirm`에서 유효/무효 store parameter 대응 검증
- 유효 store는 정상, FAKE/INVALID store는 404 또는 차단 메시지

5. LINE 경로 테스트
- `POST /api/line/webhook/:webhookPathToken` : mapping, signature, credentialsResolved 분기
- `POST /api/line/webhook`(legacy) : 기존 동작 회귀 확인
- 토큰화 경로에서 ping 텍스트 처리 정책에 맞는 응답/차단 로그 보관

6. 운영 품질 점검
- 에러 패턴: 401/404/503의 분포 체크
- 라우트 디시전(routeDecision), dry-run/sendSuppressed 기록이 기대치와 일치하는지 확인
- raw token/secret이 응답/로그에 노출되지 않음 확인

## 5) Free/Premium 수동 전환 절차

1. 플랫폼 admin이 대상 점포의 `store_features` 확인
2. Free/Premium preset를 기준으로 on/off 조정
3. 변경 즉시 메뉴 접근 및 직접 URL 동작을 점검
4. 변경 로그와 승인 이력 기록(수동 전환은 롤백 대비)
5. 필요 시 기능 보정 후 동일 점포에서 재검증

권고: v1은 결제 자동화/청구 연동 없이 수동 전환 기준으로 운영, 자동 과금 플로우는 다음 단계

## 6) LINE 설정 절차

1. 매장 관리자/플랫폼 전담자 계정으로 store LINE 설정 조회
2. `channelId / channelSecret / channelAccessToken` 입력 및 마스킹 상태 확인
3. `webhook_path` 생성/확인 후 tokenized webhook URL 등록
4. `channel_secret`/`channel_access_token`의 `env:` 모드 또는 직접 모드 사용 방식 확정
5. 채널 설정 변경 시 `credentialsResolved` 분기와 signature 검증 실패 처리 경로 점검
6. raw token/secret이 로그/응답에 노출되지 않는지 최종 확인

## 7) Store owner 온보딩 절차

1. 점포 생성( 플랫폼 admin )
- `POST /api/saas-admin/stores`로 점포 및 owner 초기값 생성
- 임시 계정 비밀번호/패스워드 전달 규칙 적용

2. owner 초기 접근
- owner 계정으로 로그인 확인
- 점포 기본 메뉴 접근권한과 초기 기능 상태를 확인

3. store settings/LINE settings 기본값 적용
- 기본 메뉴 ON/OFF 정책과 store_features 상태 반영
- LIFF storeCode 연동 테스트 수행

4. 운영 승인
- 실사용 전 최소 1회 주문/수리/고객 조회 흐름 smoke test

## 8) rollback 절차

1. 문제 감지 시점 정의
- raw token/secret 노출 의심
- 매장 간 침투 탐지
- tokenized webhook 실패율 급증(401/503/500)

2. 즉시 조치
- tokenized reply/push 관련 플래그를 비활성화해 dry-run 중심 상태로 되돌리기
- legacy `/api/line/webhook` 단독 동작으로 전환
- 점포별 feature 변경은 수동으로 이전 상태 복구

3. 사후 처리
- 장애 원인 로그 보존(민감정보 마스킹)
- 배포/설정/커밋 단위로 원인 분해
- 테스트 항목 재실행 후 단계적 재오픈

## 9) 출시 전 최종 PASS/FAIL 표

| 항목 | 상태 | 비고 |
|---|---|---|
| 플랫폼 admin/사스 점포 생성 API | PASS | 점포/owner/features 트랜잭션 생성 설계 및 구현 존재 |
| Store-feature 기능 제어 | PASS(부분) | 구현은 있으나 운영 SOP 통합 보완 필요 |
| 멀티테넌시 격리 기본 정책 | PASS(수치/리허설) / FAIL(자동회귀 미완료) | store 5/E2E 수치 검증 완료, 정식 자동화는 미완 |
| Repair 상태 변경 scope hardening | PASS | `/repairs/:id/reject|complete|pickup`의 id+store_id 조건 적용 |
| Repair estimate/customer-response scope hardening | PASS | estimate/customer-response 및 linked order 경로 store 조건 적용 |
| Product image access hardening | PASS | `/files/products/*` 차단 + `/api/products/:id/image` 게이트 적용 |
| Public flow store parameter 정책 | PASS | 정책 문서 확정 및 예외 케이스 문서 반영 |
| owner onboarding 운영 SOP | PARTIAL | 재고/권한 전달 표준 SOP는 보완 필요 |
| 멀티테넌시 교차 침투 자동회귀 | FAIL | 자동화 미구현 |
| LINE runtime 분리 적용 | FAIL | production 운영 확장 전환 미완료 |
| /files 정적 자원 전면 보안 | FAIL | `/files` open 상태 잔존 |
| 공표 가능한 v1 출시 승인 | NOT READY | 상기 FAIL 항목 정리 후 2차 승인 필요 |

## 10) 남은 TODO 분리 (staging/demo vs production)

### staging/demo blocker
- 정식 스크립트 자동회귀 도입 전(현재는 리허설 기반 수동 테스트 중심) 운영 문서 연계 필요
- owner 초기 온보딩/비밀번호 전달 SOP의 현장 운영 템플릿 보강
- purchase-confirm 및 line flow의 변경 반영을 staff 교육 문서로 분리 적용

### production blocker
- full 자동 회귀 테스트 미구현
- legacy `KINGWAY_TAINAN` migration 실행 계획/전환/정지 정책 미확정
- `/files` 정적 마운트 전면 보안화 미완료
- 실사용 LINE OA 실제 발송 정책 승인

### 실행 단계별 우선순위
- Staging/demo: 위 staging 블로커 해소 후 실매장 데모 승인
- Production: 위 production 블로커가 모두 0/clear 되어야 별도 승인 가능

## 11) 실제 매장 데모 가능 여부

- staging/demo readiness: **가능(조건부)**  
  - store 5 리허설 완료, repair scope, public flow policy, 상품 이미지 차단 경로가 실운영 전 단계 데모에서 사용 가능
  - 다만 온보딩 SOP 및 production blocker 미해결 항목은 데모 운영 절차별 보완 조건으로 반영
- production readiness: **NOT READY**  
  - legacy migration, 자동 회귀/감사 체계, `/files` 전면 보안화 및 LINE 실운영 발송 정책 확정 전까지 보류
