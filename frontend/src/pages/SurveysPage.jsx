import { useState } from "react";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import { useFetchList } from "../hooks/useFetchList";
import { apiRequest } from "../lib/api";

const columns = [
  { key: "customerName", label: "客戶" },
  { key: "orderId", label: "訂單 ID" },
  { key: "rating", label: "評分" },
  { key: "feedback", label: "意見回饋" },
  {
    key: "link",
    label: "連結",
    render: (row) =>
      row.link ? (
        <a href={row.link} target="_blank" rel="noreferrer">
          開啟
        </a>
      ) : (
        "-"
      )
  }
];

function SurveysPage() {
  const surveys = useFetchList("/surveys");
  const [form, setForm] = useState({
    customerId: "",
    orderId: ""
  });

  async function generateLink(event) {
    event.preventDefault();
    try {
      const data = await apiRequest("/surveys/generate-link", {
        method: "POST",
        body: JSON.stringify({
          customerId: Number(form.customerId),
          orderId: Number(form.orderId)
        })
      });
      setForm({ customerId: "", orderId: "" });
      surveys.refetch();
      alert(`問卷連結：\n${data.link}`);
    } catch (error) {
      alert(error.message);
    }
  }

  return (
    <div>
      <PageHeader title="問卷管理" description="產生問卷連結並查看客戶回饋。" />
      <section className="content-card form-card">
        <h2>產生問卷連結</h2>
        <form className="grid-form compact-grid" onSubmit={generateLink}>
          <label className="form-field">
            <span>客戶 ID</span>
            <input value={form.customerId} onChange={(event) => setForm((current) => ({ ...current, customerId: event.target.value }))} />
          </label>
          <label className="form-field">
            <span>訂單 ID</span>
            <input value={form.orderId} onChange={(event) => setForm((current) => ({ ...current, orderId: event.target.value }))} />
          </label>
          <button type="submit" className="primary-button inline-submit">
            產生連結
          </button>
        </form>
      </section>
      <DataTable columns={columns} rows={surveys.items} emptyText="目前沒有問卷連結。" />
    </div>
  );
}

export default SurveysPage;
