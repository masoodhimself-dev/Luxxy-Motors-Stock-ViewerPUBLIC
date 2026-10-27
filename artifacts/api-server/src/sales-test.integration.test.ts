import './test/setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
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
const call=async(path:string,method='GET',body?:unknown,headers:Record<string,string>={})=>{
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
  const dep=await doAction('issue-invoice',{kind:'deposit',acknowledge:true});assert.match(dep.document.number,/TEST/);assert.equal(dep.document.verification,undefined);
  const pdf=await call(`${work}/${sale.id}/documents/${dep.document.id}/pdf`);assert.equal(pdf.status,200);assert.equal(pdf.data.subarray(0,4).toString(),'%PDF');if(process.env.SALES_TEST_PDF_PATH)await writeFile(process.env.SALES_TEST_PDF_PATH,pdf.data);
  const depositSnapshot=dep.document;
  await doAction('invoice-payments',{payment:{amount:'900',method:'Bank transfer',date,reference:'TEST-FINAL',kind:'final-payment',status:'confirmed'}});
  await doAction('issue-invoice',{kind:'full',acknowledge:true});assert.deepEqual(sale.documents[0],depositSnapshot);
  await doAction('fulfilment',{fulfilment:{method:'collection',viewed:'viewed',address:'',recipient:s.customer.name,phone:s.customer.phone,scheduledDate:date,timeWindow:'10:00',instructions:''}});
  await doAction('finish-invoice-sale',{acknowledge:true});await doAction('handover',{recipient:s.customer.name});
  assert.equal((await call(`${scoped}/stock`)).data.cars[0].inventoryStatus,'sold');
  assert.equal(sale.payments.length,2);assert.equal(sale.lifecycle.status,'sold');assert.ok(sale.draft.fulfilment.completedAt);
  const afterPdf=await call(`${work}/${sale.id}/documents/${dep.document.id}/pdf`);assert.deepEqual(afterPdf.data,pdf.data);
  assert.equal(await protectedState(),before);
  const cleaned=await call(scoped,'DELETE',{});assert.equal(cleaned.status,200,JSON.stringify(cleaned.data));
  assert.equal((await call(work,'POST',mutation({draft:draft(s.vehicle.id)}))).status,404);
  assert.equal((await call(`${work}/${sale.id}`)).status,404);assert.equal(await protectedState(),before);
  await pool.query("DELETE FROM sale_workspace WHERE dealer_id='protected-dealer'");await pool.query("DELETE FROM sale_workspace_counters WHERE dealer_id='protected-dealer'");await pool.query("DELETE FROM vehicles WHERE dealer_id='protected-dealer'");
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
test.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();});
