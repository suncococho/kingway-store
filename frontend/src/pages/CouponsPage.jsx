import { useState } from "react";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import { useFetchList } from "../hooks/useFetchList";
import { apiRequest } from "../lib/api";

const columns = [
  { key: "code", label: "Code" },
  { key: "couponType", label: "Type" },
  { key: "amount", label: "Amount" },
  { key: "customerName", label: "Customer" },
  { key: "approvedByStaffId", label: "Approved By" },
  {
    key: "action",
    label: "Action",
    render: (row) =>
      row.couponType === "google_review" && !row.approvedByStaffId ? (
        <button type="button" className="secondary-button" onClick={() => row.onApprove(row.id)}>
          Approve
        </button>
      ) : (
        "-"
      )
  }
];

function CouponsPage() {
  const coupons = useFetchList("/api/coupons");
  const [newFriendForm, setNewFriendForm] = useState({ customerId: "", orderId: "" });
  const [reviewForm, setReviewForm] = useState({ customerId: "", orderId: "" });

  function handleFormChange(setter, name, value) {
    setter((current) => ({
      ...current,
      [name]: value
    }));
  }

  async function issueNewFriend(event) {
    event.preventDefault();
    try {
      await apiRequest("/api/coupons/issue", {
        method: "POST",
        body: JSON.stringify({
          customerId: Number(newFriendForm.customerId),
          orderId: Number(newFriendForm.orderId),
          couponType: "new_friend"
        })
      });
      setNewFriendForm({ customerId: "", orderId: "" });
      coupons.refetch();
      alert("New friend coupon issued");
    } catch (error) {
      alert(error.message);
    }
  }

  async function requestReviewCoupon(event) {
    event.preventDefault();
    try {
      await apiRequest("/api/coupons/request-google-review", {
        method: "POST",
        body: JSON.stringify({
          customerId: Number(reviewForm.customerId),
          orderId: Number(reviewForm.orderId)
        })
      });
      setReviewForm({ customerId: "", orderId: "" });
      coupons.refetch();
      alert("Google review coupon requested");
    } catch (error) {
      alert(error.message);
    }
  }

  async function approveCoupon(id) {
    try {
      await apiRequest(`/api/coupons/approve-google-review/${id}`, {
        method: "POST",
        body: JSON.stringify({})
      });
      coupons.refetch();
      alert("Coupon approved");
    } catch (error) {
      alert(error.message);
    }
  }

  const rows = coupons.items.map((item) => ({
    ...item,
    onApprove: approveCoupon
  }));

  return (
    <div>
      <PageHeader title="Coupons" description="Issue new friend coupons and approve Google review coupons." />
      <section className="content-card form-card">
        <h2>Issue New Friend Coupon</h2>
        <form className="grid-form compact-grid" onSubmit={issueNewFriend}>
          <label className="form-field">
            <span>Customer ID</span>
            <input value={newFriendForm.customerId} onChange={(event) => handleFormChange(setNewFriendForm, "customerId", event.target.value)} />
          </label>
          <label className="form-field">
            <span>Order ID</span>
            <input value={newFriendForm.orderId} onChange={(event) => handleFormChange(setNewFriendForm, "orderId", event.target.value)} />
          </label>
          <button type="submit" className="primary-button inline-submit">
            Issue NT$500
          </button>
        </form>
      </section>
      <section className="content-card form-card">
        <h2>Request Google Review Coupon</h2>
        <form className="grid-form compact-grid" onSubmit={requestReviewCoupon}>
          <label className="form-field">
            <span>Customer ID</span>
            <input value={reviewForm.customerId} onChange={(event) => handleFormChange(setReviewForm, "customerId", event.target.value)} />
          </label>
          <label className="form-field">
            <span>Order ID</span>
            <input value={reviewForm.orderId} onChange={(event) => handleFormChange(setReviewForm, "orderId", event.target.value)} />
          </label>
          <button type="submit" className="primary-button inline-submit">
            Request Approval
          </button>
        </form>
      </section>
      <DataTable columns={columns} rows={rows} emptyText="No coupons yet." />
    </div>
  );
}

export default CouponsPage;
