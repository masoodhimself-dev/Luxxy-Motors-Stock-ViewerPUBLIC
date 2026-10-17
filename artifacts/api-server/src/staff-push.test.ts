import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { EventEmitter } from 'node:events';
import express from 'express';
import { sql } from 'drizzle-orm';
import { engine,db,dealershipsTable,dealerDomainsTable,portalUsersTable,enquiriesTable,enquiryEventsTable } from './test/tenant-test-db';
import { resolveTenant } from './middlewares/tenant';
import { createStaffPushRouter } from './routes/staff-push';
import { createWebPushSender, defaultPushPreferences, enqueueStaffPush, processStaffPush, pushConfiguration, validPushEndpoint,validPushSubscription,pushMessage,type PushMessage } from './lib/staff-push';
import { runWithTenant } from './lib/tenant-context';

// Isolated PGlite + fictional Clerk identity. No .env, real DB or push service is used.
process.env.MULTI_TENANT_ENABLED='true';
const ecdh=createECDH('prime256v1');ecdh.generateKeys();
const publicKey=ecdh.getPublicKey().toString('base64url'),privateKey=ecdh.getPrivateKey().toString('base64url');
const makeSubscription=(name:string)=>({endpoint:`https://fcm.googleapis.com/fcm/send/fictional-${name}`,keys:{p256dh:publicKey,auth:randomBytes(16).toString('base64url')}});
const configure=()=>{process.env.WEB_PUSH_ENABLED='true';process.env.WEB_PUSH_PUBLIC_KEY=publicKey;process.env.WEB_PUSH_PRIVATE_KEY=privateKey;process.env.WEB_PUSH_SUBJECT='mailto:operator@example.test';};
const tenant={dealerId:'a',canonicalOrigin:'https://a.example.test',platform:'autotrader' as const,retailerId:'a',sourceUrl:'https://www.autotrader.co.uk/example',kind:'website' as const};
const runA=<T>(job:()=>T)=>runWithTenant(tenant,job);
const logs:unknown[]=[];
const log={warn:(...values:unknown[])=>{logs.push(values);}};
const deliveries:Array<{subscription:ReturnType<typeof makeSubscription>;message:PushMessage;ttl:number}>=[];
let providerStatus=0;
const sender=async(subscription:ReturnType<typeof makeSubscription>,message:PushMessage,ttl:number)=>{if(providerStatus)throw Object.assign(new Error('provider body must never be logged'),{statusCode:providerStatus});deliveries.push({subscription,message,ttl});};

test('Web Push secure configuration, allowed vendor hosts and generic lock-screen content',()=>{
  process.env.WEB_PUSH_ENABLED='false';assert.equal(pushConfiguration(),null);configure();assert.ok(pushConfiguration());
  for(const host of ['https://fcm.googleapis.com/fcm/send/x','https://updates.push.services.mozilla.com/wpush/v2/x','https://web.push.apple.com/Q/x','https://wns2.notify.windows.com/w/?token=x']) assert.equal(validPushEndpoint(host),true,host);
  for(const host of ['http://fcm.googleapis.com/a','https://127.0.0.1/a','https://fcm.googleapis.com.evil.test/a','https://evil.push.apple.com.evil.test/a','https://fcm.googleapis.com:444/a','https://user@fcm.googleapis.com/a','https://fcm.googleapis.com/a#fragment','https://fcm.googleapis.com/']) assert.equal(validPushEndpoint(host),false,host);
  assert.ok(validPushSubscription(makeSubscription('valid')));assert.equal(validPushSubscription({...makeSubscription('bad'),keys:{p256dh:'fake',auth:'fake'}}),false);
  const message=pushMessage(randomUUID(),'bookings','event:fictional',randomUUID());assert.equal(message.title,'Dealership update');assert.ok(message.url.startsWith('/portal?'));assert.ok(!JSON.stringify(message).includes('customer@example'));
});

test('real sender encrypts content, signs VAPID, bounds the request and refuses redirects without visiting their target',async()=>{
  configure();let requests=0,status=201;const headers:Record<string,string>[]=[];let encrypted:Buffer|undefined;
  const transport=((url:URL,options:any,callback:(response:any)=>void)=>{
    requests++;assert.equal(url.hostname,'fcm.googleapis.com');assert.ok(options.signal instanceof AbortSignal);headers.push(options.headers);
    const req=new EventEmitter() as EventEmitter & {end:(body:Buffer)=>void};
    req.end=(body:Buffer)=>{encrypted=body;const response=new EventEmitter() as any;response.statusCode=status;response.headers={location:'https://untrusted.example.test/collect'};response.resume=()=>{};callback(response);queueMicrotask(()=>response.emit('end'));};return req;
  }) as never;
  const sender=createWebPushSender(transport),message=pushMessage(randomUUID(),'test','key',null);
  await sender(makeSubscription('encrypted'),message,7200);assert.equal(headers[0].TTL,3600);assert.equal(headers[0]['Content-Encoding'],'aes128gcm');assert.ok(headers[0].Authorization.includes('vapid'));assert.ok(encrypted&&!encrypted.toString().includes(message.body));
  status=302;await assert.rejects(()=>sender(makeSubscription('redirect'),message,100),(e:unknown)=>Boolean(e&&typeof e==='object'&&'statusCode'in e&&e.statusCode===302));assert.equal(requests,2);
});

test('staff push: HTTP tenancy/auth, enrolled devices, dedup, retries, expiry and current appointment state',async t=>{
  for(const name of (await readdir('../../lib/db/drizzle')).filter(n=>/^\d.*\.sql$/.test(n)).sort())await engine.exec(await readFile('../../lib/db/drizzle/'+name,'utf8'));
  for(const dealer of ['a','b']) {
    await db.insert(dealershipsTable).values({id:dealer,name:dealer,status:'active',canonicalOrigin:`https://${dealer}.example.test`,stockPlatform:'autotrader',retailerId:dealer,sourceUrl:'https://www.autotrader.co.uk/example'});
    await db.insert(dealerDomainsTable).values({hostname:`${dealer}.example.test`,dealerId:dealer,verified:true,verificationToken:'fictional'});
    await db.insert(portalUsersTable).values({dealerId:dealer,authUserId:`user_${dealer}`,role:'owner'});
  }
  await db.insert(portalUsersTable).values([{dealerId:'a',authUserId:'other_a',role:'owner'},{dealerId:'a',authUserId:'accounts',role:'accounts'}]);
  await db.insert(dealerDomainsTable).values({hostname:'alias.example.test',dealerId:'a',verified:true,verificationToken:'fictional'});
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.log={warn(){},error(){}} as never;next();});app.use(resolveTenant);app.use('/api',createStaffPushRouter({sender}));
  const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  async function call(method:string,path:string,body?:unknown,user='user_a',dealer='a',origin:string|null=`https://${dealer}.example.test`) {
    return new Promise<{status:number;body:any;headers:any}>((resolve,reject)=>{
      const text=body===undefined?'':JSON.stringify(body),headers:Record<string,string>={host:`${dealer}.example.test`,'content-type':'application/json','content-length':String(Buffer.byteLength(text))};if(user)headers['x-test-user']=user;if(origin)headers.origin=origin;
      const req=request({hostname:'127.0.0.1',port:(address as {port:number}).port,method,path:'/api/staff/push'+path,headers},res=>{let data='';res.on('data',v=>data+=v);res.on('end',()=>resolve({status:res.statusCode!,body:JSON.parse(data),headers:res.headers}));});req.on('error',reject);req.end(text);
    });
  }
  const query=async(text:ReturnType<typeof sql>)=>(await db.execute(text)).rows;
  const clear=async()=>{await db.execute(sql`DELETE FROM staff_push_deliveries`);await db.execute(sql`DELETE FROM enquiry_events`);await db.execute(sql`DELETE FROM email_delivery_checks`);await db.execute(sql`DELETE FROM enquiry_emails`);deliveries.length=0;logs.length=0;providerStatus=0;};
  let subscriptionId='';
  try {
    await t.test('disabled config is a clear no-op and does not access push tables',async()=>{
      process.env.WEB_PUSH_ENABLED='false';await engine.exec('ALTER TABLE staff_push_subscriptions RENAME TO push_subscriptions_hidden');
      const result=await call('GET','');assert.equal(result.status,200);assert.equal(result.body.configured,false);assert.equal(result.body.actorScope,'a:user_a');
      await runA(()=>processStaffPush(log,sender));assert.equal(deliveries.length,0);
      await engine.exec('ALTER TABLE push_subscriptions_hidden RENAME TO staff_push_subscriptions');configure();
    });
    await t.test('signed out, unassigned staff and cross-origin writes are rejected',async()=>{
      assert.equal((await call('GET','',undefined,'')).status,401);
      assert.equal((await call('GET','',undefined,'outsider')).status,403);
      assert.equal((await call('POST','/subscriptions',{subscription:makeSubscription('wrong'),deviceLabel:'Phone'},'user_a','a','https://b.example.test')).status,403);
      assert.equal((await call('POST','/subscriptions',{subscription:makeSubscription('missing'),deviceLabel:'Phone'},'user_a','a',null)).status,403);
    });
    await t.test('device enrollment is idempotent; endpoints and keys never leave GET',async()=>{
      const body={subscription:makeSubscription('a'),deviceLabel:'My iPhone'};
      const first=await call('POST','/subscriptions',body);assert.equal(first.status,201);subscriptionId=first.body.id;
      assert.equal((await call('POST','/subscriptions',body)).body.id,subscriptionId);
      const read=await call('GET','');assert.equal(read.status,200);assert.equal(read.body.subscriptions.length,1);assert.ok(read.headers['cache-control'].includes('no-store'));assert.ok(!JSON.stringify(read.body).includes(body.subscription.endpoint));assert.ok(!JSON.stringify(read.body).includes(body.subscription.keys.auth));
      assert.equal((await call('POST','/subscriptions',body,'other_a')).status,409);
      assert.equal((await call('POST','/subscriptions',body,'user_b','b')).status,409);
      assert.equal((await call('GET','',undefined,'user_b','b')).body.subscriptions.length,0);
    });
    await t.test('verified website aliases keep their own devices on same-origin GET without an Origin header',async()=>{
      const device=await call('POST','/subscriptions',{subscription:makeSubscription('alias'),deviceLabel:'Alias browser'},'user_a','alias');assert.equal(device.status,201);
      const read=await call('GET','',undefined,'user_a','alias',null);assert.equal(read.status,200);assert.equal(read.body.actorScope,'a:user_a');assert.deepEqual(read.body.subscriptions.map((s:any)=>s.deviceLabel),['Alias browser']);
      await db.execute(sql`INSERT INTO staff_push_deliveries(subscription_id,dealer_id,event_key,category,expires_at) VALUES(${device.body.id}::uuid,'a','alias-verified','test',now()+interval '1 hour')`);await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal(deliveries.length,1);await clear();
      await db.execute(sql`UPDATE dealer_domains SET verified=false WHERE hostname='alias.example.test'`);
      await db.execute(sql`INSERT INTO staff_push_deliveries(subscription_id,dealer_id,event_key,category,expires_at) VALUES(${device.body.id}::uuid,'a','alias-revoked','test',now()+interval '1 hour')`);await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal(deliveries.length,0);assert.equal((await query(sql`SELECT status FROM staff_push_deliveries`))[0].status,'cancelled');await clear();
      await db.execute(sql`UPDATE dealer_domains SET verified=true WHERE hostname='alias.example.test'`);
      await call('DELETE','/subscriptions/'+device.body.id,undefined,'user_a','alias');
    });
    await t.test('test send is one device only, throttled, and cannot test/delete another dealer device',async()=>{
      const result=await call('POST','/test',{subscriptionId});assert.equal(result.status,202);assert.equal(result.body.status,'sent');assert.equal(deliveries.length,1);assert.equal(deliveries[0].message.category,'test');
      assert.equal((await call('POST','/test',{subscriptionId})).status,429);
      assert.equal((await call('POST','/test',{subscriptionId},'user_b','b')).status,404);
      assert.equal((await call('DELETE','/subscriptions/'+subscriptionId,undefined,'user_b','b')).status,200);
      assert.equal((await call('GET','')).body.subscriptions.length,1);await clear();
    });
    await t.test('preferences validate permitted intervals and email access',async()=>{
      assert.equal((await call('PUT','/preferences',{...defaultPushPreferences,reminderMinutes:999})).status,400);
      const accounts=await call('PUT','/preferences',defaultPushPreferences,'accounts');assert.equal(accounts.status,200);assert.equal(accounts.body.preferences.emailFailures,false);
      assert.equal((await call('GET','',undefined,'accounts')).body.preferences.emailFailures,false);
    });
    await t.test('post-enrollment events only; scans and concurrent workers do not duplicate sends',async()=>{
      const oldId=randomUUID(),freshId=randomUUID(),foreignId=randomUUID();
      await db.insert(enquiriesTable).values([{id:oldId,dealerId:'a',type:'general',customerName:'Old private name',message:'old'},{id:freshId,dealerId:'a',type:'general',customerName:'Private name',message:'new'},{id:foreignId,dealerId:'b',type:'general',customerName:'Other dealer name',message:'foreign'}]);
      await db.insert(enquiryEventsTable).values([{dealerId:'a',enquiryId:oldId,kind:'enquiry_received',summary:'old',occurredAt:new Date(Date.now()-86400000)},{dealerId:'a',enquiryId:freshId,kind:'enquiry_received',summary:'private customer message'},{dealerId:'b',enquiryId:foreignId,kind:'enquiry_received',summary:'foreign'}]);
      await runA(()=>enqueueStaffPush());await runA(()=>enqueueStaffPush());assert.equal((await query(sql`SELECT * FROM staff_push_deliveries`)).length,1);
      await Promise.all([runA(()=>processStaffPush(log,sender,{skipEnqueue:true})),runA(()=>processStaffPush(log,sender,{skipEnqueue:true}))]);assert.equal(deliveries.length,1);assert.ok(!JSON.stringify(deliveries).includes('Private name'));assert.ok(!JSON.stringify(deliveries).includes('private customer message'));await clear();
    });
    await t.test('only confirmed upcoming reminders, and a reschedule invalidates a queued reminder',async()=>{
      const future=new Date(Date.now()+15*60000),ids=[randomUUID(),randomUUID(),randomUUID()];
      await db.insert(enquiriesTable).values(ids.map((id,i)=>({id,dealerId:'a',type:'viewing' as const,customerName:'Private',message:'appointment',appointmentAt:future,appointmentStatus:i===1?'pending' as const:'confirmed' as const,appointmentCancelledAt:i===2?new Date():null})));
      await runA(()=>enqueueStaffPush());const reminders=await query(sql`SELECT * FROM staff_push_deliveries WHERE category='reminders'`);assert.equal(reminders.length,1);assert.equal(reminders[0].enquiry_id,ids[0]);
      await db.execute(sql`UPDATE enquiries SET appointment_revision=appointment_revision+1,appointment_at=appointment_at+interval '2 hours' WHERE id=${ids[0]}::uuid`);
      await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal(deliveries.length,0);assert.equal((await query(sql`SELECT status FROM staff_push_deliveries WHERE category='reminders'`))[0].status,'cancelled');await clear();
    });
    await t.test('accounts receive ordinary booking alerts but never customer email-failure alerts',async()=>{
      const accounts=await call('POST','/subscriptions',{subscription:makeSubscription('accounts'),deviceLabel:'Accounts tablet'},'accounts');assert.equal(accounts.status,201);
      const id=randomUUID();await db.insert(enquiriesTable).values({id,dealerId:'a',type:'viewing',customerName:'Private name',message:'appointment',appointmentAt:new Date(Date.now()+2*3600000),appointmentStatus:'confirmed'});
      await db.insert(enquiryEventsTable).values([{dealerId:'a',enquiryId:id,kind:'viewing_booked',summary:'new appointment'},{dealerId:'a',enquiryId:id,kind:'enquiry_received',summary:'legacy duplicate event'}]);
      await runA(()=>enqueueStaffPush());const jobs=await query(sql`SELECT category,subscription_id FROM staff_push_deliveries`);assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.category==='bookings'));
      await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal(deliveries.length,2);
      await clear();
      await db.execute(sql`INSERT INTO staff_push_deliveries(subscription_id,dealer_id,event_key,category,expires_at) VALUES(${accounts.body.id}::uuid,'a','no-email-permission','emailFailures',now()+interval '1 hour')`);
      await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal(deliveries.length,0);assert.equal((await query(sql`SELECT status FROM staff_push_deliveries`))[0].status,'cancelled');
      await call('DELETE','/subscriptions/'+accounts.body.id,undefined,'accounts');await clear();
    });
    await t.test('a new bounce on an old email creates one fresh failure alert',async()=>{
      const id=randomUUID(),mail=randomUUID();await db.insert(enquiriesTable).values({id,dealerId:'a',type:'general',customerName:'Private',message:'email'});
      await db.execute(sql`INSERT INTO enquiry_emails(id,dealer_id,enquiry_id,request_id,request_hash,status,recipient,subject,message,created_by,created_at,finished_at,provider_id) VALUES(${mail}::uuid,'a',${id}::uuid,${randomUUID()}::uuid,'fictional','sent','customer@example.test','Private subject','Private body','user_a',now()-interval '2 days',now()-interval '2 days','provider-fictional')`);
      await db.execute(sql`INSERT INTO email_delivery_checks(dealer_id,message_key,provider_id,last_event) VALUES('a',${'enquiry:'+mail},'provider-fictional','bounced')`);
      await runA(()=>enqueueStaffPush());await runA(()=>enqueueStaffPush());assert.equal((await query(sql`SELECT * FROM staff_push_deliveries WHERE category='emailFailures'`)).length,1);await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal(deliveries.length,1);assert.equal(deliveries[0].message.category,'emailFailures');assert.ok(!JSON.stringify(deliveries[0].message).includes('Private'));await clear();
    });
    await t.test('follow-up completion suppresses queued work and overdue historical follow-ups do not flood',async()=>{
      const id=randomUUID();await db.insert(enquiriesTable).values({id,dealerId:'a',type:'general',customerName:'Private',message:'follow up',followUpAt:new Date(Date.now()-1000)});
      // Device predates the due task in this deterministic fixture.
      await db.execute(sql`UPDATE staff_push_subscriptions SET created_at=now()-interval '2 minutes' WHERE id=${subscriptionId}::uuid`);await db.execute(sql`UPDATE staff_push_preferences SET updated_at=now()-interval '2 minutes' WHERE dealer_id='a' AND auth_user_id='user_a'`);
      await runA(()=>enqueueStaffPush());assert.equal((await query(sql`SELECT * FROM staff_push_deliveries WHERE category='followups'`)).length,1);
      await db.execute(sql`UPDATE enquiries SET follow_up_completed_at=now() WHERE id=${id}::uuid`);await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal(deliveries.length,0);await clear();
    });
    await t.test('429/503 retry is bounded, generic logs omit provider content, and 302 never retries',async()=>{
      const enqueue=async(key:string)=>{await db.execute(sql`INSERT INTO staff_push_deliveries(subscription_id,dealer_id,event_key,category,expires_at) VALUES(${subscriptionId}::uuid,'a',${key},'test',now()+interval '1 hour')`);};
      await enqueue('retry');providerStatus=503;
      for(let attempt=1;attempt<=3;attempt++){await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));const row=(await query(sql`SELECT * FROM staff_push_deliveries WHERE event_key='retry'`))[0];assert.equal(row.attempts,attempt);assert.equal(row.status,attempt===3?'failed':'pending');await db.execute(sql`UPDATE staff_push_deliveries SET next_attempt_at=now()-interval '1 second' WHERE event_key='retry'`);}
      assert.ok(!JSON.stringify(logs).includes('provider body'));await clear();
      await enqueue('redirect');providerStatus=302;await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal((await query(sql`SELECT status FROM staff_push_deliveries WHERE event_key='redirect'`))[0].status,'failed');await clear();
    });
    await t.test('disabled staff and changed preferences cancel pending sends',async()=>{
      await db.execute(sql`INSERT INTO staff_push_deliveries(subscription_id,dealer_id,event_key,category,expires_at) VALUES(${subscriptionId}::uuid,'a','disabled','test',now()+interval '1 hour')`);
      await db.execute(sql`UPDATE portal_users SET disabled_at=now() WHERE dealer_id='a' AND auth_user_id='user_a'`);await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal(deliveries.length,0);assert.equal((await query(sql`SELECT status FROM staff_push_deliveries`))[0].status,'cancelled');await db.execute(sql`UPDATE portal_users SET disabled_at=NULL WHERE dealer_id='a' AND auth_user_id='user_a'`);await clear();
      await db.execute(sql`INSERT INTO staff_push_deliveries(subscription_id,dealer_id,event_key,category,expires_at) VALUES(${subscriptionId}::uuid,'a','pref-disabled','enquiries',now()+interval '1 hour')`);await call('PUT','/preferences',{...defaultPushPreferences,enquiries:false});await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal(deliveries.length,0);await call('PUT','/preferences',defaultPushPreferences);await clear();
    });
    await t.test('expired leases recover once and current leases are left alone',async()=>{
      await db.execute(sql`INSERT INTO staff_push_deliveries(subscription_id,dealer_id,event_key,category,expires_at,status,attempts,lease_until) VALUES(${subscriptionId}::uuid,'a','expired-lease','test',now()+interval '1 hour','sending',1,now()-interval '1 minute'),(${subscriptionId}::uuid,'a','current-lease','test',now()+interval '1 hour','sending',1,now()+interval '1 minute')`);
      await Promise.all([runA(()=>processStaffPush(log,sender,{skipEnqueue:true})),runA(()=>processStaffPush(log,sender,{skipEnqueue:true}))]);assert.equal(deliveries.length,1);const rows=await query(sql`SELECT event_key,status,attempts FROM staff_push_deliveries ORDER BY event_key`);assert.equal(rows[0].status,'sending');assert.equal(rows[0].attempts,1);assert.equal(rows[1].status,'sent');assert.equal(rows[1].attempts,2);await clear();
    });
    await t.test('a suspended dealer cannot receive queued device notifications',async()=>{
      await db.execute(sql`INSERT INTO staff_push_deliveries(subscription_id,dealer_id,event_key,category,expires_at) VALUES(${subscriptionId}::uuid,'a','suspended','test',now()+interval '1 hour')`);await db.execute(sql`UPDATE dealerships SET status='suspended' WHERE id='a'`);
      await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal(deliveries.length,0);assert.equal((await query(sql`SELECT status FROM staff_push_deliveries`))[0].status,'cancelled');await db.execute(sql`UPDATE dealerships SET status='active' WHERE id='a'`);await clear();
    });
    await t.test('revoking even the canonical domain prevents further queued notifications',async()=>{
      await db.execute(sql`INSERT INTO staff_push_deliveries(subscription_id,dealer_id,event_key,category,expires_at) VALUES(${subscriptionId}::uuid,'a','canonical-domain-revoked','test',now()+interval '1 hour')`);
      await db.execute(sql`UPDATE dealer_domains SET verified=false WHERE hostname='a.example.test'`);await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal(deliveries.length,0);assert.equal((await query(sql`SELECT status FROM staff_push_deliveries`))[0].status,'cancelled');await db.execute(sql`UPDATE dealer_domains SET verified=true WHERE hostname='a.example.test'`);await clear();
    });
    await t.test('merged records retain their kept appointment and follow-up notifications',async()=>{
      const primary=randomUUID(),child=randomUUID();
      await db.execute(sql`UPDATE staff_push_preferences SET updated_at=now()-interval '2 minutes' WHERE dealer_id='a' AND auth_user_id='user_a'`);
      await db.insert(enquiriesTable).values({id:primary,dealerId:'a',type:'general',customerName:'Private primary',message:'primary'});
      await db.insert(enquiriesTable).values({id:child,dealerId:'a',type:'viewing',customerName:'Private child',message:'kept appointment',mergedIntoId:primary,appointmentAt:new Date(Date.now()+15*60000),appointmentStatus:'confirmed',followUpAt:new Date(Date.now()-1000)});
      await db.insert(enquiryEventsTable).values({dealerId:'a',enquiryId:child,kind:'viewing_booked',summary:'retained appointment'});
      await runA(()=>enqueueStaffPush());const rows=await query(sql`SELECT category,enquiry_id FROM staff_push_deliveries`);assert.deepEqual(rows.map(r=>r.category).sort(),['bookings','followups','reminders']);assert.ok(rows.every(row=>row.enquiry_id===child));
      await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal(deliveries.length,3);
      for(const delivery of deliveries)assert.equal(new URL(delivery.message.url,'https://a.example.test').searchParams.get('enquiryId'),delivery.message.category==='followups'?primary:child);
      await db.execute(sql`UPDATE enquiries SET status='closed' WHERE id=${child}::uuid`);await clear();
    });
    await t.test('shortening the reminder interval defers the same reminder rather than cancelling it permanently',async()=>{
      const id=randomUUID(),at=new Date(Date.now()+20*60000);
      await db.insert(enquiriesTable).values({id,dealerId:'a',type:'viewing',customerName:'Private',message:'reminder preference',appointmentAt:at,appointmentStatus:'confirmed'});
      await runA(()=>enqueueStaffPush());const before=(await query(sql`SELECT * FROM staff_push_deliveries WHERE category='reminders' AND enquiry_id=${id}::uuid`))[0];assert.ok(before);
      await call('PUT','/preferences',{...defaultPushPreferences,reminderMinutes:10});await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal(deliveries.length,0);
      const deferred=(await query(sql`SELECT * FROM staff_push_deliveries WHERE id=${before.id}::uuid`))[0];assert.equal(deferred.status,'pending');assert.equal(deferred.attempts,0);assert.ok(Math.abs(new Date(String(deferred.next_attempt_at)).getTime()-(at.getTime()-10*60000))<1000);
      // Advance the application clock into the ten-minute window, keeping the
      // database eligibility deterministic without waiting twenty minutes.
      const now=Date.now;try {const base=now();Date.now=()=>base+11*60000;await db.execute(sql`UPDATE staff_push_deliveries SET next_attempt_at=now()-interval '1 second' WHERE id=${before.id}::uuid`);await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));}finally{Date.now=now;}
      assert.equal(deliveries.length,1);assert.equal(deliveries[0].message.eventId,String(before.id));await db.execute(sql`UPDATE enquiries SET status='closed' WHERE id=${id}::uuid`);await call('PUT','/preferences',defaultPushPreferences);await clear();
    });
    await t.test('turning reminders back on revives only preference-cancelled future work',async()=>{
      const id=randomUUID();await db.insert(enquiriesTable).values({id,dealerId:'a',type:'viewing',customerName:'Private',message:'toggle reminder',appointmentAt:new Date(Date.now()+15*60000),appointmentStatus:'confirmed'});
      await runA(()=>enqueueStaffPush());await call('PUT','/preferences',{...defaultPushPreferences,reminders:false});await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal(deliveries.length,0);assert.equal((await query(sql`SELECT error_code FROM staff_push_deliveries`))[0].error_code,'preference_disabled');
      await call('PUT','/preferences',defaultPushPreferences);await runA(()=>enqueueStaffPush());await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal(deliveries.length,1);await db.execute(sql`UPDATE enquiries SET status='closed' WHERE id=${id}::uuid`);await clear();
    });
    await t.test('30 to 10 to 30 minute changes bring the same pending reminder forward again',async()=>{
      const id=randomUUID();await db.insert(enquiriesTable).values({id,dealerId:'a',type:'viewing',customerName:'Private',message:'changed reminder',appointmentAt:new Date(Date.now()+25*60000),appointmentStatus:'confirmed'});
      await runA(()=>enqueueStaffPush());const before=(await query(sql`SELECT * FROM staff_push_deliveries WHERE enquiry_id=${id}::uuid`))[0];assert.ok(before);
      await call('PUT','/preferences',{...defaultPushPreferences,reminderMinutes:10});const later=(await query(sql`SELECT * FROM staff_push_deliveries WHERE id=${before.id}::uuid`))[0];assert.ok(new Date(String(later.next_attempt_at)).getTime()>Date.now()+14*60000);
      await call('PUT','/preferences',defaultPushPreferences);const earlier=(await query(sql`SELECT * FROM staff_push_deliveries WHERE id=${before.id}::uuid`))[0];assert.ok(new Date(String(earlier.next_attempt_at)).getTime()<=Date.now()+1000);
      await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal(deliveries.length,1);assert.equal(deliveries[0].message.eventId,String(before.id));await db.execute(sql`UPDATE enquiries SET status='closed' WHERE id=${id}::uuid`);await clear();
    });
    await t.test('changing reminder times preserves real retry backoff and leaves terminal jobs untouched',async()=>{
      const id=randomUUID(),retryAt=new Date(Date.now()+5*60000),finishedAt=new Date(Date.now()-60000);await db.insert(enquiriesTable).values({id,dealerId:'a',type:'viewing',customerName:'Private',message:'retry scheduling',appointmentAt:new Date(Date.now()+25*60000),appointmentStatus:'confirmed'});
      await runA(()=>enqueueStaffPush());const job=(await query(sql`SELECT * FROM staff_push_deliveries WHERE enquiry_id=${id}::uuid`))[0];
      await db.execute(sql`UPDATE staff_push_deliveries SET attempts=1,retry_after=${retryAt},next_attempt_at=${retryAt} WHERE id=${job.id}::uuid`);
      await db.execute(sql`INSERT INTO staff_push_deliveries(subscription_id,dealer_id,event_key,category,enquiry_id,due_at,expires_at,status,next_attempt_at) VALUES(${subscriptionId}::uuid,'a','already-sent','reminders',${id}::uuid,now()+interval '25 minutes',now()+interval '25 minutes','sent',${finishedAt}),(${subscriptionId}::uuid,'a','already-failed','reminders',${id}::uuid,now()+interval '25 minutes',now()+interval '25 minutes','failed',${finishedAt})`);
      await call('PUT','/preferences',{...defaultPushPreferences,reminderMinutes:10});await call('PUT','/preferences',defaultPushPreferences);
      const retry=(await query(sql`SELECT * FROM staff_push_deliveries WHERE id=${job.id}::uuid`))[0];assert.ok(Math.abs(new Date(String(retry.next_attempt_at)).getTime()-retryAt.getTime())<1000);assert.equal(retry.attempts,1);
      const terminal=await query(sql`SELECT status,next_attempt_at FROM staff_push_deliveries WHERE event_key IN ('already-sent','already-failed')`);assert.ok(terminal.every(row=>new Date(String(row.next_attempt_at)).getTime()===finishedAt.getTime()));
      await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal(deliveries.length,0);await db.execute(sql`UPDATE enquiries SET status='closed' WHERE id=${id}::uuid`);await clear();
    });
    await t.test('expired jobs do not send; 410 removes revoked device and its queue',async()=>{
      await db.execute(sql`INSERT INTO staff_push_deliveries(subscription_id,dealer_id,event_key,category,expires_at) VALUES(${subscriptionId}::uuid,'a','expired','test',now()-interval '1 minute')`);await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal(deliveries.length,0);assert.equal((await query(sql`SELECT status FROM staff_push_deliveries`))[0].status,'cancelled');await clear();
      await db.execute(sql`INSERT INTO staff_push_deliveries(subscription_id,dealer_id,event_key,category,expires_at) VALUES(${subscriptionId}::uuid,'a','revoked','test',now()+interval '1 hour')`);providerStatus=410;await runA(()=>processStaffPush(log,sender,{skipEnqueue:true}));assert.equal((await query(sql`SELECT * FROM staff_push_subscriptions WHERE id=${subscriptionId}::uuid`)).length,0);assert.equal((await query(sql`SELECT * FROM staff_push_deliveries`)).length,0);
    });
  }finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await engine.close();}
});
