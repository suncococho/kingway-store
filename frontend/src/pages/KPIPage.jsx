import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import { useFetchList } from "../hooks/useFetchList";

const columns = [
  { key: "staffName", label: "Staff" },
  { key: "role", label: "Role" },
  { key: "logCount", label: "Log Count" },
  { key: "totalScore", label: "Total Score" }
];

function KPIPage() {
  const kpi = useFetchList("/api/kpi");

  return (
    <div>
      <PageHeader title="KPI" description="Simple KPI score summary by staff." />
      <DataTable columns={columns} rows={kpi.items} emptyText="No KPI logs yet." />
    </div>
  );
}

export default KPIPage;
