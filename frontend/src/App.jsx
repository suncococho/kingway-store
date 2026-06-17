import { Navigate, Route, Routes } from "react-router-dom";
import GlobalProcessingOverlay from "./components/GlobalProcessingOverlay";
import ProtectedLayout from "./components/ProtectedLayout";
import { getStoredToken, getStoredUser } from "./lib/auth";
import { getDefaultRouteForUser } from "./lib/permissions";
import LoginPage from "./pages/LoginPage";
import StoreSignupPage from "./pages/StoreSignupPage";
import PlatformLoginPage, { PlatformAdminPage } from "./pages/PlatformLoginPage";
import SaasAdminPage from "./pages/SaasAdminPage";
import SaasStoreFeaturesPage from "./pages/SaasStoreFeaturesPage";
import DashboardPage from "./pages/DashboardPage";
import CustomerStatusPage from "./pages/CustomerStatusPage";
import CustomersPage from "./pages/CustomersPage";
import ProductsPage from "./pages/ProductsPage";
import InventoryPage from "./pages/InventoryPage";
import SuppliersPage from "./pages/SuppliersPage";
import OrdersPage from "./pages/OrdersPage";
import SalesManagementPage from "./pages/SalesManagementPage";
import OrderEditPage from "./pages/OrderEditPage";
import POSPage from "./pages/POSPage";
import PurchaseConfirmationsPage from "./pages/PurchaseConfirmationsPage";
import RepairsPage from "./pages/RepairsPage";
import RepairDetailPage from "./pages/RepairDetailPage";
import CouponsPage from "./pages/CouponsPage";
import SurveysPage from "./pages/SurveysPage";
import StaffAttendancePage from "./pages/StaffAttendancePage";
import StaffPage from "./pages/StaffPage";
import KPIPage from "./pages/KPIPage";
import PayrollPage from "./pages/PayrollPage";
import MorePage from "./pages/MorePage";
import SettingsPage from "./pages/SettingsPage";
import StoreSettingsPage from "./pages/StoreSettingsPage";
import StoreLineSettingsPage from "./pages/StoreLineSettingsPage";
import PurchaseConfirmPublicPage from "./pages/PurchaseConfirmPublicPage";
import SurveyPublicPage from "./pages/SurveyPublicPage";
import LineEntryPage from "./pages/LineEntryPage";
import LineGoogleReviewPage from "./pages/LineGoogleReviewPage";
import LineOrderPage from "./pages/LineOrderPage";
import LineCustomerPage from "./pages/LineCustomerPage";
import LineRepairRequestPage from "./pages/LineRepairRequestPage";
import LineSupportPage from "./pages/LineSupportPage";
import LineCouponPage from "./pages/LineCouponPage";
import LineProgressPage from "./pages/LineProgressPage";
import TrashPage from "./pages/TrashPage";

function App() {
  const token = getStoredToken();
  const user = getStoredUser();
  const defaultProtectedRoute = getDefaultRouteForUser(user);

  return (
    <>
    <GlobalProcessingOverlay />
    <Routes>
      <Route path="/purchase-confirm/manual" element={<PurchaseConfirmPublicPage />} />
      <Route path="/purchase-confirm" element={<PurchaseConfirmPublicPage />} />
      <Route path="/purchase-confirm/:token" element={<PurchaseConfirmPublicPage />} />
      <Route path="/surveys/:token" element={<SurveyPublicPage />} />
      <Route path="/line-order" element={<LineOrderPage />} />
      <Route path="/line-customer" element={<LineCustomerPage />} />
      <Route path="/repair-reservation" element={<LineRepairRequestPage />} />
      <Route path="/repair-request" element={<LineRepairRequestPage />} />
      <Route path="/line-repair-request" element={<LineRepairRequestPage />} />
      <Route path="/coupon-center" element={<LineCouponPage />} />
      <Route path="/line-coupon" element={<LineCouponPage />} />
      <Route path="/google-review" element={<LineGoogleReviewPage />} />
      <Route path="/progress" element={<LineProgressPage />} />
      <Route path="/line-progress" element={<LineProgressPage />} />
      <Route path="/store-info" element={<LineEntryPage />} />
      <Route path="/support" element={<LineSupportPage />} />
      <Route path="/crm" element={<Navigate to="/customers?section=CRM" replace />} />
      <Route path="/orders/new" element={<Navigate to="/pos" replace state={{ mode: "order" }} />} />
      <Route path="/repairs/quote" element={<Navigate to="/repairs?tab=ESTIMATED" replace state={{ mode: "baojia" }} />} />
      <Route path="/baojia" element={<Navigate to="/repairs?tab=ESTIMATED" replace state={{ mode: "baojia" }} />} />
      <Route path="/products/new" element={<Navigate to="/products?section=CREATE" replace state={{ mode: "up" }} />} />
      <Route path="/platform-admin/login" element={<PlatformLoginPage />} />
      <Route path="/platform-admin" element={<PlatformAdminPage />} />
      <Route path="/platform-admin/stores/:id/features" element={<SaasStoreFeaturesPage />} />
      <Route path="/saas-admin" element={<SaasAdminPage />} />
      <Route path="/saas-admin/stores/:id/features" element={<SaasStoreFeaturesPage />} />
      <Route path="/saas-admin/*" element={<Navigate to="/platform-admin" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/store-signup" element={<StoreSignupPage />} />
      <Route path="/" element={<Navigate to={token ? defaultProtectedRoute : "/login"} replace />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/customer-status" element={<CustomerStatusPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/sales" element={<SalesManagementPage />} />
        <Route path="/orders/:id/edit" element={<OrderEditPage />} />
        <Route path="/pos" element={<POSPage />} />
        <Route path="/purchase-confirmations" element={<PurchaseConfirmationsPage />} />
        <Route path="/repairs" element={<RepairsPage />} />
        <Route path="/repairs/:id" element={<RepairDetailPage />} />
        <Route path="/coupons" element={<CouponsPage />} />
        <Route path="/surveys" element={<SurveysPage />} />
        <Route path="/staff-attendance" element={<StaffAttendancePage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/attendance" element={<Navigate to="/staff-attendance" replace />} />
        <Route path="/kpi" element={<KPIPage />} />
        <Route path="/payroll" element={<PayrollPage />} />
        <Route path="/settings/store" element={<StoreSettingsPage />} />
        <Route path="/settings/line" element={<StoreLineSettingsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/more" element={<MorePage />} />
        <Route path="/trash" element={<TrashPage />} />
      </Route>
      <Route
        path="*"
        element={<Navigate to={token ? defaultProtectedRoute : "/login"} replace />}
      />
    </Routes>
    </>
  );
}

export default App;
