# KINGWAY_TAINAN to SaaS 멀티테넌트 전환 계획

작성일: 2026-06-04  
브랜치: `beta/staging-architecture`

## 1. 현재 상태

- 현재 운영 데이터 모델은 사실상 `store_id=1` 단일점 구조(legacy `KINGWAY_TAINAN`)를 기점으로 동작한다.
- `POST /api/line/webhook`는 글로벌 채널 인증(`config.line.channelSecret`) 기반으로 동작하며, 요청 당점포 식별이 아닌 단일 채널 정책으로 처리된다.
- 기존 LINE OA/채널 설정은 기존 `KINGWAY_TAINAN` 런타임과 호환되는 형태를 유지하고 있으며, 멀티테넌트 전환에서는 별도 운영 승인 전까지 변경하지 않는다.
- 현재 리허설 범위는 스테이징 기준으로:
  - store settings, line settings, product/order/repair/purchase-confirm 흐름은 store scope 강화가 일부 완료되어 있음.
  - `/api/products/:id/image` 게이트 및 파일 접근 통제 1차 적용.
  - public flow store parameter 정책 문서/예외 테스트 문서화가 완료됨.

## 2. migration 목표

- 기존 `KINGWAY_TAINAN` 데이터를 기준 데이터로 안정적으로 귀속한 채로 SaaS 멀티테넌트 동작 체계로 이동한다.
- staff/owner의 인증/권한과 store scope를 통해 `store_id` 경계 침투를 차단한다.
- `line webhook`, `line settings`, `상품`, `주문`, `수리`, `구매확인` 흐름에서 store scope를 점진적으로 강제한다.
- 단계별 cutover 중 기존 운영을 멈추지 않고 되돌릴 수 있는 안전선을 유지한다.

## 3. migration 범위

1) Store Settings
- 점포별 설정 조회/수정이 store-scoped context 기반으로 일관 동작해야 함.
- 기존 설정 마이그레이션 이전에도 점포 간 경계 분리 상태를 검증.

2) Line Settings
- `stores` + `store_line_settings`의 store 매핑을 기반으로 채널/토큰/secret 처리를 분리.
- webhook 경로와 LIFF 컨텍스트가 store를 강제 검증하도록 확장.
- `legacy` 토큰 의존을 점진적으로 낮춤.

3) Products
- 상품 생성/조회/수정/이미지 접근에서 store scope를 명시 적용.
- `/files` 정적 노출 이슈가 남아 있는 항목은 다음 단계 포함 대상.

4) Orders
- 주문/주문아이템/재고이력에서 `store_id` 일치 여부 기반 조회·갱신 가드.
- 타 매장 직접 URL 또는 id 조작에 대한 404/403 정책 정합성 확보.

5) Repairs
- 수리예약/수리 상태변경/연계 주문 흐름에서 store scope 강제.
- `repairs` 상태변경/estimate/customer-response chain의 store-id 의존성이 누락되지 않도록 단계별 점검.

6) Purchase Confirm
- 구매확인 token 공개 라우트는 token 소유권 우선 + store hint 일치 검사 강화.
- store mismatch 시 token mismatch/404 정책 고정.

## 4. 절대 건드리면 안 되는 것

- production LINE OA
  - 운영 채널 설정/계정/연동을 임의로 변경하지 않음.
  - 승인되지 않은 메시지 채널 변경 금지.
- production webhook
  - `production /api/line/webhook` 또는 운영 webhook URL 운영 변경 없음.
- production 토큰
  - `channel_secret`, `channel_access_token` 원문 값/운영 시크릿 교체 금지.
- DB destructive 변경 및 운영환경 직접 실행
  - DROP/TRUNCATE/DELETE 실행 및 직접 배포/재기동은 계획 승인 단계에서 별도 승인 전 금지.

## 5. 단계별 전환

### Phase M1: read-only audit

목표: `store_id=1` 단일점 기준 자산을 완전히 파악하고, 전환 리스크를 문서화.

- 동작 점검 항목
  - store scope 누락 가능성이 있는 query/route/service 감사 결과 정합.
  - legacy webhook + LIFF + line settings 간 경계 비교.
  - store 1 중심 현재 데이터 경계(교차침투 가능성 포함) 확인.
- 산출물
  - read-only 리스크 매트릭스
  - Phase M2 진입 승인조건(블로커 최소화)

### Phase M2: tokenized webhook 병행

목표: `POST /api/line/webhook/:webhookPathToken`를 store-scoped 경로로 병행 가동.

- 동작 규칙
  - tokenized webhook는 스토어 매핑 + `x-line-signature` 검증 + credential 조회 후 store context 결론.
  - legacy `/api/line/webhook`는 기존 동작 유지(동시 병행).
  - 실제 LINE 발송은 현재 제한 정책 하에서 유지.
- 산출물
  - legacy fallback 사용률/실패율 모니터링
  - tokenized 경로 store resolution mismatch 처리 증빙

### Phase M3: limited reply

목표: 안정된 점포 범위에서 제한적 이벤트 처리/응답만 허용.

- 동작 규칙
  - 토큰화 경로에서만 store-scoped credential 사용 여부를 강화.
  - 기존 `store_code` 단독 신뢰 제거, store context mismatch 시 fail-closed.
  - `repair`, `line-order`, `purchase-confirm` 관련 공개 경로에서 store 분기 정책을 문서와 일치.
- 산출물
  - 최소 기능군(리허설 store)에서의 cross-store 차단 증빙
  - 제한적 reply/push 후보 경로 목록과 승인 로그

### Phase M4: full cutover

목표: `KINGWAY_TAINAN`을 legacy 호환범위에서 정상 멀티테넌트 운영으로 전환.

- 동작 규칙
  - tokenized webhook를 운영 기본 경로로 전환(legacy는 종료/보관 모드 또는 제한 fallback).
  - store route/request context 중심으로 공통 middleware 및 예외 케이스 처리 통일.
  - owner onboarding/운영 SOP와 자동 회귀 테스트 통합.
- 산출물
  - production ready review 패키지
  - 승인 전 롤백 리허설 기록

## 6. rollback 전략

- 공통 원칙
  - 실패 감지 시 즉시 Phase 이전 상태로 회귀.
  - Git snapshot 기준점 기준 코드 롤백 우선.
  - 운영 데이터 변경 시점이 관여되면 restore rehearsal로만 복구 판단.

- M1 -> M2 롤백
  - tokenized webhook 등록만 비활성.
  - legacy path 동작만 유지.
  - stage route 로그만 비교 후 재진입.

- M2 -> M3 롤백
  - store-scoped send/답변 준비 로직 비활성.
  - tokenized 경로의 credential 주입을 일시 중단하고 기존 no-send/no-op 기준으로 복귀.

- M3 -> M4 롤백
  - 운영 default 라우팅을 legacy 우선으로 되돌림.
  - tokenized routing의 공개 노출 경로 차단 및 모니터링 강화.
  - 필요 시 운영 승인 없이 추가 전환 중단.

- 긴급 복구
  - 교차침투/권한오류 급증(401/403/404 비정상 편차), webhook mismatch 급증, LINE 메시지 오발송 징후 발생 시 즉시 M2 이전 수준으로 축소.

## 7. 성공 기준

- 공통
  - cross-store 직접 접근/우회가 route/서비스 계층에서 404/403으로 차단.
  - LINE store mismatch 정책이 문서와 일치.
  - 프로덕션 secret/토큰은 변경 없이 오직 점검 승인된 런타임 범위 내 사용.
- M1
  - 기존 데이터 경계와 위험 항목이 점검 문서로 정합.
  - migration BLOCKER 후보가 식별됨.
- M2
  - tokenized webhook resolve 성립/미성립 분기 정상.
  - legacy fallback 동작이 의도대로 유지됨.
- M3
  - 제한된 feature에서 실제 오발송 없이 reply/notify 흐름 규칙 검증.
  - store mismatch 테스트에서 정책 응답 고정.
- M4
  - store settings/line settings/products/orders/repairs/purchase-confirm의 store scope가 운영 기준으로 일관 동작.
  - 운영 승인 체크리스트 통과 후 production 승인 요청 가능.

## 8. 실패 시 즉시 복구 절차

1. 문제 감지 (교차침투, 웹훅 처리 오류, 오발송 징후, webhook 인증 실패 급증)
2. 즉시 scope 축소
  - `tokenized webhook` 수신/처리 비활성 또는 축소.
  - legacy 경로로 fallback.
3. 증상 캡처
  - request id, store hint, signature 결과, line user id, webhook token/hash 기록.
4. 롤백 실행
  - 설정/코드 변경은 직전 승인 snapshot 기준으로 되돌림.
5. 재오픈 조건 확인
  - 동일 장애 재현성 제거 후 단일 테스트 케이스 통과 시 단계별 재개.

## 9. 운영 승인 체크리스트

- 기술 승인
  - store scope 감사 결과 PASS
  - webhook token/secret 매핑 + webhookPathToken 동작 PASS
  - repair/order/purchase-confirm cross-store 차단 PASS
- 운영 승인
  - owner onboarding SOP 적용 가능성
  - 운영 대응 runbook(실패 복구) 승인
  - 실제 LINE OA 발송 전 제한 및 테스트 승인
- 출시 승인
  - staging/rehearsal에서 v1 체크리스트의 남은 blocking 항목 정리 상태
  - production 단계 전환 동의(rollout gate)

## 10. production ready 조건

다음 항목이 모두 충족되면 production transition 검토 가능.

- `store scope` 핵심 영역(store settings, line settings, products, orders, repairs, purchase-confirm)에서 구조적 누락 route 없음.
- `legacy /api/line/webhook`에서 `store_id=1` 암묵 의존이 단계적으로 제거되거나 승인된 제한조건으로 유지됨.
- 자동화 회귀(교차 침투, public flow, webhook mismatch) 정합적으로 통과.
- production LINE OA, production webhook, production token은 변경 없이 운영 승인된 모드에서만 동작.
- 실패 시 restore/rollback rehearsal 기록이 완료되고, staging에서 실행해 검증된 운영중단 기준 시간 내 복구 가능성이 입증됨.
