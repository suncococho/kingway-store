import { useState } from "react";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import { useFetchList } from "../hooks/useFetchList";
import { apiRequest } from "../lib/api";

const columns = [
  { key: "name", label: "Name" },
  { key: "sku", label: "SKU" },
  { key: "category", label: "Category" },
  { key: "price", label: "Price" },
  { key: "stock", label: "Stock" },
  { key: "reorderLevel", label: "Reorder Level" }
];

function ProductsPage() {
  const { items, loading, error, refetch } = useFetchList("/api/products");
  const [form, setForm] = useState({
    name: "",
    sku: "",
    category: "OTHER",
    price: "",
    stock: "",
    reorderLevel: "0"
  });
  const [submitting, setSubmitting] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);

    try {
      await apiRequest("/api/products", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          sku: form.sku,
          category: form.category,
          price: Number(form.price),
          stock: Number(form.stock),
          reorderLevel: Number(form.reorderLevel)
        })
      });

      setForm({
        name: "",
        sku: "",
        category: "OTHER",
        price: "",
        stock: "",
        reorderLevel: "0"
      });
      refetch();
    } catch (requestError) {
      alert(requestError.message || "Failed to create product");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Products"
        description="View product SKU, pricing, and stock levels."
      />
      <section className="content-card form-card">
        <h2>Create Product</h2>
        <form className="inline-form" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Name</span>
            <input
              name="name"
              type="text"
              value={form.name}
              onChange={handleChange}
              required
            />
          </label>
          <label className="form-field">
            <span>SKU</span>
            <input
              name="sku"
              type="text"
              value={form.sku}
              onChange={handleChange}
              required
            />
          </label>
          <label className="form-field">
            <span>Price</span>
            <input
              name="price"
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={handleChange}
              required
            />
          </label>
          <label className="form-field">
            <span>Stock</span>
            <input
              name="stock"
              type="number"
              min="0"
              step="1"
              value={form.stock}
              onChange={handleChange}
              required
            />
          </label>
          <label className="form-field">
            <span>Category</span>
            <select name="category" value={form.category} onChange={handleChange}>
              <option value="EBIKE">EBIKE</option>
              <option value="REPAIR">REPAIR</option>
              <option value="ACCESSORY">ACCESSORY</option>
              <option value="OTHER">OTHER</option>
            </select>
          </label>
          <label className="form-field">
            <span>Reorder Level</span>
            <input
              name="reorderLevel"
              type="number"
              min="0"
              step="1"
              value={form.reorderLevel}
              onChange={handleChange}
            />
          </label>
          <button type="submit" className="primary-button inline-submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create Product"}
          </button>
        </form>
      </section>
      {loading ? <div className="loading-state">Loading products...</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      {!loading && !error ? (
        <DataTable columns={columns} rows={items} emptyText="No products yet." />
      ) : null}
    </div>
  );
}

export default ProductsPage;
