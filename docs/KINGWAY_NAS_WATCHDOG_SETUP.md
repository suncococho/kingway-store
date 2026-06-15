# KINGWAY NAS Watchdog 設定

此文件說明如何在 Synology DSM 設定 KINGWAY watchdog，讓 NAS 開機後自動嘗試恢復 Container Manager / Docker / kingway-store，並每 5 分鐘巡檢一次。

## 檔案位置

- Watchdog script: `/volume1/docker/kingway-store/scripts/kingway_watchdog.sh`
- Watchdog log: `/volume1/docker/kingway-store/logs/kingway_watchdog.log`
- Optional secret env: `/volume1/docker/kingway-store/.env.watchdog`

## Telegram 設定

watchdog 會先讀取專案 `.env` 內既有的 Telegram 設定。若專案 `.env` 沒有設定，可建立 `.env.watchdog`：

```sh
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

設定權限：

```sh
chmod 600 /volume1/docker/kingway-store/.env.watchdog
```

不要在 DSM 工作排程、log、截圖或回報內容中輸出 token / chat id。

## DSM 開機自動執行

1. DSM -> Control Panel -> Task Scheduler
2. Create -> Triggered Task -> User-defined script
3. Event: Boot-up
4. User: `root`
5. Script:

```sh
/volume1/docker/kingway-store/scripts/kingway_watchdog.sh
```

## DSM 每 5 分鐘巡檢

1. DSM -> Control Panel -> Task Scheduler
2. Create -> Scheduled Task -> User-defined script
3. Schedule: every 5 minutes
4. User: `root`
5. Script:

```sh
/volume1/docker/kingway-store/scripts/kingway_watchdog.sh
```

## 注意事項

- Task Scheduler 請使用 `root` 執行。
- Script 內不需要加入 `sudo`。
- Watchdog 只會執行 `docker compose up -d` 做非破壞性恢復。
- 禁止刪除 Docker volume。
- 禁止清空、搬移或還原 MySQL data directory。
- 禁止對 production DB 做資料寫入。
- log rotation 設定已放在 `docker-compose.yml`，會在下次容器 recreate 時生效。
