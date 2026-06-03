# KINGWAY SaaS v1 Free/Premium Roadmap

Date: 2026-06-03
Branch: `beta/staging-architecture`

목표: 1주 내 사용 가능한 v1 SaaS 출시 범위를 Free/Premium로 구분하고, `store_features`를 통해 운영 가능한 형태로 정리.

## 1. 1주 안에 사용 가능해야 하는 v1 필수 기능

1. `platform_admin_users` 기반 플랫폼 운영자 로그인 및 SaaS 관리권한 관리
2. 멀티테넌시 구분 기반 Store 관리 API
3. `POST /api/saas-admin/stores` 신규 점포 생성 및 owner bootstrap
4. `store_features` 관리 API와 화면 연동
5. 기존 운영 흐름 보전된 `staff`/`orders`/`repairs`/`inventory`/`coupon`/`purchase confirmation`/`POS` 핵심 화면과 API
6. 메뉴/직접 URL에 대한 기능 On-Off enforcement 완결 (`sales_dashboard`, `coupons`, `suppliers`, `inventory`, `purchase_confirmations`, `repairs`, `staff_management`, `orders`, `pos`)
7. 기존 LINE/OA/LIFF 고객/업무 플로우를 깨지 않도록 기능 토글 동작과 분리
8. `store id=1(KINGWAY_TAINAN)`을 기본 동작 호환 기준으로 유지하는 1차 운영형태

## 2. Free 버전 기능

- 기본 메뉴/작업
  - 儀表板/營業總覽(銷售報表)
  - 訂單管理(리스트/조회/수정/삭제/결제 연동 기본)
  - 產品與庫存管理(Products/Inventory)
  - 基礎客戶維護(CRM)
- 작업 보조
  - 發票與訂單出貨 확인(기존 주문 관리 흐름)
  - 基本維修接單與流程
- 보장 조건
  - 플랫폼 관리자로만 점포 생성 가능
  - 점포 owner 계정은 기본 제공
  - 모든 기능은 초기에는 기본 ON 상태를 유지하되 운영에서 Free/Premium를 토글 가능

## 3. Premium 버전 기능

- Premium 업셀링 후보
  - 進階報表與 KPI/效率儀表
  - 高權限角色分層與審批流 강화
  - LINE 店鋪별設定與多店鋪 운영 통합 운영 도구
  - 供應商訂單/採購管理 고도화(현재는 기능은 있으나 정책적으로 프리미엄 패키지에 포함)
  - 付款/訂閱 기반의 자동화 제어, 계정 과금·알림 연동(아직 미구현, 추후 추가)

## 4. 나중에 Enterprise로 넘길 기능

- 자동 과금/청구(Stripe/帳單整合)
- 멀티채널 봇/채널 통합(현재 Telegram은 별도 유지 정책)
- 계정/권한 감사 시스템 고도화
- 고객/매장 간 자동 동기화, 대량 migration 도구
- 샵 간 템플릿 동기화, 규격형 데이터 이관 파이프라인
- 고급 보안(회계감사 로그, 사기탐지, SSO 확장)

## 5. 현재 이미 구현된 기능

- 플랫폼 관리자 시스템
  - `/api/platform-auth/login`, 토큰 기반 인증
  - 플랫폼용 middleware(`authenticatePlatformAdmin`)
  - `/api/saas-admin/stores`, `/api/saas-admin/stores/:id/features` GET/PATCH
- 점포 생성 자동화 1단계
  - `POST /api/saas-admin/stores` 트랜잭션 생성(점포 + `store_features` + owner)
  - 중복 코드/username 가드 및 임시 패스워드 반환
- feature enforcement 완료 상태
  - sales_dashboard_enabled, coupons_enabled, suppliers_enabled
  - inventory_enabled, purchase_confirmations_enabled
  - repairs_enabled, staff_management_enabled
  - orders_enabled, pos_enabled
- 메뉴/직접 URL 접근 차단 메시지 패턴 적용
- 고객 공개 흐름(구매확인/LINE/repair LIFF flow) 보전 정책을 문서대로 유지
- `store_line_settings` 기본 저장/마스킹/조회 API 기초 구현(실시간 토큰 라우팅 미적용)
- LINE send 계층 4A(no-behavior-change context) 구조 반영

## 6. 아직 남은 구현

- v1 론칭 문서상 남은 의사결정
  - Free/Premium 정책을 `store_features`에 영구 반영하는 계약 정책
  - 점포 생성에서 자동 plan 값과 feature preset 정책 표준화
  - 관리자 화면에서 v1 표기(체험/유료 제약)와 권한 안내
- 운영 안정화 보완
  - 토큰 기반 전환 대신 수동 플랜 전환 flow 문서화 + UI 작업
  - 기능별 SLA/장애 복구 가이드 작성
  - tenant 생성 시 샘플 데이터 비포함 정책 고정
- LINE 남은 단계
  - 현재는 send/reply 토큰 분기 미적용 상태
  - webhook + LIFF store-scoped 전환 이전 단계(토큰화 webhook 처리/실제 매장별 발송) 미완료

## 7. store_features와 Free/Premium 연결 방식

1. 점포 생성 시 `store_features`는 기본값을 Free preset 기준으로 생성
2. Free/Premium 전환은 `PATCH /api/saas-admin/stores/:id/features` 또는 추후 승인된 운영 도구로 수동 변경
3. 추천 매핑
   - `inventory_enabled`, `repairs_enabled`, `orders_enabled`, `pos_enabled`는 기본적으로 Free 패키지 기본 ON
   - `staff_management_enabled`, `purchase_confirmations_enabled`는 Free/업셀링 범주 중 분리하여 단계별 정책 적용
   - Premium 전환 시 고급 리포트/권한/통합 API를 추가하는 방식으로 점진 on/off
4. 점포별 정책 변경은 플랫폼 관리자 동작만 허용, staff token으로는 불가
5. 변경 이력은 수동 운영 로그에 남기고, 1주차 v1에서는 자동 과금 이벤트를 연동하지 않음

## 8. 결제는 당장 구현하지 않고 수동 플랜 전환으로 시작

- 결제/구독은 v1에서 제외
- 운영 기준
  - 신규 점포: 기본 Free preset 생성
  - Premium 업그레이드: 플랫폼 관리자가 수동으로 `store_features`를 조정
  - 다운그레이드: 동일 수동 절차로 rollback 가능
- 장점
  - 초도 1주 내 오퍼레이션 리스크 최소화
  - 법적/결제 연동 리스크 없이 기능 확장 시험 운영 가능

## 9. LINE 관련 남은 작업

- `store_line_settings` 저장/조회는 되어 있으나 매장별 런타임 채널 토큰 분기 미적용
- `reply` / `push`는 아직 글로벌 토큰 중심
- 단계별 진행
  - 4A: 컨텍스트 전달 (완료)
  - 4B: store token resolver 추가
  - 4C: `/api/line/webhook/:webhookPathToken`에서만 store token 사용
  - 4D: `KINGWAY_TAINAN` 최종 전환
- 고객 공개 LIFF / 구매확인 / 수리 예약 public flow는 v1까지 기존 동작 보존

## 10. 7일 작업 우선순위

- Day 1
  - v1 출시 대상 기능/제한을 운영 가이드에 고정
  - Free/Premium 분류 최종 승인
  - 수동 플랜 전환 SOP 1차 공개
- Day 2
  - `store_features`와 플랜 프리셋 동기화 정책 문서 반영
  - 점포 onboarding 완료 체크리스트 적용
- Day 3
  - 플랫폼 운영 메뉴에서 plan/feature 설명 UI 라벨 정리
  - 기능 제한 메시지 텍스트 정합성 정리
- Day 4
  - 신규 점포 생성 트랜잭션 결과 문서 보강(임시 패스워드 전달 SOP)
- Day 5
  - LINE 남은 단계(4B~4D) 착수 범위 확정
  - 고객/관리자 흐름 영향도 재확인
- Day 6
  - v1 릴리즈 전 마감 테스트 체크리스트 실행(아래 항목)
  - 장애 대응 절차 정리
- Day 7
  - 운영 승인 및 staging 기준 검증
  - v1 릴리즈 공지 초안

## 11. 출시 전 필수 테스트 체크리스트

- 인증/권한
  - 플랫폼 로그인/토큰 유효성
  - SaaS admin API 접근 제어(Staff token 거부)
  - 각 `store_features` on/off 시 API/메뉴 일치 확인
- 멀티테넌시
  - 점포 생성 시 `store_id` 분리 확인
  - store_id 범위 API 호출이 타 점포 침투하지 않는지 확인
- 점포 기능
  - Free/Premium 토글 변경 후 메뉴 노출/직접 URL 동작 1:1 검증
- 운영 안정성
  - 신규 점포 생성 후 로그인 owner 동작
  - 장애 시 rollback 및 수동 plan 전환 처리
- LINE 공용 흐름
  - 기존 고객/공개 LIFF flow 유입 정상
  - store-scoped token 분기 미적용 상태에서 기존 동작 유지 확인
