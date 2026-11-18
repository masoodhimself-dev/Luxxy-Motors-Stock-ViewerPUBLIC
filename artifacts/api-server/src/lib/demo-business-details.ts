import { z } from 'zod/v4';
const publicUrl=z.string().url().max(2048).refine(value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port;}catch{return false;}},'Use a public HTTPS source URL without credentials or a custom port.');
const checkedAt=z.iso.datetime({offset:true}).refine(value=>new Date(value).getTime()<=Date.now()+300000,'Source check cannot be in the future.');
const evidence={sourceUrl:publicUrl,checkedAt};
export const demoShowroomAddress=z.object({street:z.string().trim().min(1).max(160),city:z.string().trim().min(1).max(80),region:z.string().trim().max(80).default(''),postcode:z.string().trim().min(1).max(20),mapsUrl:z.union([publicUrl,z.literal('')]).optional(),...evidence}).strict();
const clock=z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
const day=z.number().int().min(0).max(6);
const openingDay=z.discriminatedUnion('status',[
 z.object({day,status:z.literal('open'),open:clock,close:clock}).strict().refine(v=>v.close>v.open,'Closing time must be after opening time; do not guess overnight hours.'),
 z.object({day,status:z.enum(['closed','appointment_only','unknown'])}).strict(),
]);
export const demoOpeningHours=z.object({timezone:z.literal('Europe/London').default('Europe/London'),days:z.array(openingDay).length(7).refine(rows=>new Set(rows.map(r=>r.day)).size===7,'Provide each weekday exactly once.'),...evidence}).strict();
const dayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export function publishedDemoHours(hours:z.infer<typeof demoOpeningHours>){return [...hours.days].sort((a,b)=>(a.day+6)%7-(b.day+6)%7).map(row=>({days:dayNames[row.day],times:row.status==='open'?`${row.open} - ${row.close}`:row.status==='closed'?'Closed':row.status==='appointment_only'?'By appointment':'Contact us to confirm'}));}

const publicText = (max: number) => z.string().trim().max(max);
export const demoDealershipDetails = z.object({
  ...evidence,
  phone: publicText(40).regex(/^[+()\d .-]*$/).optional(),
  email: z.union([z.email().max(160), z.literal('')]).optional(),
  websiteUrl: z.union([publicUrl, z.literal('')]).optional(),
  about: publicText(1000).optional(),
  visitInstructions: publicText(1000).optional(),
  showroomAddress: demoShowroomAddress.optional(),
  openingHours: demoOpeningHours.optional(),
  includedItems: z.array(publicText(160).min(1)).max(12).optional(),
  warrantyDescription: publicText(300).optional(),
  deliveryDescription: publicText(300).optional(),
  partExchangeDescription: publicText(300).optional(),
}).strict();

export type DemoDealershipDetails = z.infer<typeof demoDealershipDetails>;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Apply only supplied public details, preserving independently edited settings. */
export function applyDemoDealershipDetails(config: Record<string, unknown>, details?: DemoDealershipDetails) {
  if (!details) return config;
  const result = { ...config };
  const contact = { ...object(config.contact) };
  if (details.phone !== undefined) contact.phone = details.phone;
  if (details.email !== undefined) contact.email = details.email;
  result.contact = contact;
  const presentation = { ...object(config.presentation) };
  if (details.about !== undefined) presentation.teamIntroduction = details.about;
  if (details.visitInstructions !== undefined) presentation.visitInstructions = details.visitInstructions;
  if (details.includedItems !== undefined) {
    const seen = new Set<string>();
    presentation.includedItems = details.includedItems.filter(item => {
      const key = item.toLocaleLowerCase('en-GB');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  result.presentation = presentation;
  if (details.showroomAddress) {
    const { sourceUrl, checkedAt, ...address } = details.showroomAddress;
    result.address = { ...object(config.address), ...address, mapsUrl: address.mapsUrl ?? '' };
  }
  if (details.openingHours) result.hours = publishedDemoHours(details.openingHours);
  for (const [key, description] of [
    ['warranty', details.warrantyDescription],
    ['delivery', details.deliveryDescription],
    ['partExchange', details.partExchangeDescription],
  ] as const) {
    if (description !== undefined) {
      result[key] = { ...object(config[key]), enabled: Boolean(description), description };
    }
  }
  return result;
}
