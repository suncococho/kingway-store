import liff from "@line/liff";

const LIFF_ID = import.meta.env.VITE_LIFF_ID || "2010080463-s7I6a2BG";
const PROFILE_RETRY_DELAY_MS = [250, 500];
const QUERY_LINE_USER_ID_KEYS = [
  "lineUserId",
  "line_user_id",
  "lineUid",
  "lineUID",
  "liffUserId",
  "uid",
  "userId"
];
const QUERY_DISPLAY_NAME_KEYS = ["displayName", "lineDisplayName", "line_name", "name"];
const STORAGE_LINE_USER_ID_KEYS = [
  "lineUserId",
  "line_user_id",
  "kw_line_user_id",
  "kwLineUserId",
  "lineProfileUserId"
];
const STORAGE_DISPLAY_NAME_KEYS = [
  "lineProfileName",
  "line_display_name",
  "kw_line_profile_name",
  "lineUserName"
];

function normalizeValue(value) {
  const candidate = String(value || "").trim();
  return candidate || "";
}

function firstMatchFromMap(sourceMap, keys) {
  for (const key of keys) {
    const value = normalizeValue(sourceMap?.[key]);
    if (value) {
      return { value, key };
    }
  }

  return { value: "", key: "" };
}

function firstMatchFromQuery(keys) {
  const params = new URLSearchParams(window.location.search || "");

  const fallback = firstMatchFromMap(Object.fromEntries(Array.from(params.entries())), keys);

  if (fallback.value) {
    return fallback;
  }

  for (const key of keys) {
    const value = normalizeValue(params.get(key));
    if (value) {
      return { value, key };
    }
  }

  return { value: "", key: "" };
}

function firstMatchFromStorage(storage, keys) {
  if (!storage) {
    return { value: "", key: "" };
  }

  for (const key of keys) {
    try {
      const raw = storage.getItem(key);
      const value = normalizeValue(raw);

      if (value) {
        return { value, key };
      }
    } catch (error) {
      return { value: "", key: "" };
    }
  }

  return { value: "", key: "" };
}

function safeCall(fn, fallback = null) {
  try {
    return fn();
  } catch (error) {
    return fallback;
  }
}

function normalizeProfileErrorMessage(error) {
  return normalizeValue(error?.message || error?.name || String(error || ""));
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function getProfileWithRetry(retryDelays = PROFILE_RETRY_DELAY_MS) {
  let lastError = null;

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      return await liff.getProfile();
    } catch (error) {
      lastError = error;

      if (attempt >= retryDelays.length) {
        break;
      }

      await delay(retryDelays[attempt]);
    }
  }

  throw lastError || new Error("無法取得 LINE Profile");
}

function restoreFromSources() {
  const query = firstMatchFromQuery(QUERY_LINE_USER_ID_KEYS);
  if (query.value) {
    return {
      lineUserId: query.value,
      displayName: normalizeValue(new URLSearchParams(window.location.search || "").get("displayName") || ""),
      source: "query",
      sourceDetail: query.key
    };
  }

  const sessionUser = firstMatchFromStorage(window?.sessionStorage, STORAGE_LINE_USER_ID_KEYS);
  if (sessionUser.value) {
    return {
      lineUserId: sessionUser.value,
      displayName: firstMatchFromStorage(window?.sessionStorage, STORAGE_DISPLAY_NAME_KEYS).value,
      source: "sessionStorage",
      sourceDetail: sessionUser.key
    };
  }

  const localUser = firstMatchFromStorage(window?.localStorage, STORAGE_LINE_USER_ID_KEYS);
  if (localUser.value) {
    return {
      lineUserId: localUser.value,
      displayName: firstMatchFromStorage(window?.localStorage, STORAGE_DISPLAY_NAME_KEYS).value,
      source: "localStorage",
      sourceDetail: localUser.key
    };
  }

  return { lineUserId: "", displayName: "", source: "none", sourceDetail: "" };
}

function persistResolvedContext({ lineUserId, displayName }) {
  if (!lineUserId) {
    return;
  }

  for (const storage of [window?.sessionStorage, window?.localStorage]) {
    if (!storage) {
      continue;
    }

    try {
      storage.setItem("lineUserId", lineUserId);
      if (displayName) {
        storage.setItem("lineProfileName", displayName);
      }
    } catch (error) {
      break;
    }
  }
}

export async function resolveLineContext({ liffId = LIFF_ID } = {}) {
  const result = {
    inClient: false,
    isLoggedIn: false,
    lineUserId: "",
    displayName: "",
    source: "none",
    sourceDetail: "",
    profileSource: "none",
    failureReason: "",
    shouldLogin: false,
    profileAttempts: 0
  };

  try {
    await liff.init({ liffId });
  } catch (error) {
    result.failureReason = `LIFF 初始化失敗：${normalizeProfileErrorMessage(error)}`;
    return result;
  }

  const query = firstMatchFromQuery(QUERY_LINE_USER_ID_KEYS);
  const stored = restoreFromSources();
  const context = safeCall(() => liff.getContext(), null);
  result.inClient = Boolean(
    safeCall(() => liff.isInClient(), false) ||
    safeCall(() => Boolean(context?.type), false) ||
    safeCall(() => Boolean(context?.userId), false)
  );

  if (query.value) {
    result.lineUserId = query.value;
    result.source = "query";
    result.sourceDetail = query.key;
  } else if (stored.lineUserId) {
    result.lineUserId = stored.lineUserId;
    result.source = stored.source;
    result.sourceDetail = stored.sourceDetail;
    result.displayName = stored.displayName;
    result.displayName = result.displayName || firstMatchFromQuery(QUERY_DISPLAY_NAME_KEYS).value;
  }

  if (!result.displayName) {
    const contextDisplayName = firstMatchFromQuery(QUERY_DISPLAY_NAME_KEYS).value;
    result.displayName = normalizeValue(contextDisplayName);
    if (!result.displayName && context?.userId && stored?.lineUserId) {
      result.displayName = firstMatchFromStorage(window?.sessionStorage, ["lineProfileName"]).value || firstMatchFromStorage(window?.localStorage, ["lineProfileName"]).value;
    }
  }

  if (context?.userId) {
    const contextUserId = normalizeValue(context.userId);
    if (!result.lineUserId) {
      result.lineUserId = contextUserId;
      result.source = "context";
      result.sourceDetail = "liffContext";
    }
  }

  result.isLoggedIn = Boolean(safeCall(() => liff.isLoggedIn(), false));
  if (!result.isLoggedIn) {
    result.shouldLogin = true;
    result.failureReason = "LINE 尚未登入";
    try {
      liff.login();
    } catch (error) {
      result.failureReason = `LINE 登入失敗：${normalizeProfileErrorMessage(error)}`;
    }

    return result;
  }

  try {
    const profile = await getProfileWithRetry();
    result.profileAttempts = PROFILE_RETRY_DELAY_MS.length + 1;
    if (profile?.userId) {
      result.lineUserId = normalizeValue(profile.userId);
      result.displayName = normalizeValue(profile.displayName || result.displayName);
      result.profileSource = "profile";
      result.source = result.source || "profile";
      result.sourceDetail = result.sourceDetail || "liffProfile";
    }

    if (profile?.userId && !context?.userId && !result.source) {
      result.source = "profile";
      result.sourceDetail = "liffProfile";
    }

    if (result.lineUserId) {
      result.failureReason = result.failureReason ? `${result.failureReason}；備援來源已取得` : "";
      persistResolvedContext({
        lineUserId: result.lineUserId,
        displayName: result.displayName
      });
    }
    return result;
  } catch (error) {
    const profileError = normalizeProfileErrorMessage(error);
    result.profileAttempts = PROFILE_RETRY_DELAY_MS.length + 1;

    if (result.lineUserId) {
      result.failureReason = `getProfile 失敗：${profileError}`;
      persistResolvedContext({
        lineUserId: result.lineUserId,
        displayName: result.displayName
      });
      return result;
    }

    result.failureReason = `無法取得 LINE 使用者資料（${profileError}）。`;
    return result;
  }
}
