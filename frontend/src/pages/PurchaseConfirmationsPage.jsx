import { useEffect, useState } from "react";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import { useFetchList } from "../hooks/useFetchList";
import { apiRequest } from "../lib/api";

const confirmationColumns = [
  { key: "orderNo", label: "Order No" },
  { key: "customerName", label: "Customer" },
  { key: "customerPhone", label: "Phone" },
  {
    key: "pdfPath",
    label: "PDF",
    render: (row) =>
      row.pdfPath ? (
        <a href={`http://localhost:3000${row.pdfPath}`} target="_blank" rel="noreferrer">
          Download
        </a>
      ) : (
        "-"
      )
  },
  { key: "submittedAt", label: "Submitted At" }
];

const linkColumns = [
  { key: "id", label: "ID" },
  { key: "customer_id", label: "Customer ID" },
  { key: "order_id", label: "Order ID" },
  { key: "token", label: "Token" },
  { key: "status", label: "Status" },
  { key: "created_at", label: "Created At" },
  {
    key: "link",
    label: "Link",
    render: (row) =>
      row.link ? (
        <a href={row.link} target="_blank" rel="noreferrer">
          Open
        </a>
      ) : (
        "-"
      )
  }
];

function PurchaseConfirmationsPage() {
  const confirmations = useFetchList("/api/purchase-confirmations");
  const [customerId, setCustomerId] = useState("");
  const [pendingLinks, setPendingLinks] = useState([]);

  async function loadPendingLinks() {
    try {
      const data = await apiRequest("/api/purchase-confirmations/pending-links");
      const pending = Array.isArray(data.pending)
        ? data.pending
        : Array.isArray(data.pendingLinks)
          ? data.pendingLinks
          : [];

      setPendingLinks(pending);
    } catch (error) {
      alert(error.message);
    }
  }

  useEffect(() => {
    loadPendingLinks();
  }, []);

  async function generateLink(event) {
    event.preventDefault();

    try {
      const data = await apiRequest("/api/purchase-confirmations/generate-link", {
        method: "POST",
        body: JSON.stringify({
          customerId: Number(customerId)
        })
      });
      setCustomerId("");
      confirmations.refetch();
      loadPendingLinks();
      alert(`Link generated:\n${data.link}`);
    } catch (error) {
      alert(error.message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Purchase Confirmations"
        description="Generate purchase confirmation links and review submitted PDFs."
      />
      <section className="content-card form-card">
        <h2>Generate Confirmation Link</h2>
        <form className="grid-form compact-grid" onSubmit={generateLink}>
          <label className="form-field">
            <span>Customer ID</span>
            <input value={customerId} onChange={(event) => setCustomerId(event.target.value)} required />
          </label>
          <button type="submit" className="primary-button inline-submit">
            Generate Link
          </button>
        </form>
      </section>
      <section className="page-section">
        <h2>Submitted Records</h2>
        <DataTable columns={confirmationColumns} rows={confirmations.items} emptyText="No submitted confirmations yet." />
      </section>
      <section className="page-section">
        <h2>Pending Links</h2>
        <DataTable columns={linkColumns} rows={pendingLinks} emptyText="No pending links." />
      </section>
    </div>
  );
}

export default PurchaseConfirmationsPage;
