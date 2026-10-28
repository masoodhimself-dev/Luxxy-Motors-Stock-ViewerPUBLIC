import { Router } from 'express';
import { pool } from '@workspace/db';
import { z } from 'zod/v4';
import { createHash } from 'node:crypto';
import { validatedDemoInput,demoBrandingPatch,DemoSetupError } from '../lib/demo-creation';
import { demoProvisioning } from '../lib/demo-policy';
import { publishedDemoHours } from '../lib/demo-business-details';
const hash=(v:unknown)=>{const stable=(x:any):any=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;return createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');};
export function demoEditRouter(){
 const router=Router();
 router.post('/preflight',async(req,res)=>{
  const p=demoProvisioning();
  try{
   const input=z.object({demo:z.record(z.string(),z.unknown())}).strict().parse(req.body);
   const prepared=validatedDemoInput({...input.demo,...(!('recipient' in input.demo)?{recipient:p.recipients[0]??''}:{})});
   if(!p.emailReady||!p.emailDomain)throw new DemoSetupError('Demo email is not ready.',409);
   const existing=await pool.query('SELECT id FROM dealerships WHERE id=$1 OR canonical_origin=$2 UNION ALL SELECT dealer_id AS id FROM dealer_domains WHERE hostname=$3',[prepared.id,`https://${prepared.host}`,prepared.host]);
   if(existing.rows.length){res.status(409).json({status:'unavailable',error:'Demo slug already exists.'});return;}
   res.json({status:'ready',dealerId:prepared.id,origin:`https://${prepared.host}`,writes:false,quotaConsumed:false,availabilityReserved:false});
  }catch(e){res.status(e instanceof DemoSetupError?e.status:e instanceof z.ZodError?400:503).json({error:e instanceof DemoSetupError?e.message:e instanceof z.ZodError?'Invalid preflight fields.':'Preflight unavailable. Retry without creating a demo.'});}
 });
 router.get('/slugs/:slug',async(req,res)=>{
  const parsed=z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/).safeParse(req.params.slug);
  if(!parsed.success){res.status(400).json({error:'Invalid demo slug.'});return;}
  const p=demoProvisioning();if(!p.domain){res.status(409).json({error:'Demo domains are not configured.'});return;}
  const existing=await pool.query('SELECT id FROM dealerships WHERE id=$1 OR canonical_origin=$2 UNION ALL SELECT dealer_id AS id FROM dealer_domains WHERE hostname=$3',[`demo-${parsed.data}`,`https://${parsed.data}.${p.domain}`,`${parsed.data}.${p.domain}`]);
  res.json({slug:parsed.data,available:existing.rows.length===0,reserved:false});
 });
 router.patch('/demos/:dealerId',async(req,res)=>{
  const input=z.object({expectedRevision:z.number().int().min(0),changes:demoBrandingPatch}).strict().safeParse(req.body);
  if(!input.success){res.status(400).json({error:'Supply expectedRevision and supported branding/business changes only.'});return;}
  const key=res.locals.onboardingKey,id=req.params.dealerId,client=await pool.connect();
  try{
   await client.query('BEGIN');
   const valid=(await client.query('SELECT id FROM demo_onboarding_keys WHERE id=$1 AND revoked_at IS NULL AND expires_at>now() FOR SHARE',[key.id])).rows[0];
   if(!valid){await client.query('ROLLBACK');res.status(401).json({error:'Invalid onboarding credential.'});return;}
   const d=(await client.query('SELECT d.*,t.name,t.status,t.stock_platform,t.retailer_id,t.source_url,t.canonical_origin FROM dealer_demos d JOIN dealerships t ON t.id=d.dealer_id JOIN demo_onboarding_requests r ON r.dealer_id=d.dealer_id WHERE d.dealer_id=$1 AND r.key_id=$2 FOR UPDATE OF d',[id,key.id])).rows[0];
   if(!d||d.converted_at){await client.query('ROLLBACK');res.status(404).json({error:'Demo not found.'});return;}
   if(d.status!=='active'||new Date(d.expires_at).getTime()<=Date.now()){await client.query('ROLLBACK');res.status(410).json({error:'Demo expired or inactive.'});return;}
   if(d.baseline||(await client.query('SELECT dealer_id FROM demo_onboarding_completion WHERE dealer_id=$1 AND completed_at IS NOT NULL',[id])).rows.length||(await client.query("SELECT id FROM demo_completion_jobs WHERE dealer_id=$1 AND status IN ('queued','running')",[id])).rows.length){await client.query('ROLLBACK');res.status(409).json({error:'Initial setup is already completed or being completed. Use the dealership Settings for further changes.'});return;}
   const digest=hash(input.data);
   if(d.revision===input.data.expectedRevision+1&&d.onboarding_patch_hash===digest&&d.onboarding_patch_revision===input.data.expectedRevision){await client.query('COMMIT');res.json({dealerId:id,status:'replayed',revision:d.revision});return;}
   if(d.revision!==input.data.expectedRevision){await client.query('ROLLBACK');res.status(409).json({error:'Demo changed. Read its revision before submitting another change.'});return;}
   const changes=input.data.changes;
   const prepared=validatedDemoInput({slug:id.slice(5),name:d.name,platform:d.stock_platform,retailerId:d.retailer_id,sourceUrl:d.source_url,recipient:d.recipient,logoData:d.logo_data??undefined,footerLogoData:d.footer_logo_data??undefined,...changes});
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`dealer-settings:${id}`]);
   const config=(await client.query('SELECT config FROM dealer_settings WHERE dealer_id=$1 FOR UPDATE',[id])).rows[0]?.config;
   if(!config)throw Error('Missing settings');
   if(changes.logoData!==undefined)config.identity.logoAsset='/api/demo-logo';
   if(changes.footerLogoData!==undefined)config.presentation={...config.presentation,footerLogoUrl:`${d.canonical_origin}/api/demo-logo?variant=footer`};
   if(changes.showroomAddress){const {sourceUrl,checkedAt,...address}=changes.showroomAddress;config.address={...address,mapsUrl:address.mapsUrl??''};}
   if(changes.openingHours)config.hours=publishedDemoHours(changes.openingHours);
   const business={...d.business_details,...(changes.showroomAddress?{showroomAddress:changes.showroomAddress}:{}),...(changes.openingHours?{openingHours:changes.openingHours}:{})};
   await client.query('UPDATE dealer_settings SET config=$2::jsonb,revision=revision+1,updated_at=now() WHERE dealer_id=$1',[id,JSON.stringify(config)]);
   await client.query('UPDATE dealer_demos SET logo_data=$2,footer_logo_data=$3,business_details=$4::jsonb,revision=revision+1,updated_by=$5,onboarding_patch_hash=$6,onboarding_patch_revision=$7 WHERE dealer_id=$1',[id,prepared.logo,prepared.footerLogo,JSON.stringify(business),key.ownerAuthUserId,digest,input.data.expectedRevision]);
   await client.query('COMMIT');res.json({dealerId:id,status:'updated',revision:d.revision+1});
  }catch(e){await client.query('ROLLBACK');res.status(e instanceof DemoSetupError?e.status:503).json({error:e instanceof DemoSetupError?e.message:'Demo correction could not finish. Retry identical changes and revision.'});}finally{client.release();}
 });
 return router;
}
