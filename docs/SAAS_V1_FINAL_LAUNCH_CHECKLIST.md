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

## 2) 출시 가능 조건

- 필수 전환 동의
  - 플랫폼 admin과 점포 owner 계정 권한 분리가 명확해야 함
  - Free/Premium 기능 ON/OFF가 운영에서 예측 가능해야 함
- 멀티테넌시 최소 보증
  - 점포 간 데이터 침투 차단이 수치로 확인되어야 함
  - 테스트 데이터 기준으로 storeId 경로/권한 분기 정합성 보증
- 공개 흐름 안정성
  - purchase-confirm, line-order, line-repair의 store parameter 검증이 운영 기준 통과
- LINE 운영 기준 준수
  - tokenized webhook만 제한 조건 하에서 확장하고, legacy webhook는 영향 유지
  - raw token/secret 노출 없음
- 배포 규칙
  - production config/`.env`/DB destructive 변경 없이 론칭 승인

## 3) 아직 production 전환 금지 항목

- 실제 LINE 메시지 발송(점포별 reply/push 실운영 전환)
- 매장별 runtime tokenized token fallback 미완성/운영 정책 미확정 상태 해소 전
- store 오너 비밀번호 전달·회수·초기 안내 SOP의 운영 표준화 미완료
- 멀티테넌시 교차 침투 자동 회귀 테스트 미완료 상태인 항목
- /files 정적 자원 무권한 접근 통제 미적용 구간
- purchase-confirm, store settings, LINE 설정의 운영 UI/운영자 안내가 수동 절차만으로 정리된 항목은 운영 승인 후 재확인 필요

## 4) 실제 매장 테스트 절차

1. 테스트 환경 고정
- 스테이징 backend `:3010` 및 DB `127.0.0.1:3310` 기준으로만 수행
- legacy와 tokenized webhook 동선 분리로 404/401/503/200 응답 규칙을 사전 스냅샷

2. 계정/권한 준비
- platform admin 계정, store owner(신규/기존) 로그인 경로 점검
- owner 비밀번호 전달/초기 재설정 규칙과 접근성 점검
- `store_features` 상태를 통해 메뉴/직접 URL 제약이 실제로 반영되는지 확인

3. 매장 격리 테스트
- store=1, store=4 기준으로 product/orders/customers/repairs/settings/purchase-confirm/public route를 분리 조회
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
- raw token/secret, raw credential이 응답/로그에 노출되지 않음 확인

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
| 멀티테넌시 격리 기본 정책 | PASS(문서) / FAIL(실증) | 회귀 테스트에서 일부 항목 미완료 또는 보완 필요 |
| owner onboarding 실제 운영 검증 | FAIL | owner 비번/초기 안내 SOP 및 실제 검증 흐름 미완료 |
| LINE store 설정 저장/마스킹 | PASS | API는 마스킹/미노출 원칙 반영 |
| LINE runtime 분리 적용 | FAIL | tokenized webhook 일부 제한 전환만 진행, full runtime 분리 미완료 |
| legacy webhook 보존 | PASS | 기존 경로 변경 없음 확인 |
| 정적 파일 접근 보안 | FAIL | `/files` 노출 관련 항목 보완 필요 |
| 공표 가능한 v1 출시 승인 | NOT READY | 상기 FAIL 항목 정리 후 2차 승인 필요 |

## 10) 다음 실제 구현 우선순위

1. 멀티테넌시 교차 침투 실증 강화(상품/주문/POS/수리/setting)
2. owner 계정 온보딩/비밀번호 전달/초기 설정 SOP 운영화
3. purchase-confirm/public LIFF 및 URL/토큰 전달 규칙 최종 고정
4. 파일 접근 권한 정리(`/files`, PDF 라우트)
5. store-scoped LINE runtime 분리의 단계적 확장(테스트 후 4B~4D 마무리)
6. 실사용 지표 기반 롤백 기준 문서화 및 운영 알람 정비
