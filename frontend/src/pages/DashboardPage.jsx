import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import { getStoredUser } from "../lib/auth";
import { apiRequest } from "../lib/api";

function DashboardPage() {
  const user = getStoredUser();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    async function loadSummary() {
      try {
        const data = await apiRequest("/api/dashboard/summary");
        setSummary(data);
      } catch (error) {
        setSummary(null);
      }
    }

    loadSummary();
  }, []);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Simple admin overview for the LINE-only store system."
      />
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Logged in user</div>
          <div className="stat-value">{user?.displayName || user?.username || "-"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Role</div>
          <div className="stat-value">{user?.role || "-"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sales Today</div>
          <div className="stat-value small-text">NT${summary?.totals?.salesToday ?? 0}</div>
        </div>
      </div>
      <section className="content-card form-card">
        <h2>Pending Tasks</h2>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Purchase Confirmations</div>
            <div className="stat-value">{summary?.pendingTasks?.purchaseConfirmationsPending ?? 0}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Repairs Pending</div>
            <div className="stat-value">{summary?.pendingTasks?.repairReservationsPending ?? 0}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Review Approvals</div>
            <div className="stat-value">{summary?.pendingTasks?.googleReviewApprovalsPending ?? 0}</div>
          </div>
        </div>
      </section>
      <section className="content-card">
        <h2>What you can do now</h2>
        <ul className="simple-list">
          <li>Browse customers, products, orders, and inventory in one admin panel.</li>
          <li>Create POS orders and let stock deduct automatically.</li>
          <li>Handle purchase confirmations, repairs, coupons, surveys, and staff attendance.</li>
          <li>Use the sidebar to move between store modules quickly.</li>
        </ul>
      </section>
    </div>
  );
}

export default DashboardPage;
