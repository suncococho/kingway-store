const crypto = require("crypto");
const { isReadOnlyValidationMode, validationSkipResult } = require("../runtime/validationMode");

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

function normalizeLineSendContext(context = {}) {
  return {
    storeId: context.storeId ?? null,
    storeCode: context.storeCode ?? null,
    lineChannelId: context.lineChannelId ?? null,
    channelAccessTokenRef: context.channelAccessTokenRef ?? null,
    channelSecretRef: context.channelSecretRef ?? null,
    source: context.source ?? null,
    purpose: context.purpose ?? null,
    credentialsResolved: context.credentialsResolved ?? null
  };
}

function normalizeLineSendOptions(options = {}) {
  const normalizedOptions = options && typeof options === "object" ? { ...options } : {};
  const contextSource = normalizedOptions.context && typeof normalizedOptions.context === "object"
    ? normalizedOptions.context
    : normalizedOptions;

  normalizedOptions.context = normalizeLineSendContext(contextSource);
  return normalizedOptions;
}

function resolveLineAccessToken(config, options = {}) {
  const normalizedOptions = normalizeLineSendOptions(options);
  const scopedAccessToken = normalizedOptions.channelAccessToken || normalizedOptions.accessToken || null;

  if (normalizedOptions.allowConfigFallback === false) {
    return scopedAccessToken;
  }

  return scopedAccessToken || config.line.channelAccessToken;
}

function buildSafeLineApiError(responseStatus, details) {
  const normalizedDetails = String(details || "").trim();
  let safeDetails = normalizedDetails;

  try {
    const parsed = JSON.parse(normalizedDetails);
    if (parsed && typeof parsed === "object") {
      safeDetails = parsed.message || parsed.details || parsed.reason || normalizedDetails;
    }
  } catch (error) {
    safeDetails = normalizedDetails;
  }

  return {
    message: `LINE API request failed: ${responseStatus}`,
    safeDetails: safeDetails ? String(safeDetails).slice(0, 300) : null
  };
}

async function sendLineReply(config, replyToken, messages, options = {}) {
  if (isReadOnlyValidationMode()) {
    return validationSkipResult();
  }
  const normalizedOptions = normalizeLineSendOptions(options);
  const channelAccessToken = resolveLineAccessToken(config, normalizedOptions);

  if (!channelAccessToken) {
    throw new Error("LINE channel access token is not configured");
  }

  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`
    },
    body: JSON.stringify({
      replyToken,
      messages
    })
  });

  if (!response.ok) {
    const details = await response.text();
    const safeError = buildSafeLineApiError(response.status, details);
    const error = new Error(safeError.message);
    error.statusCode = 502;
    error.lineApiStatus = response.status;
    error.safeDetails = safeError.safeDetails;
    throw error;
  }
}

async function sendLineMessage(config, to, messages, options = {}) {
  if (isReadOnlyValidationMode()) {
    return validationSkipResult();
  }
  const normalizedOptions = normalizeLineSendOptions(options);
  const channelAccessToken = resolveLineAccessToken(config, normalizedOptions);

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
    const safeError = buildSafeLineApiError(response.status, details);
    const error = new Error(safeError.message);
    error.statusCode = 502;
    error.lineApiStatus = response.status;
    error.safeDetails = safeError.safeDetails;
    throw error;
  }
}

module.exports = {
  normalizeLineSendContext,
  normalizeLineSendOptions,
  verifyLineSignature,
  resolveLineAccessToken,
  sendLineReply,
  sendLineMessage
};
