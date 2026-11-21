#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="${1:-/volume1/docker/kingway-store}"
REPORT_ROOT="${2:-$REPO_DIR/tmp/work-schedule-research}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-kingway-mysql}"

timestamp="$(date '+%Y%m%d_%H%M%S')"
report_file="$REPORT_ROOT/report-${timestamp}.txt"
error_file="$REPORT_ROOT/report-${timestamp}.errors.txt"

mkdir -p "$REPORT_ROOT"

log_section() {
  printf '\n\n==================================================\n'
  printf '%s\n' "$1"
  printf '==================================================\n'
}

safe_run() {
  local title="$1"
  shift
  log_section "$title"
  if "$@"; then return 0; fi
  local status=$?
  printf 'WARNING: command failed with exit code %s\n' "$status"
  printf 'COMMAND:'
  printf ' %q' "$@"
  printf '\n'
  return 0
}

mysql_query() {
  local query="$1"
  sudo docker exec "$MYSQL_CONTAINER" sh -lc "
    set -eu
    MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" \\
    mysql -u root -D \"\${MYSQL_DATABASE:-kingway_store}\" \\
      --default-character-set=utf8mb4 --table -e $(printf '%q' "$query")
  "
}

if [ ! -d "$REPO_DIR" ]; then
  echo "ERROR: repository directory not found: $REPO_DIR" >&2
  exit 1
fi

cd "$REPO_DIR"

{
  printf 'KINGWAY WORK SCHEDULE READ-ONLY RESEARCH REPORT\n'
  printf 'captured_at=%s\n' "$(date -Iseconds)"
  printf 'repo_dir=%s\n' "$REPO_DIR"
  printf 'mysql_container=%s\n' "$MYSQL_CONTAINER"
  printf 'mode=READ_ONLY\n'

  safe_run "1. REPOSITORY STATE" bash -lc '
    printf "pwd=%s\n" "$(pwd)"
    printf "branch=%s\n" "$(git branch --show-current 2>/dev/null || true)"
    printf "commit=%s\n" "$(git rev-parse HEAD 2>/dev/null || true)"
    echo "--- git status --short ---"
    git status --short 2>/dev/null || true
    echo "--- recent commits ---"
    git log -10 --oneline --decorate 2>/dev/null || true
  '

  safe_run "2. STAFF_USERS TABLE SCHEMA AND ROLE COUNTS" mysql_query "
    SHOW CREATE TABLE staff_users;
    SELECT role, COUNT(*) AS user_count FROM staff_users GROUP BY role ORDER BY role;
  "

  safe_run "3. STAFF USERS SAFE SUMMARY" mysql_query "
    SELECT id, store_id, username, display_name, role, is_active, created_at, updated_at
    FROM staff_users ORDER BY store_id, id;
  "

  safe_run "4. PAYROLL / INCENTIVE / ATTENDANCE / SCHEDULE TABLES" mysql_query "
    SELECT TABLE_NAME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        TABLE_NAME LIKE '%payroll%' OR TABLE_NAME LIKE '%salary%'
        OR TABLE_NAME LIKE '%wage%' OR TABLE_NAME LIKE '%incentive%'
        OR TABLE_NAME LIKE '%attendance%' OR TABLE_NAME LIKE '%schedule%'
        OR TABLE_NAME LIKE '%shift%' OR TABLE_NAME LIKE '%roster%'
      )
    ORDER BY TABLE_NAME;
  "

  safe_run "5. EXISTING FOREIGN KEY PATTERN" mysql_query "
    SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION;
  "

  safe_run "6. STAFF ROUTES AND DEACTIVATION REFERENCES" bash -lc '
    grep -RInE --include="*.js" --include="*.jsx" --exclude="*.bak*" --exclude="*before*" \
      --exclude-dir=node_modules --exclude-dir=.git \
      "staff_users|is_active|deactivat|inactive|離職|停用|員工管理" \
      backend/src frontend/src 2>/dev/null | head -700 || true
  '

  safe_run "7. AUTHORIZATION AND STORE SCOPE REFERENCES" bash -lc '
    grep -RInE --include="*.js" --exclude="*.bak*" --exclude="*before*" \
      --exclude-dir=node_modules --exclude-dir=.git \
      "req\\.storeId|req\\.user\\.id|req\\.user\\.role|isAdminRole|requireAdmin|ADMIN|CASHIER|STAFF" \
      backend/src 2>/dev/null | head -900 || true
  '

  safe_run "8. PAYROLL, INCENTIVE, AND STAFF FILES" bash -lc '
    find backend/src frontend/src -type f \
      \( -iname "*payroll*" -o -iname "*salary*" -o -iname "*wage*" \
         -o -iname "*incentive*" -o -iname "*attendance*" -o -iname "*schedule*" -o -iname "*staff*" \) \
      -print 2>/dev/null | sort || true
  '

  safe_run "9. SIDEBAR, MENU, ROUTE, AND PAYROLL UI REFERENCES" bash -lc '
    grep -RInE --include="*.jsx" --include="*.js" --exclude-dir=node_modules --exclude-dir=.git \
      "sidebar|menuItems|navItems|薪資|工資|員工|payroll|staff|Routes|Route path" \
      frontend/src 2>/dev/null | head -800 || true
  '

  safe_run "10. MIGRATION FILE INVENTORY" bash -lc '
    find migration sql database backend/scripts scripts -maxdepth 4 -type f 2>/dev/null | sort | tail -400 || true
  '

  safe_run "11. MIGRATION EXECUTION AND SCHEMA GUARD REFERENCES" bash -lc '
    grep -RInE --include="*.js" --include="*.sh" --include="package.json" --include="*.md" \
      --exclude-dir=node_modules --exclude-dir=.git \
      "migration|migrate|SchemaGuard|SchemaBootstrap|RUN_SCHEMA_BOOTSTRAP|verifyMigration" \
      backend scripts docs package.json 2>/dev/null | head -1000 || true
  '

  safe_run "12. DATE, TIME, WEEK, AND TIMEZONE REFERENCES" bash -lc '
    grep -RInE --include="*.js" --include="*.jsx" --include="*.yml" --include="*.yaml" --include=".env*" \
      --exclude-dir=node_modules --exclude-dir=.git \
      "Asia/Taipei|TZ=|timezone|DATE_FORMAT|DAYOFWEEK|WEEKDAY\\(|startOfWeek|endOfWeek|weekStartsOn" \
      backend/src frontend/src docker-compose*.yml 2>/dev/null | head -700 || true
  '

  safe_run "13. FRONTEND API, AUTH, ROLE, AND USER CONTEXT REFERENCES" bash -lc '
    grep -RInE --include="*.js" --include="*.jsx" --exclude-dir=node_modules --exclude-dir=.git \
      "apiRequest|currentUser|user\\.role|isAdmin|localStorage|getCurrentUser|AuthContext" \
      frontend/src 2>/dev/null | head -900 || true
  '

  safe_run "14. FRONTEND PACKAGE.JSON" bash -lc '
    if [ -f frontend/package.json ]; then cat frontend/package.json; else echo "frontend/package.json not found"; fi
  '

  safe_run "15. EXISTING CALENDAR / SHIFT / SCHEDULE CODE" bash -lc '
    grep -RInE --include="*.js" --include="*.jsx" --exclude="*.bak*" \
      --exclude-dir=node_modules --exclude-dir=.git \
      "schedule|shift|roster|calendar|班表|排班|勤務|근무" \
      backend/src frontend/src 2>/dev/null | head -900 || true
  '

  safe_run "16. ROUTE REGISTRATION REFERENCES" bash -lc '
    grep -RInE --include="*.js" --include="*.jsx" --exclude-dir=node_modules --exclude-dir=.git \
      "app\\.use|router\\.use|Routes|Route path" \
      backend/src frontend/src 2>/dev/null | head -900 || true
  '

  safe_run "17. RELEVANT DATABASE COLUMN INVENTORY" mysql_query "
    SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        TABLE_NAME = 'staff_users' OR TABLE_NAME LIKE '%payroll%' OR TABLE_NAME LIKE '%salary%'
        OR TABLE_NAME LIKE '%wage%' OR TABLE_NAME LIKE '%incentive%' OR TABLE_NAME LIKE '%attendance%'
        OR TABLE_NAME LIKE '%schedule%' OR TABLE_NAME LIKE '%shift%'
      )
    ORDER BY TABLE_NAME, ORDINAL_POSITION;
  "

  safe_run "18. PRODUCTION CONTAINER STATE (READ ONLY)" bash -lc '
    sudo docker inspect kingway-backend kingway-frontend kingway-mysql \
      --format "{{.Name}} image={{.Image}} started={{.State.StartedAt}} status={{.State.Status}} restart_count={{.RestartCount}}" \
      2>/dev/null || true
  '

  safe_run "19. STAGING CONTAINER STATE (READ ONLY)" bash -lc '
    sudo docker inspect kingway-staging-backend kingway-staging-frontend kingway-staging-mysql \
      --format "{{.Name}} image={{.Image}} started={{.State.StartedAt}} status={{.State.Status}} restart_count={{.RestartCount}}" \
      2>/dev/null || true
  '

  log_section "20. SAFETY SUMMARY"
  cat <<'SUMMARY'
This script performed read-only inspection only.

It did not:
- modify repository files
- write to MySQL
- run migrations
- restart or recreate containers
- build images
- create commits
- deploy to staging or production
- print LINE, Telegram, JWT, or database passwords
SUMMARY

} >"$report_file" 2>"$error_file"

if [ ! -s "$error_file" ]; then
  rm -f "$error_file"
  error_file=""
fi

printf '\nDONE\n'
printf 'REPORT_FILE=%s\n' "$report_file"
if [ -n "$error_file" ]; then printf 'ERROR_FILE=%s\n' "$error_file"; fi
printf 'REPORT_LINES=%s\n' "$(wc -l < "$report_file" | tr -d ' ')"
printf 'REPORT_SIZE=%s\n' "$(du -h "$report_file" | awk '{print $1}')"

echo
printf "sed -n '1,500p' %q\n" "$report_file"
printf "sed -n '501,1000p' %q\n" "$report_file"
printf "sed -n '1001,1500p' %q\n" "$report_file"
