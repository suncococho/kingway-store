import { NavLink, useLocation } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import { getStoredUser } from "../lib/auth";
import { getMobileMenuSectionsForUser, isMenuItemActive } from "../lib/mobileNavigation";

function MorePage() {
  const location = useLocation();
  const user = getStoredUser();
  const mobileMenuSections = getMobileMenuSectionsForUser(user);

  return (
    <div>
      <PageHeader title="更多" description="門市常用功能與管理入口，採用群組式 mobile menu 版型。" />

      <div className="more-store-card">
        <div className="sidebar-user-name">{user?.displayName || user?.username || "管理員"}</div>
        <div className="sidebar-role">{user?.role || "門市後台"}</div>
        <div className="more-store-meta">
          <StatusBadge tone="info">KINGWAY 台南門市</StatusBadge>
          <StatusBadge tone="neutral">LINE-first</StatusBadge>
        </div>
      </div>

      <div className="menu-section-list">
        {mobileMenuSections.map((section) => (
          <section key={section.heading} className="menu-section-card">
            <div className="menu-section-heading">{section.heading}</div>
            <div className="menu-item-list">
              {section.items.map((item) =>
                item.to ? (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={() =>
                      `menu-item-row${
                        isMenuItemActive(item.to, location.pathname, location.search) ? " nav-link-active" : ""
                      }`
                    }
                  >
                    <span className="menu-item-copy">
                      <span className="menu-item-title">{item.label}</span>
                      <span className="menu-item-description">{item.description}</span>
                    </span>
                    <span className="menu-item-chevron">›</span>
                  </NavLink>
                ) : (
                  <div key={item.label} className="menu-item-row menu-item-row-disabled">
                    <span className="menu-item-copy">
                      <span className="menu-item-title">{item.label}</span>
                      <span className="menu-item-description">{item.description}</span>
                    </span>
                    <span className="menu-item-chevron">›</span>
                  </div>
                )
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default MorePage;
