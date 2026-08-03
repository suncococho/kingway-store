import { STATUS_LABELS } from "./calendarUtils";
export default function WorkdayRequestStatus({status}){const label=STATUS_LABELS[status]||"可選擇";return <span className={`workday-status workday-status-${String(status||"open").toLowerCase()}`}>{label}</span>}
