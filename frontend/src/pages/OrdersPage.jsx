import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import { useFetchList } from "../hooks/useFetchList";

const columns = [
  { key: "orderNo", label: "Order No" },
  { key: "businessDate", label: "Business Date" },
  {
    key: "customerName",
    label: "Customer",
    render: (row) => row.customerName || row.customerNameSnapshot || "-"
  },
  { key: "staffName", label: "Staff" },
  { key: "paymentMethod", label: "Payment" },
  { key: "status", label: "Status" },
  { key: "totalAmount", label: "Total Amount" }
];

function OrdersPage() {
  const { items, loading, error } = useFetchList("/api/orders");

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Recent POS orders from the backend."
      />
      {loading ? <div className="loading-state">Loading orders...</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      {!loading && !error ? (
        <DataTable columns={columns} rows={items} emptyText="No orders yet." />
      ) : null}
    </div>
  );
}

export default OrdersPage;
