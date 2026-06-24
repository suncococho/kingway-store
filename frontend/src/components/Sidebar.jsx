import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { clearAuth, getStoredStoreName, getStoredUser } from "../lib/auth";
import { apiRequest } from "../lib/api";
import { useStoreFeatures } from "../hooks/useStoreFeatures";
import { useStoreAccess } from "../hooks/useStoreAccess";
import { useMenuPermissions } from "../hooks/useMenuPermissions";
import { getMobileMenuSectionsForUser, isMenuItemActive } from "../lib/mobileNavigation";

function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getStoredUser();
  const currentStoreName = getStoredStoreName();
  const { features } = useStoreFeatures();
  const { access } = useStoreAccess(user);
  const { permissions: menuPermissions } = useMenuPermissions(user);
  const effectiveFeatures = {
    ...features,
    suppliers_enabled: features.suppliers_enabled !== false && !access?.lockedFeatures?.includes("suppliers"),
    supplier_purchases_enabled: !access?.lockedFeatures?.includes("supplier_purchases"),
    store_transfers_enabled: !access?.lockedFeatures?.includes("store_transfers"),
    company_store_settlements_enabled: !access?.lockedFeatures?.includes("company_store_settlements"),
    headquarters_enabled: !access?.lockedFeatures?.includes("headquarters")
  };
  const [companyAccess, setCompanyAccess] = useState({ loaded: false, enabled: false });
  const mobileMenuSections = getMobileMenuSectionsForUser(user, effectiveFeatures, menuPermissions)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.to !== "/saas-admin")
    }))
    .filter((group) => group.items.length > 0);
  if (companyAccess.enabled && effectiveFeatures.headquarters_enabled !== false) {
    mobileMenuSections.splice(2, 0, {
      heading: "總部",
      items: [
        { to: "/headquarters", label: "總部管理", description: "公司資料、所屬門市與本部出貨" },
        { to: "/hq-replenishment-requests", label: "本部請貨管理", description: "查看門市請貨並建立本部出貨" },
        { to: "/hq-transfer-report", label: "本部出貨明細", description: "查詢本部批發價、出貨數量與月結狀態" },
        ...(effectiveFeatures.company_store_settlements_enabled !== false
          ? [{ to: "/company-store-settlements", label: "本部月結", description: "本部供貨應收與門市應付月結" }]
          : [])
      ]
    });
  }
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadCompanyAccess() {
      try {
        const response = await apiRequest("/company/me");
        if (active) {
          setCompanyAccess({ loaded: true, enabled: Boolean(response.franchiseEnabled) });
        }
      } catch (_error) {
        if (active) {
          setCompanyAccess({ loaded: true, enabled: false });
        }
      }
    }
    loadCompanyAccess();
    return () => {
      active = false;
    };
  }, [user?.id, user?.storeId]);

  function handleLogout() {
    clearAuth();
    navigate("/login", { replace: true });
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-main">
        <div className="sidebar-brand-card">
          <div className="brand">目前門市：{currentStoreName}</div>
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
          <div className="mobile-top-brand">目前門市：{currentStoreName}</div>
          <div className="mobile-top-user">{user?.displayName || user?.username || "門市後台"}</div>
        </div>
      </div>

      {mobileDrawerOpen ? (
        <div className="mobile-drawer-backdrop" role="presentation" onClick={() => setMobileDrawerOpen(false)}>
          <aside className="mobile-drawer" aria-label="主要導覽" onClick={(event) => event.stopPropagation()}>
            <div className="mobile-drawer-header">
              <div>
                <div className="mobile-drawer-title">目前門市：{currentStoreName}</div>
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
