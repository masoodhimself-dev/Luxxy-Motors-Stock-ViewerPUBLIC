import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import express from 'express';
import { canDeleteEmptySaleDraft, createSaleWorkspace, changeSaleWorkspace, type SaleWorkspaceRecord, type SaleWorkspaceContext } from '@workspace/vehicle-meta';
import { engine, pool } from './test/tenant-test-db';
import { runWithTenant } from './lib/tenant-context';
import { permissionsForRole, type StaffRole } from './lib/staff-permissions';
import routes from './routes/sale-workspace';
import { PostgresSaleWorkspaceStore } from './lib/sale-workspace-store';

const context: SaleWorkspaceContext = { now:'2026-10-24T12:00:00Z', actor:'Fictional staff',nextId:randomUUID,nextNumber:type=>'UNUSED-'+type,branding:{identity:{name:'Fictional',logoText:'',logoAsset:''},contact:{phone:'',email:''},address:{street:'',city:'',region:'',postcode:''},legal:{companyName:'',companyNumber:'',vatNumber:''}} };
const emptyDraft = () => ({id:'',customer:'',email:'',phone:'',address:'',vehicleId:'',vehicle:'',registration:'',price:'',partExchange:false,pxRegistration:'',pxDescription:'',pxValue:'',deposit:'',paymentMethod:'Bank transfer',notes:'',collection:'',preparation:false,documents:false,handover:false});
const create = (customer = '') => createSaleWorkspace({draft:{...emptyDraft(),customer},requestId:randomUUID()},context,'FICTIONAL-'+randomUUID()).sale;

test('deletion eligibility protects real details and all historical financial or customer activity', () => {
  const empty = create(); assert.equal(canDeleteEmptySaleDraft(empty,true),true);
  const sample = create('[TEST] Fictional buyer'); assert.equal(canDeleteEmptySaleDraft(sample,true),true);
  for(const customer of ['Test drive buyer', 'Test-drive customer', 'Test Drive enquiry']) assert.equal(canDeleteEmptySaleDraft(create(customer),true),false,'test-drive wording is real customer activity');
  const changed = changeSaleWorkspace(create('Actual buyer'),{action:'update',draft:emptyDraft()},{requestId:randomUUID(),expectedRevision:1},context).sale;
  assert.equal(canDeleteEmptySaleDraft(changed,true),false,'clearing real buyer fields must not bypass history');
  const renamed = changeSaleWorkspace(create('Actual buyer'),{action:'update',draft:{...emptyDraft(),customer:'TEST pretend'}},{requestId:randomUUID(),expectedRevision:1},context).sale;
  assert.equal(canDeleteEmptySaleDraft(renamed,true),false,'renaming real customer as a test must not permit deletion');
  for (const mutate of [
    (s:any)=>s.payments.push({status:'cancelled'}), (s:any)=>s.documents.push({type:'invoice'}),
    (s:any)=>s.documentArchives={orphan:{content:'keep'}}, (s:any)=>s.providerPayments={pi_keep:{}},
    (s:any)=>s.lifecycle={status:'released'}, (s:any)=>s.completedAt=context.now,
    (s:any)=>s.customerAccess={revokedAt:context.now}, (s:any)=>s.customerLinkEmail={status:'failed'},
    (s:any)=>s.emailDeliveries=[{status:'prepared'}], (s:any)=>s.packDocumentIds=['keep'],
    (s:any)=>s.reviewReminder={cancelledAt:context.now}, (s:any)=>s.checklists={},
    (s:any)=>s.draft.sourceEnquiryId=randomUUID(), (s:any)=>s.draft.sourceReservationId=randomUUID(),
    (s:any)=>s.events.push({type:'payment-recorded'}), (s:any)=>s.events.push({type:'customer-link-revoked'}),
    (s:any)=>s.requests.bad={fingerprint:'unreadable legacy history'}, (s:any)=>delete s.requests,
  ]) { const protectedSale=structuredClone(sample);mutate(protectedSale);assert.equal(canDeleteEmptySaleDraft(protectedSale,true),false); }
});

test('real HTTP delete isolates dealers, checks roles/revision, and leaves other records and counters unchanged', async () => {
  process.env.MULTI_TENANT_ENABLED='true';
  for(const file of (await readdir('../../lib/db/drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort()) await engine.exec(await readFile(join('../../lib/db/drizzle',file),'utf8'));
  const a={dealerId:'delete-a',canonicalOrigin:'https://a.example.test',platform:'autotrader' as const,retailerId:'fictional',sourceUrl:'https://www.autotrader.co.uk/fictional',kind:'website' as const};
  const app=express();app.use(express.json());app.use((req,_res,next)=>{(req as any).log={error(){},warn(){}};const role=req.get('x-test-role') as StaffRole | undefined;if(role)req.staff={authUserId:'fictional-staff',email:null,name:'Fictional staff',role,permissions:permissionsForRole(role)};runWithTenant(req.get('x-test-tenant')==='b.example.test'?{...a,dealerId:'delete-b',canonicalOrigin:'https://b.example.test'}:a,next);});app.use('/api',routes);
  const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('No test server');
  const call=async(id:string,body:unknown,role='owner',host='a.example.test')=>{const response=await fetch(`http://127.0.0.1:${address.port}/api/sale-workspace/${id}`,{method:'DELETE',headers:{host,'x-test-tenant':host,'content-type':'application/json',...(role?{'x-test-role':role}:{})},body:JSON.stringify(body)});return {status:response.status,json:await response.json()};};
  const insert=async(sale:SaleWorkspaceRecord,dealer='delete-a')=>pool.query('INSERT INTO sale_workspace(id,dealer_id,reference,revision,state)VALUES($1,$2,$3,$4,$5::jsonb)',[sale.id,dealer,sale.reference,sale.revision,JSON.stringify(sale)]);
  try {
    await pool.query("INSERT INTO sale_workspace_counters(dealer_id,numbers) VALUES('delete-a','{\"invoice-2026\":17}'::jsonb)");
    const empty=create(), real=create('Actual customer'), testSale=create('[TEST] Fictional buyer');await insert(empty);await insert(real);await insert(testSale);
    const before=JSON.stringify((await pool.query('SELECT state FROM sale_workspace WHERE id=$1',[real.id])).rows[0]);
    assert.equal((await call(empty.id,{confirm:true,expectedRevision:1},'')).status,401);
    assert.equal((await call(empty.id,{confirm:true,expectedRevision:1},'accounts')).status,403);
    assert.equal((await call(empty.id,{confirm:true,expectedRevision:1},'owner','b.example.test')).status,404);
    assert.equal((await call(empty.id,{expectedRevision:1})).status,422);
    assert.equal((await call(empty.id,{confirm:true,expectedRevision:0})).status,409);
    assert.equal((await call(empty.id,{confirm:true,expectedRevision:2})).status,409);
    assert.equal((await call(real.id,{confirm:true,expectedRevision:1})).status,409);
    assert.equal((await call(empty.id,{confirm:true,expectedRevision:1},'salesperson')).status,200);
    assert.equal((await call(testSale.id,{confirm:true,expectedRevision:1})).status,200);
    assert.equal((await call(empty.id,{confirm:true,expectedRevision:1})).status,404);
    assert.equal(JSON.stringify((await pool.query('SELECT state FROM sale_workspace WHERE id=$1',[real.id])).rows[0]),before);
    assert.deepEqual((await pool.query("SELECT numbers FROM sale_workspace_counters WHERE dealer_id='delete-a'")).rows[0].numbers,{'invoice-2026':17});
    const current=create();await insert(current);await pool.query('UPDATE sale_workspace SET revision=2 WHERE id=$1',[current.id]);assert.equal((await call(current.id,{confirm:true,expectedRevision:1})).status,409);
    const store=new PostgresSaleWorkspaceStore('delete-a',async()=>({branding:context.branding}),pool);
    assert.equal((await store.get(real.id)).emptyDraftDeletable,false);
    assert.ok((await store.list()).every(sale=>!('requests' in sale)&&!('documentArchives' in sale)));
  } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await engine.close();}
});
