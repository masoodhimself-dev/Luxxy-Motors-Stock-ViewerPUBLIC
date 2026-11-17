import { resolveDealerFeatures, type ChecklistEntry } from '@workspace/vehicle-meta';
// Loopback-only dashboard preview. Not imported by the production backend.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { z } from 'zod/v4';
import { importCapacitySummary } from '../../api-server/src/lib/platform-capacity';
import { previewSettings } from './settings';
import { previewStock } from './stock';
const filename = fileURLToPath(new URL('../../../.local/platform-dashboard-preview.json', import.meta.url));
type PreviewDealer = {
  id: string;
  name: string;
  status: string;
  canonicalOrigin: string;
  stockPlatform: 'autotrader' | 'cazoo';
  retailerId: string;
  plan?: 'website_only' | 'full_portal';
  enquiryEmail?: string | null;
  onboardingRequired?: boolean;
  onboardingChecklist?: Record<string, ChecklistEntry>;
};
const defaults: PreviewDealer[] = [
  { id: 'example-dealer-a', name: 'Example Dealership A', status: 'draft', canonicalOrigin: 'https://dealer-a.example.test', stockPlatform: 'autotrader', retailerId: 'example-a' },
  { id: 'example-dealer-b', name: 'Example Dealership B', status: 'draft', canonicalOrigin: 'https://dealer-b.example.test', stockPlatform: 'cazoo', retailerId: 'cazoo-example-b' },
];
const launchExamples: PreviewDealer[] = [
  { id: 'launch-website-only', name: 'Mill Lane Cars', status: 'draft', canonicalOrigin: 'https://milllanecars.example.test', stockPlatform: 'autotrader', retailerId: 'mill-lane-example', plan: 'website_only', enquiryEmail: 'enquiries@milllanecars.example.test', onboardingRequired: true },
  { id: 'launch-full-portal', name: 'Oakfield Motors', status: 'draft', canonicalOrigin: 'https://oakfieldmotors.example.test', stockPlatform: 'cazoo', retailerId: 'oakfield-example', plan: 'full_portal', enquiryEmail: null, onboardingRequired: true },
];
const planInput = z.enum(['website_only', 'full_portal']);
const input = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/), name: z.string().trim().min(1).max(120), canonicalOrigin: z.string().url().refine(v=>new URL(v).protocol==='https:'), platform: z.enum(['autotrader','cazoo']), retailerId: z.string().trim().min(1), sourceUrl: z.string().url(), ownerAuthUserId: z.string().regex(/^user_[A-Za-z0-9]+$/).optional(), ownerEmail:z.string().email().optional(),useMyAccount:z.boolean().optional(),inviteOwnerEmail:z.string().email().optional(),plan:planInput.optional(),enquiryEmail:z.string().email().optional() }).strict();
async function readDealers(): Promise<PreviewDealer[]> {
  try { return JSON.parse(await readFile(filename,'utf8')) as PreviewDealer[]; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [...defaults]; throw error; }
}
async function dealers() { return [...launchExamples, ...await readDealers()]; }
const pass = new Map<string, string>();
const changed = new Map<string, Partial<PreviewDealer>>();
function onboarding(dealer: PreviewDealer) {
  const current = { ...dealer, ...changed.get(dealer.id) };
  const plan = current.plan ?? 'full_portal';
  const enquiryEmail = current.enquiryEmail ?? null;
  const acceptedAt = pass.get(current.id);
  const seed = launchExamples.some(example => example.id === current.id);
  const checks = [
    { id: 'domain', label: 'Website domain', ready: seed, detail: seed ? `${new URL(current.canonicalOrigin).hostname} is verified.` : 'Check the website domain in Domains.' },
    { id: 'stock', label: 'Stock on the website', ready: seed, detail: seed ? '18 cars were checked in the first import.' : 'Upload the dealership’s first stock file.' },
    ...(plan === 'full_portal' ? [{ id: 'owner', label: 'Portal owner', ready: seed, detail: seed ? 'The dealership owner has accepted their invitation.' : 'Invite the dealership owner in Staff.' }] : []),
    { id: 'enquiry', label: plan === 'website_only' ? 'Enquiry email' : 'Inbox enquiry', ready: Boolean(acceptedAt), detail: plan === 'website_only'
      ? acceptedAt ? `Test accepted for ${enquiryEmail}.` : `Send a test to ${enquiryEmail || 'the dealership’s email'}.`
      : acceptedAt ? 'The fictional enquiry appeared in this dealership’s Inbox.' : 'Check that a new enquiry appears in this dealership’s Inbox.' },
  ];
  const testEnquiry = acceptedAt ? {
    acceptedAt, recipient: enquiryEmail, channel: plan === 'website_only' ? 'email' : 'inbox',
    ...(plan === 'full_portal' ? { enquiryId: 'fictional-test', reference: 'TEST-01' } : {}),
  } : null;
  return { plan, enquiryEmail, onboardingRequired: current.onboardingRequired === true, ready: current.status === 'draft' && checks.every(check => check.ready), checks, testEnquiry };
}
async function inputBody(req: IncomingMessage) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 16000) throw Error('Request too large');
  }
  return JSON.parse(raw);
}
function send(res: ServerResponse, status: number, data: object) { res.statusCode=status; res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store'); res.end(JSON.stringify(data)); }
/** Fictional, read-only layout sample; never reads production databases or providers. */
export function previewCapacitySnapshot(now = new Date()) {
  const at = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
  return {
    generatedAt: now.toISOString(), scope: 'local_fixture', localExample: true,
    database: { ready: true, pool: { maximum: 10, total: 3, idle: 2, waiting: 0, idleErrorCount: 0, lastIdleErrorAt: null } },
    imports: {
      admission: { active: 0, maximum: 2, accepted: 12, rejected: 1, completed: 12, oldestActiveMs: 0 },
      ...importCapacitySummary([
        { id: defaults[0].id, name: defaults[0].name, active_key_count: 1, last_success_received_at: at(0.99), last_success_scraped_at: at(1), last_attempt_at: at(0.99), last_attempt_status: 'completed' },
        { id: defaults[1].id, name: defaults[1].name, active_key_count: 0, last_success_received_at: at(14.99), last_success_scraped_at: at(15), last_attempt_at: at(14.9), last_attempt_status: 'failed' },
      ], now.getTime()),
    },
    jobs: {
      concurrency: 2, activeDealerJobs: 1, queuedDealerJobs: 0,
      sweeps: [
        { name: 'reminders', state: 'completed', startedAt: at(0.05), finishedAt: at(0.049), durationMs: 3_600, dealers: 2, completed: 2, failed: 0, excludedDemos: 1, maxActive: 2 },
        { name: 'retention', state: 'running', startedAt: new Date(now.getTime() - 3_000).toISOString(), finishedAt: null, durationMs: 3_000, dealers: 2, completed: 1, failed: 0, excludedDemos: 1, maxActive: 1 },
      ],
    },
  };
}
export async function platformPreview(req: IncomingMessage, res: ServerResponse, url: URL) {
  const websitePreview = /^\/platform\/preview\/([^/]+)\/api(\/.*)$/.exec(url.pathname);
  if (!url.pathname.startsWith('/api/platform/') && !websitePreview) return false;
  const host=new URL(`http://${req.headers.host}`).hostname, remote=(req.socket.remoteAddress??'').replace(/^::ffff:/,'');
  if(!['127.0.0.1','localhost','[::1]'].includes(host)||!['127.0.0.1','::1'].includes(remote)|| (req.headers.origin && req.headers.origin!==`http://${req.headers.host}`)) {send(res,403,{error:'Platform preview is available only on this computer.'});return true;}
  try {
    if (websitePreview) {
      const dealer = (await dealers()).find(candidate => candidate.id === decodeURIComponent(websitePreview[1]));
      if (!dealer || req.method !== 'GET') { send(res,404,{error:'Example website preview is unavailable.'}); return true; }
      const example = launchExamples.some(candidate => candidate.id === dealer.id);
      const cars = example ? previewStock.cars.slice(0,18) : [];
      const path = websitePreview[2];
      const pathVehicle = /^\/vehicles\/([^/]+)$/.exec(path);
      if (path === '/stock') send(res,200,{...previewStock,dealerName:dealer.name,cars,count:cars.length});
      else if (pathVehicle) {
        const car = cars.find(candidate => candidate.id === pathVehicle[1]);
        if (car) send(res,200,car);
        else send(res,404,{error:'Example car was not found.'});
      }
      else if (path === '/dealer-settings') send(res,200,{
        ...previewSettings,
        identity: {...previewSettings.identity,name:dealer.name,logoText:dealer.name,logoAsset:''},
        contact: {phone:'',whatsapp:'',email:''},
        social: {instagram:'',facebook:'',twitter:''},
        legal: {companyName:dealer.name},
      });
      else if (path === '/features') send(res,200,{features:Object.fromEntries(resolveDealerFeatures({},{}).map(feature => [feature.key,feature.enabled]))});
      else if (path === '/demo-status') send(res,200,{demo:true,emailRestricted:true,paymentsDisabled:true});
      else if (path === '/reservations/payment-readiness') send(res,200,{enabled:false});
      else send(res,404,{error:'This action is unavailable in the example website.'});
      return true;
    }
    const launchRoute = /^\/api\/platform\/dealers\/([^/]+)\/onboarding(?:\/(test-enquiry|launch))?$/.exec(url.pathname);
    if (launchRoute) {
      const id = decodeURIComponent(launchRoute[1]);
      const dealer = (await dealers()).find(candidate => candidate.id === id);
      if (!dealer) { send(res,404,{error:'Example dealer not found.'}); return true; }
      const state = onboarding(dealer);
      if (!launchRoute[2] && req.method === 'GET') send(res,200,state);
      else if (!launchRoute[2] && req.method === 'PATCH') {
        const parsed = z.object({ plan: planInput, enquiryEmail: z.string().email().nullable() }).safeParse(await inputBody(req));
        if (!parsed.success || (parsed.data.plan === 'website_only' && !parsed.data.enquiryEmail)) send(res,400,{error:'Choose a plan and enter a valid enquiry address.'});
        else { changed.set(id, { ...changed.get(id), ...parsed.data }); pass.delete(id); send(res,200,onboarding(dealer)); }
      }
      else if (launchRoute[2] === 'test-enquiry' && req.method === 'POST') {
        if (state.plan === 'website_only' && !state.enquiryEmail) send(res,409,{error:'Save an enquiry address first.'});
        else { pass.set(id, new Date().toISOString()); send(res,200,onboarding(dealer)); }
      }
      else if (launchRoute[2] === 'test-enquiry' && req.method === 'GET' && state.testEnquiry?.enquiryId) {
        send(res,200,{enquiry:{customerName:'DealerOS test enquiry', reference:'TEST-01', message:'Fictional website enquiry for this dealership’s launch checks.'}});
      }
      else if (launchRoute[2] === 'launch' && req.method === 'POST') {
        if (!state.ready) send(res,409,{error:'Complete the launch checklist first.'});
        else {
          changed.set(id, { ...changed.get(id), status: 'active', onboardingRequired: false, onboardingChecklist: {
            launch: { status: 'done', note: 'Example launch', updatedAt: new Date().toISOString(), updatedBy: 'Preview' },
          } });
          pass.delete(id);
          send(res, 200, { dealerId: id, status: 'active', origin: dealer.canonicalOrigin });
        }
      }
      else send(res,404,{error:'Example launch action is unavailable.'});
      return true;
    }
    if(req.method==='GET'&&/^\/api\/platform\/(?:dealers\/[^/]+\/)?features$/.test(url.pathname)) {
      const dealerId = url.pathname.includes('/dealers/') ? decodeURIComponent(url.pathname.split('/')[4]) : null;
      if (dealerId && !(await dealers()).some(dealer => dealer.id === dealerId)) send(res,404,{error:'Example dealer not found.'});
      else send(res,200,{scope:dealerId?'dealer':'platform',dealerId,readOnly:true,evaluatedAt:new Date().toISOString(),features:resolveDealerFeatures({},{}),audit:[]});
    }
    else if(req.method==='GET'&&url.pathname==='/api/platform/capacity') send(res,200,previewCapacitySnapshot());
    else if(req.method==='GET'&&url.pathname==='/api/platform/overview') send(res,200,{dealers:(await dealers()).map(d=>({...d,...changed.get(d.id),sourceUrl:d.stockPlatform==='cazoo'?'https://www.cazoo.co.uk/fictional':'https://www.autotrader.co.uk/fictional',domains:[],activeKeyCount:0,latestImport:null,lastSuccessfulImport:null})),activity:[],sharedStaffPilotDealerId:'example-motor-group'});
    else if(req.method==='GET'&&/^\/api\/platform\/dealers\/[^/]+\/workspace$/.test(url.pathname)) {
      const dealer=(await dealers()).find(d=>d.id===decodeURIComponent(url.pathname.split('/')[4]));
      if(!dealer) send(res,404,{error:'Example dealer not found.'});
      else send(res,200,{dealer:{...dealer,...changed.get(dealer.id),sourceUrl:dealer.stockPlatform==='cazoo'?'https://www.cazoo.co.uk/fictional':'https://www.autotrader.co.uk/fictional'},sharedStaffWorkspaceUrl: dealer.id === 'launch-full-portal' ? '/dealers/launch-full-portal/portal' : null,effectiveStockConnection:{status:'known',platform:dealer.stockPlatform,retailerId:dealer.retailerId,sourceUrl:dealer.stockPlatform==='cazoo'?'https://www.cazoo.co.uk/fictional':'https://www.autotrader.co.uk/fictional',enabled:true,usesOverride:false},domains:[{hostname:new URL(dealer.canonicalOrigin).hostname,verified:false,verificationToken:'EXAMPLE-ONLY-NOT-A-REAL-DNS-TOKEN'}],members:[],imports:[],keys:[]});
    }
    else if(req.method==='GET'&&url.pathname==='/api/platform/dealers') send(res,200,{dealers:await dealers(),localExample:true});
    else if(req.method==='POST'&&url.pathname==='/api/platform/dealers') {
      const parsed=input.safeParse(await inputBody(req)); if(!parsed.success){send(res,400,{error:'Enter every field using a valid HTTPS website, source URL and Clerk owner ID.'});return true;}
      const d=parsed.data,list=await readDealers();if([...list,...launchExamples].some(row=>row.id===d.id||row.canonicalOrigin===d.canonicalOrigin)){send(res,409,{error:'Dealer ID or domain already exists in this preview.'});return true;}
      list.push({id:d.id,name:d.name,status:'draft',canonicalOrigin:d.canonicalOrigin,stockPlatform:d.platform,retailerId:d.retailerId,plan:d.plan,enquiryEmail:d.enquiryEmail,onboardingRequired:!!d.plan});await mkdir(dirname(filename),{recursive:true});await writeFile(filename,JSON.stringify(list,null,2),{mode:0o600});send(res,201,{dealerId:d.id,dns:{name:`_dealer-verification.${new URL(d.canonicalOrigin).hostname}`,value:'LOCAL-PREVIEW-ONLY-NOT-A-REAL-DNS-TOKEN'}});
    } else send(res,409,{error:'This is a local dashboard preview. Real domain verification, activation and import keys require the configured multi-dealer backend.'});
  }catch{send(res,400,{error:'Local dashboard request could not be processed.'});}
  return true;
}
