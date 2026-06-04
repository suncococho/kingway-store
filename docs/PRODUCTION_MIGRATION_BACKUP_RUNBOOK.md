# Production Migration Backup Runbook

작성일: 2026-06-04  
대상 저장소: `KINGWAY 台南 獨立門市管理系統`  
대상 환경: production runtime `3000/5173`, production DB `3306`  
대상 DB: `kingway_store`

## 1. 백업 목적

이 runbook의 목적은 production `3306` SaaS migration 전에 현재 운영 원본을 안전하게 보존하는 것이다.

백업 목적:

- production DB 원본 보존
- `backend/uploads` 및 구매확인 PDF 보존
- 현재 production 환경 설정과 배포 기준점 보존
- rollback 및 restore 기준점 확보
- staging overwrite 없이 production 원본을 기준으로 migration 진행

이 문서는 backup 준비 및 검증 절차 문서다.

이번 범위에서 하지 않는 것:

- production DB schema 변경
- data backfill
- 배포
- reverse proxy 변경

## 2. 백업 대상

필수 백업 대상:

1. production DB `3306` `kingway_store` dump
2. `backend/uploads`
3. `backend/storage/pdfs`
4. `.env`
5. 현재 git commit hash
6. `docker-compose.yml`
7. nginx reverse proxy 설정 위치 기록

권장 추가 메타데이터:

- 현재 branch
- backup 실행 timestamp
- row count 기록
- checksum
- backup 파일 목록

## 3. 백업 저장 위치

권장 기본 저장 위치:

```text
/volume1/docker/kingway-store/backups/production-pre-saas/YYYYMMDD_HHMMSS
```

권장 보관 원칙:

- NAS 로컬 경로 1차 저장
- 별도 외부 경로 2차 복제
- migration window 동안 최소 2개 위치에 보관

예상 산출물:

- `mysql_kingway_store.sql.gz`
- `backend_uploads.tar.gz`
- `backend_storage_pdfs.tar.gz`
- `.env.backup`
- `docker-compose.production.yml`
- `git_commit.txt`
- `git_branch.txt`
- `row_counts.tsv`
- `nginx_reverse_proxy_location.txt`
- `manifest.txt`
- `sha256sums.txt`

## 4. mysqldump 명령

production DB dump 권장 명령:

```bash
MYSQL_PWD="$MYSQL_PASSWORD" \
mysqldump \
  -h 127.0.0.1 \
  -P 3306 \
  -u "$MYSQL_USER" \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --no-tablespaces \
  --default-character-set=utf8mb4 \
  kingway_store \
  | gzip -c > "$BACKUP_DIR/mysql_kingway_store.sql.gz"
```

원칙:

- `mysqldump` only
- `--single-transaction` 사용
- raw DB password를 명령 출력에 남기지 않음
- dump 후 gzip 압축

## 5. 파일 tar 백업 명령

### 5-1. uploads

```bash
tar -C /volume1/docker/kingway-store \
  -czf "$BACKUP_DIR/backend_uploads.tar.gz" \
  backend/uploads
```

### 5-2. 구매확인 PDF

```bash
tar -C /volume1/docker/kingway-store \
  -czf "$BACKUP_DIR/backend_storage_pdfs.tar.gz" \
  backend/storage/pdfs
```

### 5-3. 설정 파일 복사

```bash
cp /volume1/docker/kingway-store/.env "$BACKUP_DIR/.env.backup"
cp /volume1/docker/kingway-store/docker-compose.yml "$BACKUP_DIR/docker-compose.production.yml"
```

참고:

- `.env`는 민감정보를 포함하므로 접근 권한을 제한해야 한다.
- `backend/storage/pdfs`는 `purchase_confirmations.pdf_path`와 연결되므로 DB와 같이 보존해야 한다.

## 6. git commit 기록 명령

현재 production 기준점 기록:

```bash
git -C /volume1/docker/kingway-store branch --show-current > "$BACKUP_DIR/git_branch.txt"
git -C /volume1/docker/kingway-store rev-parse HEAD > "$BACKUP_DIR/git_commit.txt"
git -C /volume1/docker/kingway-store log -1 --oneline > "$BACKUP_DIR/git_commit_oneline.txt"
```

## 7. 백업 검증 방법

최소 검증 항목:

1. backup 디렉터리 생성 확인
2. DB dump 파일 존재 및 비어 있지 않음 확인
3. tar 파일 존재 및 열람 가능 확인
4. `.env.backup`, `docker-compose.production.yml` 존재 확인
5. git branch/commit 기록 확인
6. row count 파일 생성 확인
7. checksum 생성 확인

### 7-1. 파일 존재 확인

```bash
ls -lh "$BACKUP_DIR"
```

### 7-2. gzip dump 검증

```bash
gzip -t "$BACKUP_DIR/mysql_kingway_store.sql.gz"
gzip -l "$BACKUP_DIR/mysql_kingway_store.sql.gz"
```

### 7-3. tar 검증

```bash
tar -tzf "$BACKUP_DIR/backend_uploads.tar.gz" | head
tar -tzf "$BACKUP_DIR/backend_storage_pdfs.tar.gz" | head
```

### 7-4. row count 검증

권장 row count 비교 대상:

- `customers`
- `products`
- `orders`
- `order_items`
- `repair_orders`
- `purchase_confirmations`
- `coupons`

예시 확인:

```bash
cat "$BACKUP_DIR/row_counts.tsv"
```

### 7-5. checksum 검증

```bash
cd "$BACKUP_DIR"
sha256sum -c sha256sums.txt
```

## 8. restore 방법

주의:

- restore는 production 직접 overwrite가 아니라, 먼저 별도 검증 환경 또는 동일 버전 MySQL 대상에서 rehearsal 하는 것이 원칙이다.
- production live DB에 restore 명령을 바로 실행하지 않는다.

### 8-1. DB restore 예시

```bash
gzip -dc "$BACKUP_DIR/mysql_kingway_store.sql.gz" \
  | MYSQL_PWD="$MYSQL_PASSWORD" mysql -h 127.0.0.1 -P 3306 -u "$MYSQL_USER" kingway_store
```

실제 production 복구 시에는 아래 순서를 권장한다.

1. 복구 대상 host/port/database 재확인
2. 현재 production 상태의 추가 backup 확보
3. 별도 restore rehearsal 환경에서 import 검증
4. row count 및 샘플 데이터 검증
5. 운영 승인 후 production 복구 수행

### 8-2. 파일 restore 예시

```bash
mkdir -p /tmp/kingway-restore-check/uploads
mkdir -p /tmp/kingway-restore-check/pdfs

tar -xzf "$BACKUP_DIR/backend_uploads.tar.gz" -C /tmp/kingway-restore-check/uploads
tar -xzf "$BACKUP_DIR/backend_storage_pdfs.tar.gz" -C /tmp/kingway-restore-check/pdfs
```

원칙:

- 먼저 임시 경로로 extract
- live 경로 overwrite 전 파일 수와 경로 구조 확인
- `pdf_path` 경로와 실제 PDF 파일명 매칭 확인

### 8-3. nginx 설정 복구 참고

현재 reverse proxy 설정 위치 기록 대상:

```text
/etc/nginx/sites-enabled/server.ReverseProxy.conf
```

이 경로는 기존 cutover 문서 기준이다. 본 runbook에서는 위치 기록을 남기고, 파일 접근 권한이 허용되면 별도 사본 확보를 권장한다.

## 9. 절대 금지 작업

다음 작업은 backup 단계에서 금지한다.

- `DROP DATABASE`
- `DROP TABLE`
- `TRUNCATE TABLE`
- `DELETE FROM ...`
- `UPDATE ...`
- schema migration 실행
- staging DB를 production DB로 import
- production `.env`를 staging에 재사용
- production reverse proxy 변경
- backup 없이 migration 시작

## 10. migration 전 승인 체크리스트

- [ ] production DB `3306` 대상인지 재확인했다.
- [ ] staging `3310`과 production `3306`을 혼동하지 않는지 확인했다.
- [ ] backup 저장 디렉터리가 생성되었는지 확인했다.
- [ ] DB dump가 정상 생성되었는지 확인했다.
- [ ] `backend/uploads` tar가 생성되었는지 확인했다.
- [ ] `backend/storage/pdfs` tar가 생성되었는지 확인했다.
- [ ] `.env.backup`과 `docker-compose.production.yml`이 저장되었는지 확인했다.
- [ ] git branch / commit hash가 기록되었는지 확인했다.
- [ ] row count 파일이 생성되었는지 확인했다.
- [ ] checksum 검증을 통과했는지 확인했다.
- [ ] nginx reverse proxy 설정 위치가 기록되었는지 확인했다.
- [ ] backup 산출물을 2차 저장 위치로 복제할 계획이 있는지 확인했다.
- [ ] restore rehearsal 순서를 알고 있는지 확인했다.
- [ ] backup 완료 전에는 production SaaS migration을 시작하지 않기로 확인했다.

## 11. 실행 예시

repo root에서 실행:

```bash
cd /volume1/docker/kingway-store
bash scripts/backup-production-before-saas-migration.sh
```

실행 후 확인:

```bash
ls -lh /volume1/docker/kingway-store/backups/production-pre-saas/YYYYMMDD_HHMMSS
cat /volume1/docker/kingway-store/backups/production-pre-saas/YYYYMMDD_HHMMSS/manifest.txt
cat /volume1/docker/kingway-store/backups/production-pre-saas/YYYYMMDD_HHMMSS/row_counts.tsv
```

## 12. 결론

production SaaS migration 전 backup의 핵심은 staging 대체본을 만드는 것이 아니라 production 원본을 안전하게 고정하는 것이다.

따라서 순서는 다음으로 고정한다.

1. production DB dump
2. uploads / PDF backup
3. `.env` / `docker-compose.yml` / git commit 기록
4. row count / checksum 검증
5. restore rehearsal 계획 확인
6. 그 다음에만 schema-only migration 검토
