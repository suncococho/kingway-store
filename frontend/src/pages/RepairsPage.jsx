import { useState } from "react";
import { Link } from "react-router-dom";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import { useFetchList } from "../hooks/useFetchList";
import { apiRequest } from "../lib/api";

const columns = [
  { key: "id", label: "ID" },
  { key: "customerName", label: "Customer" },
  { key: "bikeModel", label: "Bike Model" },
  { key: "reservationDate", label: "Reservation Date" },
  { key: "status", label: "Status" },
  { key: "storageFee", label: "Storage Fee" },
  {
    key: "detail",
    label: "Detail",
    render: (row) => <Link to={`/repairs/${row.id}`}>Open</Link>
  }
];

function RepairsPage() {
  const repairs = useFetchList("/api/repairs");
  const customers = useFetchList("/api/customers");
  const [form, setForm] = useState({
    customerId: "",
    bikeModel: "",
    issueDescription: "",
    reservationDate: ""
  });

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value
    }));
  }

  async function createRepair(event) {
    event.preventDefault();

    try {
      await apiRequest("/api/repairs", {
        method: "POST",
        body: JSON.stringify({
          customerId: Number(form.customerId),
          bikeModel: form.bikeModel,
          issueDescription: form.issueDescription,
          reservationDate: form.reservationDate
        })
      });
      setForm({
        customerId: "",
        bikeModel: "",
        issueDescription: "",
        reservationDate: ""
      });
      repairs.refetch();
      alert("Repair reservation created");
    } catch (error) {
      alert(error.message);
    }
  }

  return (
    <div>
      <PageHeader title="Repairs" description="Manage repair reservations, approvals, completion, and pickup." />
      <section className="content-card">
        <h2>Repair Notice</h2>
        <ul className="simple-list">
          <li>\u975E\u4FDD\u56FA\u7DAD\u4FEE\u9700\u6536\u53D6\u57FA\u672C\u6AA2\u67E5/\u5DE5\u8CC7 NT$400</li>
          <li>\u9664\u975E\u975E\u5E38\u7C21\u55AE\u7684\u8ABF\u6574\u5916\uFF0C\u8ECA\u8F1B\u9700\u7559\u5E97\u6AA2\u67E5</li>
          <li>\u7DAD\u4FEE\u5B8C\u6210\u901A\u77E5\u5F8C\uFF0C\u8D85\u904E 3 \u65E5\u672A\u53D6\u8ECA\uFF0C\u6BCF\u65E5\u6536\u53D6\u4FDD\u7BA1\u8CBB NT$80</li>
        </ul>
      </section>
      <section className="content-card form-card">
        <h2>Create Repair Reservation</h2>
        <form className="grid-form" onSubmit={createRepair}>
          <label className="form-field">
            <span>Customer</span>
            <select name="customerId" value={form.customerId} onChange={handleChange} required>
              <option value="">Select customer</option>
              {customers.items.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} / {customer.phone || "-"}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Bike Model</span>
            <input name="bikeModel" value={form.bikeModel} onChange={handleChange} required />
          </label>
          <label className="form-field">
            <span>Reservation Date</span>
            <input name="reservationDate" type="date" value={form.reservationDate} onChange={handleChange} required />
          </label>
          <label className="form-field form-field-wide">
            <span>Issue Description</span>
            <textarea name="issueDescription" value={form.issueDescription} onChange={handleChange} rows="3" required />
          </label>
          <button type="submit" className="primary-button inline-submit">
            Save Reservation
          </button>
        </form>
      </section>
      <DataTable columns={columns} rows={repairs.items} emptyText="No repair orders yet." />
    </div>
  );
}

export default RepairsPage;
