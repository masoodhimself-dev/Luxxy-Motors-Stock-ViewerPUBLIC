// Loopback-only dashboard preview. Not imported by the production backend.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { z } from 'zod/v4';
import { importCapacitySummary } from '../../api-server/src/lib/platform-capacity';
const filename = fileURLToPath(new URL('../../../.local/platform-dashboard-preview.json', import.meta.url));
const defaults = [
  { id: 'example-dealer-a', name: 'Example Dealership A', status: 'draft', canonicalOrigin: 'https://dealer-a.example.test', stockPlatform: 'autotrader', retailerId: 'example-a' },
  { id: 'example-dealer-b', name: 'Example Dealership B', status: 'draft', canonicalOrigin: 'https://dealer-b.example.test', stockPlatform: 'cazoo', retailerId: 'cazoo-example-b' },
];
const input = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/), name: z.string().trim().min(1).max(120), canonicalOrigin: z.string().url().refine(v=>new URL(v).protocol==='https:'), platform: z.enum(['autotrader','cazoo']), retailerId: z.string().trim().min(1), sourceUrl: z.string().url(), ownerAuthUserId: z.string().regex(/^user_[A-Za-z0-9]+$/).optional(), ownerEmail:z.string().email().optional(),useMyAccount:z.boolean().optional() }).strict();
async function dealers() { try { return JSON.parse(await readFile(filename,'utf8')) as typeof defaults; } catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT') return [...defaults]; throw error; } }
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
  if(!url.pathname.startsWith('/api/platform/')) return false;
  const host=new URL(`http://${req.headers.host}`).hostname, remote=(req.socket.remoteAddress??'').replace(/^::ffff:/,'');
  if(!['127.0.0.1','localhost','[::1]'].includes(host)||!['127.0.0.1','::1'].includes(remote)|| (req.headers.origin && req.headers.origin!==`http://${req.headers.host}`)) {send(res,403,{error:'Platform preview is available only on this computer.'});return true;}
  try {
    if(req.method==='GET'&&url.pathname==='/api/platform/capacity') send(res,200,previewCapacitySnapshot());
    else if(req.method==='GET'&&url.pathname==='/api/platform/overview') send(res,200,{dealers:(await dealers()).map(d=>({...d,sourceUrl:d.stockPlatform==='cazoo'?'https://www.cazoo.co.uk/fictional':'https://www.autotrader.co.uk/fictional',domains:[],activeKeyCount:0,latestImport:null,lastSuccessfulImport:null})),activity:[]});
    else if(req.method==='GET'&&/^\/api\/platform\/dealers\/[^/]+\/workspace$/.test(url.pathname)) {
      const dealer=(await dealers()).find(d=>d.id===decodeURIComponent(url.pathname.split('/')[4]));
      if(!dealer) send(res,404,{error:'Example dealer not found.'});
      else send(res,200,{dealer:{...dealer,sourceUrl:dealer.stockPlatform==='cazoo'?'https://www.cazoo.co.uk/fictional':'https://www.autotrader.co.uk/fictional'},domains:[{hostname:new URL(dealer.canonicalOrigin).hostname,verified:false,verificationToken:'EXAMPLE-ONLY-NOT-A-REAL-DNS-TOKEN'}],members:[],imports:[],keys:[]});
    }
    else if(req.method==='GET'&&url.pathname==='/api/platform/dealers') send(res,200,{dealers:await dealers(),localExample:true});
    else if(req.method==='POST'&&url.pathname==='/api/platform/dealers') {
      let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16000)throw Error('Request too large');}
      const parsed=input.safeParse(JSON.parse(raw)); if(!parsed.success){send(res,400,{error:'Enter every field using a valid HTTPS website, source URL and Clerk owner ID.'});return true;}
      const d=parsed.data,list=await dealers();if(list.some(row=>row.id===d.id||row.canonicalOrigin===d.canonicalOrigin)){send(res,409,{error:'Dealer ID or domain already exists in this preview.'});return true;}
      list.push({id:d.id,name:d.name,status:'draft',canonicalOrigin:d.canonicalOrigin,stockPlatform:d.platform,retailerId:d.retailerId});await mkdir(dirname(filename),{recursive:true});await writeFile(filename,JSON.stringify(list,null,2),{mode:0o600});send(res,201,{dealerId:d.id,dns:{name:`_dealer-verification.${new URL(d.canonicalOrigin).hostname}`,value:'LOCAL-PREVIEW-ONLY-NOT-A-REAL-DNS-TOKEN'}});
    } else send(res,409,{error:'This is a local dashboard preview. Real domain verification, activation and import keys require the configured multi-dealer backend.'});
  }catch{send(res,400,{error:'Local dashboard request could not be processed.'});}
  return true;
}
