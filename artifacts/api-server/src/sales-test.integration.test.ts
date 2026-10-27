import './test/setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import express from 'express';
const { pool } = await import('@workspace/db');
const { runWithTenant } = await import('./lib/tenant-context');
const { default: router } = await import('./routes/sales-test');
process.env.MULTI_TENANT_ENABLED = 'false';
const app=express();app.use(express.json());
app.use((req,_res,next)=>{
  req.log={error(){},warn(){},info(){}} as any;
  req.staff={authUserId:String(req.headers['x-user']||'owner-a'),name:'Isolated QA Staff',email:null,role:(req.headers['x-role'] as any)||'owner'};
  runWithTenant({dealerId:String(req.headers['x-dealer']||'protected-dealer'),canonicalOrigin:'http://127.0.0.1',platform:'cazoo',retailerId:'fixture',sourceUrl:'https://example.test',kind:'website'},next);
});
app.use('/api',router);
const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${(server.address() as any).port}/api`;
const fixtureCar='11111111-1111-4111-8111-111111111111',fixtureCustomer='22222222-2222-4222-8222-222222222222';
const ensureFixture=async()=>{await pool.query(`INSERT INTO vehicles(id,dealer_id,source,advert_id,title,registration,source_price) VALUES($1,'protected-dealer','fixture','fixture-car','[TEST] Example Car','TEST 01',1000) ON CONFLICT(id) DO NOTHING`,[fixtureCar]);await pool.query(`INSERT INTO customers(id,dealer_id,name,phone,email) VALUES($1,'protected-dealer','[TEST] Example Buyer','07700900123','') ON CONFLICT(id) DO NOTHING`,[fixtureCustomer]);};
await ensureFixture();
const call=async(path:string,method='GET',body?:unknown,headers:Record<string,string>={})=>{
  if(path==='/sales-test/sessions'&&method==='POST'&&body&&Object.keys(body as object).length===0){await ensureFixture();body={vehicleId:fixtureCar,customerEnquiryId:fixtureCustomer,customerSource:'customer'};}
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const type=response.headers.get('content-type')||''; const data: any = type.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()); return {status:response.status,data,headers:response.headers};
};
const draft=(id:string)=>({id:'',customer:'[TEST] Example Buyer',email:'',phone:'07700900123',address:'1 Example Road, Test Town, TE1 1ST',vehicleId:id,vehicle:'[TEST] Example Car',registration:'TEST 01',price:'1000',partExchange:false,pxRegistration:'',pxDescription:'',pxValue:'',deposit:'',paymentMethod:'',notes:'TEST ONLY',collection:'',preparation:false,documents:false,handover:false});
const path='/sales-test/sessions';
const mutation=(extra:Record<string,unknown>={})=>({requestId:randomUUID(),...extra});
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
test('isolated test session exercises sale engine and cannot affect real data or send messages',async()=>{
  const realVehicle=randomUUID(),realSale=randomUUID();
  await pool.query("INSERT INTO vehicles(id,dealer_id,source,advert_id,title,source_price) VALUES($1,'protected-dealer','real-fixture','real-fixture','Protected real vehicle',3000)",[realVehicle]);
  await pool.query("INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES($1,'protected-dealer','REAL-PROTECTED',1,$2::jsonb)",[realSale,JSON.stringify({id:realSale,draft:{customer:'Protected real customer'},payments:[{amount:'100'}],documents:[{number:'REAL-INV'}]})]);
  await pool.query("INSERT INTO sale_workspace_counters(dealer_id,numbers) VALUES('protected-dealer','{\"invoice-2026\":9}')");
  const protectedState=async()=>JSON.stringify((await pool.query("SELECT (SELECT jsonb_agg(to_jsonb(v)) FROM vehicles v WHERE dealer_id='protected-dealer') v,(SELECT jsonb_agg(to_jsonb(s)) FROM sale_workspace s WHERE dealer_id='protected-dealer') s,(SELECT numbers FROM sale_workspace_counters WHERE dealer_id='protected-dealer') counters")).rows);
  const before=await protectedState();
  const forbidden=await call(path,'POST',{}, {'x-role':'accounts'});assert.equal(forbidden.status,403);
  assert.equal((await call(path,'POST',{}, {'origin':'https://other.example.test'})).status,403);
  const created=await call(path,'POST',{});assert.equal(created.status,201,JSON.stringify(created.data));const s=created.data;assert.equal(s.vehicle.title,'[TEST] Example Car');
  const scoped=`${path}/${s.sessionId}`, work=`${scoped}/sale-workspace`;
  const originalSettings=JSON.stringify((await pool.query("SELECT * FROM dealer_settings WHERE dealer_id='protected-dealer'")).rows);
  const isolatedSettings=await call(`${scoped}/settings`);assert.equal(isolatedSettings.status,200,JSON.stringify(isolatedSettings.data));
  const nextSettings=structuredClone(isolatedSettings.data.config);nextSettings.testDriveBooking.enabled=false;
  assert.equal((await call(`${scoped}/settings`,'PATCH',{group:'bookings',config:nextSettings,expectedRevision:isolatedSettings.data.revision},{'x-role':'salesperson'})).status,403);
  const savedSettings=await call(`${scoped}/settings`,'PATCH',{group:'bookings',config:nextSettings,expectedRevision:isolatedSettings.data.revision});assert.equal(savedSettings.status,200,JSON.stringify(savedSettings.data));assert.equal(savedSettings.data.config.testDriveBooking.enabled,false);
  assert.equal((await call(`${scoped}/settings`,'PATCH',{group:'bookings',config:nextSettings,expectedRevision:isolatedSettings.data.revision})).status,409);
  assert.equal((await call(`${scoped}/settings`,'GET',undefined,{'x-dealer':'other-dealer'})).status,404);
  assert.equal(JSON.stringify((await pool.query("SELECT * FROM dealer_settings WHERE dealer_id='protected-dealer'")).rows),originalSettings);
  const privateBefore=JSON.stringify((await pool.query("SELECT * FROM dealer_private_settings WHERE dealer_id='protected-dealer'")).rows);
  const templates=await call(`${scoped}/email-templates`);assert.equal(templates.status,200,JSON.stringify(templates.data));const template=templates.data.templates[0];
  const editedTemplate={id:template.id,expectedRevision:templates.data.revision,subject:'A test subject',body:'Hello {{customer_name}}',headline:''};
  assert.equal((await call(`${scoped}/email-templates`,'PUT',editedTemplate,{'x-role':'salesperson'})).status,403);
  const templateResult=await call(`${scoped}/email-templates`,'PUT',editedTemplate);assert.equal(templateResult.status,200,JSON.stringify(templateResult.data));assert.equal(templateResult.data.templates.find((item:any)=>item.id===template.id).subject,'A test subject');
  assert.equal((await call(`${scoped}/email-templates`,'PUT',editedTemplate)).status,409);
  assert.equal((await call(`${scoped}/email-templates`,'GET',undefined,{'x-user':'someone-else'})).status,404);
  const paperwork=await call(`${scoped}/paperwork`);assert.equal(paperwork.status,200,JSON.stringify(paperwork.data));
  const editedPaperwork={expectedRevision:paperwork.data.revision,saleTerms:'Test sale terms',reservationTerms:'Test deposit terms',invoiceSettings:paperwork.data.invoiceSettings,correctionSettings:paperwork.data.correctionSettings};
  assert.equal((await call(`${scoped}/paperwork`,'PUT',editedPaperwork,{'x-role':'salesperson'})).status,403);
  const savedPaperwork=await call(`${scoped}/paperwork`,'PUT',editedPaperwork);assert.equal(savedPaperwork.status,200,JSON.stringify(savedPaperwork.data));assert.equal(savedPaperwork.data.saleTerms,'Test sale terms');
  assert.equal((await call(`${scoped}/paperwork`,'PUT',editedPaperwork)).status,409);
  assert.equal(JSON.stringify((await pool.query("SELECT * FROM dealer_private_settings WHERE dealer_id='protected-dealer'")).rows),privateBefore);
  const realStaff=randomUUID();await pool.query("INSERT INTO portal_users(id,dealer_id,auth_user_id,email,name,role) VALUES($1,'protected-dealer','fixture-owner-test-team','owner@example.test','Owner','owner')",[realStaff]);
  const teamBefore=JSON.stringify((await pool.query("SELECT * FROM portal_users WHERE dealer_id='protected-dealer'")).rows), invitesBefore=JSON.stringify((await pool.query("SELECT * FROM account_invitations WHERE dealer_id='protected-dealer'")).rows);
  const team=await call(`${scoped}/team`);assert.equal(team.status,200,JSON.stringify(team.data));const owner=team.data.members.find((m:any)=>m.email==='owner@example.test');assert.ok(owner);assert.notEqual(owner.id,realStaff);
  assert.equal((await call(`${scoped}/team`,'PATCH',{id:owner.id,active:false,expectedRevision:team.data.revision})).status,409);
  assert.equal((await call(`${scoped}/team`,'POST',{email:'staff@example.test',role:'salesperson',expectedRevision:team.data.revision},{'x-role':'salesperson'})).status,403);
  const practice=await call(`${scoped}/team`,'POST',{email:'staff@example.test',role:'salesperson',expectedRevision:team.data.revision});assert.equal(practice.status,200,JSON.stringify(practice.data));assert.equal(practice.data.members.find((m:any)=>m.email==='staff@example.test').invited,true);
  assert.equal((await call(`${scoped}/team`,'POST',{email:'other@example.test',role:'accounts',expectedRevision:team.data.revision})).status,409);
  assert.equal((await call(`${scoped}/team`,'GET',undefined,{'x-user':'other-user'})).status,404);
  assert.equal(JSON.stringify((await pool.query("SELECT * FROM portal_users WHERE dealer_id='protected-dealer'")).rows),teamBefore);assert.equal(JSON.stringify((await pool.query("SELECT * FROM account_invitations WHERE dealer_id='protected-dealer'")).rows),invitesBefore);
  await pool.query('DELETE FROM portal_users WHERE id=$1',[realStaff]);
  const testReport=await call(`${scoped}/reports?period=30d`);assert.equal(testReport.status,200,JSON.stringify(testReport.data));assert.equal(testReport.data.enquiries.received,0);assert.equal(testReport.data.sales.completed,0);
  assert.equal((await call(`${scoped}/stock`)).data.cars[0].inventoryStatus,'available');
  for(const headers of [{'x-dealer':'other-dealer'},{'x-user':'other-user'}] as Record<string,string>[]) {assert.equal((await call(scoped,'GET',undefined,headers)).status,404);assert.equal((await call(scoped,'DELETE',{},headers)).status,404);}
  const evilDrafts=[{...draft(s.vehicle.id),vehicleId:realVehicle},{...draft(s.vehicle.id),sourceEnquiryId:randomUUID()},{...draft(s.vehicle.id),sourceReservationId:randomUUID()},{...draft(s.vehicle.id),email:'real@example.com'},{...draft(s.vehicle.id),customer:'A real person'}];
  for(const evil of evilDrafts)assert.equal((await call(work,'POST',mutation({draft:evil}))).status,400);
  let result=await call(work,'POST',mutation({draft:draft(s.vehicle.id)}));assert.equal(result.status,201,JSON.stringify(result.data));let sale=result.data.sale;
  const doAction=async(name:string,body:Record<string,unknown>)=>{const r=await call(`${work}/${sale.id}/${name}`,'POST',mutation({expectedRevision:sale.revision,...body}));assert.equal(r.status,200,JSON.stringify(r.data));sale=r.data.sale;return r.data;};
  const cross=await call(`${work}/${sale.id}`,'GET',undefined,{'x-dealer':'other-dealer'});assert.equal(cross.status,404);
  assert.equal((await call(`${work}/${sale.id}`,'PUT',mutation({expectedRevision:sale.revision,draft:{...sale.draft,vehicleId:realVehicle}}))).status,400);
  assert.equal((await call(`${work}/${sale.id}/email`,'POST',mutation())).status,404);
  assert.equal((await call(`${work}/${sale.id}/constructor`,'POST',mutation())).status,404);
  assert.equal((await call(`${work}/${sale.id}/documents/${randomUUID()}/email`,'POST',mutation())).status,404);
  await doAction('invoice-payments',{payment:{amount:'100',method:'Bank transfer',date,reference:'TEST-DEPOSIT',kind:'deposit',status:'confirmed'}});
  assert.equal((await call(`${scoped}/stock`)).data.cars[0].inventoryStatus,'reserved');
  const dep=await doAction('issue-invoice',{kind:'deposit',acknowledge:true});assert.match(dep.document.number,/TEST/);assert.equal(dep.document.verification,undefined);assert.equal(dep.document.content,'Test deposit terms');
  const pdf=await call(`${work}/${sale.id}/documents/${dep.document.id}/pdf`);assert.equal(pdf.status,200);assert.equal(pdf.data.subarray(0,4).toString(),'%PDF');if(process.env.SALES_TEST_PDF_PATH)await writeFile(process.env.SALES_TEST_PDF_PATH,pdf.data);
  const depositSnapshot=dep.document;
  const originalPayment = sale.payments[0];
  const refundPath=`payments/${originalPayment.id}/reverse`;
  assert.equal((await call(`${work}/${sale.id}/${refundPath}`,'POST',mutation({expectedRevision:sale.revision,amount:'20',kind:'refund',reason:'Test refund',date,method:'Cash'}),{'x-role':'salesperson'})).status,403);
  assert.equal((await call(`${work}/${sale.id}/${refundPath}`,'POST',mutation({expectedRevision:sale.revision,amount:'20',kind:'refund',reason:'Test refund',date,method:'Cash'}),{'x-user':'other-user'})).status,404);
  await doAction(refundPath,{amount:'20',kind:'refund',reason:'Test refund',date,method:'Cash',invoiceOnly:true});
  assert.equal(sale.payments[1].signedAmountPence,-2000);assert.equal(sale.payments[1].method,'Cash');assert.deepEqual(sale.payments[0],originalPayment);assert.deepEqual(sale.documents[0],depositSnapshot);
  assert.equal((await call(`${work}/${sale.id}/${refundPath}`,'POST',mutation({expectedRevision:sale.revision,amount:'81',kind:'refund',reason:'Too much',date,method:'Cash'}))).status,422);
  await doAction('invoice-payments',{payment:{amount:'920',method:'Bank transfer',date,reference:'TEST-FINAL',kind:'final-payment',status:'confirmed'}});
  await doAction('issue-invoice',{kind:'full',acknowledge:true});assert.deepEqual(sale.documents[0],depositSnapshot);
  await doAction('fulfilment',{fulfilment:{method:'collection',viewed:'viewed',address:'',recipient:s.customer.name,phone:s.customer.phone,scheduledDate:date,timeWindow:'10:00',instructions:''}});
  await doAction('finish-invoice-sale',{acknowledge:true});await doAction('handover',{recipient:s.customer.name});
  assert.equal((await call(`${scoped}/stock`)).data.cars[0].inventoryStatus,'sold');
  assert.equal(sale.payments.length,3);assert.equal(sale.lifecycle.status,'sold');assert.ok(sale.draft.fulfilment.completedAt);
  const beforeCorrection=structuredClone(sale),correctionPath=`${work}/${sale.id}/corrections`;
  const correctionRequest=mutation({expectedRevision:sale.revision,description:'Accountant will review the price adjustment',reference:'TEST-ACCOUNTANT-1'});
  assert.equal((await call(correctionPath,'POST',correctionRequest,{'x-role':'accounts'})).status,403);
  assert.equal((await call(correctionPath,'POST',correctionRequest,{'x-user':'other-user'})).status,404);
  const correction=await call(correctionPath,'POST',correctionRequest);assert.equal(correction.status,200,JSON.stringify(correction.data));sale=correction.data.sale;
  assert.equal(sale.corrections.length,1);assert.equal(sale.corrections[0].reference,'TEST-ACCOUNTANT-1');
  assert.deepEqual(sale.draft,beforeCorrection.draft);assert.deepEqual(sale.documents,beforeCorrection.documents);assert.deepEqual(sale.payments,beforeCorrection.payments);
  const replay=await call(correctionPath,'POST',correctionRequest);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.equal(replay.data.sale.corrections.length,1);
  assert.equal((await call(correctionPath,'POST',{...correctionRequest,description:'Different'})).status,409);
  assert.equal((await call(`${work}/${sale.id}`)).data.sale.corrections[0].description,'Accountant will review the price adjustment');
  const afterPdf=await call(`${work}/${sale.id}/documents/${dep.document.id}/pdf`);assert.deepEqual(afterPdf.data,pdf.data);
  assert.equal(await protectedState(),before);
  const cleaned=await call(scoped,'DELETE',{});assert.equal(cleaned.status,200,JSON.stringify(cleaned.data));
  assert.equal((await call(work,'POST',mutation({draft:draft(s.vehicle.id)}))).status,404);
  assert.equal((await call(`${work}/${sale.id}`)).status,404);assert.equal(await protectedState(),before);
  await pool.query("DELETE FROM sale_workspace WHERE dealer_id='protected-dealer'");await pool.query("DELETE FROM sale_workspace_counters WHERE dealer_id='protected-dealer'");await pool.query("DELETE FROM vehicles WHERE dealer_id='protected-dealer'");
});

test('a test-only contact can start a session without creating a real customer',async()=>{
  await ensureFixture();const before=JSON.stringify((await pool.query("SELECT * FROM customers WHERE dealer_id='protected-dealer' ORDER BY id")).rows);
  const body={vehicleId:fixtureCar,customerSource:'test',testCustomer:{name:'Practice Buyer',phone:'',email:''}},headers={'x-user':'practice-contact'};
  assert.equal((await call(path,'POST',{...body,testCustomer:{name:'',phone:'',email:''}},headers)).status,400);
  assert.equal((await call(path,'POST',{...body,testCustomer:{name:'Practice Buyer',phone:'',email:'invalid'}},headers)).status,400);
  const created=await call(path,'POST',body,headers);assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.customer.name,'Practice Buyer');
  assert.equal(JSON.stringify((await pool.query("SELECT * FROM customers WHERE dealer_id='protected-dealer' ORDER BY id")).rows),before);
  assert.equal((await call(`${path}/${created.data.sessionId}`,'DELETE',{},headers)).status,200);
  assert.equal(JSON.stringify((await pool.query("SELECT * FROM customers WHERE dealer_id='protected-dealer' ORDER BY id")).rows),before);
});
test('refunding a fictional deposit does not release stock until staff explicitly release it',async()=>{
  const created=await call(path,'POST',{}, {'x-user':'refund-user'});assert.equal(created.status,201);const s=created.data,scope=`${path}/${s.sessionId}`,work=`${scope}/sale-workspace`,headers={'x-user':'refund-user'};
  let r=await call(work,'POST',mutation({draft:draft(s.vehicle.id)}),headers);assert.equal(r.status,201);let sale=r.data.sale;
  const act=async(name:string,body:Record<string,unknown>)=>{const next=await call(`${work}/${sale.id}/${name}`,'POST',mutation({expectedRevision:sale.revision,...body}),headers);assert.equal(next.status,200,JSON.stringify(next.data));sale=next.data.sale;return next.data;};
  await act('invoice-payments',{payment:{amount:'100',method:'Bank transfer',date,reference:'TEST',kind:'deposit',status:'confirmed'}});
  const original=structuredClone(sale.payments[0]);const invoice=(await act('issue-invoice',{kind:'deposit',acknowledge:true})).document;
  await act('corrections',{description:'Accountant reviewing deposit invoice',reference:'TEST-PAPER-1'});
  assert.equal(sale.corrections.length,1);assert.deepEqual(sale.documents[0],invoice);
  assert.equal((await call(`${work}/${sale.id}/lifecycle`,'POST',mutation({expectedRevision:sale.revision,status:'released'}),headers)).status,409);
  await act(`payments/${original.id}/reverse`,{amount:'100',kind:'refund',reason:'Customer changed mind',date,method:'Bank transfer',invoiceOnly:true});
  assert.equal((await call(`${scope}/stock`,'GET',undefined,headers)).data.cars[0].inventoryStatus,'reserved');
  assert.deepEqual(sale.payments[0],original);assert.deepEqual(sale.documents[0],invoice);
  await act('lifecycle',{status:'released'});
  assert.equal((await call(`${scope}/stock`,'GET',undefined,headers)).data.cars[0].inventoryStatus,'available');
  assert.equal(sale.lifecycle.status,'released');assert.deepEqual(sale.documents[0],invoice);
  const releasedSnapshot=structuredClone(sale);
  await act('corrections',{description:'Accountant reviewed released reservation',reference:''});
  assert.equal(sale.corrections.length,2);assert.deepEqual(sale.draft,releasedSnapshot.draft);assert.deepEqual(sale.payments,releasedSnapshot.payments);assert.deepEqual(sale.documents,releasedSnapshot.documents);assert.deepEqual(sale.lifecycle,releasedSnapshot.lifecycle);
  for(const [endpoint,body] of [
    ['invoice-payments',{payment:{amount:'100',method:'Bank transfer',date,kind:'part-payment',status:'confirmed'}}],
    ['issue-invoice',{kind:'full',acknowledge:true}],
    ['finish-invoice-sale',{acknowledge:true,acknowledgeOutstanding:true}],
    ['handover',{recipient:s.customer.name,acknowledgeOutstanding:true}],
  ] as const) assert.equal((await call(`${work}/${sale.id}/${endpoint}`,'POST',mutation({expectedRevision:sale.revision,...body}),headers)).status,409);
  assert.equal((await call(`${scope}/stock`,'GET',undefined,headers)).data.cars[0].inventoryStatus,'available');
  assert.equal((await call(scope,'DELETE',{},headers)).status,200);
});

test('expiry fails closed and cleanup waiting on same advisory lock prevents stale replay',async()=>{
  let created=await call(path,'POST',{}, {'x-user':'race-user'});assert.equal(created.status,201);const s=created.data,scope=`${path}/${s.sessionId}`,work=`${scope}/sale-workspace`;
  await pool.query('UPDATE sales_test_sessions SET expires_at=now()-interval \'1 minute\' WHERE id=$1',[s.sessionId]);
  assert.equal((await call(work,'POST',mutation({draft:draft(s.vehicle.id)}),{'x-user':'race-user'})).status,410);
  assert.equal((await call(scope,'DELETE',{}, {'x-user':'race-user'})).status,200);
  created=await call(path,'POST',{}, {'x-user':'race-user'});assert.equal(created.status,201);const fresh=created.data,freshScope=`${path}/${fresh.sessionId}`,freshWork=`${freshScope}/sale-workspace`;
  const row=(await pool.query('SELECT sandbox_dealer_id FROM sales_test_sessions WHERE id=$1',[fresh.sessionId])).rows[0];
  const blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`sale-workspace:${row.sandbox_dealer_id}`]);
  // Queue cleanup first, then a write which passed the preliminary lookup.
  const cleanup=call(freshScope,'DELETE',{}, {'x-user':'race-user'});await new Promise(resolve=>setTimeout(resolve,150));
  const stale=call(freshWork,'POST',mutation({draft:draft(fresh.vehicle.id)}), {'x-user':'race-user'});await new Promise(resolve=>setTimeout(resolve,150));
  await blocker.query('COMMIT');blocker.release();
  assert.equal((await cleanup).status,200);assert.equal((await stale).status,404);
  assert.equal((await pool.query('SELECT 1 FROM sale_workspace WHERE dealer_id=$1',[row.sandbox_dealer_id])).rowCount,0);
  assert.equal((await pool.query('SELECT 1 FROM vehicles WHERE dealer_id=$1',[row.sandbox_dealer_id])).rowCount,0);
});

test('cleanup refuses foreign rows or a dealership namespace collision',async()=>{
  const created=await call(path,'POST',{}, {'x-user':'cleanup-user'});assert.equal(created.status,201);const s=created.data,scope=`${path}/${s.sessionId}`,work=`${scope}/sale-workspace`;
  const namespace=(await pool.query('SELECT sandbox_dealer_id FROM sales_test_sessions WHERE id=$1',[s.sessionId])).rows[0].sandbox_dealer_id;
  const extra=randomUUID();await pool.query("INSERT INTO vehicles(id,dealer_id,source,advert_id,title) VALUES($1,$2,'other','other','Foreign')",[extra,namespace]);
  assert.equal((await call(scope,'DELETE',{}, {'x-user':'cleanup-user'})).status,409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM vehicles WHERE dealer_id=$1',[namespace])).rows[0].n,2);
  await pool.query('DELETE FROM vehicles WHERE id=$1',[extra]);
  const unrelated=randomUUID();await pool.query("INSERT INTO enquiries(id,dealer_id,type,customer_name,message) VALUES($1,$2,'general','Unrelated','Keep')",[unrelated,namespace]);
  assert.equal((await call(scope,'DELETE',{}, {'x-user':'cleanup-user'})).status,409);
  assert.equal((await pool.query('SELECT 1 FROM enquiries WHERE id=$1',[unrelated])).rowCount,1);
  await pool.query('DELETE FROM enquiries WHERE id=$1',[unrelated]);
  await pool.query("INSERT INTO dealerships(id,name,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,'Collision','https://collision.example.test','cazoo','fictional','https://example.test')",[namespace]);
  assert.equal((await call(scope,'GET',undefined, {'x-user':'cleanup-user'})).status,409);
  assert.equal((await call(work,'POST',mutation({draft:draft(s.vehicle.id)}), {'x-user':'cleanup-user'})).status,409);
  assert.equal((await call(scope,'DELETE',{}, {'x-user':'cleanup-user'})).status,409);
  assert.equal((await pool.query('SELECT 1 FROM vehicles WHERE id=$1',[s.vehicle.id])).rowCount,1);
  await pool.query('DELETE FROM dealerships WHERE id=$1',[namespace]);
  assert.equal((await call(scope,'DELETE',{}, {'x-user':'cleanup-user'})).status,200);
});

test('cleanup preserves cross-dealer FK and JSON references to test vehicle',async()=>{
  const created=await call(path,'POST',{}, {'x-user':'cross-reference-user'});assert.equal(created.status,201);const s=created.data,scope=`${path}/${s.sessionId}`;
  const references:[string,string,unknown[]][]=[
    ['enquiries',"INSERT INTO enquiries(id,dealer_id,vehicle_id,type,customer_name,message) VALUES($1,'other-dealer',$2,'general','Protected','Keep')",[randomUUID(),s.vehicle.id]],
    ['leads',"INSERT INTO leads(id,dealer_id,vehicle_id,source,customer_name) VALUES($1,'other-dealer',$2,'phone','Protected')",[randomUUID(),s.vehicle.id]],
    ['enquiry_events',"INSERT INTO enquiry_events(id,dealer_id,vehicle_id,kind,summary) VALUES($1,'other-dealer',$2,'call_intent','Protected')",[randomUUID(),s.vehicle.id]],
    ['vehicle_images',"INSERT INTO vehicle_images(id,vehicle_id,source_url) VALUES($1,$2,'https://example.test/photo')",[randomUUID(),s.vehicle.id]],
    ['vehicle_changes',"INSERT INTO vehicle_changes(id,vehicle_id,field_name) VALUES($1,$2,'Protected')",[randomUUID(),s.vehicle.id]],
  ];
  for(const [table,sql,params] of references){
    await pool.query(sql,params);
    const before=(await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE id=$1`,[params[0]])).rows[0].row;
    assert.equal((await call(scope,'DELETE',{}, {'x-user':'cross-reference-user'})).status,409,table);
    assert.deepEqual((await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE id=$1`,[params[0]])).rows[0].row,before);
    await pool.query(`DELETE FROM ${table} WHERE id=$1`,[params[0]]);
  }
  const saleId=randomUUID();await pool.query("INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES($1,'other-dealer','PROTECTED-CROSS-REFERENCE',1,$2::jsonb)",[saleId,JSON.stringify({draft:{vehicleId:s.vehicle.id},protected:'unchanged'})]);
  assert.equal((await call(scope,'DELETE',{}, {'x-user':'cross-reference-user'})).status,409);
  assert.equal((await pool.query('SELECT state FROM sale_workspace WHERE id=$1',[saleId])).rows[0].state.protected,'unchanged');
  await pool.query('DELETE FROM sale_workspace WHERE id=$1',[saleId]);
  assert.equal((await call(scope,'DELETE',{}, {'x-user':'cross-reference-user'})).status,200);
});

test('cleanup locks the test vehicle before scanning FKs; a concurrent parent insert cannot be altered',async()=>{
  const created=await call(path,'POST',{}, {'x-user':'fk-race-user'});assert.equal(created.status,201);const s=created.data,scope=`${path}/${s.sessionId}`;
  const blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query('LOCK TABLE enquiry_events IN ACCESS EXCLUSIVE MODE');
  const cleanup=call(scope,'DELETE',{}, {'x-user':'fk-race-user'});
  let locked=false;
  for(let i=0;i<40&&!locked;i++){
    const probe=await pool.connect();try{await probe.query('BEGIN');await probe.query('SELECT id FROM vehicles WHERE id=$1 FOR KEY SHARE NOWAIT',[s.vehicle.id]);await probe.query('ROLLBACK');}
    catch(e:any){await probe.query('ROLLBACK');if(e.code==='55P03')locked=true;else throw e;}finally{probe.release();}
    if(!locked)await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(locked,true,'cleanup should hold a vehicle row lock before FK checks');
  const parentId=randomUUID();let settled=false;
  const insert=pool.query("INSERT INTO enquiries(id,dealer_id,vehicle_id,type,customer_name,message) VALUES($1,'parent-dealer',$2,'general','Protected','Keep')",[parentId,s.vehicle.id]).then(()=>({ok:true,code:''}),(e:any)=>({ok:false,code:e.code})).finally(()=>{settled=true;});
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(settled,false,'parent FK insert must wait for cleanup');
  await blocker.query('COMMIT');blocker.release();assert.equal((await cleanup).status,200);
  const result=await insert;assert.equal(result.ok,false);assert.equal(result.code,'23503');
  assert.equal((await pool.query('SELECT 1 FROM enquiries WHERE id=$1',[parentId])).rowCount,0);
});
test('test sale supports part exchange and delivery without changing real stock or customer',async()=>{
  await ensureFixture();
  const snapshot=async()=>JSON.stringify((await pool.query('SELECT (SELECT row_to_json(v) FROM vehicles v WHERE id=$1) car,(SELECT row_to_json(c) FROM customers c WHERE id=$2) customer',[fixtureCar,fixtureCustomer])).rows);
  const before=await snapshot(), headers={'x-user':'delivery-px-user'};
  const created=await call(path,'POST',{},headers);assert.equal(created.status,201,JSON.stringify(created.data));
  const s=created.data,scope=`${path}/${s.sessionId}`,work=`${scope}/sale-workspace`;
  const copy={...draft(s.vehicle.id),vin:'WVWZZZ1JZXW000001',exchanges:[{registration:'AA12AAA',description:'Part exchange',value:'200'}]};
  let r=await call(work,'POST',mutation({draft:copy}),headers);assert.equal(r.status,201,JSON.stringify(r.data));let sale=r.data.sale;
  const act=async(action:string,body:Record<string,unknown>)=>{const result=await call(`${work}/${sale.id}/${action}`,'POST',mutation({expectedRevision:sale.revision,...body}),headers);assert.equal(result.status,200,JSON.stringify(result.data));sale=result.data.sale;return result.data;};
  await act('checklists',{partExchanges:[{registration:'AA12AAA',items:{identity:'checked',condition:'checked',ownership:'checked',finance:'not_needed',keys:'checked'}}]});
  await act('invoice-payments',{payment:{amount:'800',method:'Bank transfer',date,reference:'TEST',kind:'final-payment',status:'confirmed'}});
  await act('issue-invoice',{kind:'full',acknowledge:true});
  await act('fulfilment',{fulfilment:{method:'delivery',viewed:'viewed',address:'2 Test Road, London',recipient:'Test recipient',phone:'07000000000',scheduledDate:date,timeWindow:'Afternoon',instructions:'Test only'}});
  await act('finish-invoice-sale',{acknowledge:true});
  await act('handover',{recipient:'Test recipient'});
  assert.equal(sale.draft.fulfilment.method,'delivery');assert.equal(sale.draft.exchanges[0].registration,'AA12AAA');assert.ok(sale.draft.fulfilment.completedAt);
  assert.equal(await snapshot(),before);
  assert.equal((await call(scope,'DELETE',{},headers)).status,200);assert.equal(await snapshot(),before);
});

test('test invoice uses the dealer logo and preserves the real settings',async()=>{
  const old=(await pool.query("SELECT config,revision FROM dealer_settings WHERE dealer_id='protected-dealer'")).rows[0];
  const canvas=createCanvas(24,12);canvas.getContext('2d').fillRect(0,0,24,12);
  const logo=`data:image/png;base64,${(await canvas.encode('png')).toString('base64')}`;
  await pool.query("INSERT INTO dealer_settings(dealer_id,config,revision) VALUES('protected-dealer',$1::jsonb,1) ON CONFLICT(dealer_id) DO UPDATE SET config=$1::jsonb",[JSON.stringify({identity:{name:'Real Dealer',logoAsset:logo}})]);
  try {
    const settingsBefore=JSON.stringify((await pool.query("SELECT config,revision FROM dealer_settings WHERE dealer_id='protected-dealer'")).rows);
    const headers={'x-user':'logo-test-user'},created=await call(path,'POST',{},headers);assert.equal(created.status,201,JSON.stringify(created.data));
    const s=created.data,scope=`${path}/${s.sessionId}`,work=`${scope}/sale-workspace`;
    let result=await call(work,'POST',mutation({draft:draft(s.vehicle.id)}),headers);assert.equal(result.status,201,JSON.stringify(result.data));let sale=result.data.sale;
    result=await call(`${work}/${sale.id}/issue-invoice`,'POST',mutation({expectedRevision:sale.revision,kind:'full',acknowledge:true}),headers);assert.equal(result.status,200,JSON.stringify(result.data));
    assert.equal(result.data.document.snapshot.branding.identity.logoAsset,logo);
    assert.match(result.data.document.snapshot.branding.identity.name,/TEST/);
    assert.equal((await call(scope,'DELETE',{},headers)).status,200);
    assert.equal(JSON.stringify((await pool.query("SELECT config,revision FROM dealer_settings WHERE dealer_id='protected-dealer'")).rows),settingsBefore);
  } finally {
    if(old)await pool.query("UPDATE dealer_settings SET config=$1::jsonb,revision=$2 WHERE dealer_id='protected-dealer'",[JSON.stringify(old.config),old.revision]);
    else await pool.query("DELETE FROM dealer_settings WHERE dealer_id='protected-dealer'");
  }
});

test.after(async()=>{await pool.query('DELETE FROM customers WHERE id=$1',[fixtureCustomer]);await pool.query('DELETE FROM vehicles WHERE id=$1',[fixtureCar]);await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();});
