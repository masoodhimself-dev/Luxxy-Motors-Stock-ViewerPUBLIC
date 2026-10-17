import { serviceLifecycle } from './service-lifecycle';
import { createECDH, createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import webpush from 'web-push';
import { sql } from 'drizzle-orm';
import { db } from '@workspace/db';
import type { Logger } from 'pino';
import { currentDealerId } from './tenant-context';
import { forEachActiveDealer } from './tenant-jobs';
import { roleHasPermission, isStaffRole } from './staff-permissions';

export const pushCategories = ['enquiries','bookings','reminders','followups','emailFailures'] as const;
export type PushCategory = typeof pushCategories[number] | 'test';
export const defaultPushPreferences = { enquiries:true, bookings:true, reminders:true, followups:true, emailFailures:true, reminderMinutes:30 };
export type PushPreferences = typeof defaultPushPreferences;
type Subscription = { endpoint:string; keys:{p256dh:string;auth:string} };
export type PushMessage = { title:string; body:string; url:string; eventId:string; category:PushCategory; tag:string };
export type PushSender = (subscription: Subscription, message: PushMessage, ttl: number) => Promise<void>;

/** Keys stay server-side. Unconfigured development/staging must never send. */
export function pushConfiguration() {
  const publicKey=process.env.WEB_PUSH_PUBLIC_KEY?.trim(), privateKey=process.env.WEB_PUSH_PRIVATE_KEY?.trim(), subject=process.env.WEB_PUSH_SUBJECT?.trim();
  if(process.env.WEB_PUSH_ENABLED!=='true' || !publicKey || !privateKey || !subject) return null;
  if(!validKey(publicKey,65) || !validKey(privateKey,32)) return null;
  try {
    const pair=createECDH('prime256v1');pair.setPrivateKey(Buffer.from(privateKey,'base64url'));
    if(!pair.getPublicKey().equals(Buffer.from(publicKey,'base64url'))) return null;
    const url=new URL(subject);
    if(url.protocol==='mailto:' ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url.pathname) : url.protocol!=='https:' || Boolean(url.username||url.password)) return null;
    return {publicKey,privateKey,subject};
  } catch { return null; }
}
function validKey(value:string, bytes:number) { return /^[A-Za-z0-9_-]+$/.test(value) && Buffer.from(value,'base64url').length===bytes; }
/** Only vendor-owned Web Push endpoints. https.request below never follows redirects. */
export function validPushEndpoint(value:string) {
  try {
    const u=new URL(value), h=u.hostname.toLowerCase();
    return value.length<=2048 && u.protocol==='https:' && !u.username && !u.password && !u.hash && (!u.port || u.port==='443') && u.pathname!=='/' &&
      (h==='fcm.googleapis.com' || h==='updates.push.services.mozilla.com' || h==='web.push.apple.com' || h.endsWith('.push.apple.com') || h.endsWith('.notify.windows.com'));
  } catch { return false; }
}
export function validPushSubscription(value:Subscription) {
  return validPushEndpoint(value.endpoint) && validKey(value.keys.p256dh,65) && Buffer.from(value.keys.p256dh,'base64url')[0]===4 && validKey(value.keys.auth,16);
}
export const endpointHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function createWebPushSender(transport:typeof httpsRequest=httpsRequest):PushSender {return async(subscription,message,ttl)=>{
  const config=pushConfiguration();
  if(!config || !validPushSubscription(subscription)) throw new Error('Push is not configured or subscription is invalid.');
  const details=webpush.generateRequestDetails(subscription,JSON.stringify(message),{vapidDetails:config,TTL:Math.max(1,Math.min(ttl,3600)),urgency:message.category==='reminders'?'high':'normal',topic:createHash('sha256').update(message.tag).digest('base64url').slice(0,32)});
  // Encryption/VAPID comes from web-push. Native HTTPS never follows redirects;
  // AbortSignal bounds DNS, TLS, request and response together to ten seconds.
  await new Promise<void>((resolve,reject)=>{
    const req=transport(new URL(details.endpoint),{method:details.method,headers:details.headers,signal:AbortSignal.timeout(10000)},response=>{
      const status=response.statusCode??0;
      response.on('error',reject);
      if(status<200||status>=300) {response.resume();reject(Object.assign(new Error('Push provider did not accept the notification.'),{statusCode:status}));return;}
      response.resume();response.on('end',resolve);
    });
    req.on('error',reject);req.end(details.body);
  });
};}
export const sendWebPush=createWebPushSender();
export async function readPushPreferences(dealer:string,user:string,emailAccess:boolean):Promise<PushPreferences> {
  const row=(await db.execute(sql`SELECT enquiries,bookings,reminders,followups,email_failures AS "emailFailures",reminder_minutes AS "reminderMinutes" FROM staff_push_preferences WHERE dealer_id=${dealer} AND auth_user_id=${user}`)).rows[0];
  return {...defaultPushPreferences,...row,emailFailures:emailAccess && (row?Boolean(row.emailFailures):true)};
}

/** Repeated scans/restarts insert once per device and event. Only post-enrolment events qualify. */
export async function enqueueStaffPush() {
  const dealer=currentDealerId();
  await db.execute(sql`WITH devices AS (
    SELECT s.*,greatest(s.created_at,coalesce(p.updated_at,s.created_at)) AS event_since,u.role,coalesce(p.enquiries,true) AS pref_enquiries,coalesce(p.bookings,true) AS pref_bookings,coalesce(p.reminders,true) AS pref_reminders,coalesce(p.followups,true) AS pref_followups,coalesce(p.email_failures,true) AS pref_email_failures,coalesce(p.reminder_minutes,30) AS lead
    FROM staff_push_subscriptions s JOIN portal_users u ON u.dealer_id=s.dealer_id AND u.auth_user_id=s.auth_user_id LEFT JOIN staff_push_preferences p ON p.dealer_id=s.dealer_id AND p.auth_user_id=s.auth_user_id
    WHERE s.dealer_id=${dealer} AND u.disabled_at IS NULL AND u.role IN ('owner','salesperson','accounts')
  ), candidates AS (
    SELECT s.id AS subscription_id,'event:'||v.id::text AS event_key,CASE WHEN v.kind='enquiry_received' THEN 'enquiries' ELSE 'bookings' END AS category,v.enquiry_id,CASE WHEN v.kind='enquiry_received' THEN NULL::integer ELSE e.appointment_revision END AS revision,NULL::timestamptz AS due_at,least(v.occurred_at+interval '24 hours',now()+interval '1 hour') AS expires_at
      FROM devices s JOIN enquiry_events v ON v.dealer_id=s.dealer_id JOIN enquiries e ON e.id=v.enquiry_id AND e.dealer_id=s.dealer_id
      WHERE (v.kind<>'enquiry_received' OR e.merged_into_id IS NULL) AND v.occurred_at>=s.event_since AND v.occurred_at>now()-interval '24 hours' AND ((v.kind='enquiry_received' AND e.appointment_at IS NULL AND s.pref_enquiries) OR (v.kind IN ('viewing_booked','viewing_rescheduled','viewing_cancelled') AND s.pref_bookings AND NOT EXISTS (SELECT 1 FROM enquiry_events newer WHERE newer.dealer_id=v.dealer_id AND newer.enquiry_id=v.enquiry_id AND newer.kind IN ('viewing_booked','viewing_rescheduled','viewing_cancelled') AND (newer.occurred_at>v.occurred_at OR (newer.occurred_at=v.occurred_at AND newer.id>v.id)))))
    UNION ALL SELECT s.id,'reminder:'||e.id::text||':'||e.appointment_revision::text,'reminders',e.id,e.appointment_revision,e.appointment_at,e.appointment_at
      FROM devices s JOIN enquiries e ON e.dealer_id=s.dealer_id WHERE s.pref_reminders AND e.status<>'closed' AND e.appointment_status='confirmed' AND e.appointment_cancelled_at IS NULL AND e.attendance='scheduled' AND e.appointment_at>now() AND e.appointment_at>=s.created_at AND e.appointment_at<=now()+s.lead*interval '1 minute'
    UNION ALL SELECT s.id,'followup:'||e.id::text||':'||e.follow_up_revision::text,'followups',e.id,e.follow_up_revision,e.follow_up_at,e.follow_up_at+interval '24 hours'
      FROM devices s JOIN enquiries e ON e.dealer_id=s.dealer_id WHERE s.pref_followups AND e.status<>'closed' AND e.follow_up_completed_at IS NULL AND e.follow_up_at>=s.event_since AND e.follow_up_at<=now() AND e.follow_up_at>now()-interval '24 hours'
    UNION ALL SELECT s.id,'email:'||m.id::text||':'||coalesce(c.last_event,m.status),'emailFailures',e.id,NULL::integer,NULL::timestamptz,now()+interval '1 hour'
      FROM devices s JOIN enquiry_emails m ON m.dealer_id=s.dealer_id JOIN enquiries e ON e.id=m.enquiry_id AND e.dealer_id=s.dealer_id LEFT JOIN email_delivery_checks c ON c.dealer_id=m.dealer_id AND c.message_key='enquiry:'||m.id::text AND c.provider_id=m.provider_id
      WHERE s.role IN ('owner','salesperson') AND s.pref_email_failures AND coalesce(c.last_event,m.status) IN ('failed','unknown','bounced','complained','suppressed') AND coalesce(c.checked_at,m.finished_at,m.created_at)>=s.event_since AND coalesce(c.checked_at,m.finished_at,m.created_at)>now()-interval '24 hours'
    UNION ALL SELECT s.id,'automail:'||e.id::text||':'||n.kind||':'||n.attempted_at::text,'emailFailures',e.id,NULL::integer,n.attempted_at,now()+interval '1 hour'
      FROM devices s JOIN enquiries e ON e.dealer_id=s.dealer_id CROSS JOIN LATERAL (VALUES ('confirmation',e.customer_notification_status,e.customer_notification_attempted_at),('reminder',e.reminder_status,e.reminder_attempted_at)) n(kind,status,attempted_at)
      WHERE s.role IN ('owner','salesperson') AND s.pref_email_failures AND n.status IN ('failed','unknown') AND n.attempted_at>=s.event_since AND n.attempted_at>now()-interval '24 hours'
  ) INSERT INTO staff_push_deliveries(subscription_id,dealer_id,event_key,category,enquiry_id,revision,due_at,expires_at)
    SELECT subscription_id,${dealer},event_key,category,enquiry_id,revision,due_at,expires_at FROM candidates ON CONFLICT(subscription_id,event_key) DO UPDATE SET status='pending',attempts=0,next_attempt_at=now(),retry_after=NULL,lease_until=NULL,finished_at=NULL,error_code=NULL WHERE staff_push_deliveries.category='reminders' AND staff_push_deliveries.status='cancelled' AND staff_push_deliveries.error_code='preference_disabled'`);
}
const bodies:Record<PushCategory,string>={enquiries:'A new customer enquiry needs attention.',bookings:'A test-drive booking has been added or changed.',reminders:'A confirmed appointment is coming up.',followups:'A customer follow-up is due.',emailFailures:'A customer email needs attention.',test:'Notifications are working on this device.'};
export function pushMessage(id:string,category:PushCategory,key:string,enquiryId:string|null):PushMessage {
  const url=enquiryId ? `/portal?section=notifications&${category==='emailFailures'?'workView=email':category==='bookings'||category==='reminders'?'workView=test-drives':'workView=customers'}&enquiryId=${encodeURIComponent(enquiryId)}` : '/portal?section=notifications';
  return {title:'Dealership update',body:bodies[category],url,eventId:id,category,tag:key};
}
function errorStatus(error:unknown) { return error && typeof error==='object' && 'statusCode' in error ? Number(error.statusCode) : 0; }
/** No customer identity, endpoint, crypto key or provider error body enters logs. */
export async function processStaffPush(log:Pick<Logger,'warn'>,sender:PushSender=sendWebPush,options:{skipEnqueue?:boolean;onlyJobId?:string}={}) {
  if(!pushConfiguration()) return;
  const dealer=currentDealerId();
  if(!options.skipEnqueue) await enqueueStaffPush();
  await db.execute(sql`UPDATE staff_push_deliveries SET status='cancelled',finished_at=now(),error_code='expired' WHERE dealer_id=${dealer} AND status IN ('pending','sending') AND expires_at<=now()`);
  await db.execute(sql`UPDATE staff_push_deliveries SET status='failed',finished_at=now(),error_code='attempt_limit' WHERE dealer_id=${dealer} AND status='sending' AND lease_until<=now() AND attempts>=3`);
  for(let count=0;count<25;count++) {
  const job=(await db.execute(sql`WITH claim AS (
    SELECT id FROM staff_push_deliveries WHERE dealer_id=${dealer} AND (${options.onlyJobId??null}::uuid IS NULL OR id=${options.onlyJobId??null}::uuid) AND expires_at>now() AND attempts<3 AND ((status='pending' AND next_attempt_at<=now()) OR (status='sending' AND lease_until<=now())) ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE staff_push_deliveries q SET status='sending',attempts=attempts+1,lease_until=now()+interval '2 minutes' FROM claim WHERE q.id=claim.id RETURNING q.*`)).rows[0];
    if(!job) break;
    const id=String(job.id),category=String(job.category) as PushCategory;
    const subscriptions=(await db.execute(sql`SELECT s.*,u.role,u.disabled_at FROM staff_push_subscriptions s JOIN portal_users u ON u.dealer_id=s.dealer_id AND u.auth_user_id=s.auth_user_id WHERE s.id=${job.subscription_id}::uuid AND s.dealer_id=${dealer}`)).rows;
    const device=subscriptions[0];
    let allowed=Boolean(device && !device.disabled_at && isStaffRole(device.role));
    const emailAccess=device && roleHasPermission(device.role as 'owner'|'salesperson'|'accounts','sales.manage');
    const preferences=device?await readPushPreferences(dealer,String(device.auth_user_id),Boolean(emailAccess)):defaultPushPreferences;
    if(category!=='test' && (!preferences[category] || (category==='emailFailures' && !emailAccess))) allowed=false;
    // A verified, still-active domain must continue to belong to this dealer.
    if(device) {
      const domains=(await db.execute(sql`SELECT d.canonical_origin FROM dealerships d WHERE d.id=${dealer} AND d.status='active' AND EXISTS (SELECT 1 FROM dealer_domains x WHERE x.dealer_id=d.id AND x.verified=true AND x.hostname=${new URL(String(device.origin)).hostname})`)).rows;
      // Single-dealer installations have no registry row; origin was verified at enrolment.
      if(process.env.MULTI_TENANT_ENABLED==='true' && !domains.length) allowed=false;
    }
    let targetId=job.enquiry_id?String(job.enquiry_id):null;
    if(job.enquiry_id) {
      const enquiry=(await db.execute(sql`SELECT * FROM enquiries WHERE id=${job.enquiry_id}::uuid AND dealer_id=${dealer}`)).rows[0];
      if(!enquiry || (category==='enquiries' && enquiry.merged_into_id)) allowed=false;
      else if(category==='bookings') allowed=allowed && Number(enquiry.appointment_revision)===Number(job.revision);
      else if(category==='emailFailures') {
        if(String(job.event_key).startsWith('email:')) {
          const parts=String(job.event_key).split(':');
          const email=(await db.execute(sql`SELECT coalesce(c.last_event,m.status) AS state FROM enquiry_emails m LEFT JOIN email_delivery_checks c ON c.dealer_id=m.dealer_id AND c.message_key='enquiry:'||m.id::text AND c.provider_id=m.provider_id WHERE m.dealer_id=${dealer} AND m.id=${parts[1]}::uuid AND m.enquiry_id=${job.enquiry_id}::uuid`)).rows[0];
          allowed=allowed && Boolean(email && email.state===parts[2]);
        }else if(String(job.event_key).startsWith('automail:')) {
          const reminder=String(job.event_key).split(':')[2]==='reminder',status=reminder?enquiry.reminder_status:enquiry.customer_notification_status,attempt=reminder?enquiry.reminder_attempted_at:enquiry.customer_notification_attempted_at;
          allowed=allowed && ['failed','unknown'].includes(String(status)) && new Date(String(attempt)).getTime()===new Date(String(job.due_at)).getTime();
        }
      }
      else if(category==='reminders') {
        const at=new Date(String(enquiry.appointment_at)).getTime();
        allowed=allowed && enquiry.status!=='closed' && enquiry.appointment_status==='confirmed' && !enquiry.appointment_cancelled_at && enquiry.attendance==='scheduled' && Number(enquiry.appointment_revision)===Number(job.revision) && at===new Date(String(job.due_at)).getTime() && at>Date.now();
        // A shorter preference moves the same reminder to its new due time.
        // This is scheduling, not an attempt to contact the push provider.
        if(allowed && at>Date.now()+preferences.reminderMinutes*60000) {
          await db.execute(sql`UPDATE staff_push_deliveries SET status='pending',next_attempt_at=greatest(${new Date(at-preferences.reminderMinutes*60000)},retry_after),lease_until=NULL,attempts=greatest(attempts-1,0) WHERE id=${id}::uuid AND dealer_id=${dealer}`);continue;
        }
      }
      else if(category==='followups') allowed=allowed && enquiry.status!=='closed' && !enquiry.follow_up_completed_at && Number(enquiry.follow_up_revision)===Number(job.revision) && new Date(String(enquiry.follow_up_at)).getTime()===new Date(String(job.due_at)).getTime();
      if(enquiry && enquiry.merged_into_id && category!=='bookings' && category!=='reminders') {
        // Customer/email views open the surviving case; queue validity still
        // belongs to the original retained appointment/follow-up record.
        let primary=String(enquiry.merged_into_id);
        for(let depth=0;depth<10;depth++) {
          const parent=(await db.execute(sql`SELECT id,merged_into_id FROM enquiries WHERE id=${primary}::uuid AND dealer_id=${dealer}`)).rows[0];
          if(!parent){allowed=false;break;} targetId=String(parent.id);
          if(!parent.merged_into_id)break;primary=String(parent.merged_into_id);
        }
      }
    }
    if(!allowed || !device) {
      await db.execute(sql`UPDATE staff_push_deliveries SET status='cancelled',finished_at=now(),error_code=${category!=='test' && !preferences[category]?'preference_disabled':'no_longer_applicable'} WHERE id=${id}::uuid AND dealer_id=${dealer}`);continue;
    }
    const subscription={endpoint:String(device.endpoint),keys:{p256dh:String(device.p256dh),auth:String(device.auth)}};
    if(!validPushSubscription(subscription)) { await db.execute(sql`DELETE FROM staff_push_subscriptions WHERE id=${device.id}::uuid AND dealer_id=${dealer}`);continue; }
    try {
      await sender(subscription,pushMessage(id,category,String(job.event_key),targetId),Math.ceil((new Date(String(job.expires_at)).getTime()-Date.now())/1000));
      await db.execute(sql`UPDATE staff_push_deliveries SET status='sent',finished_at=now(),error_code=NULL WHERE id=${id}::uuid AND dealer_id=${dealer}`);
      await db.execute(sql`UPDATE staff_push_subscriptions SET last_success_at=now() WHERE id=${device.id}::uuid AND dealer_id=${dealer}`);
    } catch(error) {
      const status=errorStatus(error);
      if(status===404 || status===410) { await db.execute(sql`DELETE FROM staff_push_subscriptions WHERE id=${device.id}::uuid AND dealer_id=${dealer}`);continue; }
      const retry=(!status || status===429 || status>=500) && Number(job.attempts)<3;
      const delay=Number(job.attempts)===1?60:300;
      await db.execute(sql`UPDATE staff_push_deliveries SET status=${retry?'pending':'failed'},next_attempt_at=now()+${delay}*interval '1 second',retry_after=CASE WHEN ${retry} THEN now()+${delay}*interval '1 second' ELSE NULL END,lease_until=NULL,finished_at=${retry?null:new Date()},error_code=${status?`provider_${status}`:'network'} WHERE id=${id}::uuid AND dealer_id=${dealer}`);
      log.warn({category,status:status||'network',retry},'Staff device notification could not be accepted');
    }
  }
  // Bounded storage; subscriptions with no successful send expire after 90 days.
  await db.execute(sql`DELETE FROM staff_push_deliveries WHERE dealer_id=${dealer} AND created_at<now()-interval '7 days' AND status IN ('sent','failed','cancelled')`);
  await db.execute(sql`DELETE FROM staff_push_subscriptions WHERE dealer_id=${dealer} AND coalesce(last_success_at,created_at)<now()-interval '90 days'`);
}
export function startStaffPushWorker(log:Logger) {
  if(!pushConfiguration()) { log.info('Staff device notifications are disabled or await Web Push configuration');return ()=>{}; }
  let running=false,stopped=false;
  const run=async()=>{if(running||stopped||serviceLifecycle.isDraining())return;running=true;try {await forEachActiveDealer(()=>processStaffPush(log), { name: 'staff-push', log });}catch {log.warn('Staff device notification worker could not complete its check');}finally{running=false;}};
  void run();const timer=setInterval(()=>void run(),60000);timer.unref();
  return ()=>{stopped=true;clearInterval(timer);};
}
