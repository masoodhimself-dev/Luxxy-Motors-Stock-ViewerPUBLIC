import { getUpcomingVisitDates, type DealerHour } from './upcoming-visit-dates';
export function showroomHours(hours: DealerHour[], now = new Date()) {
 const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const minute = Number(parts.find(p=>p.type==='hour')?.value)*60+Number(parts.find(p=>p.type==='minute')?.value);
 const dates = getUpcomingVisitDates(hours,now,14);
 const today = dates.find(day=>day.relativeLabel==='Today');
 const range = (text:string) => {
  const match=text.match(/^(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})(?:\s*\(sample\))?$/i);
  if(!match) return null;
  const [h,m,h2,m2]=match.slice(1).map(Number); const start=h*60+m,end=h2*60+m2;
  return h<24&&h2<24&&m<60&&m2<60&&end>start?{start,end,label:`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`} : null;
 };
 const current=today?range(today.times):null;
 const state = current ? minute>=current.start&&minute<current.end?'open':'closed' : today && /^closed$/i.test(today.times.trim())?'closed':'unknown';
 const next=dates.find(day=> { const value=range(day.times); return value && (day.relativeLabel!=='Today'||value.start>minute); });
 return {state,next:next?`${next.relativeLabel.toLowerCase()} at ${range(next.times)!.label} (UK time)`:null};
}
