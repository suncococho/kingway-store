import { useState } from "react";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import { useFetchList } from "../hooks/useFetchList";
import { apiRequest } from "../lib/api";

const columns = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "lineUserId", label: "LINE User ID" },
  { key: "notes", label: "Notes" }
];

function CustomersPage() {
  const { items, loading, error, refetch } = useFetchList("/api/customers");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    lineUserId: "",
    notes: ""
  });

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    try {
      await apiRequest("/api/customers", {
        method: "POST",
        body: JSON.stringify(form)
      });
      setForm({
        name: "",
        phone: "",
        lineUserId: "",
        notes: ""
      });
      refetch();
      alert("Customer created");
    } catch (requestError) {
      alert(requestError.message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Customer list from the backend API. Full CRUD can be added later."
      />
      <section className="content-card form-card">
        <h2>Create Customer</h2>
        <form className="grid-form compact-grid" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Name</span>
            <input name="name" value={form.name} onChange={handleChange} required />
          </label>
          <label className="form-field">
            <span>Phone</span>
            <input name="phone" value={form.phone} onChange={handleChange} />
          </label>
          <label className="form-field">
            <span>LINE User ID</span>
            <input name="lineUserId" value={form.lineUserId} onChange={handleChange} />
          </label>
          <label className="form-field">
            <span>Notes</span>
            <input name="notes" value={form.notes} onChange={handleChange} />
          </label>
          <button type="submit" className="primary-button inline-submit">
            Create Customer
          </button>
        </form>
      </section>
      {loading ? <div className="loading-state">Loading customers...</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      {!loading && !error ? (
        <DataTable columns={columns} rows={items} emptyText="No customers yet." />
      ) : null}
    </div>
  );
}

export default CustomersPage;
