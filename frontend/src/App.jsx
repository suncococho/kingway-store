import { Navigate, Route, Routes, useParams } from "react-router-dom";
import GlobalProcessingOverlay from "./components/GlobalProcessingOverlay";
import ProtectedLayout from "./components/ProtectedLayout";
import { getStoredToken, getStoredUser } from "./lib/auth";
import { getDefaultRouteForUser } from "./lib/permissions";
import LoginPage from "./pages/LoginPage";
import StoreSignupPage from "./pages/StoreSignupPage";
import PlatformLoginPage, { PlatformAdminPage } from "./pages/PlatformLoginPage";
import SaasStoreFeaturesPage from "./pages/SaasStoreFeaturesPage";
import PlatformCompaniesPage from "./pages/PlatformCompaniesPage";
import PlatformOnboardingPage from "./pages/PlatformOnboardingPage";
import DashboardPage from "./pages/DashboardPage";
import CustomerStatusPage from "./pages/CustomerStatusPage";
import CustomersPage from "./pages/CustomersPage";
import ProductsPage from "./pages/ProductsPage";
import InventoryPage from "./pages/InventoryPage";
import SuppliersPage from "./pages/SuppliersPage";
import OrdersPage from "./pages/OrdersPage";
import SalesManagementPage from "./pages/SalesManagementPage";
import OrderEditPage from "./pages/OrderEditPage";
import OrderInstallCheckPrintPage from "./pages/OrderInstallCheckPrintPage";
import POSPage from "./pages/POSPage";
import PurchaseConfirmationsPage from "./pages/PurchaseConfirmationsPage";
import RepairsPage from "./pages/RepairsPage";
import RepairDetailPage from "./pages/RepairDetailPage";
import RepairWorkOrderPrintPage from "./pages/RepairWorkOrderPrintPage";
import CouponsPage from "./pages/CouponsPage";
import SurveysPage from "./pages/SurveysPage";
import StaffAttendancePage from "./pages/StaffAttendancePage";
import StaffPage from "./pages/StaffPage";
import KPIPage from "./pages/KPIPage";
import StaffKpiPage from "./pages/StaffKpiPage";
import PayrollPage from "./pages/PayrollPage";
import MorePage from "./pages/MorePage";
import SettingsPage from "./pages/SettingsPage";
import StoreSettingsPage from "./pages/StoreSettingsPage";
import StoreLineSettingsPage from "./pages/StoreLineSettingsPage";
import StoreLineChannelsPage from "./pages/StoreLineChannelsPage";
import StoreCashReportsPage from "./pages/StoreCashReportsPage";
import StoreVisitRecordsPage from "./pages/StoreVisitRecordsPage";
import StoreTransfersPage from "./pages/StoreTransfersPage";
import PurchaseConfirmPublicPage from "./pages/PurchaseConfirmPublicPage";
import RepairConfirmPublicPage from "./pages/RepairConfirmPublicPage";
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
import HeadquartersPage from "./pages/HeadquartersPage";
import InboundTransfersPage from "./pages/InboundTransfersPage";
import CompanyStoreSettlementsPage from "./pages/CompanyStoreSettlementsPage";
import StoreReplenishmentRequestsPage from "./pages/StoreReplenishmentRequestsPage";
import HqReplenishmentRequestsPage from "./pages/HqReplenishmentRequestsPage";
import HqTransferReportPage from "./pages/HqTransferReportPage";
import NotificationsPage from "./pages/NotificationsPage";
import MessagesPage from "./pages/MessagesPage";
import DailyTasksPage from "./pages/DailyTasksPage";
import DailyTaskSettingsPage from "./pages/DailyTaskSettingsPage";
import LineNotificationSettingsPage from "./pages/LineNotificationSettingsPage";
import SystemManualPage from "./pages/SystemManualPage";

function LegacyStoreFeaturesRedirect() {
  const { id } = useParams();
  return <Navigate to={`/platform-admin/stores/${id}/features`} replace />;
}

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
      <Route path="/repair-confirm" element={<RepairConfirmPublicPage />} />
      <Route path="/repair-confirm/:token" element={<RepairConfirmPublicPage />} />
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
      <Route path="/platform-admin/onboarding" element={<PlatformOnboardingPage />} />
      <Route path="/platform-admin/companies" element={<PlatformCompaniesPage />} />
      <Route path="/platform-admin/stores/:id/features" element={<SaasStoreFeaturesPage />} />
      <Route path="/saas-admin" element={<Navigate to="/platform-admin" replace />} />
      <Route path="/saas-admin/onboarding" element={<Navigate to="/platform-admin/onboarding" replace />} />
      <Route path="/saas-admin/companies" element={<Navigate to="/platform-admin/companies" replace />} />
      <Route path="/saas-admin/stores/:id/features" element={<LegacyStoreFeaturesRedirect />} />
      <Route path="/saas-admin/*" element={<Navigate to="/platform-admin" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/store-signup" element={<StoreSignupPage />} />
      <Route path="/" element={<Navigate to={token ? defaultProtectedRoute : "/login"} replace />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/messages" element={<MessagesPage />} />
        <Route path="/daily-tasks" element={<DailyTasksPage />} />
        <Route path="/store-cash-reports" element={<StoreCashReportsPage />} />
        <Route path="/store-visit-records" element={<StoreVisitRecordsPage />} />
        <Route path="/customer-status" element={<CustomerStatusPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/sales" element={<SalesManagementPage />} />
        <Route path="/orders/:id/edit" element={<OrderEditPage />} />
        <Route path="/orders/:id/install-check-print" element={<OrderInstallCheckPrintPage />} />
        <Route path="/pos" element={<POSPage />} />
        <Route path="/purchase-confirmations" element={<PurchaseConfirmationsPage />} />
        <Route path="/repairs" element={<RepairsPage />} />
        <Route path="/repairs/:id" element={<RepairDetailPage />} />
        <Route path="/repairs/:id/work-order-print" element={<RepairWorkOrderPrintPage />} />
        <Route path="/coupons" element={<CouponsPage />} />
        <Route path="/surveys" element={<SurveysPage />} />
        <Route path="/staff-attendance" element={<StaffAttendancePage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/attendance" element={<Navigate to="/staff-attendance" replace />} />
        <Route path="/kpi" element={<KPIPage />} />
        <Route path="/staff-kpi" element={<StaffKpiPage />} />
        <Route path="/payroll" element={<PayrollPage />} />
        <Route path="/settings/store" element={<StoreSettingsPage />} />
        <Route path="/settings/line" element={<StoreLineSettingsPage />} />
        <Route path="/settings/line-channels" element={<StoreLineChannelsPage />} />
        <Route path="/settings/manual" element={<SystemManualPage />} />
        <Route path="/settings/daily-tasks" element={<DailyTaskSettingsPage />} />
        <Route path="/settings/line-notifications" element={<LineNotificationSettingsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/more" element={<MorePage />} />
        <Route path="/trash" element={<TrashPage />} />
        <Route path="/store-transfers" element={<StoreTransfersPage />} />
        <Route path="/headquarters" element={<HeadquartersPage />} />
        <Route path="/inbound-transfers" element={<InboundTransfersPage />} />
        <Route path="/company-store-settlements" element={<CompanyStoreSettlementsPage />} />
        <Route path="/hq-transfer-report" element={<HqTransferReportPage />} />
        <Route path="/store-replenishment-requests" element={<StoreReplenishmentRequestsPage />} />
        <Route path="/hq-replenishment-requests" element={<HqReplenishmentRequestsPage />} />
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
