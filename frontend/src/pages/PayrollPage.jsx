import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import { useFetchList } from "../hooks/useFetchList";

const columns = [
  { key: "staffName", label: "Staff" },
  { key: "totalDaysWorked", label: "Days Worked" },
  { key: "completedShifts", label: "Completed Shifts" },
  { key: "firstCheckIn", label: "First Check In" },
  { key: "lastCheckOut", label: "Last Check Out" }
];

function PayrollPage() {
  const payroll = useFetchList("/api/payroll/summary");

  return (
    <div>
      <PageHeader title="Payroll Summary" description="Basic attendance-based payroll summary." />
      <DataTable columns={columns} rows={payroll.items} emptyText="No payroll summary yet." />
    </div>
  );
}

export default PayrollPage;
