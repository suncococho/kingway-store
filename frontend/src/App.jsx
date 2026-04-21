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
import PurchaseConfirmPublicPage from "./pages/PurchaseConfirmPublicPage";
import SurveyPublicPage from "./pages/SurveyPublicPage";

function App() {
  const token = getStoredToken();

  return (
    <Routes>
      <Route path="/purchase-confirm/:token" element={<PurchaseConfirmPublicPage />} />
      <Route path="/survey/:token" element={<SurveyPublicPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Navigate to={token ? "/dashboard" : "/login"} replace />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/pos" element={<POSPage />} />
        <Route path="/purchase-confirmations" element={<PurchaseConfirmationsPage />} />
        <Route path="/repairs" element={<RepairsPage />} />
        <Route path="/coupons" element={<CouponsPage />} />
        <Route path="/surveys" element={<SurveysPage />} />
        <Route path="/staff-attendance" element={<StaffAttendancePage />} />
        <Route path="/attendance" element={<Navigate to="/staff-attendance" replace />} />
        <Route path="/kpi" element={<KPIPage />} />
        <Route path="/payroll" element={<PayrollPage />} />
      </Route>
      <Route
        path="*"
        element={<Navigate to={token ? "/dashboard" : "/login"} replace />}
      />
    </Routes>
  );
}

export default App;
