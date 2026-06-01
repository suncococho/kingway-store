import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { clearAuth, getStoredUser } from "../lib/auth";
import { useStoreFeatures } from "../hooks/useStoreFeatures";
import { getMobileMenuSectionsForUser, isMenuItemActive } from "../lib/mobileNavigation";

function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getStoredUser();
  const { features } = useStoreFeatures();
  const mobileMenuSections = getMobileMenuSectionsForUser(user, features)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.to !== "/saas-admin")
    }))
    .filter((group) => group.items.length > 0);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  function handleLogout() {
    clearAuth();
    navigate("/login", { replace: true });
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-main">
        <div className="sidebar-brand-card">
          <div className="brand">KINGWAY 台南門市</div>
          <div className="sidebar-user">
            <div className="sidebar-user-name">{user?.displayName || user?.username || "管理員"}</div>
            <div className="sidebar-role">{user?.role || "門市後台"}</div>
          </div>
        </div>

        <nav className="nav-groups desktop-nav">
          {mobileMenuSections.map((group) => (
            <section key={group.heading} className="nav-group">
              <div className="nav-group-heading">{group.heading}</div>
              <div className="nav-group-list">
                {group.items.map((item) => (
                  item.to ? (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={() =>
                        `nav-link nav-link-group${
                          isMenuItemActive(item.to, location.pathname, location.search) ? " nav-link-active" : ""
                        }`
                      }
                    >
                      <span className="nav-link-copy">
                        <span className="nav-link-title">{item.label}</span>
                        <span className="nav-link-description">{item.description}</span>
                      </span>
                      <span className="nav-link-chevron">›</span>
                    </NavLink>
                  ) : (
                    <div key={item.label} className="nav-link nav-link-group nav-link-disabled">
                      <span className="nav-link-copy">
                        <span className="nav-link-title">{item.label}</span>
                        <span className="nav-link-description">{item.description}</span>
                      </span>
                      <span className="nav-link-chevron">›</span>
                    </div>
                  )
                ))}
              </div>
            </section>
          ))}
        </nav>
      </div>

      <div className="sidebar-footer desktop-nav">
        <button type="button" className="logout-button" onClick={handleLogout}>
          登出
        </button>
      </div>

      <div className="mobile-top-nav" aria-label="手機導覽">
        <button
          type="button"
          className="mobile-hamburger-button"
          aria-label="開啟選單"
          aria-expanded={mobileDrawerOpen}
          onClick={() => setMobileDrawerOpen(true)}
        >
          <span />
          <span />
          <span />
        </button>
        <div className="mobile-top-copy">
          <div className="mobile-top-brand">KINGWAY 台南門市</div>
          <div className="mobile-top-user">{user?.displayName || user?.username || "門市後台"}</div>
        </div>
      </div>

      {mobileDrawerOpen ? (
        <div className="mobile-drawer-backdrop" role="presentation" onClick={() => setMobileDrawerOpen(false)}>
          <aside className="mobile-drawer" aria-label="主要導覽" onClick={(event) => event.stopPropagation()}>
            <div className="mobile-drawer-header">
              <div>
                <div className="mobile-drawer-title">KINGWAY 台南門市</div>
                <div className="mobile-drawer-subtitle">{user?.displayName || user?.username || "管理員"} / {user?.role || "門市後台"}</div>
              </div>
              <button type="button" className="secondary-button mobile-drawer-close" onClick={() => setMobileDrawerOpen(false)}>
                關閉
              </button>
            </div>
            <nav className="mobile-drawer-nav">
              {mobileMenuSections.map((group) => (
                <section key={group.heading} className="mobile-drawer-section">
                  <div className="mobile-drawer-section-heading">{group.heading}</div>
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={() =>
                        `mobile-drawer-link${
                          isMenuItemActive(item.to, location.pathname, location.search) ? " mobile-drawer-link-active" : ""
                        }`
                      }
                      onClick={() => setMobileDrawerOpen(false)}
                    >
                      <span>{item.label}</span>
                      <small>{item.description}</small>
                    </NavLink>
                  ))}
                </section>
              ))}
              <button type="button" className="mobile-drawer-logout" onClick={handleLogout}>
                登出
              </button>
            </nav>
          </aside>
        </div>
      ) : null}
    </aside>
  );
}

export default Sidebar;
