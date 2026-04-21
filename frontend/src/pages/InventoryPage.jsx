import { useState } from "react";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import { useFetchList } from "../hooks/useFetchList";
import { apiRequest } from "../lib/api";

const lowStockColumns = [
  { key: "name", label: "Name" },
  { key: "sku", label: "SKU" },
  { key: "category", label: "Category" },
  { key: "stock", label: "Stock" },
  { key: "reorderLevel", label: "Reorder Level" }
];

const movementColumns = [
  { key: "productName", label: "Product" },
  { key: "sku", label: "SKU" },
  { key: "movementType", label: "Type" },
  { key: "quantity", label: "Qty" },
  { key: "notes", label: "Note" },
  { key: "createdAt", label: "Created At" }
];

function InventoryPage() {
  const lowStock = useFetchList("/api/inventory/low-stock");
  const movements = useFetchList("/api/inventory/movements");
  const products = useFetchList("/api/products");
  const [form, setForm] = useState({
    productId: "",
    type: "IN",
    qty: "",
    note: ""
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
      await apiRequest("/api/inventory/movements", {
        method: "POST",
        body: JSON.stringify({
          productId: Number(form.productId),
          type: form.type,
          qty: Number(form.qty),
          note: form.note
        })
      });
      setForm({
        productId: "",
        type: "IN",
        qty: "",
        note: ""
      });
      lowStock.refetch();
      movements.refetch();
      products.refetch();
      alert("Inventory updated");
    } catch (error) {
      alert(error.message);
    }
  }

  return (
    <div>
      <PageHeader title="Inventory" description="Adjust stock and review low-stock products." />
      <section className="content-card form-card">
        <h2>Inventory Movement</h2>
        <form className="grid-form" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Product</span>
            <select name="productId" value={form.productId} onChange={handleChange} required>
              <option value="">Select product</option>
              {products.items.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} ({product.sku}) stock={product.stock}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Type</span>
            <select name="type" value={form.type} onChange={handleChange}>
              <option value="IN">IN</option>
              <option value="OUT">OUT</option>
              <option value="ADJUST">ADJUST</option>
            </select>
          </label>
          <label className="form-field">
            <span>Qty</span>
            <input name="qty" type="number" min="1" value={form.qty} onChange={handleChange} required />
          </label>
          <label className="form-field">
            <span>Note</span>
            <input name="note" type="text" value={form.note} onChange={handleChange} />
          </label>
          <button type="submit" className="primary-button inline-submit">
            Save Movement
          </button>
        </form>
      </section>
      <section className="page-section">
        <h2>Low Stock</h2>
        <DataTable columns={lowStockColumns} rows={lowStock.items} emptyText="No low-stock products." />
      </section>
      <section className="page-section">
        <h2>Movement Log</h2>
        <DataTable columns={movementColumns} rows={movements.items} emptyText="No inventory movement yet." />
      </section>
    </div>
  );
}

export default InventoryPage;
