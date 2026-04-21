import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedLayout from "./components/ProtectedLayout";
import { getStoredToken } from "./lib/auth";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import CustomersPage from "./pages/CustomersPage";
import ProductsPage from "./pages/ProductsPage";
import InventoryPage from "./pages/InventoryPage";
import OrdersPage from "./pages/OrdersPage";
import POSPage from "./pages/POSPage";
import PurchaseConfirmationsPage from "./pages/PurchaseConfirmationsPage";
import RepairsPage from "./pages/RepairsPage";
import CouponsPage from "./pages/CouponsPage";
import SurveysPage from "./pages/SurveysPage";
import StaffAttendancePage from "./pages/StaffAttendancePage";
import KPIPage from "./pages/KPIPage";
import PayrollPage from "./pages/PayrollPage";

function ProtectedPage({ children }) {
  const token = getStoredToken();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <ProtectedLayout>{children}</ProtectedLayout>;
}

function App() {
  const token = getStoredToken();

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<ProtectedPage><DashboardPage /></ProtectedPage>} />
      <Route path="/customers" element={<ProtectedPage><CustomersPage /></ProtectedPage>} />
      <Route path="/products" element={<ProtectedPage><ProductsPage /></ProtectedPage>} />
      <Route path="/inventory" element={<ProtectedPage><InventoryPage /></ProtectedPage>} />
      <Route path="/orders" element={<ProtectedPage><OrdersPage /></ProtectedPage>} />
      <Route path="/pos" element={<ProtectedPage><POSPage /></ProtectedPage>} />
      <Route path="/purchase-confirmations" element={<ProtectedPage><PurchaseConfirmationsPage /></ProtectedPage>} />
      <Route path="/repairs" element={<ProtectedPage><RepairsPage /></ProtectedPage>} />
      <Route path="/coupons" element={<ProtectedPage><CouponsPage /></ProtectedPage>} />
      <Route path="/surveys" element={<ProtectedPage><SurveysPage /></ProtectedPage>} />
      <Route path="/attendance" element={<ProtectedPage><StaffAttendancePage /></ProtectedPage>} />
      <Route path="/kpi" element={<ProtectedPage><KPIPage /></ProtectedPage>} />
      <Route path="/payroll" element={<ProtectedPage><PayrollPage /></ProtectedPage>} />
      <Route
        path="*"
        element={<Navigate to={token ? "/dashboard" : "/login"} replace />}
      />
    </Routes>
  );
}

export default App;
