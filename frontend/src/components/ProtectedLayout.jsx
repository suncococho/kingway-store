import { useMemo } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Sidebar from "./Sidebar";
import { getImpersonationSession, stopImpersonationSession } from "../lib/auth";
import { platformRequest } from "../lib/platformAuth";

function ProtectedLayout() {
  const location = useLocation();
  const navigate = useNavigate();
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

  const isPosFullscreen =
    location.pathname === "/pos" &&
    new URLSearchParams(location.search).get("fullscreen") === "1";

  return (
    <div className={`app-shell ${isPosFullscreen ? "app-shell-pos-fullscreen" : ""}`}>
      {!isPosFullscreen ? <Sidebar /> : null}

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
        <Outlet />
      </main>
    </div>
  );
}

export default ProtectedLayout;
