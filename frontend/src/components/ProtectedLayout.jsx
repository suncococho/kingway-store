import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";

function ProtectedLayout() {
  const location = useLocation();

  const isPosFullscreen =
    location.pathname === "/pos" &&
    new URLSearchParams(location.search).get("fullscreen") === "1";

  return (
    <div className={`app-shell ${isPosFullscreen ? "app-shell-pos-fullscreen" : ""}`}>
      {!isPosFullscreen ? <Sidebar /> : null}

      <main className={`page-content ${isPosFullscreen ? "page-content-pos-fullscreen" : ""}`}>
        <Outlet />
      </main>

      
    </div>
  );
}

export default ProtectedLayout;
