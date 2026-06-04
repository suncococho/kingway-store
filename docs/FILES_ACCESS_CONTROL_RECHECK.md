# Files Access Control Recheck (SaaS v1)

Date: 2026-06-04
Branch: `beta/staging-architecture`
Auditor: Codex
Scope: `SaaS v1 launch pre-check` (code 수정 없음, DB 변경 없음, 배포 없음)

## 점검 대상

- `backend/src/app.js`
- `backend/src/routes/purchaseConfirmations.js`
- `backend/src/routes/products.js`
- `backend/src/routes/customers.js`
- `backend/src/routes/repairs.js`
- `docs/FILES_ISOLATION_AUDIT.md`
- `docs/SAAS_V1_REHEARSAL_FINAL_REPORT.md`

## 1) /files/* static mount 상태

- 현재 상태: `OPEN`
- 근거
  - `backend/src/app.js:426`  
    `app.use("/files", express.static(path.join(__dirname, "..", "storage")));`
  - 인증/권한/`store_id` 검사 미적용
- 영향: 스토어 분리(store_id)를 거치지 않는 직접 URL 접근이 가능.

## 2) /files/pdfs/* 차단 상태

- 현재 상태: `BLOCKED (일반 경로)`
- 근거
  - `backend/src/app.js:426`  
    `/files/pdfs` 가 `/files` 이전에 별도 등록 라우트로 선차단되어 `404`.
  - `app.use("/files/pdfs", (req, res) => res.status(404)... )`
- 비고: `/files/pdfs` 직접 접근은 차단되나, 다른 `/files/*`는 여전히 공개.

## 3) purchase-confirm PDF 게이트 상태

- `/api/purchase-confirmations/public/:token/pdf`
  - 상태: `TOKEN GATED`
  - 근거: `fetchPurchaseConfirmationToken` 기반 조회 후 `sendPurchaseConfirmationPdfFile`.
  - `assertPurchaseConfirmationStoreMatch`는 요청 `store` 파라미터가 있을 때만 store 일치 검사.
  - `:token` 자체가 유효성의 주된 gate.
- `/api/purchase-confirmations/manual/:id/pdf`
  - 상태: `STAFF / 토큰 GATED`
  - 근거: `optionalStaffStoreContext` + `access` JWT(scope `manual_download`/`staff_download`) 검증.
  - `fetchPurchaseConfirmationPdfRecordById`에 `scopedStoreId` 전달.
- `/api/purchase-confirmations/download/:accessToken`
  - 상태: `SIGNED TOKEN GATED`
  - 근거: `verifyPurchaseConfirmationPdfAccessToken` 필요, `storeId` 클레임 확인.
- `/api/purchase-confirmations/:id/pdf`
  - 상태: `STORE GATED (staff auth route)`
  - 근거: `fetchPurchaseConfirmationPdfRecordById(confirmationId, req.storeId)`.

## 4) Product images public 접근 상태

- 현재 상태: `OPEN WITH GUESSABILITY REDUCTION`
- 근거
  - 업로드 API는 auth + store scope 존재 (`backend/src/routes/products.js`).
  - 저장 위치: `storage/products` (write)
  - 반환 URL: `/files/products/<filename>`
  - 정적 제공 경로: `/files` 공개 마운트 (app.js)
- 즉, 업로드는 보안되지만 URL이 노출되면 store 분리 없이 읽기 가능.

## 5) repair/customer attachment route 존재 여부

- `repair attachment` 전용 업로드/다운로드 라우트는 현재 미확인.
- `backend/src/routes/repairs.js`에는 상태 변경, 조회, 첨부 관련 전용 파일 라우트 없음.
- `backend/src/routes/customers.js`에서도 첨부 파일 제공 라우트는 없음.
- 다만 repair/상품 이미지 URL 정규화에서 `/files/...` 패턴 노출은 존재.

## 6) 직접 URL로 접근 가능한 파일 경로

- 현재 확인된 직접 접근 가능 경로:
  - `/files/products/<file>` (public, store_id 미검증)
  - `/files/<anything>` (app.js static mount로 일반 접근 허용)
  - `storage/products` 하위 경로는 업로드 파일 반환 구조상 외부에서 직접 조회 가능.
- 확인된 직접 차단 경로:
  - `/files/pdfs/*` (`404` 처리)

## 7) store_id 검증 없이 열려 있는 경로

- `store_id` 미검증 공개 경로
  - `/files/*`
  - `/files/products/*` (상기 포함)
- `store_id` 조건이 있는 경로
  - `/api/purchase-confirmations/public/:token/pdf` (토큰 기반 + 옵션 store 일치 검사)
  - `/api/purchase-confirmations/manual/:id/pdf` (staff/JWT + 접근 토큰)
  - `/api/purchase-confirmations/download/:accessToken` (signed token)

## 위험도 분류

- `HIGH`
  - 글로벌 `/files/*` 무조건 공개 노출
  - 업로드된 상품/기타 파일의 tenant 경계 없는 추출 위험
- `MEDIUM`
  - 구매확인서 public flow가 토큰 의존이므로 URL 유출/공유 시 유효성 의존 위험
- `LOW`
  - `/files/pdfs/*` 차단 상태는 현재 유효하지만, 우회 경로 노출 재점검 필요

## v1 launch blocker 여부

- `v1 launch blocker: YES`  
  - 이유: `/files/*` 공개 마운트 자체가 남아있어 tenant 경계가 무너질 수 있는 루트가 존재.

## 출시 전 반드시 막아야 할 항목

- 1순위: `backend/src/app.js`의 `/files` 정적 마운트 보안화
  - `/files`를 모두 허용하는 형태 폐기 또는 인증·store 검증된 signed URL/라우트 기반으로 전환
- 2순위: 정적 파일 접근 경로의 store 스코프 강제
  - `/files/products/*`는 owner 조회만으로는 부족하므로 파일 조회 API에서 `store_id` 검증 필요
- 3순위: purchase-confirmation 공개 URL/토큰 검증과 감사 로그 일관성 강화
  - 토큰만으로 공개 가능한 부분에 대한 모니터링 강화

## 나중으로 미뤄도 되는 항목

- 과거 유실/누적 파일 정리 전략(파기 정책)
- `/files` 미사용 정적 자산의 CDN 이전 계획
- 로그/권한 감사 대시보드의 보강

## 수정 필요 파일(권장)

- `backend/src/app.js`
- `backend/src/routes/products.js`
- `backend/src/routes/purchaseConfirmations.js`
- `backend/src/services/repairReservationService.js`(첨부/알림 연계 재검토 시)

## 다음 구현 1순위

- `/files` 공개 마운트 제거 또는 보호 레이어를 둔 전용 파일 라우트(예: `/api/files/:storeId/...` + signed token) 도입.
