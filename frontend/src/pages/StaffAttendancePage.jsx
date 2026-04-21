import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import { useFetchList } from "../hooks/useFetchList";
import { apiRequest } from "../lib/api";

const columns = [
  { key: "staffName", label: "Staff" },
  { key: "checkInAt", label: "Check In" },
  { key: "checkOutAt", label: "Check Out" }
];

function StaffAttendancePage() {
  const attendance = useFetchList("/api/attendance");

  async function checkIn() {
    try {
      await apiRequest("/api/attendance/check-in", {
        method: "POST",
        body: JSON.stringify({})
      });
      attendance.refetch();
      alert("Checked in");
    } catch (error) {
      alert(error.message);
    }
  }

  async function checkOut() {
    try {
      await apiRequest("/api/attendance/check-out", {
        method: "POST",
        body: JSON.stringify({})
      });
      attendance.refetch();
      alert("Checked out");
    } catch (error) {
      alert(error.message);
    }
  }

  return (
    <div>
      <PageHeader title="Staff Attendance" description="Check in, check out, and review attendance history." />
      <section className="action-row">
        <button type="button" className="primary-button action-button" onClick={checkIn}>
          Check In
        </button>
        <button type="button" className="secondary-button action-button" onClick={checkOut}>
          Check Out
        </button>
      </section>
      <DataTable columns={columns} rows={attendance.items} emptyText="No attendance records yet." />
    </div>
  );
}

export default StaffAttendancePage;
