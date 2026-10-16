import { Router } from 'express';
import { pool } from '@workspace/db';
import { z } from 'zod/v4';
export const publicCompletionJob=(j:any)=>({jobId:j.id,dealerId:j.dealer_id,runId:j.run_id,status:j.status,stage:j.stage,attempts:j.attempts,deliveryChecks:j.delivery_checks,history:j.history,error:j.error,createdAt:j.created_at,updatedAt:j.updated_at});
export function demoJobRouter(){
 const router=Router();
 router.post('/demos/:dealerId/complete',async(req,res)=>{
  const parsed=z.object({runId:z.uuid(),confirm:z.string(),publicSiteChecked:z.literal(true),importReplayChecked:z.literal(true)}).strict().safeParse(req.body),id=req.params.dealerId,key=res.locals.onboardingKey;
  if(!parsed.success||parsed.data.confirm!==id){res.status(400).json({error:'Supply latest runId, exact dealer ID confirmation with publicSiteChecked:true and importReplayChecked:true after the visual and identical-import retry checks.'});return;}
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const valid=(await client.query('SELECT id FROM demo_onboarding_keys WHERE id=$1 AND revoked_at IS NULL AND expires_at>now() FOR SHARE',[key.id])).rows[0];
   if(!valid){await client.query('ROLLBACK');res.status(401).json({error:'Invalid onboarding credential.'});return;}
   const d=(await client.query('SELECT d.*,t.status FROM dealer_demos d JOIN dealerships t ON t.id=d.dealer_id JOIN demo_onboarding_requests r ON r.dealer_id=d.dealer_id WHERE d.dealer_id=$1 AND r.key_id=$2 FOR UPDATE OF d',[id,key.id])).rows[0];
   if(!d){await client.query('ROLLBACK');res.status(404).json({error:'Demo not found.'});return;}
   if(d.status!=='active'||new Date(d.expires_at).getTime()<=Date.now()){await client.query('ROLLBACK');res.status(410).json({error:'Demo expired or inactive.'});return;}
   const prior=(await client.query('SELECT * FROM demo_completion_jobs WHERE dealer_id=$1',[id])).rows[0];
   if(prior){await client.query('COMMIT');res.status(prior.run_id===parsed.data.runId?200:409).json(prior.run_id===parsed.data.runId?publicCompletionJob(prior):{error:'A completion job already exists for a different import. Operator review required.'});return;}
   if(d.baseline){await client.query('ROLLBACK');res.status(409).json({error:'Baseline already saved. No completion job created.'});return;}
   const latest=(await client.query('SELECT run_id,status,received_count,expected_count FROM stock_import_runs WHERE dealer_id=$1 ORDER BY received_at DESC LIMIT 1',[id])).rows[0];
   if(latest?.run_id!==parsed.data.runId||latest.status!=='completed'||latest.received_count<1||latest.received_count!==latest.expected_count){await client.query('ROLLBACK');res.status(409).json({error:'Use latest complete non-empty import runId.'});return;}
   const job=(await client.query('INSERT INTO demo_completion_jobs(dealer_id,key_id,run_id) VALUES ($1,$2,$3) RETURNING *',[id,key.id,parsed.data.runId])).rows[0];
   await client.query('COMMIT');res.status(202).json(publicCompletionJob(job));
  }catch{await client.query('ROLLBACK');res.status(503).json({error:'Unable to queue completion. Retry the same request.'});}finally{client.release();}
 });
 router.get('/demos/:dealerId/completion',async(req,res)=>{
  const result=await pool.query('SELECT j.* FROM demo_completion_jobs j JOIN demo_onboarding_requests r ON r.dealer_id=j.dealer_id WHERE j.dealer_id=$1 AND r.key_id=$2',[req.params.dealerId,res.locals.onboardingKey.id]);
  if(!result.rows[0]){res.status(404).json({error:'Completion job not found.'});return;}
  res.json(publicCompletionJob(result.rows[0]));
 });
 return router;
}
