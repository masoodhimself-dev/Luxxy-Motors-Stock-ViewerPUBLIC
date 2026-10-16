import { z } from 'zod/v4';
const publicUrl=z.string().url().max(2048).refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port;},'Use a public HTTPS source URL without credentials or a custom port.');
const checkedAt=z.iso.datetime({offset:true}).refine(value=>new Date(value).getTime()<=Date.now()+300000,'Source check cannot be in the future.');
const evidence={sourceUrl:publicUrl,checkedAt};
export const demoShowroomAddress=z.object({street:z.string().trim().min(1).max(160),city:z.string().trim().min(1).max(80),region:z.string().trim().max(80).default(''),postcode:z.string().trim().min(1).max(20),mapsUrl:publicUrl.optional(),...evidence}).strict();
const clock=z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
const day=z.number().int().min(0).max(6);
const openingDay=z.discriminatedUnion('status',[
 z.object({day,status:z.literal('open'),open:clock,close:clock}).strict().refine(v=>v.close>v.open,'Closing time must be after opening time; do not guess overnight hours.'),
 z.object({day,status:z.enum(['closed','appointment_only','unknown'])}).strict(),
]);
export const demoOpeningHours=z.object({timezone:z.literal('Europe/London').default('Europe/London'),days:z.array(openingDay).length(7).refine(rows=>new Set(rows.map(r=>r.day)).size===7,'Provide each weekday exactly once.'),...evidence}).strict();
const dayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export function publishedDemoHours(hours:z.infer<typeof demoOpeningHours>){return [...hours.days].sort((a,b)=>(a.day+6)%7-(b.day+6)%7).map(row=>({days:dayNames[row.day],times:row.status==='open'?`${row.open} - ${row.close}`:row.status==='closed'?'Closed':row.status==='appointment_only'?'By appointment':'Contact us to confirm'}));}
