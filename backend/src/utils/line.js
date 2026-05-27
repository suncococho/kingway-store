const crypto = require("crypto");

function verifyLineSignature(rawBody, channelSecret, signature) {
  if (!channelSecret || !signature) {
    return false;
  }

  const digest = crypto
    .createHmac("SHA256", channelSecret)
    .update(rawBody || "")
    .digest("base64");

  const expected = Buffer.from(digest);
  const actual = Buffer.from(String(signature));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function resolveLineAccessToken(config, options = {}) {
  return options.channelAccessToken || options.accessToken || config.line.channelAccessToken;
}

async function sendLineMessage(config, to, messages, options = {}) {
  const channelAccessToken = resolveLineAccessToken(config, options);

  if (!channelAccessToken) {
    throw new Error("LINE channel access token is not configured");
  }

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`
    },
    body: JSON.stringify({
      to,
      messages
    })
  });

  if (!response.ok) {
    const details = await response.text();
    const error = new Error(`LINE push failed: ${response.status} ${details}`);
    error.statusCode = 502;
    throw error;
  }
}

module.exports = {
  verifyLineSignature,
  resolveLineAccessToken,
  sendLineMessage
};
