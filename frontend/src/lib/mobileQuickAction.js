const MOBILE_QUICK_ACTION_KEY = "kingway_mobile_quick_action_pending";

export function isMobileViewport() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.matchMedia("(max-width: 768px)").matches;
}

export function markMobileQuickActionPending() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(MOBILE_QUICK_ACTION_KEY, "1");
}

export function consumeMobileQuickActionPending() {
  if (typeof window === "undefined") {
    return false;
  }

  const pending = window.localStorage.getItem(MOBILE_QUICK_ACTION_KEY) === "1";
  if (pending) {
    window.localStorage.removeItem(MOBILE_QUICK_ACTION_KEY);
  }

  return pending;
}

export function clearMobileQuickActionPending() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(MOBILE_QUICK_ACTION_KEY);
}
