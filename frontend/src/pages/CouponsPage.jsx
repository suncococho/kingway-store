import { useMemo, useState } from "react";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import DetailModal from "../components/DetailModal";
import FilterBar from "../components/FilterBar";
import FilterChips from "../components/FilterChips";
import PageHeader from "../components/PageHeader";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import { useFetchList } from "../hooks/useFetchList";
import { apiRequest } from "../lib/api";
import { getCouponStatusLabel, getCouponTypeLabel } from "../lib/display";

function formatAmount(value) {
  return `NT$${Number(value || 0).toFixed(0)}`;
}

function CouponsPage() {
  const coupons = useFetchList("/coupons");
  const [newFriendForm, setNewFriendForm] = useState({ customerId: "", orderId: "" });
  const [reviewForm, setReviewForm] = useState({ customerId: "", orderId: "" });
  const [tab, setTab] = useState("ALL");
  const [keyword, setKeyword] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [detail, setDetail] = useState(null);

  const sectionItems = [
    { key: "ALL", label: "全部優惠券" },
    { key: "new_friend", label: "新朋友優惠券" },
    { key: "google_review", label: "Google 評論優惠券" },
    { key: "pending_approval", label: "待審核" },
    { key: "issued", label: "已發放" },
    { key: "used", label: "已使用" },
    { key: "expired", label: "已失效" }
  ];

  function handleFormChange(setter, name, value) {
    setter((current) => ({
      ...current,
      [name]: value
    }));
  }

  async function issueNewFriend(event) {
    event.preventDefault();
    try {
      await apiRequest("/coupons/issue", {
        method: "POST",
        body: JSON.stringify({
          customerId: Number(newFriendForm.customerId),
          orderId: Number(newFriendForm.orderId),
          couponType: "new_friend"
        })
      });
      setNewFriendForm({ customerId: "", orderId: "" });
      coupons.refetch();
      alert("已發送新朋友優惠券");
    } catch (error) {
      alert(error.message);
    }
  }

  async function requestReviewCoupon(event) {
    event.preventDefault();
    try {
      await apiRequest("/coupons/request-google-review", {
        method: "POST",
        body: JSON.stringify({
          customerId: Number(reviewForm.customerId),
          orderId: Number(reviewForm.orderId)
        })
      });
      setReviewForm({ customerId: "", orderId: "" });
      coupons.refetch();
      alert("已送出 Google 評論優惠券申請");
    } catch (error) {
      alert(error.message);
    }
  }

  async function approveCoupon(id) {
    try {
      await apiRequest(`/coupons/approve-google-review/${id}`, {
        method: "POST",
        body: JSON.stringify({})
      });
      coupons.refetch();
      alert("優惠券已核准");
    } catch (error) {
      alert(error.message);
    }
  }

  async function rejectCoupon(id) {
    try {
      await apiRequest(`/coupons/reject-google-review/${id}`, {
        method: "POST",
        body: JSON.stringify({ reason: "後台人工拒絕" })
      });
      coupons.refetch();
      alert("已拒絕優惠券");
    } catch (error) {
      alert(error.message);
    }
  }

  const rows = useMemo(
    () =>
      coupons.items.map((item) => ({
        ...item,
        couponTypeLabel: item.couponTypeLabel || getCouponTypeLabel(item.couponType),
        statusLabel: item.statusLabel || getCouponStatusLabel(item.status || (item.isUsed ? "used" : "issued")),
        categoryLabel: item.eligibleCategory || "-",
        signedLabel: item.approvedByStaffId ? "已處理" : "未處理",
        statusTone:
          item.status === "pending_approval"
            ? "warning"
            : item.status === "used"
              ? "success"
              : item.status === "expired"
                ? "neutral"
                : item.status === "rejected"
                  ? "danger"
                  : "info"
      })),
    [coupons.items]
  );

  const filteredRows = useMemo(
    () =>
      rows.filter((item) => {
        const text = keyword.trim().toLowerCase();
        if (text && !`${item.code} ${item.customerName || ""} ${item.couponTypeLabel || ""}`.toLowerCase().includes(text)) {
          return false;
        }
        if (categoryFilter !== "ALL" && item.eligibleCategory !== categoryFilter) {
          return false;
        }
        if (statusFilter !== "ALL" && item.status !== statusFilter) {
          return false;
        }
        if (tab === "new_friend" && item.couponType !== "new_friend") {
          return false;
        }
        if (tab === "google_review" && item.couponType !== "google_review") {
          return false;
        }
        if (tab === "pending_approval" && item.status !== "pending_approval") {
          return false;
        }
        if (tab === "issued" && item.status !== "issued") {
          return false;
        }
        if (tab === "used" && item.status !== "used") {
          return false;
        }
        if (tab === "expired" && item.status !== "expired") {
          return false;
        }
        return true;
      }),
    [categoryFilter, keyword, rows, statusFilter, tab]
  );

  const summaryCards = useMemo(
    () => [
      { label: "優惠券總數", value: rows.length },
      { label: "待審核", value: rows.filter((item) => item.status === "pending_approval").length },
      { label: "已發放", value: rows.filter((item) => item.status === "issued").length },
      { label: "已使用", value: rows.filter((item) => item.status === "used").length },
      { label: "已失效", value: rows.filter((item) => item.status === "expired").length }
    ],
    [rows]
  );

  function openDetail(row) {
    setDetail(row);
  }

  const columns = [
    { key: "code", label: "券碼" },
    { key: "customerName", label: "客戶" },
    {
      key: "couponTypeLabel",
      label: "類型",
      render: (row) => <StatusBadge tone={row.couponType === "new_friend" ? "info" : "warning"}>{row.couponTypeLabel}</StatusBadge>
    },
    { key: "amount", label: "金額", render: (row) => formatAmount(row.amount), mobileHidden: true },
    {
      key: "statusLabel",
      label: "狀態",
      render: (row) => <StatusBadge tone={row.statusTone}>{row.statusLabel}</StatusBadge>
    },
    { key: "categoryLabel", label: "適用分類", mobileHidden: true },
    {
      key: "action",
      label: "操作",
      render: (row) => (
        <div className="action-row compact-actions">
          {row.couponType === "google_review" && !row.approvedByStaffId && row.status === "pending_approval" ? (
            <>
              <button type="button" className="secondary-button" onClick={() => approveCoupon(row.id)}>
                核准發券
              </button>
              <button type="button" className="secondary-button" onClick={() => rejectCoupon(row.id)}>
                拒絕
              </button>
            </>
          ) : null}
          <button type="button" className="secondary-button" onClick={() => openDetail(row)}>
            詳情
          </button>
        </div>
      ),
      mobileHidden: true
    }
  ];

  return (
    <div>
      <PageHeader title="優惠券管理" description="新朋友與 Google 評論優惠券都在同一頁管理，狀態與審核一眼可見。" />
      <SectionTabs items={sectionItems} value={tab} onChange={setTab} label="優惠券子功能" />
      <div className="admin-summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className="admin-summary-card">
            <div className="admin-summary-label">{card.label}</div>
            <div className="admin-summary-value">{card.value}</div>
          </article>
        ))}
      </div>

      <section className="content-card form-card">
        <AdminSectionHeader
          eyebrow="發券操作"
          title="發送與審核"
          description="保留既有發券與審核流程，只整理成較清楚的操作區。"
        />
        <div className="admin-split-grid">
          <section className="stack-card">
            <div className="section-title">發送新朋友優惠券</div>
            <form className="grid-form compact-grid" onSubmit={issueNewFriend}>
              <label className="form-field">
                <span>客戶 ID</span>
                <input value={newFriendForm.customerId} onChange={(event) => handleFormChange(setNewFriendForm, "customerId", event.target.value)} />
              </label>
              <label className="form-field">
                <span>訂單 ID</span>
                <input value={newFriendForm.orderId} onChange={(event) => handleFormChange(setNewFriendForm, "orderId", event.target.value)} />
              </label>
              <button type="submit" className="primary-button inline-submit">
                發送 NT$500
              </button>
            </form>
          </section>
          <section className="stack-card">
            <div className="section-title">申請 Google 評論優惠券</div>
            <form className="grid-form compact-grid" onSubmit={requestReviewCoupon}>
              <label className="form-field">
                <span>客戶 ID</span>
                <input value={reviewForm.customerId} onChange={(event) => handleFormChange(setReviewForm, "customerId", event.target.value)} />
              </label>
              <label className="form-field">
                <span>訂單 ID</span>
                <input value={reviewForm.orderId} onChange={(event) => handleFormChange(setReviewForm, "orderId", event.target.value)} />
              </label>
              <button type="submit" className="primary-button inline-submit">
                送出審核
              </button>
            </form>
          </section>
        </div>
      </section>
      <section className="content-card section-panel">
        <div className="section-header">
          <div>
            <h2>{sectionItems.find((item) => item.key === tab)?.label || "全部優惠券"}</h2>
            <p className="muted-text">列表聚焦券碼、客戶、類型、金額、狀態與適用分類。</p>
          </div>
          <StatusBadge tone="info">顯示 {filteredRows.length} 筆</StatusBadge>
        </div>
        <FilterBar>
          <label className="form-field">
            <span>關鍵字搜尋</span>
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="券碼 / 客戶 / 類型" />
          </label>
          <label className="form-field">
            <span>適用分類</span>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="ALL">全部分類</option>
              <option value="EB">電動自行車</option>
              <option value="REPAIR">維修</option>
              <option value="ACCESSORY">配件</option>
              <option value="OTHER">其他</option>
            </select>
          </label>
        </FilterBar>
        <div className="admin-filter-stack">
          <div>
            <div className="admin-filter-label">狀態</div>
            <FilterChips
              items={[
                { key: "ALL", label: "全部狀態" },
                { key: "pending_approval", label: "待審核" },
                { key: "issued", label: "已發放" },
                { key: "used", label: "已使用" },
                { key: "expired", label: "已失效" }
              ]}
              value={statusFilter}
              onChange={setStatusFilter}
            />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={filteredRows}
          emptyText="目前沒有優惠券資料。"
          cardTitle={(row) => row.code}
          cardDescription={(row) => `${row.customerName || "-"} / ${row.couponTypeLabel}`}
          cardBadges={(row) => (
            <>
              <StatusBadge tone={row.couponType === "new_friend" ? "info" : "warning"}>{row.couponTypeLabel}</StatusBadge>
              <StatusBadge tone={row.statusTone}>{row.statusLabel}</StatusBadge>
            </>
          )}
          cardFooter={(row) => (
            <div className="field-grid">
              <div className="field-item">
                <div className="field-label">金額</div>
                <div className="field-value">{formatAmount(row.amount)}</div>
              </div>
              <div className="field-item">
                <div className="field-label">適用分類</div>
                <div className="field-value">{row.categoryLabel}</div>
              </div>
              <div className="field-item">
                <div className="field-label">操作</div>
                <div className="field-value">
                  <div className="action-row compact-actions">
                    {row.couponType === "google_review" && !row.approvedByStaffId && row.status === "pending_approval" ? (
                      <>
                        <button type="button" className="secondary-button" onClick={() => approveCoupon(row.id)}>
                          核准發券
                        </button>
                        <button type="button" className="secondary-button" onClick={() => rejectCoupon(row.id)}>
                          拒絕
                        </button>
                      </>
                    ) : null}
                    <button type="button" className="secondary-button" onClick={() => openDetail(row)}>
                      詳情
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        />
      </section>
      <DetailModal
        open={Boolean(detail)}
        title={detail ? `優惠券 ${detail.code}` : "優惠券詳情"}
        subtitle={detail ? `${detail.customerName || "-"} / ${detail.couponTypeLabel}` : ""}
        onClose={() => setDetail(null)}
      >
        {detail ? (
          <div className="admin-detail-layout">
            <div className="admin-split-grid">
              <section className="stack-card">
                <div className="section-title">基本資料</div>
                <div className="field-grid">
                  <div className="field-item"><div className="field-label">券碼</div><div className="field-value">{detail.code}</div></div>
                  <div className="field-item"><div className="field-label">客戶</div><div className="field-value">{detail.customerName || "-"}</div></div>
                  <div className="field-item"><div className="field-label">類型</div><div className="field-value">{detail.couponTypeLabel}</div></div>
                  <div className="field-item"><div className="field-label">狀態</div><div className="field-value">{detail.statusLabel}</div></div>
                </div>
              </section>
              <section className="stack-card">
                <div className="section-title">發券資訊</div>
                <div className="field-grid">
                  <div className="field-item"><div className="field-label">金額</div><div className="field-value">{formatAmount(detail.amount)}</div></div>
                  <div className="field-item"><div className="field-label">適用分類</div><div className="field-value">{detail.categoryLabel}</div></div>
                  <div className="field-item"><div className="field-label">核准人員</div><div className="field-value">{detail.approvedByStaffId || "-"}</div></div>
                  <div className="field-item"><div className="field-label">已發放時間</div><div className="field-value">{detail.issuedAt || "-"}</div></div>
                </div>
              </section>
            </div>
            <section className="stack-card">
              <div className="section-title">狀態紀錄</div>
              <div className="field-grid">
                <div className="field-item"><div className="field-label">已使用時間</div><div className="field-value">{detail.usedAt || "-"}</div></div>
                <div className="field-item"><div className="field-label">核准時間</div><div className="field-value">{detail.approvedAt || "-"}</div></div>
                <div className="field-item"><div className="field-label">拒絕時間</div><div className="field-value">{detail.rejectedAt || "-"}</div></div>
                <div className="field-item"><div className="field-label">拒絕原因</div><div className="field-value">{detail.rejectionReason || "-"}</div></div>
              </div>
            </section>
            <div className="action-row">
              {detail.couponType === "google_review" && !detail.approvedByStaffId && detail.status === "pending_approval" ? (
                <>
                  <button type="button" className="secondary-button" onClick={() => approveCoupon(detail.id)}>
                    核准發券
                  </button>
                  <button type="button" className="secondary-button" onClick={() => rejectCoupon(detail.id)}>
                    拒絕
                  </button>
                </>
              ) : null}
              <button type="button" className="secondary-button" onClick={() => setDetail(null)}>
                關閉
              </button>
            </div>
          </div>
        ) : null}
      </DetailModal>
    </div>
  );
}

export default CouponsPage;
