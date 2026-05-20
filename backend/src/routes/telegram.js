const https = require("https");
const express = require("express");

const { handleStockCommand } = require("../services/telegramService");

const router = express.Router();

router.post('/webhook', async (req, res) => {
  console.log("[TG webhook]", JSON.stringify(req.body));

  const text = req.body.message?.text;
  const chatId = req.body.message?.chat?.id;

  if (!text || !chatId) {
    return res.sendStatus(200);
  }

  try {
    const handledStock = await handleStockCommand(req.body.message);
    if (handledStock) {
      return res.sendStatus(200);
    }
  } catch (err) {
    console.error("[TG stock handler error]", err.message);
  }

  let reply = "未知指令";

  if (text.startsWith('/help')) {
    reply = `可用指令：
/order 建立訂單
/up 新增商品
/baojia 建立維修報價
/crm 查詢客戶`;
  } else if (text.startsWith('/order')) {
    reply = "請輸入電話號碼";
  } else if (text.startsWith('/up')) {
    reply = "請輸入建立者姓名";
  } else if (text.startsWith('/baojia')) {
    reply = "請輸入報價人員姓名";
  } else if (text.startsWith('/crm')) {
    reply = "請輸入客戶電話";
  }

  try {
    const token = process.env.TELEGRAM_STOCK_BOT_TOKEN || process.env.TELEGRAM_NOTIFY_BOT_TOKEN;
    const payload = JSON.stringify({
      chat_id: chatId,
      text: reply
    });

    await new Promise((resolve, reject) => {
      const request = https.request(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload)
          }
        },
        (response) => {
          response.on("data", () => {});
          response.on("end", resolve);
        }
      );

      request.on("error", reject);
      request.write(payload);
      request.end();
    });
  } catch (err) {
    console.error("TG send error", err.message);
  }

  res.sendStatus(200);
});

module.exports = router;
