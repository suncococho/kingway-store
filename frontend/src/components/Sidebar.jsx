import { NavLink, useNavigate } from "react-router-dom";
import { clearAuth, getStoredUser } from "../lib/auth";

const navItems = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/customers", label: "Customers" },
  { to: "/products", label: "Products" },
  { to: "/inventory", label: "Inventory" },
  { to: "/orders", label: "Orders" },
  { to: "/pos", label: "POS" },
  { to: "/purchase-confirmations", label: "Purchase Confirmations" },
  { to: "/repairs", label: "Repairs" },
  { to: "/coupons", label: "Coupons" },
  { to: "/surveys", label: "Surveys" },
  { to: "/attendance", label: "Staff Attendance" },
  { to: "/kpi", label: "KPI" },
  { to: "/payroll", label: "Payroll" }
];

function Sidebar() {
  const navigate = useNavigate();
  const user = getStoredUser();

  function handleLogout() {
    clearAuth();
    navigate("/login", { replace: true });
  }

  return (
    <aside className="sidebar">
      <div>
        <div className="brand">Kingway Admin</div>
        <div className="sidebar-user">
          <div>{user?.displayName || user?.username || "Admin"}</div>
          <div className="sidebar-role">{user?.role || ""}</div>
        </div>
        <nav className="nav-list">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? "nav-link nav-link-active" : "nav-link"
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <button type="button" className="logout-button" onClick={handleLogout}>
        Logout
      </button>
    </aside>
  );
}

export default Sidebar;
