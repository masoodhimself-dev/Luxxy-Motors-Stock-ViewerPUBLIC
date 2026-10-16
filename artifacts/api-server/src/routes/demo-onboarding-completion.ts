import { Router } from 'express';
import { z } from 'zod/v4';
import { pool } from '@workspace/db';
import { demoProvisioning } from '../lib/demo-policy';
import { saveDemoBaseline } from '../lib/demo-baseline';
import { runWithTenant } from '../lib/tenant-context';
import { EmailProviderError, sendEmailWithSettings } from '../lib/email-provider';

import { isPlatformAdmin } from '../lib/platform-admin';
export type CompletionKey={id:string;ownerAuthUserId:string};
export async function runDemoCompletionOperation(key:CompletionKey,id:string,operation:'test-email'|'baseline',method:string,input:{runId?:string;confirm?:string},transport:typeof fetch=(...args)=>fetch(...args)):Promise<{httpStatus:number;body:Record<string,any>}>{
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const valid=(await client.query('SELECT id FROM demo_onboarding_keys WHERE id=$1 AND revoked_at IS NULL AND expires_at>now() FOR SHARE',[key.id])).rows[0];
   if(!valid||!isPlatformAdmin(key.ownerAuthUserId)){await client.query('ROLLBACK');return {httpStatus:401,body:{error:'Invalid demo onboarding credential.'}};}
   const demo=(await client.query(`SELECT d.*,t.name,t.status,t.canonical_origin,t.stock_platform,t.retailer_id,t.source_url FROM dealer_demos d JOIN dealerships t ON t.id=d.dealer_id JOIN demo_onboarding_requests r ON r.dealer_id=d.dealer_id WHERE d.dealer_id=$1 AND r.key_id=$2 FOR UPDATE OF d`,[id,key.id])).rows[0];
   if(!demo||demo.converted_at){await client.query('ROLLBACK');return {httpStatus:404,body:{error:'Demo not found.'}};}
   if(new Date(demo.expires_at).getTime()<=Date.now()||demo.status!=='active'){await client.query('ROLLBACK');return {httpStatus:410,body:{error:'This demo is expired or inactive.'}};}
   const provision=demoProvisioning();
   let state=(await client.query('SELECT * FROM demo_onboarding_completion WHERE dealer_id=$1',[id])).rows[0];
   const reply=()=>({dealerId:id,status:state?.email_status??'not-sent',baselineSaved:Boolean(demo.baseline),...(state?.completed_at?{completedAt:state.completed_at}:{}),...(state?.checked_at?{checkedAt:state.checked_at}:{})});
   if(operation==='test-email'){
    if(!provision.emailReady||!provision.emailDomain||!provision.recipients.includes(demo.recipient)){await client.query('ROLLBACK');return {httpStatus:409,body:{error:'Demo sender or approved recipient is not ready.'}};}
    if(state&&state.recipient!==demo.recipient){await client.query('ROLLBACK');return {httpStatus:409,body:{error:'Demo recipient changed. Operator review is required; no automatic resend.'}};}
    if(method==='POST'){
     if(!state){
      const latest=(await client.query('SELECT status,received_count FROM stock_import_runs WHERE dealer_id=$1 ORDER BY received_at DESC LIMIT 1',[id])).rows[0];
      if(latest?.status!=='completed'||latest.received_count<1){await client.query('ROLLBACK');return {httpStatus:409,body:{error:'Complete a non-empty stock import before testing demo email.'}};}
      state=(await client.query('INSERT INTO demo_onboarding_completion(dealer_id,key_id,recipient) VALUES ($1,$2,$3) RETURNING *',[id,key.id,demo.recipient])).rows[0];
      // Commit the intent before external I/O so every retry uses the same provider key.
      await client.query('COMMIT');await client.query('BEGIN');
      const stillValid=(await client.query('SELECT id FROM demo_onboarding_keys WHERE id=$1 AND revoked_at IS NULL AND expires_at>now() FOR SHARE',[key.id])).rows[0];
      if(!stillValid){await client.query('ROLLBACK');return {httpStatus:401,body:{error:'Invalid demo onboarding credential.'}};}
      const current=(await client.query('SELECT d.recipient,d.expires_at,d.converted_at,t.status FROM dealer_demos d JOIN dealerships t ON t.id=d.dealer_id WHERE d.dealer_id=$1 FOR UPDATE OF d',[id])).rows[0];
      if(!current||current.converted_at||current.recipient!==demo.recipient||new Date(current.expires_at).getTime()<=Date.now()||current.status!=='active'){await client.query('ROLLBACK');return {httpStatus:409,body:{error:'Demo changed during setup. Operator review required; no email sent.'}};}
      state=(await client.query('SELECT * FROM demo_onboarding_completion WHERE dealer_id=$1 FOR UPDATE',[id])).rows[0];
     }
     if(!state.provider_id){
      if(Date.now()-new Date(state.created_at).getTime()>23*3600000){await client.query('ROLLBACK');return {httpStatus:409,body:{error:'Email retry window expired. Operator review required; no new email sent.'}};}
      const providerId=await runWithTenant({dealerId:id,canonicalOrigin:demo.canonical_origin,platform:demo.stock_platform,retailerId:demo.retailer_id,sourceUrl:demo.source_url,demo:true},()=>sendEmailWithSettings({enabled:false,apiKey:'',from:'',replyTo:''},{to:demo.recipient,subject:'Demo setup test — no action required',html:'<p>This is a controlled demonstration email. No customer action or payment is required.</p>',text:'This is a controlled demonstration email. No customer action or payment is required.',idempotencyKey:`demo-onboarding-test/${id}`},(url,options)=>transport(url,{...options,redirect:'error'})));
      state=(await client.query("UPDATE demo_onboarding_completion SET provider_id=$2,email_status='sent' WHERE dealer_id=$1 RETURNING *",[id,providerId])).rows[0];
     }
     await client.query('COMMIT');return {httpStatus:200,body:reply()};
    }
    if(!state?.provider_id){await client.query('COMMIT');return {httpStatus:200,body:reply()};}
    if(state.email_status==='delivered'||(state.checked_at&&Date.now()-new Date(state.checked_at).getTime()<60000)){await client.query('COMMIT');return {httpStatus:200,body:reply()};}
    const readKey=process.env.DEMO_RESEND_STATUS_API_KEY||process.env.DEMO_RESEND_API_KEY;
    const response=await transport(`https://api.resend.com/emails/${encodeURIComponent(state.provider_id)}`,{headers:{Authorization:`Bearer ${readKey}`},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok){await client.query('ROLLBACK');return {httpStatus:response.status===429?429:503,body:{error:[401,403].includes(response.status)?'Sending succeeded, but delivery verification needs a server-side Resend key with email-read permission (DEMO_RESEND_STATUS_API_KEY). No email was resent.':'Delivery verification is temporarily unavailable. No email was resent.'}};}
    const email=await response.json() as {id?:string;to?:string[];last_event?:string};
    if(email.id!==state.provider_id||!Array.isArray(email.to)||email.to.length!==1||email.to[0].toLowerCase()!==state.recipient)throw Error('Provider identity mismatch');
    const event=email.last_event?.replace(/^email\./,'');
    const status=event==='delivered'||event==='opened'||event==='clicked'?'delivered':['bounced','failed','complained','suppressed'].includes(event??'')?'failed':['sent','queued','delivery_delayed'].includes(event??'')?'pending':null;
    if(!status)throw Error('Unknown provider status');
    state=(await client.query('UPDATE demo_onboarding_completion SET email_status=$2,checked_at=now() WHERE dealer_id=$1 RETURNING *',[id,status])).rows[0];
    await client.query('COMMIT');return {httpStatus:200,body:reply()};
   }
   if(input.confirm!==id){await client.query('ROLLBACK');return {httpStatus:400,body:{error:'Confirm the exact demo dealer ID.'}};}
   // A repeated completion never recreates practice data or overwrites an existing baseline.
   if(demo.baseline){await client.query('COMMIT');return {httpStatus:200,body:{dealerId:id,status:state?.baseline_run_id===input.runId?'replayed':'already-saved',baselineSaved:true}};}
   if(state?.email_status!=='delivered'||state.recipient!==demo.recipient||!provision.recipients.includes(demo.recipient)){await client.query('ROLLBACK');return {httpStatus:409,body:{error:'Confirm delivery to the current approved demo recipient before saving the starting point.'}};}
   for(const lock of [`stock-import:${id}`,`sale-workspace:${id}`,`dealer-settings:${id}`])await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[lock]);
   const latest=(await client.query('SELECT run_id,status,received_count,expected_count FROM stock_import_runs WHERE dealer_id=$1 ORDER BY received_at DESC LIMIT 1',[id])).rows[0];
   if(latest?.run_id!==input.runId||latest.status!=='completed'||latest.received_count<1||latest.received_count!==latest.expected_count){await client.query('ROLLBACK');return {httpStatus:409,body:{error:'Use the latest successful complete, non-empty stock import runId.'}};}
   const config=(await client.query('SELECT config FROM dealer_settings WHERE dealer_id=$1 FOR UPDATE',[id])).rows[0]?.config;
   if(!config||!await saveDemoBaseline(client,id,config,demo.logo_data,demo.footer_logo_data)){await client.query('ROLLBACK');return {httpStatus:409,body:{error:'Demo stock and branding are not ready.'}};}
   await client.query('UPDATE dealer_demos SET revision=revision+1,updated_by=$2 WHERE dealer_id=$1',[id,key.ownerAuthUserId]);
   await client.query('UPDATE demo_onboarding_completion SET baseline_run_id=$2,completed_at=now() WHERE dealer_id=$1',[id,input.runId]);
   await client.query('COMMIT');return {httpStatus:200,body:{dealerId:id,status:'saved',baselineSaved:true}};
  }catch(error){
   await client.query('ROLLBACK');
   if(error instanceof EmailProviderError){
    // Sender authentication and message validation require an operator fix, not a retry loop.
    if(error.httpStatus>=400&&error.httpStatus<500&&error.httpStatus!==429)return {httpStatus:409,body:{error:`Demo email was rejected by the provider (HTTP ${error.httpStatus}). Check the sender credentials and email configuration before retrying; no automatic resend.`}};
    if(error.httpStatus===429)return {httpStatus:429,body:{error:'Demo email provider rate limit reached. Retry the same operation; no new email is requested.'}};
   }
   return {httpStatus:503,body:{error:'Demo completion could not finish. Retry the same operation; no reset or new email is requested.'}};
  }finally{client.release();}
}
/** Mounted after the onboarding authentication/approved-host middleware. */
export function demoCompletionRouter(transport:typeof fetch=(...args)=>fetch(...args)) {
 const router=Router();
 router.all('/demos/:dealerId/:operation',async(req,res,next)=>{
  const operation=req.params.operation;
  if(!['test-email','baseline'].includes(operation) || !((operation==='test-email'&&['GET','POST'].includes(req.method))||(operation==='baseline'&&req.method==='POST'))){next();return;}
  const body=operation==='baseline'?z.object({runId:z.uuid(),confirm:z.string()}).strict():z.object({}).strict();
  const parsed=body.safeParse(req.method==='GET'?{}:req.body??{});
  if(!parsed.success){res.status(400).json({error:'Invalid completion request. Use the documented fields only.'});return;}
  const input=parsed.data as {runId?:string;confirm?:string};
  const result=await runDemoCompletionOperation(res.locals.onboardingKey,req.params.dealerId,operation as 'test-email'|'baseline',req.method,input,transport);
  res.status(result.httpStatus).json(result.body);
 });
 return router;
}
