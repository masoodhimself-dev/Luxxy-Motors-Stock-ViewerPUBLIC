import { isPlatformAdmin } from '../lib/platform-admin';
import { Router } from 'express';
import { randomBytes,createHash } from 'node:crypto';
import { db,pool,demoOnboardingKeysTable,demoOnboardingRequestsTable,dealershipsTable,dealerDemosTable,stockImportRunsTable } from '@workspace/db';
import { and,eq,desc } from 'drizzle-orm';
import { z } from 'zod/v4';
import { importSecretDigest,matchesImportSecret } from '../middlewares/tenant';
import { normaliseTenantHost,multiTenantEnabled } from '../lib/tenant-context';
import { demoProvisioning } from '../lib/demo-policy';
import { validatedDemoInput,insertDemo,DemoSetupError,demoCreationInput } from '../lib/demo-creation';
import { sealDemoReceipt,openDemoReceipt } from '../lib/demo-onboarding-secrets';
const router=Router();
const requests=new Map<string,{start:number;count:number}>();
function limited(identity:string){const now=Date.now(),old=requests.get(identity);if(!old||now-old.start>=60000){if(requests.size>=10000){for(const [k,v] of requests)if(now-v.start>=60000)requests.delete(k);if(requests.size>=10000)return true;}requests.set(identity,{start:now,count:1});return false;}return ++old.count>60;}

function fingerprint(value:unknown):string {const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');}
router.use(async(req,res,next)=>{
 res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'});
 if(!multiTenantEnabled()||normaliseTenantHost(req.get('host')??'')!==normaliseTenantHost(process.env.STOCK_IMPORT_API_HOST??'')){res.status(421).json({error:'Use the approved onboarding API host.'});return;}
 if(req.get('origin')){res.status(403).json({error:'This endpoint is for the server-side onboarding worker, not browser requests.'});return;}
 if(limited(req.ip??req.socket.remoteAddress??'unknown')){res.set('Retry-After','60').status(429).json({error:'Too many onboarding requests. Retry later.'});return;}
 const secret=req.get('x-demo-onboarding-secret')??'';
 if(!/^[A-Za-z0-9_-]{43}$/.test(secret)){res.status(401).json({error:'Invalid demo onboarding credential.'});return;}
 const [key]=await db.select().from(demoOnboardingKeysTable).where(eq(demoOnboardingKeysTable.secretHash,importSecretDigest(secret)));
 if(!key || !isPlatformAdmin(key.ownerAuthUserId) || key.revokedAt || key.expiresAt.getTime()<=Date.now() || !matchesImportSecret(secret,key.secretHash)){res.status(401).json({error:'Invalid demo onboarding credential.'});return;}
 res.locals.onboardingKey=key;next();
});
router.get('/capabilities',(_req,res)=>{const p=demoProvisioning(),key=res.locals.onboardingKey;res.json({scope:'demo:create-and-read-own',domain:p.domain||null,domainsReady:Boolean(p.domain&&p.domainsReady),emailReady:Boolean(p.emailDomain&&p.emailReady),expiresAt:key.expiresAt,maxDemos:key.maxDemos,maxPerDay:key.maxPerDay,operations:['POST /api/demo-onboarding/demos','GET /api/demo-onboarding/demos/:dealerId'],notSupported:['live-dealers','reset','delete','staff','settings','payments','email-send','schedules']});});
const createInput=z.object({requestId:z.uuid(),demo:z.record(z.string(),z.unknown())}).strict();
router.post('/demos',async(req,res)=>{
 const parsed=createInput.safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Supply a UUID requestId and demo object.'});return;}
 if(!demoCreationInput.partial({recipient:true}).safeParse(parsed.data.demo).success){res.status(400).json({error:'Invalid demo fields. Use the documented name, slug, source, marketplace, logo and expiry fields only.'});return;}
 // Hash/parse structural validation happens before writes; do not log request bodies or credentials.
 const payloadHash=fingerprint(parsed.data.demo),key=res.locals.onboardingKey;
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const locked=(await client.query('SELECT * FROM demo_onboarding_keys WHERE id=$1 FOR UPDATE',[key.id])).rows[0];
  if(!locked || locked.revoked_at || new Date(locked.expires_at).getTime()<=Date.now()){await client.query('ROLLBACK');res.status(401).json({error:'Invalid demo onboarding credential.'});return;}
  const prior=(await client.query('SELECT * FROM demo_onboarding_requests WHERE key_id=$1 AND request_id=$2',[key.id,parsed.data.requestId])).rows[0];
  const aad=`${key.id}:${parsed.data.requestId}`;
  if(prior){
   if(prior.payload_hash!==payloadHash){await client.query('ROLLBACK');res.status(409).json({error:'requestId already used with different demo data.'});return;}
   const state=(await client.query('SELECT expires_at FROM dealer_demos WHERE dealer_id=$1',[prior.dealer_id])).rows[0];
   if(!state||new Date(state.expires_at).getTime()<=Date.now()){await client.query('ROLLBACK');res.status(410).json({error:'The demonstration has expired. Contact the operator.'});return;}
   const receipt=openDemoReceipt(prior.sealed_response,aad);await client.query('COMMIT');res.json({...receipt,status:'replayed'});return;
  }
  const p=demoProvisioning();
  const raw=parsed.data.demo && typeof parsed.data.demo==='object'&&!Array.isArray(parsed.data.demo)?{...parsed.data.demo as Record<string,unknown>}:parsed.data.demo;
  if(raw && typeof raw==='object' && !Array.isArray(raw) && !('recipient' in raw)) (raw as Record<string,unknown>).recipient=p.recipients[0]??'';
  const prepared=validatedDemoInput(raw);
  if(!p.emailDomain||!p.emailReady)throw new DemoSetupError('Verified demo email provisioning must be completed before automated onboarding.',409);
  const counts=(await client.query("SELECT count(*)::int AS total,count(*) FILTER (WHERE created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS today FROM demo_onboarding_requests WHERE key_id=$1",[key.id])).rows[0];
  if(counts.total>=locked.max_demos || counts.today>=locked.max_per_day){await client.query('ROLLBACK');res.set('Retry-After','3600').status(429).json({error:'Demo creation quota reached. Contact the operator.'});return;}
  const result=await insertDemo(client,prepared,locked.owner_auth_user_id);
  const secret=randomBytes(32).toString('base64url');
  const importKey=(await client.query('INSERT INTO dealer_import_keys (dealer_id,secret_hash) VALUES ($1,$2) RETURNING id',[result.dealerId,importSecretDigest(secret)])).rows[0];
  const demo=(await client.query('SELECT expires_at FROM dealer_demos WHERE dealer_id=$1',[result.dealerId])).rows[0];
  const receipt={status:'created',requestId:parsed.data.requestId,...result,portalUrl:`${result.origin}/portal`,expiresAt:demo.expires_at,stockImport:{endpoint:`https://${process.env.STOCK_IMPORT_API_HOST}/api/stock/imports/${result.dealerId}/grok`,header:'x-stock-import-secret',keyId:importKey.id,secret},email:{sender:`${result.dealerId}@${p.emailDomain}`,recipient:prepared.d.recipient,restricted:true},baselineSaved:false,notice:'Store the stock credential securely before continuing. No stock was collected, email sent or schedule created. Ask the operator to save the baseline after the first stock import.'};
  const sealed=sealDemoReceipt(receipt,aad);
  await client.query('INSERT INTO demo_onboarding_requests (key_id,request_id,dealer_id,payload_hash,sealed_response) VALUES ($1,$2,$3,$4,$5::jsonb)',[key.id,parsed.data.requestId,result.dealerId,payloadHash,JSON.stringify(sealed)]);
  await client.query('COMMIT');res.status(201).json(receipt);
 }catch(error){await client.query('ROLLBACK');if(error instanceof DemoSetupError){res.status(error.status).json({error:error.message});return;}if((error as any).code==='23505'){res.status(409).json({error:'Demo name already exists. No new demo created.'});return;}res.status(503).json({error:'Demo onboarding could not finish. Retry the identical requestId and payload; do not create another request.'});}finally{client.release();}
});
router.get('/demos/:dealerId',async(req,res)=>{
 const key=res.locals.onboardingKey;
 const [row]=await db.select({dealer:dealershipsTable,demo:dealerDemosTable}).from(demoOnboardingRequestsTable).innerJoin(dealershipsTable,eq(dealershipsTable.id,demoOnboardingRequestsTable.dealerId)).innerJoin(dealerDemosTable,eq(dealerDemosTable.dealerId,dealershipsTable.id)).where(and(eq(demoOnboardingRequestsTable.keyId,key.id),eq(demoOnboardingRequestsTable.dealerId,req.params.dealerId)));
 if(!row){res.status(404).json({error:'Demo not found.'});return;}
 const [last]=await db.select({runId:stockImportRunsTable.runId,status:stockImportRunsTable.status,receivedCount:stockImportRunsTable.receivedCount,receivedAt:stockImportRunsTable.receivedAt}).from(stockImportRunsTable).where(eq(stockImportRunsTable.dealerId,row.dealer.id)).orderBy(desc(stockImportRunsTable.receivedAt)).limit(1);
 res.json({dealerId:row.dealer.id,origin:row.dealer.canonicalOrigin,portalUrl:`${row.dealer.canonicalOrigin}/portal`,status:row.dealer.status,expired:row.demo.expiresAt.getTime()<=Date.now(),expiresAt:row.demo.expiresAt,baselineSaved:Boolean(row.demo.baseline),lastImport:last??null});
});
router.use((_req,res)=>{res.status(404).json({error:'Onboarding operation unavailable.'});});
export default router;
