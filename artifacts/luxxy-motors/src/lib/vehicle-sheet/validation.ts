import type { VehicleSheetData, SheetOptions, FeatureHighlight, Disclosure, LabelledValue } from './types';
export class SheetInputError extends Error { constructor(public code: string, message: string) { super(message); this.name='SheetInputError'; } }
export function text(value: unknown): string { return typeof value==='string'?value.trim():typeof value==='number'&&Number.isFinite(value)?String(value):''; }
export function list<T>(value: T[] | undefined | null): T[] { return Array.isArray(value)?value:[]; }
export function highlight(x: string | FeatureHighlight): FeatureHighlight { return typeof x==='string'?{text:x}:{text:x.text,required:x.required===true}; }
export function disclosure(x: string | Disclosure): Disclosure { return typeof x==='string'?{text:x}:x; }
export function historyText(x: string | LabelledValue): string { return typeof x==='string'?x:[x.label.replace(/:+$/, ''),x.value].filter(Boolean).join(': '); }
export function validateData(data: VehicleSheetData): void {
  if(!data||typeof data!=='object'||!data.vehicle||typeof data.vehicle!=='object'||!data.document)throw new SheetInputError('DATA_REQUIRED','Vehicle and document objects are required.');
  if(!text(data.vehicle.title))throw new SheetInputError('TITLE_REQUIRED','A vehicle title is required.');
  for(const [k,v] of Object.entries(data.vehicle)) {
    if(v==null)continue;
    if(['featureHighlights','runningCosts','historyFacts','disclosures','photos','summaryQualifications'].includes(k)) { if(!Array.isArray(v))throw new SheetInputError('INVALID_ARRAY',`${k} must be an array.`);continue; }
    if(k==='shortSummaryPreservesMaterialFacts') { if(typeof v!=='boolean')throw new SheetInputError('INVALID_SUMMARY_ATTESTATION','shortSummaryPreservesMaterialFacts must be boolean.');continue; }
    if(['year','doors','seats'].includes(k) && typeof v==='number' && Number.isFinite(v))continue;
    if(typeof v!=='string')throw new SheetInputError('INVALID_VALUE',`${k} must be a supplied display string.`);
  }
  for(const [k,v] of Object.entries(data.dealer||{})) { if(v==null)continue;if(k==='address'&&Array.isArray(v)&&v.every(x=>typeof x==='string'))continue;if(typeof v!=='string')throw new SheetInputError('INVALID_DEALER_VALUE',`dealer.${k} must be a string.`); }
  const v=data.vehicle;
  for(const x of list(v.featureHighlights))if(typeof x!=='string'&&(!x||typeof x.text!=='string'||(x.required!==undefined&&typeof x.required!=='boolean')))throw new SheetInputError('INVALID_FEATURE','Features must be strings or {text, required?}.');
  for(const x of list(v.disclosures))if(typeof x!=='string'&&(!x||typeof x.text!=='string'||(x.heading!=null&&typeof x.heading!=='string')))throw new SheetInputError('INVALID_DISCLOSURE','Disclosures must contain text.');
  for(const x of list(v.runningCosts))if(!x||typeof x.label!=='string'||typeof x.value!=='string')throw new SheetInputError('INVALID_COST','Running costs require supplied label and value strings.');
  for(const x of list(v.historyFacts))if(typeof x!=='string'&&(!x||typeof x.label!=='string'||typeof x.value!=='string'))throw new SheetInputError('INVALID_HISTORY','History facts must be strings or labelled values.');
  for(const x of list(v.photos))if(typeof x!=='string'&&(!x||typeof x.src!=='string'||(x.alt!=null&&typeof x.alt!=='string')))throw new SheetInputError('INVALID_PHOTO','Photos require a source string.');
  for(const x of list(v.summaryQualifications))if(typeof x!=='string')throw new SheetInputError('INVALID_QUALIFICATION','Qualifications must be supplied strings.');
  if(data.document.printedDate!=null&&typeof data.document.printedDate!=='string')throw new SheetInputError('INVALID_DATE','printedDate must be a supplied display string.');
  for(const c of [data.dealer?.accentColour])if(c&&!/^#[0-9a-f]{6}$/i.test(c))throw new SheetInputError('INVALID_COLOUR','accentColour must be a six-digit hex colour.');
  const reg=text(v.registrationNumber);
  if(reg&&(/^\d{2}\s*reg$/i.test(reg)||/\breg(?:istration)?\b/i.test(reg)||!/[A-Z]/i.test(reg)||!/[0-9]/.test(reg)||!/[A-Z0-9]{2}/i.test(reg.replace(/\s/g,''))||!/^[A-Z0-9 ]+$/i.test(reg)||reg.replace(/\s/g,'').length>8))throw new SheetInputError('INVALID_REGISTRATION','registrationNumber must be an actual supplied registration, not a registration band or annotation.');
}
function publicHost(host: string): boolean { return host.includes('.')&&!host.includes(':')&&!/^\d+(?:\.\d+){0,3}$/.test(host)&&!/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host)&&!host.endsWith('.localhost'); }
export function validateVehiclePageUrl(raw: unknown, policy: SheetOptions): string {
  if(typeof raw!=='string'||!raw)throw new SheetInputError('VEHICLE_URL_REQUIRED','Supply the permanent public vehicle page URL.');
  if(raw!==raw.trim()||/[\u0000-\u0020\u007f]/.test(raw))throw new SheetInputError('INVALID_VEHICLE_URL','The exact URL must not contain whitespace or control characters.');
  let u: URL,origin: URL;try{u=new URL(raw);origin=new URL(policy.dealerWebsiteOrigin);}catch{throw new SheetInputError('INVALID_VEHICLE_URL','The vehicle URL and trusted dealership origin must be absolute HTTPS URLs.');}
  if(u.protocol!=='https:'||origin.protocol!=='https:'||u.username||u.password||origin.username||origin.password||!publicHost(u.hostname)||!publicHost(origin.hostname))throw new SheetInputError('PRIVATE_VEHICLE_URL','Use a public HTTPS dealership website URL.');
  if(origin.pathname!=='/'||origin.search||origin.hash)throw new SheetInputError('INVALID_DEALER_ORIGIN','dealerWebsiteOrigin must contain only scheme and host.');
  if(u.hash)throw new SheetInputError('NON_PERMANENT_URL','Use a canonical vehicle URL without a fragment or fragment-based sharing token.');
  if(u.origin!==origin.origin)throw new SheetInputError('WRONG_DEALER_ORIGIN','The vehicle URL must belong to the configured dealership origin.');
  if(/(^|\.)(autotrader\.(co\.uk|com|ca)|cazoo\.(co\.uk|com))$/i.test(u.hostname))throw new SheetInputError('MARKETPLACE_URL','Marketplace URLs are not dealership vehicle pages.');
  let path=u.pathname;try{for(let i=0;i<2;i++)path=decodeURIComponent(path);}catch{throw new SheetInputError('INVALID_PATH','Malformed URL path encoding.');}
  if(path==='/'||/(^|\/)(api|admin|staff|portal|login|signin|sign-in|auth|account|share|preview|sign|customer-details|my-purchase)(\/|$)/i.test(path)||/\.(pdf|jpg|png|webp)$/i.test(path))throw new SheetInputError('NON_PUBLIC_VEHICLE_PATH','Use the permanent public vehicle page, not a login, staff, preview, share or asset URL.');
  if(policy.vehiclePathPrefix&&(!policy.vehiclePathPrefix.startsWith('/')||!u.pathname.startsWith(policy.vehiclePathPrefix)))throw new SheetInputError('WRONG_VEHICLE_PATH','URL does not match the configured public vehicle route.');
  for(const [key] of u.searchParams){if(/token|sig|expires|session|secret|auth|redirect|next|key|code/i.test(key)||!policy.permanentQueryKeys?.includes(key))throw new SheetInputError('NON_PERMANENT_URL','Use a canonical permanent URL without sharing, authentication or expiry parameters.');}
  return raw; // Never serialise or normalise the accepted payload.
}
