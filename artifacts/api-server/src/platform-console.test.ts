import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer,request as httpRequest } from 'node:http';
import express from 'express';
import { db,engine,stockImportRunsTable,dealerImportKeysTable,portalUsersTable } from './test/tenant-test-db';
process.env.MULTI_TENANT_ENABLED='true';process.env.PLATFORM_ADMIN_HOST='admin.example.test';process.env.PLATFORM_ADMIN_USER_IDS='user_admin';
test('platform onboarding and operational views preserve access checks and omit secrets',async()=>{
 for(const file of (await readdir('../../lib/db/drizzle')).filter(n=>/^\d+.*\.sql$/.test(n)).sort()) await engine.exec(await readFile(join('../../lib/db/drizzle',file),'utf8'));
 const {default:router}=await import('./routes/platform-dealers'); const {resolveTenant}=await import('./middlewares/tenant');
 const {default:onboardingRouter}=await import('./routes/demo-onboarding');
 const app=express();app.use(express.json());app.use('/api/demo-onboarding',onboardingRouter);app.use('/api/platform',router);app.use(resolveTenant);app.get('/',(_req,res)=>res.send('dealer'));
 const server=createServer(app);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw Error('No server');
 const request=(path:string,method='GET',body?:unknown,user='user_admin',host='admin.example.test',origin?:string,extraHeaders:Record<string,string>={}):Promise<Response>=>new Promise((resolve,reject)=>{const req=httpRequest(`http://127.0.0.1:${address.port}${path}`,{method,headers:{host,'content-type':'application/json','x-test-user':user,...(origin?{origin}:{}),...extraHeaders}},r=>{let s='';r.on('data',c=>s+=c);r.on('end',()=>resolve(new Response(s||null,{status:r.statusCode,headers:{'Content-Type':r.headers['content-type']??'application/json',...(r.headers.location?{location:r.headers.location}:{})}})));});req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();});
 const input={id:'test-dealer',name:'Test Dealer',canonicalOrigin:'https://dealer.example.test',platform:'autotrader',retailerId:'fictional',sourceUrl:'https://www.autotrader.co.uk/fictional',useMyAccount:true};
 try{
  assert.equal((await request('/api/platform/overview','GET',undefined,'user_other')).status,403);
  assert.equal((await request('/api/platform/overview','GET',undefined,'user_admin','other.example.test')).status,403);
  assert.equal((await request('/api/platform/dealers','POST',input,'user_admin','admin.example.test','https://evil.example.test')).status,403);
  const root=await request('/');assert.equal(root.status,302);assert.equal(root.headers.get('location'),'/platform');
  assert.equal((await request('/api/platform/dealers','POST',{...input,canonicalOrigin:'https://admin.example.test'})).status,400);
  assert.equal((await request('/api/platform/dealers','POST',input)).status,201);
  assert.equal((await request('/api/platform/dealers/test-dealer/domains','POST',{hostname:'admin.example.test'})).status,400);
  assert.equal((await db.select().from(portalUsersTable))[0].authUserId,'user_admin');
  assert.equal((await request('/api/platform/dealers','POST',input)).status,409);
  assert.equal((await request('/api/platform/dealers','POST',{...input,id:'bad-source',sourceUrl:'https://evil.example.test'})).status,400);
  assert.equal((await request('/api/platform/dealers','POST',{...input,id:'two-owners',ownerAuthUserId:'user_owner'})).status,400);
  assert.equal((await request('/api/platform/dealers','POST',{...input,id:'email-dealer',canonicalOrigin:'https://email.example.test',useMyAccount:undefined,ownerEmail:'owner@example.test'})).status,201);
  assert.equal((await request('/api/platform/dealers','POST',{...input,id:'missing-owner',canonicalOrigin:'https://missing.example.test',useMyAccount:undefined,ownerEmail:'missing@example.test'})).status,400);
  assert.equal((await request('/api/platform/dealers/test-dealer/status','PUT',{status:'active'})).status,409);
  await db.insert(dealerImportKeysTable).values({dealerId:'test-dealer',secretHash:'never-return-this-hash'});
  for(const [runId,status,time] of [['run-good','completed','2026-10-10T08:00:00Z'],['run-held','quarantined','2026-10-10T20:00:00Z']] as const) await db.insert(stockImportRunsTable).values({runId,status,receivedAt:new Date(time),scrapedAt:new Date(time),dealerId:'test-dealer',source:'grok',retailerId:'fictional',schemaVersion:'1',expectedCount:1,receivedCount:1,rawSnapshot:{secret:'never-return-this-snapshot'}});
  const overview=await request('/api/platform/overview');assert.equal(overview.status,200);const text=await overview.text();assert.ok(!text.includes('never-return'));const data=JSON.parse(text);const dealer=data.dealers.find((d:{id:string})=>d.id==='test-dealer');assert.equal(dealer.latestImport.runId,'run-held');assert.equal(dealer.lastSuccessfulImport.runId,'run-good');assert.equal(dealer.activeKeyCount,1);
  const workspace=await request('/api/platform/dealers/test-dealer/workspace');assert.equal(workspace.status,200);const details=await workspace.text();assert.ok(!details.includes('never-return'));assert.equal(JSON.parse(details).imports.length,2);
  assert.equal((await request('/api/platform/dealers/unknown/workspace')).status,404);
  const checklistPath = '/api/platform/dealers/test-dealer/checklist';
  const item = { itemId: 'https', status: 'done', note: 'Certificate checked' };
  assert.equal((await request(checklistPath, 'PATCH', item, 'user_other')).status,403);
  assert.equal((await request(checklistPath, 'PATCH', { ...item, itemId: 'invented' })).status,400);
  assert.equal((await request(checklistPath, 'PATCH', { ...item, status: 'skipped', note: '' })).status,400);
  assert.equal((await request('/api/platform/dealers/unknown/checklist', 'PATCH', item)).status,404);
  assert.equal((await request(checklistPath, 'PATCH', item)).status,200);
  assert.equal((await request(checklistPath, 'PATCH', { itemId: 'billing', status: 'pending', note: 'Awaiting approval' })).status,200);
  const saved = await (await request('/api/platform/dealers/test-dealer/workspace')).json() as { dealer: { onboardingChecklist: Record<string, { status: string; updatedBy: string; note: string }> } };
  assert.equal(saved.dealer.onboardingChecklist.https.status,'done');
  assert.equal(saved.dealer.onboardingChecklist.https.updatedBy,'user_admin');
  assert.equal(saved.dealer.onboardingChecklist.billing.note,'Awaiting approval');
  const separate = await (await request('/api/platform/dealers/email-dealer/workspace')).json() as { dealer: { onboardingChecklist: Record<string, unknown> } };
  assert.deepEqual(separate.dealer.onboardingChecklist,{});

  // Demo setup is a separate, operator-only workflow. Missing infrastructure fails closed.
  const demoInput={slug:'fictional-motors',name:'Fictional Motors',platform:'autotrader',retailerId:'demo-retailer',sourceUrl:'https://www.autotrader.co.uk/fictional',recipient:'operator@example.test',days:14};
  assert.equal((await request('/api/platform/demos','POST',demoInput)).status,409);
  process.env.DEMO_BASE_DOMAIN='demo.example.test';process.env.DEMO_DOMAINS_READY='true';process.env.DEMO_EMAIL_RECIPIENTS='operator@example.test';
  assert.equal((await request('/api/platform/demos','POST',{...demoInput,recipient:'customer@example.test'})).status,400);
  assert.equal((await request('/api/platform/demos','POST',demoInput,'user_other')).status,403);
  const created=await request('/api/platform/demos','POST',demoInput);assert.equal(created.status,201,await created.clone().text());
  assert.equal(((await created.json()) as {dealerId:string}).dealerId,'demo-fictional-motors');
  assert.equal((await request('/api/platform/demos','POST',demoInput)).status,409);
  assert.equal((await engine.query("SELECT * FROM sale_workspace WHERE dealer_id='demo-fictional-motors'")).rows.length,2);
  const demoPath='/api/platform/dealers/demo-fictional-motors/demo';
  const action={action:'baseline',expectedRevision:0,confirm:'demo-fictional-motors'};
  assert.equal((await request('/api/platform/dealers/test-dealer/demo','POST',{...action,confirm:'test-dealer'})).status,409);
  assert.equal((await request(demoPath,'POST',action)).status,409); // no stock baseline
  await engine.exec("INSERT INTO vehicles (dealer_id,source,advert_id,title,source_price) VALUES ('demo-fictional-motors','grok','demo-advert','Example vehicle',12995)");
  const saveBaseline=await request(demoPath,'POST',action);assert.equal(saveBaseline.status,200,await saveBaseline.clone().text());
  await engine.exec("UPDATE vehicles SET source_price=9999,inventory_status='sold' WHERE dealer_id='demo-fictional-motors'");
  assert.equal((await request(demoPath,'POST',{...action,action:'activity',expectedRevision:0})).status,409);
  const reset=await request(demoPath,'POST',{...action,action:'activity',expectedRevision:1});assert.equal(reset.status,200,await reset.clone().text());
  let car=(await engine.query<Record<string,any>>("SELECT * FROM vehicles WHERE dealer_id='demo-fictional-motors'")).rows[0];assert.equal(car.source_price,9999);assert.equal(car.inventory_status,'reserved');
  const original=await request(demoPath,'POST',{...action,action:'original',expectedRevision:2});assert.equal(original.status,200,await original.clone().text());
  car=(await engine.query<Record<string,any>>("SELECT * FROM vehicles WHERE dealer_id='demo-fictional-motors'")).rows[0];assert.equal(car.source_price,12995);
  assert.equal((await engine.query("SELECT * FROM enquiries WHERE dealer_id='demo-fictional-motors'")).rows.length,3);
  assert.equal((await engine.query("SELECT * FROM dealerships WHERE id='test-dealer'")).rows.length,1);
  const recipientAction={action:'recipient',expectedRevision:3,confirm:'demo-fictional-motors',recipient:'unapproved@example.test'};
  assert.equal((await request(demoPath,'POST',recipientAction)).status,400);
  assert.equal((await request(demoPath,'POST',{...recipientAction,recipient:'operator@example.test',expectedRevision:0})).status,409);
  assert.equal((await request(demoPath,'POST',{...recipientAction,recipient:'operator@example.test'},'user_other')).status,403);
  const baselineBefore=(await engine.query<Record<string,any>>("SELECT baseline FROM dealer_demos WHERE dealer_id='demo-fictional-motors'")).rows[0];
  assert.equal((await request(demoPath,'POST',{...recipientAction,recipient:'OPERATOR@example.test'})).status,200);
  const recipientAfter=(await engine.query<Record<string,any>>("SELECT recipient,revision,baseline FROM dealer_demos WHERE dealer_id='demo-fictional-motors'")).rows[0];
  assert.equal(recipientAfter.recipient,'operator@example.test');assert.equal(recipientAfter.revision,4);assert.deepEqual(recipientAfter.baseline,baselineBefore.baseline);
  const {runWithTenant}=await import('./lib/tenant-context');
  const {sendEmailWithSettings}=await import('./lib/email-provider');
  const tenant={dealerId:'demo-fictional-motors',canonicalOrigin:'https://fictional-motors.demo.example.test',platform:'autotrader' as const,retailerId:'demo-retailer',sourceUrl:demoInput.sourceUrl,demo:true};
  let sends=0;const transport:typeof fetch=async(_url,init)=>{sends++;const body=JSON.parse(String(init?.body));assert.deepEqual(body.to,['operator@example.test']);assert.match(body.subject,/^\[DEMO\]/);assert.match(body.html,/DEMONSTRATION/);assert.match(body.from,/demo-fictional-motors@emails.example.test/);return Response.json({id:'fictional-email'});};
  const message={to:'real-customer@example.test',subject:'Your sample',html:'<p>Sample</p>',idempotencyKey:'fictional-test'};
  const config={enabled:false,apiKey:'',from:'',replyTo:''};
  await assert.rejects(runWithTenant(tenant,()=>sendEmailWithSettings(config,message,transport)),/Demo email is disabled/);assert.equal(sends,0);
  process.env.DEMO_EMAIL_DOMAIN='emails.example.test';process.env.DEMO_RESEND_VERIFIED='true';process.env.DEMO_RESEND_API_KEY='re_fictional_test_only';
  assert.equal(await runWithTenant(tenant,()=>sendEmailWithSettings(config,message,transport)),'fictional-email');assert.equal(sends,1);
  const {assertStripeReady}=await import('./lib/stripe-payments');
  assert.throws(()=>runWithTenant(tenant,()=>assertStripeReady({enabled:true,mode:'live',secretKey:'sk_live_fake',publishableKey:'pk_live_fake',webhookSecret:'whsec_fake'})),/disabled in demonstrations/);
  assert.equal((await request('/api/reservations/checkout','POST',{},'user_admin','fictional-motors.demo.example.test')).status,403);
  const demoPage=await request('/','GET',undefined,'user_admin','fictional-motors.demo.example.test');assert.equal(demoPage.status,200);
  await engine.exec("UPDATE dealer_demos SET expires_at=now()-interval '1 day' WHERE dealer_id='demo-fictional-motors'");
  assert.equal((await request('/','GET',undefined,'user_admin','fictional-motors.demo.example.test')).status,410);

  // The machine credential is separate from both Clerk administration and stock delivery.
  process.env.STOCK_IMPORT_API_HOST='imports.example.test';process.env.INTEGRATIONS_ENCRYPTION_KEY='33'.repeat(32);
  const issued=await request('/api/platform/onboarding-keys','POST',{label:'Fictional Master Bot',days:30,maxDemos:2,maxPerDay:1});
  assert.equal(issued.status,201);const onboarding=await issued.json() as {id:string;secret:string};
  const machine=(path:string,method='GET',body?:unknown,token=onboarding.secret,host='imports.example.test',origin?:string)=>request('/api/demo-onboarding'+path,method,body,'',host,origin,{'x-demo-onboarding-secret':token});
  assert.equal((await machine('/capabilities','GET',undefined,'wrong')).status,401);
  assert.equal((await machine('/capabilities','GET',undefined,onboarding.secret,'wrong.example.test')).status,421);
  assert.equal((await machine('/capabilities','GET',undefined,onboarding.secret,'imports.example.test','https://evil.example.test')).status,403);
  assert.equal((await machine('/capabilities')).status,200);
  assert.equal((await machine('/demos','POST',{requestId:'33333333-3333-4333-8333-333333333333'})).status,400);
  const job={requestId:'33333333-3333-4333-8333-333333333333',demo:{slug:'bot-example',name:'Bot Example',platform:'autotrader',retailerId:'fictional-ref',sourceUrl:'https://www.autotrader.co.uk/fictional',logoData:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII='}};
  assert.equal((await machine('/demos','POST',{...job,demo:{...job.demo,logoData:'data:image/svg+xml;base64,PHN2Zz4='}})).status,400);
  Object.assign(job.demo,{footerLogoData:job.demo.logoData});
  const sent=await machine('/demos','POST',job);assert.equal(sent.status,201,await sent.clone().text());
  const receipt=await sent.json() as {dealerId:string;origin:string;status:string};
  assert.deepEqual(receipt,{dealerId:'demo-bot-example',origin:'https://bot-example.demo.example.test',status:'created'});
  assert.equal((await engine.query("SELECT * FROM dealer_import_keys WHERE dealer_id='demo-bot-example'")).rows.length,0);
  assert.equal((await engine.query<Record<string,any>>("SELECT logo_data FROM dealer_demos WHERE dealer_id='demo-bot-example'")).rows[0].logo_data,job.demo.logoData);
  assert.equal((await engine.query<Record<string,any>>("SELECT footer_logo_data FROM dealer_demos WHERE dealer_id='demo-bot-example'")).rows[0].footer_logo_data,job.demo.logoData);
  assert.equal((await request('/api/demo-logo?variant=footer','GET',undefined,'','bot-example.demo.example.test')).status,200);
  assert.equal((await request('/api/demo-logo?variant=footer','GET',undefined,'','dealer.example.test')).status,421);
  // A historical receipt containing a credential must never be exposed on replay.
  await engine.query("UPDATE demo_onboarding_requests SET sealed_response=$1::jsonb WHERE dealer_id='demo-bot-example'",[JSON.stringify({stockImport:{secret:'historical-secret'}})]);
  const repeated=await machine('/demos','POST',job);assert.equal(repeated.status,200);
  assert.deepEqual(await repeated.json(),{...receipt,status:'replayed'});
  assert.equal((await machine('/demos','POST',{...job,demo:{...job.demo,name:'Changed'}})).status,409);
  assert.equal((await machine('/demos/demo-bot-example')).status,200);
  assert.equal((await machine('/demos/test-dealer')).status,404);
  assert.equal((await machine('/demos/demo-fictional-motors')).status,404);
  assert.equal((await machine('/demos/demo-bot-example','DELETE')).status,404);
  assert.equal((await machine('/demos/demo-bot-example/reset','POST',{})).status,404);
  assert.equal((await request('/api/platform/overview','GET',undefined,'','admin.example.test',undefined,{'x-demo-onboarding-secret':onboarding.secret})).status,403);
  assert.equal((await machine('/demos','POST',{...job,requestId:'44444444-4444-4444-8444-444444444444',demo:{...job.demo,slug:'another-demo'}})).status,429);
  // Completion cannot send arbitrary mail, affect another key's demo, or replace a baseline.
  const emailPath='/demos/demo-bot-example/test-email',baselinePath='/demos/demo-bot-example/baseline';
  const completeRun='66666666-6666-4666-8666-666666666666';
  const completionBody={runId:completeRun,confirm:'demo-bot-example'};
  assert.equal((await machine(emailPath,'POST',{subject:'arbitrary'})).status,400);
  assert.equal((await machine('/demos/test-dealer/test-email','POST',{})).status,404);
  assert.equal((await machine(emailPath,'POST',{})).status,409); // no stock yet
  await engine.exec("INSERT INTO vehicles (dealer_id,source,advert_id,title,source_price) VALUES ('demo-bot-example','grok','fictional-one','Fictional car',10000)");
  await db.insert(stockImportRunsTable).values({runId:completeRun,status:'completed',receivedAt:new Date(),scrapedAt:new Date(),dealerId:'demo-bot-example',source:'grok',retailerId:'fictional-ref',schemaVersion:'1',expectedCount:1,receivedCount:1,rawSnapshot:{}});
  assert.equal((await machine(baselinePath,'POST',completionBody)).status,409); // delivery not confirmed
  const originalFetch=globalThis.fetch;let emailSends=0,statusReads=0,providerEvent='sent',providerDenied=false,providerUnavailable=false;
  globalThis.fetch=async(url,init)=>{
   assert.equal(init?.redirect,'error');
   if(init?.method==='POST'){emailSends++;const payload=JSON.parse(String(init.body));assert.deepEqual(payload.to,['operator@example.test']);assert.match(payload.subject,/^\[DEMO\]/);assert.equal(init.headers && (init.headers as Record<string,string>)['Idempotency-Key'],'demo-onboarding-test/demo-bot-example');if(providerUnavailable)throw Error('Timed out after provider accept');return Response.json({id:'fixed-provider-id'});}
   statusReads++;assert.equal(String(url),'https://api.resend.com/emails/fixed-provider-id');if(providerDenied)return Response.json({error:'denied'},{status:403});return Response.json({id:'fixed-provider-id',to:['operator@example.test'],last_event:providerEvent});
  };
  try{
   providerUnavailable=true;assert.equal((await machine(emailPath,'POST',{})).status,503);providerUnavailable=false;
   assert.equal((await machine(emailPath,'POST',{})).status,200); // same idempotency key after ambiguous timeout
   assert.equal((await machine(emailPath,'POST',{})).status,200);assert.equal(emailSends,2);
   providerDenied=true;assert.equal((await machine(emailPath)).status,503);providerDenied=false;
   assert.equal(((await (await machine(emailPath)).json()) as any).status,'pending');
   assert.equal((await machine(baselinePath,'POST',completionBody)).status,409);
   providerEvent='bounced';await engine.exec("UPDATE demo_onboarding_completion SET checked_at=now()-interval '2 minutes' WHERE dealer_id='demo-bot-example'");
   assert.equal(((await (await machine(emailPath)).json()) as any).status,'failed');
   assert.equal((await machine(baselinePath,'POST',completionBody)).status,409);
   providerEvent='delivered';await engine.exec("UPDATE demo_onboarding_completion SET checked_at=now()-interval '2 minutes' WHERE dealer_id='demo-bot-example'");
   assert.equal(((await (await machine(emailPath)).json()) as any).status,'delivered');
   assert.equal((await machine(baselinePath,'POST',{...completionBody,runId:'77777777-7777-4777-8777-777777777777'})).status,409);
   assert.equal((await machine(baselinePath,'POST',completionBody)).status,200);
   const baselineState=(await engine.query<Record<string,any>>("SELECT baseline FROM dealer_demos WHERE dealer_id='demo-bot-example'")).rows[0].baseline;
   await engine.exec("UPDATE enquiries SET message='Practice edit must survive retry' WHERE dealer_id='demo-bot-example'");
   assert.equal(((await (await machine(baselinePath,'POST',completionBody)).json()) as any).status,'replayed');
   assert.equal((await engine.query("SELECT * FROM enquiries WHERE dealer_id='demo-bot-example' AND message='Practice edit must survive retry'")).rows.length,3);
   assert.deepEqual((await engine.query<Record<string,any>>("SELECT baseline FROM dealer_demos WHERE dealer_id='demo-bot-example'")).rows[0].baseline,baselineState);
   assert.equal(emailSends,2);assert.equal(statusReads,4);
  }finally{globalThis.fetch=originalFetch;}
  const keyList=await request('/api/platform/onboarding-keys');assert.ok(!(await keyList.text()).includes(onboarding.secret));

  const secondIssued=await request('/api/platform/onboarding-keys','POST',{label:'Rollback test',maxDemos:2,maxPerDay:2});const second=await secondIssued.json() as {secret:string};
  const rollbackJob={...job,requestId:'55555555-5555-4555-8555-555555555555',demo:{...job.demo,slug:'rollback-demo'}};
  delete process.env.INTEGRATIONS_ENCRYPTION_KEY;
  // Creation no longer needs encryption configuration because it creates no secrets.
  assert.equal((await machine('/demos','POST',rollbackJob,second.secret)).status,201);
  assert.equal((await engine.query("SELECT * FROM dealer_import_keys WHERE dealer_id='demo-rollback-demo'")).rows.length,0);
  assert.equal((await machine('/demos/demo-bot-example','GET',undefined,second.secret)).status,404);
  assert.equal((await machine(emailPath,'POST',{},second.secret)).status,404);
  assert.equal((await machine(baselinePath,'POST',completionBody,second.secret)).status,404);
  const originalKeys=(await engine.query("SELECT * FROM dealer_import_keys WHERE dealer_id='test-dealer'")).rows.length;
  assert.equal((await request('/api/platform/onboarding-keys/'+onboarding.id,'DELETE')).status,200);
  assert.equal((await machine('/capabilities')).status,401);
  assert.equal((await engine.query("SELECT * FROM dealer_import_keys WHERE dealer_id='test-dealer'")).rows.length,originalKeys);
  assert.equal((await engine.query("SELECT * FROM dealer_import_keys WHERE dealer_id='demo-bot-example' AND disabled_at IS NULL")).rows.length,0);

 }finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));await engine.close();}
});
