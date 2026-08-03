import WorkdayRequestStatus from "./WorkdayRequestStatus";
export default function CalendarLegend(){return <div className="workday-legend" aria-label="月曆狀態說明">{[null,"DRAFT","PENDING","APPROVED","FULL","CLOSED","LOCKED","ADJUSTED"].map((status)=><WorkdayRequestStatus key={status||"OPEN"} status={status}/>)}</div>}
