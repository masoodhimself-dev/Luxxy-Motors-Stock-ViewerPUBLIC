import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db } from '@workspace/db';
import { requireStaff } from '../middlewares/staff-auth';
import { currentDealerId, currentTenant } from '../lib/tenant-context';
import { siteOrigin } from '../lib/enquiry-links';
import { pushConfiguration, readPushPreferences, defaultPushPreferences, endpointHash, validPushSubscription, processStaffPush, type PushSender } from '../lib/staff-push';

const preferenceSchema=z.object({enquiries:z.boolean(),bookings:z.boolean(),reminders:z.boolean(),followups:z.boolean(),emailFailures:z.boolean(),reminderMinutes:z.union([z.literal(10),z.literal(15),z.literal(30),z.literal(60)])}).strict();
const subscriptionSchema=z.object({subscription:z.object({endpoint:z.string().max(2048),keys:z.object({p256dh:z.string().max(100),auth:z.string().max(50)}).strict()}).strict(),deviceLabel:z.string().trim().min(1).max(60).refine(s=>!/[\u0000-\u001f\u007f]/.test(s))}).strict();
const uuid=z.string().uuid();
export function createStaffPushRouter(options:{sender?:PushSender}={}) {
  const router=Router();
  router.use('/staff/push',requireStaff,async(req,res,next)=>{
    res.set('Cache-Control','no-store, private');
    try {
      const raw=req.get('origin'),canonical=new URL(siteOrigin());
      // Same-origin GETs commonly omit Origin. resolveTenant already verified
      // this Host; retain a www/alias device's own browser origin in that case.
      const fallback=currentTenant()?.kind==='website' && req.get('host') ? `${canonical.protocol}//${req.get('host')}` : canonical.origin;
      const origin=new URL(raw||fallback);
      const valid=(!raw || origin.origin===raw) && !origin.username && !origin.password &&
        (origin.origin===canonical.origin || (currentTenant()?.kind==='website' && origin.host===req.get('host') && origin.protocol===canonical.protocol));
      if(!valid || (req.method!=='GET' && !raw)) {res.status(403).json({error:'Open notifications on your dealership website.'});return;}
      // Push is for a real named staff member, never a server automation token.
      const membership=(await db.execute(sql`SELECT id FROM portal_users WHERE dealer_id=${currentDealerId()} AND auth_user_id=${req.staff!.authUserId} AND disabled_at IS NULL`)).rows[0];
      if(!membership) {res.status(403).json({error:'A current dealership staff account is required.'});return;}
      res.locals.pushOrigin=origin.origin;next();
    }catch {res.status(503).json({error:'Device notification settings are temporarily unavailable.'});}
  });
  router.get('/staff/push',async(req,res)=>{
    const configured=pushConfiguration(),dealer=currentDealerId(),user=req.staff!.authUserId;
    if(!configured) {res.json({configured:false,publicKey:null,actorScope:`${dealer}:${user}`,subscriptions:[],preferences:{...defaultPushPreferences,emailFailures:Boolean(req.staff!.permissions?.includes('sales.manage'))}});return;}
    try {
      const subscriptions=(await db.execute(sql`SELECT id,device_label AS "deviceLabel",created_at AS "createdAt",last_success_at AS "lastSuccessAt" FROM staff_push_subscriptions WHERE dealer_id=${dealer} AND auth_user_id=${user} AND origin=${res.locals.pushOrigin} ORDER BY created_at DESC`)).rows;
      res.json({configured:Boolean(configured),publicKey:configured?.publicKey??null,actorScope:`${dealer}:${user}`,subscriptions,preferences:await readPushPreferences(dealer,user,Boolean(req.staff!.permissions?.includes('sales.manage')))});
    }catch {res.status(503).json({error:'Device notifications need the latest database update. Please contact your platform administrator.'});}
  });
  router.post('/staff/push/subscriptions',async(req,res)=>{
    if(!pushConfiguration()){res.status(503).json({error:'Device notifications are not configured yet.'});return;}
    const input=subscriptionSchema.safeParse(req.body);
    if(!input.success || !validPushSubscription(input.data.subscription)){res.status(400).json({error:'This browser supplied an unsupported notification subscription.'});return;}
    const dealer=currentDealerId(),user=req.staff!.authUserId,{subscription,deviceLabel}=input.data;
    try {
      const result=await db.transaction(async tx=>{
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`push-enrol:${dealer}:${user}`}))`);
        const saved=(await tx.execute(sql`SELECT id,dealer_id,auth_user_id,origin FROM staff_push_subscriptions WHERE endpoint_hash=${endpointHash(subscription.endpoint)}`)).rows[0];
        if(saved && (saved.dealer_id!==dealer || saved.auth_user_id!==user || saved.origin!==res.locals.pushOrigin)) return {status:409,error:'This browser is linked to another staff account. Turn off its notifications before switching accounts.'};
        if(!saved) {
          const count=(await tx.execute(sql`SELECT count(*)::int AS n FROM staff_push_subscriptions WHERE dealer_id=${dealer} AND auth_user_id=${user}`)).rows[0];
          if(Number(count?.n)>=10) return {status:409,error:'Remove an old device before adding another. You can use up to 10 devices.'};
        }
        const device=(await tx.execute(sql`INSERT INTO staff_push_subscriptions(dealer_id,auth_user_id,origin,endpoint,endpoint_hash,p256dh,auth,device_label) VALUES(${dealer},${user},${res.locals.pushOrigin},${subscription.endpoint},${endpointHash(subscription.endpoint)},${subscription.keys.p256dh},${subscription.keys.auth},${deviceLabel}) ON CONFLICT(endpoint_hash) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,device_label=excluded.device_label WHERE staff_push_subscriptions.dealer_id=excluded.dealer_id AND staff_push_subscriptions.auth_user_id=excluded.auth_user_id AND staff_push_subscriptions.origin=excluded.origin RETURNING id,device_label AS "deviceLabel",created_at AS "createdAt",last_success_at AS "lastSuccessAt"`)).rows[0];
        if(!device) return {status:409,error:'This browser is linked to another staff account.'};
        await tx.execute(sql`INSERT INTO staff_push_preferences(dealer_id,auth_user_id) VALUES(${dealer},${user}) ON CONFLICT DO NOTHING`);
        return {status:saved?200:201,device};
      });
      res.status(result.status).json(result.device??{error:result.error});
    }catch {res.status(503).json({error:'This device could not be saved. Please try again.'});}
  });
  router.delete('/staff/push/subscriptions/:id',async(req,res)=>{
    if(!uuid.safeParse(req.params.id).success){res.status(400).json({error:'Check the device.'});return;}
    try {await db.execute(sql`DELETE FROM staff_push_subscriptions WHERE id=${String(req.params.id)}::uuid AND dealer_id=${currentDealerId()} AND auth_user_id=${req.staff!.authUserId} AND origin=${res.locals.pushOrigin}`);res.json({removed:true});}
    catch {res.status(503).json({error:'This device could not be removed. Please try again.'});}
  });
  router.put('/staff/push/preferences',async(req,res)=>{
    const input=preferenceSchema.safeParse(req.body);
    if(!input.success){res.status(400).json({error:'Check your notification preferences.'});return;}
    const p={...input.data,emailFailures:input.data.emailFailures && Boolean(req.staff!.permissions?.includes('sales.manage'))},dealer=currentDealerId(),user=req.staff!.authUserId;
    try {
      await db.transaction(async tx=>{
        await tx.execute(sql`INSERT INTO staff_push_preferences(dealer_id,auth_user_id,enquiries,bookings,reminders,followups,email_failures,reminder_minutes) VALUES(${dealer},${user},${p.enquiries},${p.bookings},${p.reminders},${p.followups},${p.emailFailures},${p.reminderMinutes}) ON CONFLICT(dealer_id,auth_user_id) DO UPDATE SET enquiries=excluded.enquiries,bookings=excluded.bookings,reminders=excluded.reminders,followups=excluded.followups,email_failures=excluded.email_failures,reminder_minutes=excluded.reminder_minutes,updated_at=now()`);
        // Preferences apply across this staff member's devices. Move pending
        // reminders in either direction, preserving a real provider backoff.
        if(p.reminders) await tx.execute(sql`UPDATE staff_push_deliveries q SET next_attempt_at=greatest(now(),q.due_at-${p.reminderMinutes}*interval '1 minute',q.retry_after) FROM staff_push_subscriptions s WHERE q.subscription_id=s.id AND q.dealer_id=${dealer} AND s.dealer_id=${dealer} AND s.auth_user_id=${user} AND q.category='reminders' AND q.status='pending' AND q.due_at>now()`);
      });
      res.json({preferences:p});
    }
    catch {res.status(503).json({error:'Your preferences could not be saved. Please try again.'});}
  });
  router.post('/staff/push/test',async(req,res)=>{
    if(!pushConfiguration()){res.status(503).json({error:'Device notifications are not configured yet.'});return;}
    const input=z.object({subscriptionId:uuid}).strict().safeParse(req.body);
    if(!input.success){res.status(400).json({error:'Choose a saved device.'});return;}
    try {
      const result=await db.transaction(async tx=>{
        const row=(await tx.execute(sql`SELECT id,last_test_at FROM staff_push_subscriptions WHERE id=${input.data.subscriptionId}::uuid AND dealer_id=${currentDealerId()} AND auth_user_id=${req.staff!.authUserId} AND origin=${res.locals.pushOrigin} FOR UPDATE`)).rows[0];
        if(!row) return {status:404};
        if(row.last_test_at && new Date(String(row.last_test_at)).getTime()>Date.now()-60000) return {status:429};
        await tx.execute(sql`UPDATE staff_push_subscriptions SET last_test_at=now() WHERE id=${row.id}::uuid`);
        const job=(await tx.execute(sql`INSERT INTO staff_push_deliveries(subscription_id,dealer_id,event_key,category,expires_at) VALUES(${row.id}::uuid,${currentDealerId()},${`test:${Date.now()}`},'test',now()+interval '5 minutes') RETURNING id`)).rows[0];
        return {status:202,id:String(job!.id)};
      });
      if(result.status===404){res.status(404).json({error:'This device is not registered to your staff account.'});return;}
      if(result.status===429){res.set('Retry-After','60').status(429).json({error:'Wait one minute before sending another test.'});return;}
      await processStaffPush({warn:()=>{}},options.sender,{skipEnqueue:true,onlyJobId:result.id});
      const outcome=(await db.execute(sql`SELECT status FROM staff_push_deliveries WHERE id=${result.id}::uuid AND dealer_id=${currentDealerId()}`)).rows[0];
      if(!outcome || outcome.status==='failed' || outcome.status==='cancelled') {res.status(502).json({error:'This device could not accept the test. Re-enable notifications and try again.'});return;}
      res.status(202).json({status:outcome.status==='sent'?'sent':'queued'});
    }catch {res.status(503).json({error:'The test could not be sent. Please try again.'});}
  });
  return router;
}
export default createStaffPushRouter();
