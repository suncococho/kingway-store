import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import { apiRequest } from "../lib/api";
import HeadquartersPage from "./HeadquartersPage";
import InboundTransfersPage from "./InboundTransfersPage";

function StoreTransfersPage() {
  const [state, setState] = useState({ loading: true, hasCompanyAccess: false });

  useEffect(() => {
    let active = true;
    async function loadAccess() {
      try {
        const response = await apiRequest("/company/me");
        if (!active) return;
        setState({ loading: false, hasCompanyAccess: Boolean(response.franchiseEnabled) });
      } catch (_error) {
        if (active) setState({ loading: false, hasCompanyAccess: false });
      }
    }
    loadAccess();
    return () => {
      active = false;
    };
  }, []);

  if (state.loading) {
    return <PageHeader title="門市調撥" description="載入調撥資料中..." />;
  }

  return state.hasCompanyAccess ? <HeadquartersPage /> : <InboundTransfersPage />;
}

export default StoreTransfersPage;
