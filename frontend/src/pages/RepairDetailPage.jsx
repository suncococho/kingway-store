import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import { apiRequest } from "../lib/api";

function RepairDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [estimateAmount, setEstimateAmount] = useState("");
  const [estimateNote, setEstimateNote] = useState("");

  async function loadDetail() {
    try {
      const data = await apiRequest(`/api/repairs/${id}`);
      setDetail(data);
    } catch (error) {
      alert(error.message);
    }
  }

  useEffect(() => {
    loadDetail();
  }, [id]);

  async function callAction(path, body = {}) {
    try {
      await apiRequest(path, {
        method: "POST",
        body: JSON.stringify(body)
      });
      loadDetail();
    } catch (error) {
      alert(error.message);
    }
  }

  if (!detail) {
    return <div className="loading-state">Loading repair detail...</div>;
  }

  return (
    <div>
      <PageHeader title={`Repair #${detail.id}`} description="Repair order detail and actions." />
      <section className="content-card">
        <div className="detail-grid">
          <div>Customer</div>
          <div>{detail.customerName}</div>
          <div>Phone</div>
          <div>{detail.customerPhone || "-"}</div>
          <div>Bike Model</div>
          <div>{detail.bike_model}</div>
          <div>Status</div>
          <div>{detail.status}</div>
          <div>Estimate</div>
          <div>NT${detail.estimate_amount}</div>
          <div>Storage Fee</div>
          <div>NT${detail.storageFee}</div>
        </div>
      </section>
      <section className="content-card form-card">
        <h2>Submit Estimate</h2>
        <div className="grid-form compact-grid">
          <label className="form-field">
            <span>Estimate Amount</span>
            <input value={estimateAmount} onChange={(event) => setEstimateAmount(event.target.value)} />
          </label>
          <label className="form-field">
            <span>Note</span>
            <input value={estimateNote} onChange={(event) => setEstimateNote(event.target.value)} />
          </label>
          <button
            type="button"
            className="primary-button inline-submit"
            onClick={() => callAction(`/api/repairs/${id}/estimate`, { estimateAmount, note: estimateNote })}
          >
            Send Estimate
          </button>
        </div>
      </section>
      <section className="action-row">
        <button type="button" className="secondary-button" onClick={() => callAction(`/api/repairs/${id}/approve`)}>
          Approve
        </button>
        <button type="button" className="secondary-button" onClick={() => callAction(`/api/repairs/${id}/reject`, { note: "Rejected by admin" })}>
          Reject
        </button>
        <button type="button" className="secondary-button" onClick={() => callAction(`/api/repairs/${id}/complete`)}>
          Mark Completed
        </button>
        <button type="button" className="secondary-button" onClick={() => callAction(`/api/repairs/${id}/pickup`)}>
          Mark Picked Up
        </button>
        <button type="button" className="secondary-button" onClick={() => navigate("/repairs")}>
          Back
        </button>
      </section>
      <section className="content-card">
        <h2>Logs</h2>
        {detail.logs.length === 0 ? <div className="empty-state">No logs yet.</div> : null}
        {detail.logs.map((log) => (
          <div key={log.id} className="log-row">
            <strong>{log.action}</strong>
            <div>{log.note}</div>
            <div className="muted-text">{log.createdAt}</div>
          </div>
        ))}
      </section>
    </div>
  );
}

export default RepairDetailPage;
