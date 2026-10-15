import { Router } from 'express';
import { getAuth } from '@clerk/express';
import { z } from 'zod/v4';
import { randomBytes } from 'node:crypto';
import { db, pool, dealerDemosTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { demoProvisioning } from '../lib/demo-policy';
import { clearDemoActivity, seedDemo } from '../lib/demo-workspace';
import { newDealerSettings } from './dealer-settings';
const router=Router();
// Mounted ONLY behind platform-dealers' host, administrator and origin checks.
router.get('/demo-config', (_req,res) => {
  const p=demoProvisioning();res.json({...p,emailReady:p.emailReady && Boolean(p.emailDomain), configured:Boolean(p.domain && p.domainsReady), note:'Wildcard DNS/TLS and Clerk domain support must be configured once. Creating a demo does not start Grok or verify Resend.'});
});
const input=z.object({slug:z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/), name:z.string().trim().min(1).max(100),platform:z.enum(['autotrader','cazoo']),retailerId:z.string().trim().min(1).max(128),sourceUrl:z.string().url(),recipient:z.string().email(),days:z.number().int().min(1).max(90).default(14),logoData:z.string().max(400000).optional()}).strict();
router.post('/demos',async(req,res)=>{
  const parsed=input.safeParse(req.body),p=demoProvisioning();
  if(!parsed.success){res.status(400).json({error:'Enter a dealer name, unique demo name, authorised source and approved test email.'});return;}
  const d=parsed.data, id=`demo-${d.slug}`,host=`${d.slug}.${p.domain}`, source=new URL(d.sourceUrl);
  if(!p.domain || !p.domainsReady){res.status(409).json({error:'Configure DEMO_BASE_DOMAIN and confirm wildcard DNS/TLS and Clerk support with DEMO_DOMAINS_READY before creating demos.'});return;}
  if(!p.recipients.includes(d.recipient.toLowerCase())){res.status(400).json({error:'Choose an operator-approved demo email recipient.'});return;}
  const allowed=d.platform==='cazoo'?['cazoo.co.uk','www.cazoo.co.uk']:['autotrader.co.uk','www.autotrader.co.uk'];
  if(source.protocol!=='https:' || source.username || source.password || source.port || !allowed.includes(source.hostname)){res.status(400).json({error:'Stock source must be an authorised HTTPS URL from the selected marketplace.'});return;}
  let logo:string|null=null;
  if(d.logoData){
    const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(d.logoData);
    const data=match?Buffer.from(match[2],'base64'):Buffer.alloc(0);
    if(!match || data.length>250000 || !(match[1]==='png'?data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):data[0]===255&&data[1]===216&&data[2]===255)){res.status(400).json({error:'Upload a PNG or JPEG logo smaller than 250 KB.'});return;}logo=d.logoData;
  }
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const config=newDealerSettings(d.name);config.identity.logoAsset=logo?'/api/demo-logo':'';config.hero.announcement='Demonstration website — sample activity, no real payments.';
    config.contact.email=p.emailDomain?`${id}@${p.emailDomain}`:'';
    await client.query("INSERT INTO dealerships (id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES ($1,$2,'active',$3,$4,$5,$6)",[id,d.name,`https://${host}`,d.platform,d.retailerId,d.sourceUrl]);
    await client.query('INSERT INTO dealer_domains (hostname,dealer_id,verified,verification_token) VALUES ($1,$2,true,$3)',[host,id,`platform-owned-demo=${randomBytes(24).toString('hex')}`]);
    await client.query("INSERT INTO portal_users (dealer_id,auth_user_id,role) VALUES ($1,$2,'owner')",[id,getAuth(req).userId]);
    await client.query('INSERT INTO dealer_settings (dealer_id,config) VALUES ($1,$2::jsonb)',[id,JSON.stringify(config)]);
    await client.query('INSERT INTO dealer_demos (dealer_id,recipient,expires_at,updated_by,logo_data) VALUES ($1,$2,$3,$4,$5)',[id,d.recipient.toLowerCase(),new Date(Date.now()+d.days*86400000),getAuth(req).userId,logo]);
    await seedDemo(client,id,config);
    await client.query('COMMIT');res.status(201).json({dealerId:id,origin:`https://${host}`,next:'Create a dedicated import credential in Stock connection. After importing authorised stock, save the starting point in Demo controls. No worker has been started.'});
  }catch(error){await client.query('ROLLBACK');if((error as {code?:string}).code==='23505'){res.status(409).json({error:'That demo name is already in use. Nothing was created.'});return;}throw error;}finally{client.release();}
});
router.get('/dealers/:id/demo',async(req,res)=>{
  const [demo]=await db.select().from(dealerDemosTable).where(eq(dealerDemosTable.dealerId,req.params.id));
  if(!demo){res.json({demo:false});return;}
  const p=demoProvisioning();res.json({demo:true,recipient:demo.recipient,expiresAt:demo.expiresAt,revision:demo.revision,baselineSaved:Boolean(demo.baseline),lastResetAt:demo.lastResetAt,sender:p.emailDomain?`${demo.dealerId}@${p.emailDomain}`:null,emailReady:p.emailReady && p.recipients.includes(demo.recipient),paymentsDisabled:true});
});
const action=z.object({action:z.enum(['baseline','activity','original','extend']),expectedRevision:z.number().int().nonnegative(),confirm:z.string(),days:z.number().int().min(1).max(90).optional()}).strict();
router.post('/dealers/:id/demo',async(req,res)=>{
  const parsed=action.safeParse(req.body);if(!parsed.success||parsed.data.confirm!==req.params.id){res.status(400).json({error:'Confirm the exact demo dealer ID and current revision.'});return;}
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const demo=(await client.query('SELECT * FROM dealer_demos WHERE dealer_id=$1 FOR UPDATE',[req.params.id])).rows[0];
    if(!demo){await client.query('ROLLBACK');res.status(409).json({error:'This is not a demo. Live dealerships cannot be reset.'});return;}
    if(demo.revision!==parsed.data.expectedRevision){await client.query('ROLLBACK');res.status(409).json({error:'Demo changed in another session. Reload before continuing.'});return;}
    const id=req.params.id;
    // Coordinate with the existing dealer-specific stock and sales locks.
    for(const key of [`stock-import:${id}`,`sale-workspace:${id}`,`dealer-settings:${id}`]) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
    let config=(await client.query('SELECT config FROM dealer_settings WHERE dealer_id=$1 FOR UPDATE',[id])).rows[0].config;
    if(parsed.data.action==='baseline'){
      const vehicles=(await client.query('SELECT * FROM vehicles WHERE dealer_id=$1',[id])).rows;
      if(!vehicles.length){await client.query('ROLLBACK');res.status(409).json({error:'Import stock before saving the starting point.'});return;}
      const images=(await client.query('SELECT i.* FROM vehicle_images i JOIN vehicles v ON v.id=i.vehicle_id WHERE v.dealer_id=$1',[id])).rows;
      await clearDemoActivity(client,id);await seedDemo(client,id,config);
      await client.query('UPDATE dealer_demos SET baseline=$2::jsonb WHERE dealer_id=$1',[id,JSON.stringify({version:1,config,logoData:demo.logo_data,vehicles:vehicles.map(v=>({...v,inventory_status:'available'})),images,savedAt:new Date().toISOString()})]);
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
        await client.query('UPDATE dealer_demos SET logo_data=$2 WHERE dealer_id=$1',[id,baseline.logoData]);
      }
      await seedDemo(client,id,config);
      await client.query('UPDATE dealer_demos SET last_reset_at=now() WHERE dealer_id=$1',[id]);
    }
    await client.query('UPDATE dealer_demos SET revision=revision+1,updated_by=$2 WHERE dealer_id=$1',[id,getAuth(req).userId]);
    await client.query('COMMIT');res.json({status:'ready',action:parsed.data.action,notice:'Only this demo was changed. Import history, credentials and staff access were preserved. Worker schedules were not changed.'});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
});
export default router;
