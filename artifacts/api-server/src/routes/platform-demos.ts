import { saveDemoBaseline } from '../lib/demo-baseline';
import { Router } from 'express';
import { getAuth } from '@clerk/express';
import { z } from 'zod/v4';
import { db, pool, dealerDemosTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { demoProvisioning } from '../lib/demo-policy';
import { clearDemoActivity, seedDemo } from '../lib/demo-workspace';
import { validatedDemoInput,insertDemo,DemoSetupError } from '../lib/demo-creation';
const router=Router();
// Mounted ONLY behind platform-dealers' host, administrator and origin checks.
router.get('/demo-config', (_req,res) => {
  const p=demoProvisioning();res.json({...p,emailReady:p.emailReady && Boolean(p.emailDomain), configured:Boolean(p.domain && p.domainsReady), note:'Wildcard DNS/TLS and Clerk domain support must be configured once. Creating a demo does not start Grok or verify Resend.'});
});
router.post('/demos',async(req,res)=>{
  let prepared:ReturnType<typeof validatedDemoInput>;
  try{prepared=validatedDemoInput(req.body);}catch(error){if(error instanceof DemoSetupError){res.status(error.status).json({error:error.message});return;}throw error;}
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const result=await insertDemo(client,prepared,getAuth(req).userId!);
    await client.query('COMMIT');res.status(201).json({...result,next:'Create a dedicated import credential in Stock connection. After importing authorised stock, save the starting point in Demo controls. No worker has been started.'});
  }catch(error){await client.query('ROLLBACK');if((error as {code?:string}).code==='23505'){res.status(409).json({error:'That demo name is already in use. Nothing was created.'});return;}throw error;}finally{client.release();}
});
router.get('/dealers/:id/demo',async(req,res)=>{
  const [demo]=await db.select().from(dealerDemosTable).where(eq(dealerDemosTable.dealerId,req.params.id));
  if(!demo){res.json({demo:false});return;}
  if(demo.convertedAt){res.json({demo:false,converted:true,convertedAt:demo.convertedAt});return;}
  const p=demoProvisioning();res.json({demo:true,recipient:demo.recipient,expiresAt:demo.expiresAt,revision:demo.revision,baselineSaved:Boolean(demo.baseline),lastResetAt:demo.lastResetAt,sender:p.emailDomain?`${demo.dealerId}@${p.emailDomain}`:null,emailReady:p.emailReady && p.recipients.includes(demo.recipient),paymentsDisabled:true});
});
const action=z.object({action:z.enum(['baseline','activity','original','extend','recipient']),expectedRevision:z.number().int().nonnegative(),confirm:z.string(),days:z.number().int().min(1).max(90).optional(),recipient:z.email().transform(v=>v.toLowerCase()).optional()}).strict();
router.post('/dealers/:id/demo',async(req,res)=>{
  const parsed=action.safeParse(req.body);if(!parsed.success||parsed.data.confirm!==req.params.id){res.status(400).json({error:'Confirm the exact demo dealer ID and current revision.'});return;}
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const demo=(await client.query('SELECT * FROM dealer_demos WHERE dealer_id=$1 FOR UPDATE',[req.params.id])).rows[0];
    if(!demo||demo.converted_at){await client.query('ROLLBACK');res.status(409).json({error:'This is not a demo. Live dealerships cannot be reset.'});return;}
    if(demo.revision!==parsed.data.expectedRevision){await client.query('ROLLBACK');res.status(409).json({error:'Demo changed in another session. Reload before continuing.'});return;}
    const id=req.params.id;
    // Coordinate with the existing dealer-specific stock and sales locks.
    for(const key of [`stock-import:${id}`,`sale-workspace:${id}`,`dealer-settings:${id}`]) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
    let config=(await client.query('SELECT config FROM dealer_settings WHERE dealer_id=$1 FOR UPDATE',[id])).rows[0].config;
    if(parsed.data.action==='recipient'){
      const recipient=parsed.data.recipient;
      if(!recipient || !demoProvisioning().recipients.includes(recipient)){await client.query('ROLLBACK');res.status(400).json({error:'Choose a platform-approved demo email recipient.'});return;}
      await client.query('UPDATE dealer_demos SET recipient=$2 WHERE dealer_id=$1',[id,recipient]);
    }else if(parsed.data.action==='baseline'){
      if(!await saveDemoBaseline(client,id,config,demo.logo_data,demo.footer_logo_data)){await client.query('ROLLBACK');res.status(409).json({error:'Import stock before saving the starting point.'});return;}
    }else if(parsed.data.action==='extend'){
      await client.query("UPDATE dealer_demos SET expires_at=$2 WHERE dealer_id=$1",[id,new Date(Date.now()+(parsed.data.days??14)*86400000)]);
    }else{
      if(!demo.baseline){await client.query('ROLLBACK');res.status(409).json({error:'Save a starting point after importing stock first.'});return;}
      await clearDemoActivity(client,id);
      if(parsed.data.action==='original'){
        const baseline=demo.baseline;
        // Snapshots are written by this server only and are scoped again before restoring.
        if(baseline.version!==1 || baseline.vehicles.some((v:any)=>v.dealer_id!==id)) throw Error('Invalid demo baseline');
        await client.query('DELETE FROM vehicles WHERE dealer_id=$1',[id]);
        await client.query('INSERT INTO vehicles SELECT * FROM json_populate_recordset(NULL::vehicles,$1::json)',[JSON.stringify(baseline.vehicles)]);
        await client.query('INSERT INTO vehicle_images SELECT * FROM json_populate_recordset(NULL::vehicle_images,$1::json)',[JSON.stringify(baseline.images)]);
        config=baseline.config;
        const row=(await client.query('UPDATE dealer_settings SET config=$2::jsonb,revision=revision+1,updated_at=now() WHERE dealer_id=$1 RETURNING revision',[id,JSON.stringify(config)])).rows[0];
        await client.query("INSERT INTO dealer_settings_versions(dealer_id,revision,config,published_at,published_by,action) VALUES ($1,$2,$3::jsonb,now(),$4,'publish')",[id,row.revision,JSON.stringify(config),getAuth(req).userId]);
        await client.query('UPDATE dealer_demos SET logo_data=$2,footer_logo_data=$3 WHERE dealer_id=$1',[id,baseline.logoData,Object.prototype.hasOwnProperty.call(baseline,'footerLogoData')?baseline.footerLogoData:demo.footer_logo_data]);
      }
      await seedDemo(client,id,config);
      await client.query('UPDATE dealer_demos SET last_reset_at=now() WHERE dealer_id=$1',[id]);
    }
    await client.query('UPDATE dealer_demos SET revision=revision+1,updated_by=$2 WHERE dealer_id=$1',[id,getAuth(req).userId]);
    await client.query('COMMIT');res.json({status:'ready',action:parsed.data.action,notice:'Only this demo was changed. Import history, credentials and staff access were preserved. Worker schedules were not changed.'});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
});
export default router;
