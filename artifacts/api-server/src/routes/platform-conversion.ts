import { Router } from 'express';
import { getAuth } from '@clerk/express';
import { pool } from '@workspace/db';
import { z } from 'zod/v4';
import { conversionReadiness,isDemoHost } from '../lib/demo-conversion';

// Mounted only behind the platform's administrator, origin and host checks.
const router=Router();
function summary(value:NonNullable<Awaited<ReturnType<typeof conversionReadiness>>>){const {cleanup,config,...publicState}=value as any;return publicState;}
router.get('/dealers/:id/conversion',async(req,res)=>{
 const origin=typeof req.query.origin==='string'?req.query.origin:undefined;
 const result=await conversionReadiness(pool,req.params.id,origin);
 if(!result){res.status(404).json({error:'Dealer not found.'});return;}
 res.json(summary(result));
});
const input=z.object({expectedRevision:z.number().int().nonnegative(),confirm:z.string(),acknowledge:z.literal(true),domainOrigin:z.string().url()}).strict();
router.post('/dealers/:id/conversion',async(req,res)=>{
 const parsed=input.safeParse(req.body),id=req.params.id;
 if(!parsed.success||parsed.data.confirm!==id){res.status(400).json({error:'Confirm the exact dealer ID, live origin, current revision and practice-data cleanup.'});return;}
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const demo=(await client.query('SELECT * FROM dealer_demos WHERE dealer_id=$1 FOR UPDATE',[id])).rows[0];
  if(!demo){await client.query('ROLLBACK');res.status(409).json({error:'This is not a demo. No conversion performed.'});return;}
  const receipt=demo.conversion_receipt;
  if(demo.converted_at){await client.query('COMMIT');if(receipt?.expectedRevision!==parsed.data.expectedRevision||receipt?.origin!==parsed.data.domainOrigin){res.status(409).json({error:'This dealership is already live. Conversion cannot be used to change its settings.'});return;}res.json({status:'replayed',dealerId:id,origin:receipt.origin,notice:'Already converted. No records were removed again.'});return;}
  if(demo.revision!==parsed.data.expectedRevision){await client.query('ROLLBACK');res.status(409).json({error:'Demo changed. Refresh the conversion review before continuing.'});return;}
  // Same order as existing baseline/reset: demo row, then import/sales/settings locks.
  for(const key of [`stock-import:${id}`,`sale-workspace:${id}`,`dealer-settings:${id}`])await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
  await client.query('SELECT id FROM dealerships WHERE id=$1 FOR UPDATE',[id]);
  await client.query('SELECT hostname FROM dealer_domains WHERE dealer_id=$1 FOR UPDATE',[id]);
  await client.query('SELECT id FROM portal_users WHERE dealer_id=$1 FOR SHARE',[id]);
  await client.query('SELECT dealer_id FROM dealer_private_settings WHERE dealer_id=$1 FOR SHARE',[id]);
  await client.query('SELECT dealer_id FROM dealer_settings WHERE dealer_id=$1 FOR UPDATE',[id]);
  const state=await conversionReadiness(client,id,parsed.data.domainOrigin);
  if(!state?.demo||!state.ready){await client.query('ROLLBACK');res.status(409).json({error:'Complete the conversion checks first.',...(state?{readiness:summary(state)}:{})});return;}
  const data=state as typeof state&{cleanup:{saleIds:string[];enquiryIds:string[];leadIds:string[]};config:any};
  // Remove exact recognised sample IDs only. Never reset all stock or delete unknown financial rows.
  const reserved=(await client.query('SELECT id,state FROM sale_workspace WHERE dealer_id=$1 AND id=ANY($2::uuid[])',[id,data.cleanup.saleIds])).rows;
  const sampleVehicleIds=reserved.filter(s=>s.state?.lifecycle?.status==='reserved').map(s=>s.state?.draft?.vehicleId).filter(Boolean);
  await client.query('DELETE FROM sale_workspace WHERE dealer_id=$1 AND id=ANY($2::uuid[])',[id,data.cleanup.saleIds]);
  await client.query('UPDATE enquiries SET merged_into_id=NULL WHERE dealer_id=$1 AND id=ANY($2::uuid[])',[id,data.cleanup.enquiryIds]);
  await client.query('DELETE FROM enquiries WHERE dealer_id=$1 AND id=ANY($2::uuid[])',[id,data.cleanup.enquiryIds]);
  await client.query('DELETE FROM leads WHERE dealer_id=$1 AND id=ANY($2::uuid[])',[id,data.cleanup.leadIds]);
  await client.query('DELETE FROM sale_workspace_counters WHERE dealer_id=$1',[id]);
  await client.query("UPDATE vehicles SET inventory_status='available',audit_metadata=coalesce(audit_metadata,'{}'::jsonb)-'saleWorkspaceId'-'saleWorkspaceStatus' WHERE dealer_id=$1 AND id=ANY($2::uuid[]) AND inventory_status='reserved' AND (audit_metadata->>'saleWorkspaceId' IS NULL OR audit_metadata->>'saleWorkspaceId'=ANY($3::text[]))",[id,sampleVehicleIds,data.cleanup.saleIds]);
  const oldOrigin=(await client.query('SELECT canonical_origin FROM dealerships WHERE id=$1',[id])).rows[0].canonical_origin;
  const origin=parsed.data.domainOrigin,config=data.config;
  // Uploaded artwork stays in dealer_demos; its public URL moves to the live origin.
  config.presentation={...config.presentation};
  if(typeof config.identity?.logoAsset==='string'&&config.identity.logoAsset.startsWith(oldOrigin+'/api/demo-logo'))config.identity.logoAsset=origin+config.identity.logoAsset.slice(oldOrigin.length);
  for(const key of ['footerLogoUrl','heroImageUrl'])if(typeof config.presentation[key]==='string'&&config.presentation[key].startsWith(oldOrigin+'/api/demo-logo'))config.presentation[key]=origin+config.presentation[key].slice(oldOrigin.length);
  if(!config.presentation.heroImageUrl){config.presentation.heroImageUrl=origin+'/showroom-car.jpg';config.presentation.heroImageAlt='Illustrative car photograph';}
  const settings=(await client.query('UPDATE dealer_settings SET config=$2::jsonb,revision=revision+1,updated_at=now() WHERE dealer_id=$1 RETURNING revision',[id,JSON.stringify(config)])).rows[0];
  await client.query("INSERT INTO dealer_settings_versions(dealer_id,revision,config,published_at,published_by,action) VALUES ($1,$2,$3::jsonb,now(),$4,'publish')",[id,settings.revision,JSON.stringify(config),getAuth(req).userId]);
  await client.query("UPDATE dealerships SET canonical_origin=$2,status='active' WHERE id=$1",[id,origin]);
  const domains=(await client.query('SELECT hostname FROM dealer_domains WHERE dealer_id=$1',[id])).rows;
  for(const d of domains)if(isDemoHost(d.hostname))await client.query('UPDATE dealer_domains SET verified=false WHERE dealer_id=$1 AND hostname=$2',[id,d.hostname]);
  const saved={origin,expectedRevision:demo.revision,convertedAt:new Date().toISOString(),actor:getAuth(req).userId,removed:{sales:data.cleanup.saleIds.length,enquiries:data.cleanup.enquiryIds.length,leads:data.cleanup.leadIds.length},lastImportRunId:data.lastImportRunId};
  await client.query('UPDATE dealer_demos SET converted_at=now(),converted_by=$2,conversion_receipt=$3::jsonb,baseline=NULL,revision=revision+1,updated_by=$2 WHERE dealer_id=$1',[id,getAuth(req).userId,JSON.stringify(saved)]);
  await client.query('COMMIT');
  res.json({status:'converted',dealerId:id,origin,notice:'Live dealership activated. Stock, artwork, staff, import history and the dedicated credential are preserved. The old demo subdomain and resets are disabled. Grok delivery and schedules were not changed; approve and test them separately. Online payments remain disabled.'});
 }catch{await client.query('ROLLBACK');res.status(503).json({error:'Conversion could not finish. Retry the identical confirmation; no partial conversion was committed.'});}finally{client.release();}
});
export default router;
