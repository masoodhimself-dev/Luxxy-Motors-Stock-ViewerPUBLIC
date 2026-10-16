import { pool } from '@workspace/db';
import type { Logger } from 'pino';
import { multiTenantEnabled } from './tenant-context';
import { isPlatformAdmin } from './platform-admin';
import { runDemoCompletionOperation } from '../routes/demo-onboarding-completion';

/** Durable work records; session advisory locks exclude other processes and release on crashes. */
export async function processDemoCompletionJobs(transport:typeof fetch=(...args)=>fetch(...args)){
 const due=await pool.query("SELECT id FROM demo_completion_jobs WHERE status IN ('queued','running') AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 10");
 for(const {id} of due.rows){
  const lease=await pool.connect();let locked=false;
  try{
   locked=Boolean((await lease.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',[`demo-completion-job:${id}`])).rows[0]?.locked);
   if(!locked)continue;
   const job=(await lease.query("SELECT j.*,k.owner_auth_user_id,k.revoked_at,k.expires_at FROM demo_completion_jobs j JOIN demo_onboarding_keys k ON k.id=j.key_id WHERE j.id=$1 AND j.status IN ('queued','running') AND j.next_attempt_at<=now()",[id])).rows[0];
   if(!job)continue;
   const record=async(status:string,stage:string,error:string|null=null,delaySeconds=60)=>{
    const event={stage,status,at:new Date().toISOString(),...(error?{error}:{})};
    await lease.query("UPDATE demo_completion_jobs SET status=$2,stage=$3,error=$4,history=history || $5::jsonb,updated_at=now(),next_attempt_at=now()+($6 * interval '1 second') WHERE id=$1",[id,status,stage,error,JSON.stringify([event]),delaySeconds]);
   };
   if(job.revoked_at||new Date(job.expires_at).getTime()<=Date.now()||!isPlatformAdmin(job.owner_auth_user_id)){await record('blocked',job.stage,'Onboarding credential expired, revoked or no longer authorised.');continue;}
   if(job.attempts>=15){await record('blocked',job.stage,'Completion retry limit reached. Operator review required.');continue;}
   const key={id:job.key_id,ownerAuthUserId:job.owner_auth_user_id};
   await lease.query("UPDATE demo_completion_jobs SET status='running',attempts=attempts+1,updated_at=now() WHERE id=$1",[id]);
   // Validate the selected import on every attempt, not just job creation.
   const current=(await lease.query('SELECT d.baseline,d.expires_at,t.status FROM dealer_demos d JOIN dealerships t ON t.id=d.dealer_id WHERE d.dealer_id=$1',[job.dealer_id])).rows[0];
   const latest=(await lease.query('SELECT run_id,status,received_count,expected_count FROM stock_import_runs WHERE dealer_id=$1 ORDER BY received_at DESC LIMIT 1',[job.dealer_id])).rows[0];
   if(!current||current.status!=='active'||new Date(current.expires_at).getTime()<=Date.now()||latest?.run_id!==job.run_id||latest.status!=='completed'||latest.received_count<1||latest.received_count!==latest.expected_count){await record('blocked',job.stage,'Demo or latest complete import changed. Operator review required.');continue;}
   const operation=job.stage==='baseline'?'baseline':'test-email';
   if(job.stage==='import-check')await record('running','email-send');
   const stage=job.stage==='import-check'?'email-send':job.stage;
   if(stage==='email-delivery'){
    if(job.delivery_checks>=10){await record('blocked',stage,'Email delivery not confirmed after ten checks. No baseline saved.');continue;}
    await lease.query('UPDATE demo_completion_jobs SET delivery_checks=delivery_checks+1 WHERE id=$1',[id]);
   }
   const result=await runDemoCompletionOperation(key,job.dealer_id,operation,stage==='email-delivery'?'GET':'POST',{runId:job.run_id,confirm:job.dealer_id},transport);
   if(result.httpStatus!==200){
    const transient=[429,503].includes(result.httpStatus)&&!(result.body.error as string)?.includes('email-read permission');
    await record(transient?'running':'blocked',stage,result.body.error??'Completion failed.');continue;
   }
   if(stage==='baseline'){const saved=result.body.baselineSaved&&['saved','replayed'].includes(result.body.status);await record(saved?'completed':'blocked','baseline',saved?null:'Baseline already exists or was not saved by this job. Operator review required.');}
   else if(result.body.status==='failed')await record('blocked','email-delivery','Test email failed delivery. No baseline saved.');
   else if(result.body.status==='delivered')await record('running','baseline',null,0);
   else await record('running','email-delivery');
  }catch{
   if(locked)await lease.query("UPDATE demo_completion_jobs SET error='Temporary completion failure; retry pending.',next_attempt_at=now()+interval '1 minute',updated_at=now() WHERE id=$1",[id]).catch(()=>{});
  }finally{
   if(locked)await lease.query('SELECT pg_advisory_unlock(hashtext($1))',[`demo-completion-job:${id}`]).catch(()=>{});
   lease.release();
  }
 }
}
export function startDemoCompletionWorker(log:Logger){
 let running=false;
 const tick=async()=>{if(!multiTenantEnabled()||running)return;running=true;try{await processDemoCompletionJobs();}catch{log.warn('Demo completion queue unavailable; saved work will retry.');}finally{running=false;}};
 const timer=setInterval(()=>void tick(),15000);timer.unref();void tick();return()=>clearInterval(timer);
}
