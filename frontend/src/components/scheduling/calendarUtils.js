export const DAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
export const STATUS_LABELS = { DRAFT:"已選擇",PENDING:"申請中",APPROVED:"已核准",REJECTED:"不可選",ADJUSTED:"管理員指定",CANCELLED:"可選擇",FULL:"已額滿",CLOSED:"店休日",LOCKED:"不可選" };
export const monthKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
export const moveMonth = (month, amount) => { const [year,index]=month.split("-").map(Number); return monthKey(new Date(year,index-1+amount,1)); };
export const weekStart = (value) => { const date=new Date(`${String(value).slice(0,10)}T00:00:00+08:00`); date.setDate(date.getDate()-((date.getDay()+6)%7)); return date.toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"}); };
export const statusForDay = (day, selected) => selected ? "DRAFT" : day.ownStatus || (!day.isOpen ? "CLOSED" : day.isLocked ? "LOCKED" : day.availableSlots<=0 ? "FULL" : null);
export const deadlinePassed = (day) => { if (!day.deadline) return false; const raw = String(day.deadline).replace(" ", "T"); return new Date(raw.endsWith("Z") || raw.includes("+") ? raw : raw + "+08:00") < new Date(); };
export const canSelectDay = (day) => day.isOpen && !day.isLocked && !deadlinePassed(day) && day.availableSlots>0 && !["PENDING","APPROVED","ADJUSTED"].includes(day.ownStatus);
