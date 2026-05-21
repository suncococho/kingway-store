# Staging Restore Execution Result Template

## 1. 실행 정보

```text
Date:
Operator:
Git branch: beta/staging-architecture
Git commit hash:

Backup file:
Backup checksum:
Backup created at:
Backup size:

Staging folder: /volume1/docker/kingway-store-staging
Staging DB: kingway_store_staging_restore

Staging ports:
- MySQL: 3310 -> 3306
- Backend: 3010 -> 3000
- Frontend: 5180 -> 80
```

확인:

```text
Production DB used: YES / NO
Production compose modified: YES / NO
Production container restarted: YES / NO
Production volume mounted: YES / NO
Production notification sent: YES / NO
```

## 2. Restore 실행 결과

```text
MySQL restore result: PASS / FAIL / BLOCKER
Backend startup result: PASS / FAIL / BLOCKER
Frontend startup result: PASS / FAIL / BLOCKER
Container status result: PASS / FAIL / BLOCKER
Restore duration:

Restore started at:
Restore finished at:
```

상세 기록:

```text
MySQL restore notes:

Backend startup notes:

Frontend startup notes:

Container status:
- kingway-staging-mysql:
- kingway-staging-backend:
- kingway-staging-frontend:

Restore duration notes:
```

판정 기준:

- `PASS`: staging DB restore와 staging 서비스 기동이 정상 완료됨
- `FAIL`: staging 내부 문제로 restore 또는 기동 일부 실패
- `BLOCKER`: production 대상 접근, production credential 사용, production 영향 가능성 발견

## 3. Smoke Test 결과 표

```text
Item                          Result                  Notes
Login                         PASS / FAIL / BLOCKER
Dashboard                     PASS / FAIL / BLOCKER
Customers                     PASS / FAIL / BLOCKER
POS                           PASS / FAIL / BLOCKER
Orders                        PASS / FAIL / BLOCKER
Repairs                       PASS / FAIL / BLOCKER
Coupons                       PASS / FAIL / BLOCKER
Inventory                     PASS / FAIL / BLOCKER
Purchase Confirmation         PASS / FAIL / BLOCKER
PDF Generation                PASS / FAIL / BLOCKER
Chinese Text Rendering        PASS / FAIL / BLOCKER
```

상세 기록:

```text
Login notes:

Dashboard notes:

Customers notes:

POS notes:

Orders notes:

Repairs notes:

Coupons notes:

Inventory notes:

Purchase confirmation notes:

PDF generation notes:

Chinese text rendering notes:
```

## 4. Notification Isolation 결과

```text
LINE disabled: PASS / FAIL / BLOCKER
Telegram disabled: PASS / FAIL / BLOCKER
Email disabled: PASS / FAIL / BLOCKER
Push disabled: PASS / FAIL / BLOCKER
```

확인 항목:

```text
LINE production credential present: YES / NO
LINE webhook enabled: YES / NO
LINE messaging enabled: YES / NO
Actual LINE message sent: YES / NO

Telegram production token present: YES / NO
Telegram notification enabled: YES / NO
Actual Telegram message sent: YES / NO

Email production credential present: YES / NO
Email enabled: YES / NO
Actual email sent: YES / NO

Push production credential present: YES / NO
Push enabled: YES / NO
Actual push sent: YES / NO
```

상세 기록:

```text
LINE isolation notes:

Telegram isolation notes:

Email isolation notes:

Push isolation notes:
```

BLOCKER 기준:

- production LINE credential이 staging에 존재함
- 실제 LINE 메시지가 발송됨
- production Telegram token이 staging에 존재함
- 실제 Telegram 메시지가 발송됨
- production email / push credential이 staging에 존재함
- 실제 email / push notification이 발송됨

## 5. Rollback Rehearsal 결과

```text
Rollback rehearsal performed: YES / NO
Rollback target DB: kingway_store_staging_restore
Rollback result: PASS / FAIL / BLOCKER
Rollback duration:
Rollback started at:
Rollback finished at:
```

상세 기록:

```text
Rollback scope:

Rollback steps executed:

Rollback verification:

Rollback issues:

Production rollback triggered: YES / NO
```

원칙:

- rollback rehearsal은 staging DB에서만 수행한다.
- staging rollback 성공이 production rollback 자동 실행을 의미하지 않는다.
- production rollback은 별도 승인 없이는 수행하지 않는다.

## 6. BLOCKER 기록

```text
Blocker occurred: YES / NO
Blocker severity:
Blocker detected at:
Blocker owner:
```

BLOCKER 상세:

```text
Blocker summary:

Evidence:

Immediate action taken:

Production impact suspected: YES / NO

Follow-up required:
```

BLOCKER 예시:

- production DB 대상 restore 시도 또는 실행
- production credential이 staging env에 포함됨
- production volume이 staging에 mount됨
- production notification 실제 발송
- restore 데이터 integrity 심각한 문제
- staging / production 대상 구분 불명확

## 7. Known Issue 기록

```text
Known issues found: YES / NO
```

```text
Issue 1:
- Summary:
- Area:
- Severity: LOW / MEDIUM / HIGH
- Impact:
- Workaround:
- Follow-up:

Issue 2:
- Summary:
- Area:
- Severity: LOW / MEDIUM / HIGH
- Impact:
- Workaround:
- Follow-up:
```

기록 원칙:

- BLOCKER가 아닌 문제도 추적 가능하게 기록한다.
- restore rehearsal 성공 여부와 별도로 후속 조치 대상을 명확히 한다.
- production 적용 전 반드시 해결해야 하는 이슈는 HIGH로 표시한다.

## 8. Production 영향 여부

```text
Production DB changed: YES / NO
Production container restarted: YES / NO
Production compose changed: YES / NO
Production env changed: YES / NO
Production volume mounted: YES / NO
Production upload path written: YES / NO
Production notification sent: YES / NO
Production reverse proxy changed: YES / NO
```

상세 기록:

```text
Production impact summary:

Evidence:

If any YES, explain:
```

판정:

- 모든 항목이 `NO`이면 production 영향 없음으로 기록한다.
- 하나라도 `YES`이면 최소 `BLOCKER`로 검토한다.
- 영향 여부가 불명확하면 `BLOCKER`로 기록한다.

## 9. 최종 판정

최종 판정 중 하나를 선택한다.

```text
Final result: PASS / PASS WITH WARNING / FAIL / BLOCKER
```

판정 기준:

### PASS

- restore가 staging DB에 정상 완료됨
- staging backend / frontend가 정상 기동됨
- 필수 smoke test가 통과됨
- notification isolation이 통과됨
- production 영향이 전혀 없음
- BLOCKER 없음

### PASS WITH WARNING

- 핵심 restore와 smoke test는 통과함
- production 영향 없음
- BLOCKER 없음
- 단, non-critical known issue 또는 후속 개선 항목이 있음

### FAIL

- staging 내부 restore, startup, smoke test 중 일부 실패
- production 영향 없음
- BLOCKER 없음
- 재실행 또는 수정 후 다시 rehearsal 필요

### BLOCKER

- production 영향이 발생했거나 발생 가능성이 있음
- production credential, production DB, production volume, production notification 관련 위험 발견
- staging / production 대상 구분이 불명확함
- 즉시 중단 후 별도 검토 필요

최종 기록:

```text
Final result:
Reason:

Required follow-up:

Approved for production use: YES / NO
Approver:
Approval date:
```

## 10. Production Safety 최우선 원칙

production safety가 restore rehearsal 결과 판정의 최우선 기준이다.

금지 사항:

- production DB restore 금지
- production DB migration 금지
- production docker-compose 수정 금지
- production container restart 금지
- production `.env` 복사 금지
- production volume mount 금지
- production upload path write 금지
- production LINE credential 사용 금지
- production Telegram token 사용 금지
- production webhook URL 사용 금지
- production email / push credential 사용 금지
- production notification 발송 금지
- production rollback 자동 실행 금지

결과 문서 작성 시 production 영향 여부가 조금이라도 불명확하면 `BLOCKER`로 기록한다.
