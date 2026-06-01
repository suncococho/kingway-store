# Codex Safety Rules for KINGWAY

Every Codex task must follow these rules.

## Allowed

Codex may do:

- Code changes
- Documentation changes
- node --check
- npm --prefix frontend run build
- git status
- git diff
- git add
- git commit
- git push origin beta/staging-architecture
- scripts/deploy-staging.sh
- Staging API curl checks
- Read-only DB inspection for staging

## Forbidden Without Explicit User Approval

Codex must NOT automatically run:

- NAS reboot / shutdown
- Production config changes
- Production .env changes
- DB delete / reset / DROP / TRUNCATE
- Docker volume delete
- rm -rf destructive commands
- Editing /volume1/scripts/kingway_backup.sh
- Changing Synology Task Scheduler backup jobs
- Touching LINE / Telegram raw tokens
- Printing raw secrets or tokens
- Changing production containers
- Restoring database backups
- Any command that can destroy or overwrite production data

If any forbidden action is needed, Codex must stop and report the exact reason and proposed command without executing it.

## Default Project

cd /volume1/docker/kingway-store

Branch:

beta/staging-architecture

Deploy command:

scripts/deploy-staging.sh

Staging URLs:

http://59.127.191.213:5180
http://59.127.191.213:5180/saas-admin
http://59.127.191.213:3010/api/saas-admin/stores

## Backup Rules

Do not modify existing production backup:

/volume1/scripts/kingway_backup.sh
/volume1/backup/kingway
Synology Task Scheduler: KINGWAY Backup

Staging backup script may be used manually:

/volume1/docker/kingway-store/scripts/backup-kingway-staging.sh
/volume1/docker/kingway-store/backups/staging

Do not register staging backup into Synology Task Scheduler unless the user explicitly approves.

## Required Final Report

After every Codex task, report:

- Commit hash
- Changed files
- Build/check result
- Deploy result if deployed
- API check result if relevant
- Any skipped or blocked actions
