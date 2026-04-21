import { useState } from "react";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import { useFetchList } from "../hooks/useFetchList";
import { apiRequest } from "../lib/api";

const columns = [
  { key: "customerName", label: "Customer" },
  { key: "orderId", label: "Order ID" },
  { key: "rating", label: "Rating" },
  { key: "feedback", label: "Feedback" },
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

function SurveysPage() {
  const surveys = useFetchList("/api/surveys");
  const [form, setForm] = useState({
    customerId: "",
    orderId: ""
  });

  async function generateLink(event) {
    event.preventDefault();
    try {
      const data = await apiRequest("/api/surveys/generate-link", {
        method: "POST",
        body: JSON.stringify({
          customerId: Number(form.customerId),
          orderId: Number(form.orderId)
        })
      });
      setForm({ customerId: "", orderId: "" });
      surveys.refetch();
      alert(`Survey link:\n${data.link}`);
    } catch (error) {
      alert(error.message);
    }
  }

  return (
    <div>
      <PageHeader title="Surveys" description="Generate survey links and review customer feedback." />
      <section className="content-card form-card">
        <h2>Generate Survey Link</h2>
        <form className="grid-form compact-grid" onSubmit={generateLink}>
          <label className="form-field">
            <span>Customer ID</span>
            <input value={form.customerId} onChange={(event) => setForm((current) => ({ ...current, customerId: event.target.value }))} />
          </label>
          <label className="form-field">
            <span>Order ID</span>
            <input value={form.orderId} onChange={(event) => setForm((current) => ({ ...current, orderId: event.target.value }))} />
          </label>
          <button type="submit" className="primary-button inline-submit">
            Generate
          </button>
        </form>
      </section>
      <DataTable columns={columns} rows={surveys.items} emptyText="No survey links yet." />
    </div>
  );
}

export default SurveysPage;
