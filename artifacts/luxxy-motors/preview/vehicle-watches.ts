// Explicit, loopback-only UI fixture. Never sends email or writes dealership data.
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { previewStock } from './stock';
type Watch = { id: string; vehicleId: string; email: string; status: 'pending'|'active'|'stopped'; verifiedAt: string|null };
const watches = new Map<string,Watch>(), tokens = new Map<string,{email:string;watchId?:string;purpose:'verify'|'manage';expiresAt:string}>();
const events = new Map<string,{id:string;vehicleId:string;createdAt:string}>();
let settings = { enabled: true, revision: 0, emailReady: true };
const enabled = () => process.env.WATCH_CAR_PREVIEW === 'true';
function issue(email:string,purpose:'verify'|'manage',watchId?:string) { const token=randomBytes(32).toString('base64url'); tokens.set(token,{email,purpose,watchId,expiresAt:new Date(Date.now()+86400000).toISOString()}); return token; }
function management(token:string) { const entry=tokens.get(token); if(!entry||Date.parse(entry.expiresAt)<=Date.now())return null; const car=entry.watchId ? previewStock.cars.find(car=>car.id===watches.get(entry.watchId!)?.vehicleId):undefined; if(entry.purpose==='verify')return {verificationRequired:true,vehicleTitle:car?`${car.make} ${car.model}`:'Car updates',emailHint:'Fictional test address'}; return {expiresAt:entry.expiresAt,emailHint:'Fictional test address',dealerName:'Luxxy Motors — local preview',watches:[...watches.values()].filter(w=>w.email===entry.email&&w.verifiedAt).map(w=>{const car=previewStock.cars.find(c=>c.id===w.vehicleId)!;return {...w,email:undefined,vehicleTitle:`${car.make} ${car.model}`,vehicleUrl:`/vehicle/${w.vehicleId}`,currentPrice:car.price,currency:car.currency,imageUrl:car.heroImage};})}; }
function tasks() { return [...events.values()].map(event=>{const car=previewStock.cars.find(c=>c.id===event.vehicleId)!; const recipients=[...watches.values()].filter(w=>w.vehicleId===car.id&&w.status==='active'&&w.verifiedAt).map(w=>({id:w.id,email:w.email,status:'pending',sentAt:null})); return { ...event,vehicleTitle:`${car.make} ${car.model} (fictional watch example)`,vehicleUrl:`/vehicle/${car.id}`,kind:'price_drop',revision:0,previousPrice:(car.price??0)+500,currentPrice:car.price,subject:`A price update for the ${car.make} ${car.model}`,message:`Hi,\n\nThe ${car.make} ${car.model} you are watching has a new price.\n\nFICTIONAL LOCAL PREVIEW — no price was changed and no email will be sent.`,recipients,pendingCount:recipients.length,totalCount:recipients.length}; }).filter(t=>t.recipients.length); }
export async function vehicleWatchesPreview(req:IncomingMessage,res:ServerResponse,url:URL) {
  if(!url.pathname.startsWith('/api/vehicle-watches')&&!url.pathname.startsWith('/api/staff/vehicle-watch'))return false;
  const send=(status:number,body:unknown)=>{res.statusCode=status;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return true;};
  const remote=(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
  if(!['127.0.0.1','::1'].includes(remote)||!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host||'')||(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`))return send(403,{error:'Watch preview is loopback-only.'});
  if(!enabled()) { if(url.pathname.endsWith('/availability'))return send(200,{enabled:false,emailReady:false}); if(url.pathname.endsWith('/vehicle-watch-tasks'))return send(200,{tasks:[],total:0}); if(url.pathname.endsWith('/vehicle-watch-counts'))return send(200,{counts:[]}); return send(409,{error:'Watch preview is not enabled. No email was sent.'}); }
  let body:any={};
  if(req.method!=='GET') {let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16000)return send(413,{error:'Request too large.'});}try{body=JSON.parse(raw||'{}');}catch{return send(400,{error:'Check the request.'});}}
  const path=url.pathname.replace('/api','');
  if(path==='/vehicle-watches/availability'&&req.method==='GET')return send(200,{enabled:settings.enabled,emailReady:true});
  if(path==='/staff/vehicle-watch-settings') { if(req.method==='GET')return send(200,settings);if(req.method!=='PUT')return send(405,{error:'Method not allowed.'});if(body.revision!==settings.revision||typeof body.enabled!=='boolean')return send(409,{error:'Preferences changed.'});settings={...settings,enabled:body.enabled,revision:settings.revision+1};return send(200,settings); }
  if((path==='/vehicle-watches'||path==='/vehicle-watches/manage-link')&&req.method==='POST') {
    if(!settings.enabled)return send(409,{error:'Car updates are currently unavailable.'});
    // Fixtures accept example.test addresses only, preventing accidental real-recipient use.
    if(typeof body.email!=='string'||!/^[-\w.+]+@example\.test$/i.test(body.email))return send(400,{error:'Use a fictional @example.test address in this local preview. No email is sent.'});
    const email=body.email.toLowerCase().trim();let token:string;
    if(path.endsWith('/manage-link'))token=issue(email,'manage');else { const car=previewStock.cars.find(c=>c.id===body.vehicleId);if(!car)return send(404,{error:'Choose a preview car.'});let watch=[...watches.values()].find(w=>w.email===email&&w.vehicleId===car.id);if(!watch){watch={id:randomUUID(),vehicleId:car.id,email,status:'pending',verifiedAt:null};watches.set(watch.id,watch);}token=issue(email,'verify',watch.id); }
    return send(202,{accepted:true,preview:true,previewVerificationUrl:`/watch#${token}`,message:'Fictional local preview. No email was sent.'});
  }
  if(path==='/vehicle-watches/verify'&&req.method==='POST') {const entry=tokens.get(body.token);if(!entry||entry.purpose!=='verify'||Date.parse(entry.expiresAt)<=Date.now()||!entry.watchId)return send(410,{error:'This link has expired. Request a fresh link.'});const watch=watches.get(entry.watchId)!;watch.status='active';watch.verifiedAt=new Date().toISOString();tokens.delete(body.token);const token=issue(entry.email,'manage');if(!events.has(watch.vehicleId))events.set(watch.vehicleId,{id:randomUUID(),vehicleId:watch.vehicleId,createdAt:new Date().toISOString()});return send(200,{verified:true,token,...management(token)});}
  if(path==='/vehicle-watches/manage'&&req.method==='GET') {const data=management(String(req.headers['x-vehicle-watch-token']||''));return data?send(200,data):send(410,{error:'This private link has expired or is unavailable. Request a fresh link.'});}
  const stop=/^\/vehicle-watches\/([^/]+)\/stop$/.exec(path);
  if(stop&&req.method==='POST') {const token=String(req.headers['x-vehicle-watch-token']||''),entry=tokens.get(token),watch=watches.get(stop[1]);if(!entry||entry.purpose!=='manage'||!management(token)||!watch||watch.email!==entry.email)return send(404,{error:'This watch is unavailable.'});watch.status='stopped';return send(200,{stopped:true});}
  if(path==='/staff/vehicle-watch-counts'&&req.method==='GET')return send(200,{counts:previewStock.cars.map(car=>({vehicleId:car.id,count:[...watches.values()].filter(w=>w.vehicleId===car.id&&w.status==='active'&&w.verifiedAt).length}))});
  if(path==='/staff/vehicle-watch-tasks'&&req.method==='GET')return send(200,{tasks:settings.enabled?tasks():[],total:settings.enabled?tasks().length:0,preview:true});
  const action=/^\/staff\/vehicle-watch-tasks\/([^/]+)\/(preview|send)$/.exec(path);
  if(action&&req.method==='POST') {const task=tasks().find(t=>t.id===action[1]);if(!task||!settings.enabled)return send(409,{error:'The watch update changed.'});if(action[2]==='send')return send(409,{error:'Email sending is disabled in this fictional preview. Nothing was sent.'});const recipients=task.recipients.filter(r=>body.watchIds?.includes(r.id));return send(200,{subject:body.subject,message:body.message,recipients,expectedRevision:task.revision,previewHash:createHash('sha256').update(JSON.stringify(body)).digest('hex'),ready:false,preview:true});}
  return send(405,{error:'Method not allowed.'});
}
