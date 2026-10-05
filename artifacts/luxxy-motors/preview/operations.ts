// Local review service. No production account, import, email or payment is changed.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { UpdateDealerSettingsBody } from '../../../lib/api-zod/src/generated/api';
import { bookingPolicyError } from '../../api-server/src/lib/booking-slots';
import { preserveBrochure, preserveOnlineReservation, preservePresentation, preserveTestDriveBooking, reservationSettingsError } from '../../api-server/src/lib/settings-content';
import { expectedSettingsRevision, nextSettingsVersion, SettingsVersionError, type SettingsVersion } from '../../api-server/src/lib/settings-versions';
import { saleWorkspaceFingerprint } from '@workspace/vehicle-meta';
import { dealerOperationsSummary, paymentLedgerCsv, stockHealth, type OperationEnquiry } from '../../api-server/src/lib/dealer-operations';
import { isStaffRole, operationPermission, permissionsForRole, roleHasPermission, type StaffRole } from '../../api-server/src/lib/staff-permissions';
import { readPreviewSettings } from './reservations';
import { PreviewSaleWorkspaceStore } from './sales';
import { previewStock } from './stock';
export type PreviewOperationMember = { id: string; authUserId: string; name: string | null; email: string | null; role: StaffRole; active: boolean; createdAt: string; lastSeenAt: string };
export type PreviewOperationsState = { schemaVersion: 1; versions: SettingsVersion[]; members: PreviewOperationMember[]; prices: Record<string, number | null> };
export type PreviewOperationsOptions = {
  readSettings?: () => Promise<Record<string, unknown>>;
  writeSettings?: (config: Record<string, unknown>) => Promise<void>;
  readEnquiries?: () => Promise<OperationEnquiry[]>;
  readSales?: () => Promise<SaleWorkspaceRecord[]>;
  stateFile?: string;
};
const defaultFile = fileURLToPath(new URL('../../../.local/dealer-operations-preview.json', import.meta.url));
const queues = new Map<string, Promise<unknown>>();
function serial<T>(file: string, work: () => Promise<T>): Promise<T> {
  const result = (queues.get(file) ?? Promise.resolve()).then(work,work); queues.set(file,result.catch(()=>{})); return result;
}
async function load(file: string, settings: () => Promise<Record<string,unknown>>): Promise<PreviewOperationsState> {
  try {
    const state = JSON.parse(await readFile(file,'utf8')) as PreviewOperationsState;
    if (state.schemaVersion !== 1 || !Array.isArray(state.versions) || !state.versions.length || !Array.isArray(state.members)) throw new Error('Invalid operations store');
    const published = await settings(); const latest = state.versions.at(-1)!;
    // A previous process may have stopped after saving the booking settings but
    // before saving history. Recover that published snapshot as a fresh version.
    if (saleWorkspaceFingerprint(published) !== saleWorkspaceFingerprint(latest.config)) {
      state.versions.push(nextSettingsVersion(latest,published,latest.revision,'Recovered local settings',new Date().toISOString()));
      await save(file,state);
    }
    return state;
  }
  catch(error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const now = new Date().toISOString();
    return { schemaVersion: 1, versions: [{ revision: 0, config: await settings(), publishedAt: now, publishedBy: 'Initial settings', action: 'initial' }], members: [{ id:'00000000-0000-4000-8000-000000000001',authUserId:'preview-alex',name:'Alex',email:'alex@example.test',role:'owner',active:true,createdAt:now,lastSeenAt:now },{ id:'00000000-0000-4000-8000-000000000002',authUserId:'preview-jamie',name:'Jamie',email:'jamie@example.test',role:'salesperson',active:true,createdAt:now,lastSeenAt:now }], prices:{} };
  }
}
async function save(file:string,state:PreviewOperationsState) {
  await mkdir(dirname(file),{recursive:true}); const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary,JSON.stringify(state,null,2),{mode:0o600}); await rename(temporary,file);
}
function local(req:IncomingMessage) {
  const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/,'');
  const host = new URL(`http://${req.headers.host}`).hostname;
  const loopback = ['127.0.0.1','::1'].includes(remote) && ['127.0.0.1','localhost','[::1]'].includes(host);
  const lanHost=process.env.LUXXY_PREVIEW_LAN_HOST; const privateIpv4=/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/;
  const lan=Boolean(lanHost && privateIpv4.test(lanHost) && host===lanHost && (privateIpv4.test(remote)||remote==='127.0.0.1'));
  return (loopback||lan) && (!req.headers.origin||req.headers.origin===`http://${req.headers.host}`);
}
function send(res:ServerResponse,status:number,value:unknown) { res.statusCode=status; res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store'); res.end(JSON.stringify(value)); }
async function body(req:IncomingMessage) { let value=''; for await(const chunk of req) { value+=chunk; if(Buffer.byteLength(value)>256_000) throw new SettingsVersionError('Request is too large.',413); } try{return JSON.parse(value);}catch{throw new SettingsVersionError('Check the request details.',400);} }
function validatedSettings(config:Record<string,unknown>,previous:Record<string,unknown>) {
  const parsed=UpdateDealerSettingsBody.safeParse(config); if(!parsed.success) throw new SettingsVersionError('Please check your settings.',400);
  const compatible=UpdateDealerSettingsBody.parse(preserveTestDriveBooking(preserveBrochure(preserveOnlineReservation(preservePresentation(parsed.data,previous),previous),previous),previous));
  const error=reservationSettingsError(compatible.onlineReservation)??bookingPolicyError(compatible.testDriveBooking);
  if(error) throw new SettingsVersionError(error,400); return compatible as Record<string,unknown>;
}
/** Root middleware mounts this before booking, sales and integration handlers. */
export async function operationsPreview(req:IncomingMessage,res:ServerResponse,url:URL,options:PreviewOperationsOptions={}):Promise<boolean> {
  const path=url.pathname.replace(/^\/api/,''); const permission=operationPermission(req.method??'GET',path);
  const own=path==='/dealer-settings'||path==='/dealer-operations'||path==='/dealer-operations/payments.csv'||path==='/staff/stock-health'||path==='/staff/access'||path==='/staff/team'||path.startsWith('/staff/team/')||path.startsWith('/staff/settings-history')||/^\/staff\/vehicles\/[^/]+\/price$/.test(path);
  if(!own&&!permission) return false;
  if(!local(req)){send(res,403,{error:'This service is available only on the authorised network.'});return true;}
  const file=options.stateFile??defaultFile;
  const readSettings=options.readSettings??readPreviewSettings;
  try {
    return await serial(file,async()=>{
      const state=await load(file,readSettings);
      const staffId=typeof req.headers['x-preview-staff-id']==='string'?req.headers['x-preview-staff-id']:'preview-alex';
      const staff=state.members.find(member=>member.authUserId===staffId&&member.active);
      if(permission&&(!staff||!roleHasPermission(staff.role,permission))){send(res,staff?403:401,{error:'Your staff role does not allow this action.',permission});return true;}
      if(!own)return false;
      const current=state.versions.at(-1)!;
      if(path==='/dealer-settings'&&req.method==='GET') { res.setHeader('x-settings-revision',String(current.revision));res.setHeader('ETag',`"${current.revision}"`);send(res,200,current.config);return true; }
      if(!staff){send(res,401,{error:'Sign in to use the dealer portal.'});return true;}
      if(path==='/staff/access'&&req.method==='GET'){send(res,200,{role:staff.role,permissions:permissionsForRole(staff.role),user:{authUserId:staff.authUserId,name:staff.name,email:staff.email}});return true;}
      if(path==='/staff/team'&&req.method==='GET'){send(res,200,{members:state.members});return true;}
      if(path==='/staff/team'&&req.method==='POST') {
        const input=await body(req); if(!isStaffRole(input.role)||(!input.authUserId&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email??'')))throw new SettingsVersionError('Enter a registered staff account and role.',400);
        if(state.members.some(member=>member.authUserId===input.authUserId||(input.email&&member.email===input.email)))throw new SettingsVersionError('That account is already on the staff list.',409);
        const now=new Date().toISOString();const member:PreviewOperationMember={id:randomUUID(),authUserId:input.authUserId??`preview-${randomUUID()}`,name:input.name??input.email??'Staff member',email:input.email??null,role:input.role,active:true,createdAt:now,lastSeenAt:now};state.members.push(member);await save(file,state);send(res,201,{member});return true;
      }
      if(path.startsWith('/staff/team/')&&req.method==='PATCH') {
        const input=await body(req);const member=state.members.find(item=>item.id===path.split('/')[3]);
        if(!member)throw new SettingsVersionError('Staff member not found.',404);
        if((input.role!==undefined&&!isStaffRole(input.role))||(input.active!==undefined&&typeof input.active!=='boolean')||(input.active===undefined&&input.role===undefined))throw new SettingsVersionError('Check the role and staff access.',400);
        const role=input.role??member.role;const active=input.active??member.active;
        if(member.role==='owner'&&member.active&&(role!=='owner'||!active)&&state.members.filter(item=>item.role==='owner'&&item.active).length<=1)throw new SettingsVersionError('Keep at least one active owner. Add another owner before changing this account.',409);
        member.role=role;member.active=active;await save(file,state);send(res,200,{member});return true;
      }
      if(path==='/staff/settings-history'&&req.method==='GET'){send(res,200,{revision:current.revision,versions:[...state.versions].reverse()});return true;}
      const restore=/^\/staff\/settings-history\/(\d+)\/restore$/.exec(path);
      if((path==='/dealer-settings'&&req.method==='PATCH')||(restore&&req.method==='POST')) {
        const expected=expectedSettingsRevision(req.headers['if-match']);if(expected!==current.revision)throw new SettingsVersionError('Settings have changed. Refresh before publishing.',409,current.revision);
        const restoredFrom=restore?Number(restore[1]):undefined;
        const original=restoredFrom===undefined?await body(req):state.versions.find(version=>version.revision===restoredFrom)?.config;
        if(!original)throw new SettingsVersionError('Settings version not found.',404);
        const next=nextSettingsVersion(current,validatedSettings(original,current.config),expected,staff.name??staff.email??'Dealer',new Date().toISOString(),restoredFrom);
        if(!options.writeSettings)throw new SettingsVersionError('The preview settings publisher is unavailable.',503);
        await options.writeSettings(next.config);state.versions.push(next);await save(file,state);
        res.setHeader('x-settings-revision',String(next.revision));res.setHeader('ETag',`"${next.revision}"`);send(res,200,restore?{revision:next.revision,config:next.config}:next.config);return true;
      }
      const stockRuns=[{runId:'archived-preview-stock',status:'completed',source:'grok',complete:true,scrapedAt:previewStock.scrapedAt!,receivedAt:previewStock.scrapedAt!,expectedCount:previewStock.cars.length,receivedCount:previewStock.cars.length}];
      if(path==='/staff/stock-health'&&req.method==='GET'){send(res,200,{...stockHealth(stockRuns),imports:stockRuns});return true;}
      if(path==='/dealer-operations'&&req.method==='GET'){send(res,200,dealerOperationsSummary({enquiries:await(options.readEnquiries?.()??Promise.resolve([])),sales:await(options.readSales?.()??new PreviewSaleWorkspaceStore().list()),stockRuns,stockCount:previewStock.cars.length}));return true;}
      if(path==='/dealer-operations/payments.csv'&&req.method==='GET') {
        const from=url.searchParams.get('from')??undefined,to=url.searchParams.get('to')??undefined;
        if((from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))||(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to))||(from&&to&&from>to))throw new SettingsVersionError('Choose valid export dates.',400);
        res.statusCode=200;res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Disposition','attachment; filename="luxxy-payments.csv"');res.end(paymentLedgerCsv(await(options.readSales?.()??new PreviewSaleWorkspaceStore().list()),{from,to}));return true;
      }
      if(/^\/staff\/vehicles\/[^/]+\/price$/.test(path)&&req.method==='PATCH') {
        const id=path.split('/')[3],input=await body(req);if(!previewStock.cars.some(car=>car.id===id))throw new SettingsVersionError('Vehicle not found.',404);
        if(!(input.price===null||(typeof input.price==='number'&&Number.isInteger(input.price)&&input.price>=0&&input.price<=10_000_000)))throw new SettingsVersionError('Enter a valid advertised price in pounds.',400);
        state.prices[id]=input.price;await save(file,state);send(res,200,{id,price:input.price??previewStock.cars.find(car=>car.id===id)?.price,websitePriceOverride:input.price,updatedAt:new Date().toISOString()});return true;
      }
      send(res,405,{error:'This action is unavailable.'});return true;
    });
  } catch(error) { if(error instanceof SettingsVersionError){if(error.revision!==undefined)res.setHeader('x-settings-revision',String(error.revision));send(res,error.status,{error:error.message,...(error.revision===undefined?{}:{revision:error.revision})});}else send(res,500,{error:'Dealer operations could not be loaded or saved.'});return true; }
}
/** Root applies these only to local stock responses, preserving live fixture data. */
export async function readPreviewPriceOverrides(stateFile=defaultFile):Promise<Record<string,number|null>> {
  try{return JSON.parse(await readFile(stateFile,'utf8')).prices??{};}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {};throw error;}
}
export async function readPreviewStaffDirectory(stateFile=defaultFile):Promise<Array<{id:string;name:string}>> {
  try { const state = JSON.parse(await readFile(stateFile,'utf8')) as PreviewOperationsState; return state.members.filter(member => member.active).map(member => ({ id:member.authUserId, name:member.name ?? member.email ?? 'Staff member' })); }
  catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT') return [{id:'preview-alex',name:'Alex'},{id:'preview-jamie',name:'Jamie'}]; throw error; }
}
