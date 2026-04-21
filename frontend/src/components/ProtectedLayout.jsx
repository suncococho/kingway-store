import { Navigate, Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import { getStoredToken } from "../lib/auth";

function ProtectedLayout({ children }) {
  const token = getStoredToken();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="page-content">
        {children || <Outlet />}
      </main>
    </div>
  );
}

export default ProtectedLayout;
