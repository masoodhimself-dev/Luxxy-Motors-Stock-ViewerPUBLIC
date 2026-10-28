import { Router } from 'express';
import { getAuth } from '@clerk/express';
import { z } from 'zod/v4';
import { db, pool, dealerDemosTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { demoProvisioning } from '../lib/demo-policy';
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
    await client.query('COMMIT');res.status(201).json({...result,next:'Create a dedicated import credential in Stock connection. Demos start with empty enquiries and sales. Import authorised stock to show vehicles. No worker has been started.'});
  }catch(error){await client.query('ROLLBACK');if((error as {code?:string}).code==='23505'){res.status(409).json({error:'That demo name is already in use. Nothing was created.'});return;}throw error;}finally{client.release();}
});
router.get('/dealers/:id/demo',async(req,res)=>{
  const [demo]=await db.select().from(dealerDemosTable).where(eq(dealerDemosTable.dealerId,req.params.id));
  if(!demo){res.json({demo:false});return;}
  if(demo.convertedAt){res.json({demo:false,converted:true,convertedAt:demo.convertedAt});return;}
  const p=demoProvisioning();res.json({demo:true,recipient:demo.recipient,expiresAt:demo.expiresAt,revision:demo.revision,sender:p.emailDomain?`${demo.dealerId}@${p.emailDomain}`:null,emailReady:p.emailReady && p.recipients.includes(demo.recipient),paymentsDisabled:true});
});
const action=z.object({action:z.enum(['extend','recipient']),expectedRevision:z.number().int().nonnegative(),confirm:z.string(),days:z.number().int().min(1).max(90).optional(),recipient:z.email().transform(v=>v.toLowerCase()).optional()}).strict();
router.post('/dealers/:id/demo',async(req,res)=>{
  if(['baseline','activity','original'].includes(req.body?.action)){res.status(410).json({error:'Demo resets and fictional activity have been removed. Existing records are unchanged.'});return;}
  const parsed=action.safeParse(req.body);if(!parsed.success||parsed.data.confirm!==req.params.id){res.status(400).json({error:'Confirm the exact demo dealer ID and current revision.'});return;}
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const demo=(await client.query('SELECT * FROM dealer_demos WHERE dealer_id=$1 FOR UPDATE',[req.params.id])).rows[0];
    if(!demo||demo.converted_at){await client.query('ROLLBACK');res.status(409).json({error:'This is not a demo. Live dealerships do not use demo controls.'});return;}
    if(demo.revision!==parsed.data.expectedRevision){await client.query('ROLLBACK');res.status(409).json({error:'Demo changed in another session. Reload before continuing.'});return;}
    const id=req.params.id;
    if(parsed.data.action==='recipient'){
      const recipient=parsed.data.recipient;
      if(!recipient || !demoProvisioning().recipients.includes(recipient)){await client.query('ROLLBACK');res.status(400).json({error:'Choose a platform-approved demo email recipient.'});return;}
      await client.query('UPDATE dealer_demos SET recipient=$2 WHERE dealer_id=$1',[id,recipient]);
    }else{
      await client.query("UPDATE dealer_demos SET expires_at=$2 WHERE dealer_id=$1",[id,new Date(Date.now()+(parsed.data.days??14)*86400000)]);
    }
    await client.query('UPDATE dealer_demos SET revision=revision+1,updated_by=$2 WHERE dealer_id=$1',[id,getAuth(req).userId]);
    await client.query('COMMIT');res.json({status:'ready',action:parsed.data.action,notice:'Only this demo was changed. Import history, credentials and staff access were preserved. Worker schedules were not changed.'});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
});
export default router;
