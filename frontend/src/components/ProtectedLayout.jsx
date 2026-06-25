import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Sidebar from "./Sidebar";
import StaffNotificationPopup from "./StaffNotificationPopup";
import { getImpersonationSession, stopImpersonationSession } from "../lib/auth";
import { apiRequest } from "../lib/api";
import { platformRequest } from "../lib/platformAuth";
import { getStoredUser } from "../lib/auth";
import { useMenuPermissions } from "../hooks/useMenuPermissions";
import { canAccessPath, getMenuKeyForPath } from "../lib/menuPermissions";
import { useStoreAccess } from "../hooks/useStoreAccess";
import { buildStoreOperationProfile } from "../lib/storeOperationProfile";

const PATH_FEATURE_MAP = {
  "/suppliers": "suppliers",
  "/store-transfers": "store_transfers",
  "/store-replenishment-requests": "store_transfers",
  "/hq-replenishment-requests": "store_transfers",
  "/hq-transfer-report": "store_transfers",
  "/inbound-transfers": "store_transfers",
  "/company-store-settlements": "company_store_settlements",
  "/headquarters": "headquarters"
};

const HQ_ONLY_PATHS = new Set([
  "/headquarters",
  "/store-transfers",
  "/hq-replenishment-requests",
  "/hq-transfer-report"
]);

const SUPPLIER_PATHS = new Set(["/suppliers"]);
const STORE_REPLENISHMENT_PATHS = new Set(["/store-replenishment-requests"]);
const INBOUND_TRANSFER_PATHS = new Set(["/inbound-transfers"]);

function getFeatureForPath(pathname) {
  return PATH_FEATURE_MAP[pathname] || null;
}

function ProtectedLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = getStoredUser();
  const [storeTypeCheck, setStoreTypeCheck] = useState({ loading: false, allowed: true, message: "" });
  const { permissions: menuPermissions, loading: menuPermissionsLoading } = useMenuPermissions(user);
  const { access: storeAccess } = useStoreAccess(user);
  const impersonationSession = useMemo(() => getImpersonationSession(), [location.pathname, location.search]);

  async function handleEndImpersonation() {
    const storeId = Number(impersonationSession?.storeId || 0);
    const targetStaffUserId = Number(impersonationSession?.targetStaffUserId || 0);

    if (!storeId) {
      stopImpersonationSession();
      navigate("/platform-admin");
      return;
    }

    try {
      await platformRequest("/saas-admin/stores/" + storeId + "/impersonation/stop", {
        method: "POST",
        body: JSON.stringify({
          targetStaffUserId,
          reason: "前端結束模擬登入"
        })
      });
    } catch (_error) {
      // continue stop flow for local restore
    }

    stopImpersonationSession();
    navigate("/platform-admin");
  }

  const shouldShowBanner = Boolean(impersonationSession?.active && !impersonationSession?.expired);
  const requiresStoreTypeCheck =
    HQ_ONLY_PATHS.has(location.pathname) ||
    SUPPLIER_PATHS.has(location.pathname) ||
    STORE_REPLENISHMENT_PATHS.has(location.pathname) ||
    INBOUND_TRANSFER_PATHS.has(location.pathname);

  useEffect(() => {
    let active = true;
    async function checkStoreType() {
      if (!requiresStoreTypeCheck) {
        setStoreTypeCheck({ loading: false, allowed: true, message: "" });
        return;
      }
      setStoreTypeCheck({ loading: true, allowed: false, message: "" });
      try {
        const response = await apiRequest("/company/me");
        if (active) {
          const profile = buildStoreOperationProfile(response, user?.storeId);
          let allowed = true;
          let message = "";
          if (HQ_ONLY_PATHS.has(location.pathname)) {
            allowed = profile.canUseHqFeatures;
            message = "此功能僅限本部或倉庫帳號使用。";
          } else if (SUPPLIER_PATHS.has(location.pathname)) {
            allowed = profile.canUseSuppliers;
            message = "此功能不適用於直營或加盟門市。";
          } else if (STORE_REPLENISHMENT_PATHS.has(location.pathname)) {
            allowed = profile.canUseStoreReplenishment;
            message = "此功能僅適用於直營或加盟門市。";
          } else if (INBOUND_TRANSFER_PATHS.has(location.pathname)) {
            allowed = profile.canUseInboundTransfers;
            message = "此功能不適用於獨立店家。";
          }
          setStoreTypeCheck({ loading: false, allowed, message });
        }
      } catch (_error) {
        if (active) {
          setStoreTypeCheck({ loading: false, allowed: false, message: "此功能不適用於目前門市類型。" });
        }
      }
    }
    checkStoreType();
    return () => {
      active = false;
    };
  }, [requiresStoreTypeCheck, location.pathname, user?.id, user?.storeId]);

  const isPosFullscreen =
    location.pathname === "/pos" &&
    new URLSearchParams(location.search).get("fullscreen") === "1";
  const guardedMenuKey = getMenuKeyForPath(location.pathname);
  const isCheckingMenuPermission = Boolean(guardedMenuKey && menuPermissionsLoading);
  const hasMenuAccess = canAccessPath(location.pathname, menuPermissions, user);
  const featureKey = getFeatureForPath(location.pathname);
  const featureLocked = Boolean(featureKey && storeAccess?.lockedFeatures?.includes(featureKey));
  const shouldShowAccessBanner = Boolean(storeAccess?.warningMessage);

  return (
    <div className={`app-shell ${isPosFullscreen ? "app-shell-pos-fullscreen" : ""}`}>
      {!isPosFullscreen ? <Sidebar /> : null}
      <StaffNotificationPopup />

      <main className={`page-content ${isPosFullscreen ? "page-content-pos-fullscreen" : ""}`}>
        {shouldShowBanner ? (
          <div className="impersonation-banner">
            <div>
              <strong>平台管理員模擬登入中</strong>
              <div className="muted-text">
                店家：{impersonationSession.storeName || `Store ${impersonationSession.storeId}`} / 員工：
                {impersonationSession.targetUsername || impersonationSession.targetStaffUserId}
                （{impersonationSession.targetStoreRole || "staff"}）
              </div>
            </div>
            <button type="button" className="secondary-button" onClick={handleEndImpersonation}>
              結束模擬登入
            </button>
          </div>
        ) : null}
        {shouldShowAccessBanner ? (
          <div className="impersonation-banner">
            <div>
              <strong>{storeAccess.effectiveStatus === "TRIAL_EXPIRED" ? "試用已到期" : storeAccess.effectiveStatus}</strong>
              <div className="muted-text">{storeAccess.warningMessage}</div>
            </div>
          </div>
        ) : null}
        {isCheckingMenuPermission || storeTypeCheck.loading ? (
          <section className="content-card section-panel">
            <div className="empty-state">權限確認中...</div>
          </section>
        ) : !hasMenuAccess || !storeTypeCheck.allowed ? (
          <section className="content-card section-panel">
            <div className="empty-state">
              <h2>權限不足</h2>
              <p>{storeTypeCheck.message || "您沒有權限使用此功能"}</p>
            </div>
          </section>
        ) : featureLocked ? (
          <section className="content-card section-panel">
            <div className="empty-state">
              <h2>功能已鎖定</h2>
              <p>{storeAccess.warningMessage || "此功能不包含在目前方案，請聯絡平台管理員。"}</p>
            </div>
          </section>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}

export default ProtectedLayout;
