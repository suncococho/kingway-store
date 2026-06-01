# KINGWAY Staging Backup Runbook

## Current Backup Status

KINGWAY staging now has a local NAS backup script at:

- `scripts/backup-kingway-staging.sh`

Backups are local only. Google Drive/rclone is not configured yet and should be handled in a later phase.

This backup system is only for `kingway-store` staging. Do not use it for production and do not mix it with any other project backup workflow.

## Manual Backup

Run from the repository root:

```sh
cd /volume1/docker/kingway-store
scripts/backup-kingway-staging.sh
```

The script uses the staging MySQL container:

- container: `kingway-staging-mysql`
- database: `kingway_store`
- user: `kingway`

The MySQL password is passed through `MYSQL_PWD` inside `docker exec` and is not printed in backup logs.

## Backup Location

Backups are stored under:

```text
/volume1/docker/kingway-store/backups/staging/YYYYMMDD_HHMMSS
```

The script keeps the latest 14 timestamp folders and removes older folders under the staging backup root.

## Included Files

Each successful backup folder includes:

- `mysql_kingway_store.sql.gz`: compressed staging MySQL dump.
- `project_files.tar.gz`: project files from `/volume1/docker/kingway-store`.
- `storage_files.tar.gz`: storage folders, when `backend/storage` or `storage` exists.
- `manifest.txt`: timestamp, git branch, git commit, docker ps summary, backup file sizes, and cleanup result.

`project_files.tar.gz` excludes:

- `node_modules`
- `frontend/dist`
- `backups`
- `.git`

## Inspect A Backup

List backup folders:

```sh
ls -l /volume1/docker/kingway-store/backups/staging
```

Read a manifest:

```sh
cat /volume1/docker/kingway-store/backups/staging/YYYYMMDD_HHMMSS/manifest.txt
```

Inspect archive contents without extracting:

```sh
tar -tzf /volume1/docker/kingway-store/backups/staging/YYYYMMDD_HHMMSS/project_files.tar.gz | head

tar -tzf /volume1/docker/kingway-store/backups/staging/YYYYMMDD_HHMMSS/storage_files.tar.gz | head

gzip -l /volume1/docker/kingway-store/backups/staging/YYYYMMDD_HHMMSS/mysql_kingway_store.sql.gz
```

## Restore MySQL Into Staging

Warning: restore only into staging. Confirm the target container is `kingway-staging-mysql` before running any restore command. Never point this command at production.

Recommended staging restore pattern:

```sh
cd /volume1/docker/kingway-store
BACKUP_DIR=/volume1/docker/kingway-store/backups/staging/YYYYMMDD_HHMMSS

gzip -dc "$BACKUP_DIR/mysql_kingway_store.sql.gz" \
  | sudo docker exec -i -e MYSQL_PWD=kingway kingway-staging-mysql \
      mysql -ukingway kingway_store
```

Before restoring over a live staging database, confirm the current staging state has its own fresh backup.

## Extract Project Or Storage Files

Extract project files into a temporary inspection folder:

```sh
mkdir -p /tmp/kingway-project-restore-check
tar -xzf /volume1/docker/kingway-store/backups/staging/YYYYMMDD_HHMMSS/project_files.tar.gz \
  -C /tmp/kingway-project-restore-check
```

Extract storage files into a temporary inspection folder:

```sh
mkdir -p /tmp/kingway-storage-restore-check
tar -xzf /volume1/docker/kingway-store/backups/staging/YYYYMMDD_HHMMSS/storage_files.tar.gz \
  -C /tmp/kingway-storage-restore-check
```

Do not overwrite the live repository or live storage folders until the restore target has been confirmed.

## Production Safety Warning

This runbook is for KINGWAY staging only. Do not restore these backups into production, do not run production compose files, and do not point MySQL restore commands at production containers or volumes.

## Later Phase: Google Drive/rclone

rclone is not installed or configured by this phase. A later backup phase can add offsite sync after deciding the Google Drive destination, retention policy, encryption expectations, and restore test procedure.
