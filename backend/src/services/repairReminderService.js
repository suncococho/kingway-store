const config = require("../config");
const { sendLineMessage } = require("../utils/line");
const { sendInternalTelegram } = require("./telegramService");
const { listPickupReminderCandidates } = require("./repairPickupReminderService");

async function sendRepairPickupReminders() {
  const rows = await listPickupReminderCandidates(undefined, {
    includeCustomerLineUser: true,
    includeSuppression: true,
    includeCompletedConfirmation: true
  });

  let lineSent = 0;
  let adminAlerts = 0;

  for (const row of rows) {
    const days = Number(row.daysAfterComplete || 0);

    if (days === 1) {
      await sendLineMessage(config, row.lineUserId, [
        {
          type: "text",
          text: `您的自行車維修已完成，請記得至門市付款 / 取車。\n維修單 #${row.id}`
        }
      ]);
      lineSent += 1;
    }

    if (days === 3) {
      await sendLineMessage(config, row.lineUserId, [
        {
          type: "text",
          text: `提醒您：維修單 #${row.id} 已完修超過 3 日。\n今日起未取車將開始計算保管費 NT$80/日。`
        }
      ]);
      lineSent += 1;
    }

    if (days >= 7) {
      await sendInternalTelegram(["admin", "staff"], [
        {
          type: "text",
          text: `⚠️ 維修單 #${row.id} 已完修 ${days} 日仍未取車。\n客戶：${row.customerName || "-"}\n目前保管費：NT$${Number(row.storageFee || 0)}`
        }
      ]);
      adminAlerts += 1;
    }
  }

  return { checked: rows.length, lineSent, adminAlerts };
}

module.exports = {
  sendRepairPickupReminders
};
