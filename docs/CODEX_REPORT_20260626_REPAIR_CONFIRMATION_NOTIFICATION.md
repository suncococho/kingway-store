1. 확인한 파일

- docs/KINGWAY_STORE_MASTER_SPEC.md
- frontend/src/pages/LineRepairRequestPage.jsx
- backend/src/routes/lineRepair.js
- backend/src/services/repairReservationService.js
- backend/src/routes/repairs.js
- backend/src/services/repairService.js
- backend/src/services/lineWorkflowService.js
- backend/src/routes/products.js
- backend/src/app.js
- backend/src/bootstrap.js
- backend/src/services/schemaGuardService.js
- frontend/src/pages/RepairsPage.jsx
- frontend/src/pages/RepairDetailPage.jsx
- frontend/src/lib/api.js
- frontend/src/styles.css

2. 현재 구조 요약

- LINE 수리예약 화면은 현재 車款 / 車種, 希望到店日期, 問題描述, 保固維修範圍確認만 입력받고 JSON으로 /api/line-repair/create에 전송한다.
- /api/line-repair/create는 line_chat_sessions payload를 만들고 createRepairReservationFromSession()을 통해 repair_orders를 생성한다.
- 수리예약 생성 후 repair_logs, LINE/직원 알림 흐름은 있으나 사진/영상 첨부 저장 또는 연결 구조는 없다.
- 수리관리 목록과 상세는 repair_orders 중심으로 조회하며 logs, surveys, confirmation 정보는 내려주지만 첨부파일 목록은 내려주지 않는다.
- 기존 파일 업로드는 상품 이미지에서 express.raw() 기반 단일 파일 업로드를 사용하며 multer 의존성은 없다.
- backend/storage는 /files 정적 경로로 서빙되고, 상품 이미지는 backend/storage/products 아래 저장된다.

3. 필요한 변경 파일

- frontend/src/pages/LineRepairRequestPage.jsx: 고객이 사진/영상을 선택하고 예약 생성 후 첨부파일을 업로드하는 UI와 상태 추가.
- frontend/src/lib/api.js: 기존 apiUploadImage와 유사한 범용 파일 업로드 helper 추가 또는 수리예약 화면에서 직접 raw fetch 처리.
- backend/src/routes/lineRepair.js: /api/line-repair/:repairId/attachments 같은 고객용 첨부 업로드 endpoint 추가, LINE userId와 store scope 및 repair ownership 검증.
- backend/src/routes/repairs.js: 수리 목록 또는 상세 API에서 첨부파일 목록/개수 조회 및 반환.
- frontend/src/pages/RepairDetailPage.jsx: 수리 항목별 사진/영상 보기 섹션 추가.
- frontend/src/pages/RepairsPage.jsx: 필요 시 목록 badge 또는 첨부파일 개수 표시.
- frontend/src/styles.css: 첨부파일 grid, 이미지 preview, 영상 표시 스타일 추가.
- backend/src/bootstrap.js 또는 별도 migration script: 첨부파일 metadata table 생성 로직 추가.

4. DB/migration 필요 여부

- 필요하다.
- 파일을 repair_order별로 안정적으로 추적하려면 repair_attachments 같은 새 metadata table이 적절하다.
- 권장 컬럼: id, store_id, repair_order_id, uploaded_by_type, line_user_id, original_file_name, mime_type, file_size, media_type, storage_path, public_url, created_at.
- production migration은 금지 상태이므로 실행하지 않는다. 이후 staging에서 먼저 확인하고, production은 백업 및 명시 승인 후 진행해야 한다.

5. 위험한 작업 여부

- 현재까지 위험 작업은 수행하지 않았다.
- 파일 수정은 이 보고서 문서 생성만 수행했다.
- DB write, migration 실행, Docker 작업, deploy, git push는 수행하지 않았다.
- 구현 단계에서 주의할 점은 업로드 파일 크기 제한, 허용 MIME type 제한, store_id 격리, LINE userId ownership 검증, public file URL 노출 범위다.

6. 다음 단계 제안

- staging 기준으로 repair_attachments schema를 추가하는 최소 migration을 준비한다.
- 기존 상품 이미지 업로드 패턴을 재사용해 새 의존성 없이 사진/영상 raw upload endpoint를 구현한다.
- LINE 수리예약에서 예약 생성 성공 후 첨부파일을 순차 업로드하고, 일부 업로드 실패 시 고객에게 재시도 가능한 안내를 표시한다.
- 수리 상세 화면에 上傳檔案 / 照片影片 섹션을 추가해 이미지 preview와 영상 열람 링크를 제공한다.
- staging에서 build, health, 고객 예약 생성, 첨부 업로드, 수리 상세 조회를 먼저 확인한다.
