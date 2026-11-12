import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createSaleWorkspace,changeSaleWorkspace,saleWorkspaceTotals,salesDocumentPresentation,type SaleWorkspaceRecord,type SaleWorkspaceContext } from '@workspace/vehicle-meta';
import { refundSaleCredit,returnSaleCar,requestSalePayment,returnAndReplaceSale } from '../../../lib/vehicle-meta/src/sale-operations';
import { saleOperation } from './lib/sale-operations-store';
import { engine,pool } from './test/tenant-test-db';
import { runWithTenant } from './lib/tenant-context';
import { completeSaleReturnInspection } from './lib/sale-return-inspection';
test.after(async()=>{await engine.close();});
const ctx=():SaleWorkspaceContext=>({now:'2026-11-04T12:00:00.000Z',actor:'Test staff',nextId:randomUUID,nextNumber:type=>`${type}-${randomUUID()}`,branding:{identity:{name:'Example Motors',logoText:'EXAMPLE',logoAsset:''},contact:{phone:'',email:''},address:{street:'',city:'',region:'',postcode:''},legal:{companyName:'',companyNumber:'',vatNumber:''}}});
function fixture(received='10000'){
  const context=ctx(); let sale=createSaleWorkspace({requestId:randomUUID(),draft:{customer:'Example Buyer',vehicleId:randomUUID(),vehicle:'Example car',registration:'AB20XYZ',price:'10000'}},context,'SALE-1001').sale;
  if(Number(received)>0)sale=changeSaleWorkspace(sale,{action:'payment',payment:{amount:received,kind:'part-payment',status:'confirmed',method:'Bank transfer',date:'2026-11-03',reference:'PAID'}},{requestId:randomUUID(),expectedRevision:sale.revision},context).sale;
  sale=changeSaleWorkspace(sale,{action:'document',type:'invoice'},{requestId:randomUUID(),expectedRevision:sale.revision},context).sale;
  sale.lifecycle={status:'sold',vehicleId:sale.draft.vehicleId,changedAt:'2026-11-03T12:00:00Z'};sale.completedAt='2026-11-03T12:00:00Z';
  return sale;
}
const input=(agreedCredit='10000')=>({agreedCredit,reason:'Agreed vehicle return',condition:'Car, two keys and documents received',mileage:45100,returnedDate:'2026-11-04',financeConfirmed:true,received:true,acknowledge:true});
for(const [received,credit,cancelled,refund] of [['10000','10000',0,1000000],['2000','10000',800000,200000],['0','10000',1000000,0],['2000','9000',800000,100000],['10000','9999.99',0,999999]] as const)test(`return-only ${received} paid / ${credit} credit preserves cash and cancels only unpaid charges`,()=>{
  const sale=fixture(received), before=structuredClone(sale),result=returnSaleCar(sale,input(credit),ctx()),totals=saleWorkspaceTotals(result.sale.draft,result.sale.payments);
  assert.deepEqual(sale,before);assert.deepEqual(result.sale.payments,before.payments);assert.deepEqual(result.sale.documents.slice(0,-1),before.documents);assert.equal(result.sale.lifecycle?.status,'returned');
  assert.equal(result.sale.standaloneReturn?.unpaidCancelledPence,cancelled);assert.equal(result.sale.standaloneReturn?.refundDuePence,refund);assert.equal(totals.balance,refund===0?0:-refund);assert.equal(result.document.transaction?.kind,'return-only-credit');
  const rendered=salesDocumentPresentation(result.document);assert.equal(rendered.type,'Return Credit Note');assert.match(rendered.notice!,/does not send money/);assert.doesNotMatch(JSON.stringify(rendered),/replacement|Credit transferred -/);assert.ok(rendered.summaryRows?.some(row=>row.label==='Cash refund recorded by this document'&&row.amount==='£0.00'));
});
test('return-only validates physical receipt, dates, credit, pending/property/provider funds and prevents double return',()=>{
 const sale=fixture('2000');for(const patch of [{received:false},{financeConfirmed:false},{acknowledge:false},{agreedCredit:'10000.01'},{agreedCredit:'7999.99'},{agreedCredit:'0'},{agreedCredit:'1000.001'},{reason:''},{condition:''},{mileage:-1},{returnedDate:'2026-11-05'},{returnedDate:'2026-11-02'}])assert.throws(()=>returnSaleCar(sale,{...input(),...patch},ctx()));
 const pending=structuredClone(sale);pending.payments.push({...pending.payments[0],id:randomUUID(),status:'pending'});assert.throws(()=>returnSaleCar(pending,input(),ctx()),/pending/);
 const property=structuredClone(sale);property.draft.partExchange=true;assert.throws(()=>returnSaleCar(property,input(),ctx()),/part-exchange/);
 const provider=structuredClone(sale);provider.providerPayments={provider:{paymentId:provider.payments[0].id,eventId:'event'}};assert.throws(()=>returnSaleCar(provider,input(),ctx()),/provider/);
 const returned=returnSaleCar(sale,input(),ctx()).sale;assert.throws(()=>returnSaleCar(returned,input(),ctx()),/already been returned/);
 assert.throws(()=>changeSaleWorkspace(returned,{action:'reverse',paymentId:returned.payments[0].id,amount:'100',kind:'refund',reason:'duplicate',date:'2026-11-04'},{expectedRevision:returned.revision,requestId:randomUUID()},ctx()),/returned/);
 assert.throws(()=>requestSalePayment(returned,{kind:'other',amount:'1',dueDate:'2026-11-04',note:'',tokenHash:'f'.repeat(64),expiresAt:'2026-12-04T12:00:00Z'},ctx()),/closed/);
});
test('return of a previously replaced car retains linked funds without inventing another receipt',()=>{
 const old=fixture();const replacementDraft={...old.draft,vehicleId:randomUUID(),price:'10000'};const replacement=returnAndReplaceSale(old,{replacementDraft,...input()},ctx(),'SALE-1002').replacement;
 replacement.lifecycle!.status='sold';replacement.completedAt=ctx().now;
 const returned=returnSaleCar(replacement,input(),ctx()).sale;assert.equal(returned.payments.length,0);assert.equal(returned.standaloneReturn?.refundDuePence,1000000);assert.equal(returned.returnReplacement?.otherSaleId,old.id);
});
test('standalone returns and replacements close the original collection task, preserving its note and open payment task',()=>{
 const sale=fixture();
 const task={status:'open' as const,assigneeId:'staff',assigneeName:'Showroom staff',note:'Original internal note',
   createdAt:sale.createdAt,createdBy:'Manager',updatedAt:sale.createdAt,updatedBy:'Manager'};
 sale.handoffTasks=[{...task,id:randomUUID(),kind:'arrange-collection'},{...task,id:randomUUID(),kind:'check-payment'}];
 const direct=returnSaleCar(sale,input(),ctx()).sale;
 const swapped=returnAndReplaceSale(sale,{...input(),replacementDraft:{...sale.draft,vehicleId:randomUUID()}},ctx(),'SALE-1002');
 for(const original of [direct,swapped.returned]){
   assert.deepEqual(original.handoffTasks?.map(({status,resolutionReason,note})=>[status,resolutionReason,note]),
     [['cancelled','vehicle-returned',task.note],['open',undefined,task.note]]);
 }
 assert.equal(swapped.replacement.handoffTasks,undefined);
 assert.ok(sale.handoffTasks.every(task=>task.status==='open'));
});
test('returns and refunds use the London calendar at British Summer Time midnight',()=>{
  const context = { ...ctx(), now: '2026-07-06T23:45:00.000Z' };
  const sale = fixture();
  sale.completedAt = '2026-07-06T23:30:00.000Z';
  assert.throws(() => returnSaleCar(sale, { ...input(), returnedDate: '2026-07-06' }, context), /between the completed sale and today/i);
  const returned = returnSaleCar(sale, { ...input(), returnedDate: '2026-07-07' }, context).sale;
  assert.equal(returned.standaloneReturn?.returnedDate, '2026-07-07');
  const refund = { amount:'100', method:'Bank transfer', confirmReceived:true, date:'2026-07-07' };
  assert.throws(() => refundSaleCredit(returned, { ...refund, date:'2026-07-06' }, context), /actual refund method and date/i);
  assert.equal(refundSaleCredit(returned, refund, context).sale.payments.at(-1)?.date, '2026-07-07');
  const { replacement } = returnAndReplaceSale(sale, { ...input(), replacementDraft:{ ...sale.draft, vehicleId:randomUUID(), price:'9000' } }, context, 'SALE-1002');
  assert.throws(() => refundSaleCredit(replacement, { ...refund, date:'2026-07-06' }, context), /actual refund method and date/i);
  assert.equal(refundSaleCredit(replacement, refund, context).sale.payments.at(-1)?.date, '2026-07-07');
});
const tenant=(dealerId:string)=>({dealerId,canonicalOrigin:`https://${dealerId}.example.test`,platform:'cazoo' as const,retailerId:dealerId,sourceUrl:'https://www.cazoo.co.uk/example',kind:'website' as const});
test('stored return and partial refunds enforce tenant/revision/ownership, exact retries, immutable invoices and inspection',async()=>{
 process.env.MULTI_TENANT_ENABLED='true';process.env.AI_ASSISTANCE_ENABLED='false';delete process.env.OPENAI_API_KEY;
 for(const file of(await readdir('../../lib/db/drizzle')).filter(f=>/^\d+.*\.sql$/.test(f)).sort())await engine.exec(await readFile(join('../../lib/db/drizzle',file),'utf8'));
 const a=tenant('return-only-a'),b=tenant('return-only-b');for(const t of[a,b]){await engine.query("INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,$1,'active',$2,'cazoo',$1,$3)",[t.dealerId,t.canonicalOrigin,t.sourceUrl]);await engine.query('INSERT INTO dealer_settings(dealer_id,config) VALUES($1,$2::jsonb)',[t.dealerId,JSON.stringify({identity:{name:'Example Motors',logoAsset:''}})]);}
 const sale=fixture('2000'),frozen=structuredClone(sale.documents);await engine.query('INSERT INTO sale_workspace(id,dealer_id,reference,revision,state,created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$6)',[sale.id,a.dealerId,sale.reference,sale.revision,JSON.stringify(sale),ctx().now]);
 await engine.query("INSERT INTO vehicles(id,dealer_id,source,advert_id,title,inventory_status,source_status,audit_metadata) VALUES($1,$2,'cazoo',$4,'Example car','sold','live',$3::jsonb)",[sale.draft.vehicleId,a.dealerId,JSON.stringify({saleWorkspaceId:sale.id,preserved:'original'}),sale.draft.vehicleId]);
 const within=<T>(fn:()=>T,t=a)=>runWithTenant(t,fn),request={action:'return-car',requestId:randomUUID(),expectedRevision:sale.revision,...input()};
 const read=async()=>(await engine.query<{state:SaleWorkspaceRecord}>('SELECT state FROM sale_workspace WHERE id=$1',[sale.id])).rows[0].state;
 try{
  await assert.rejects(within(()=>saleOperation(sale.id,request,'Other'),b),/not found/);
  await assert.rejects(within(()=>saleOperation(sale.id,{...request,expectedRevision:sale.revision-1},'Staff')),/changed/);
  await engine.query("UPDATE vehicles SET audit_metadata='{}'::jsonb WHERE id=$1",[sale.draft.vehicleId]);await assert.rejects(within(()=>saleOperation(sale.id,request,'Staff')),/ownership/);assert.deepEqual(await read(),sale);
  await engine.query('UPDATE vehicles SET audit_metadata=$2::jsonb WHERE id=$1',[sale.draft.vehicleId,JSON.stringify({saleWorkspaceId:sale.id,preserved:'original'})]);
  const result=await within(()=>saleOperation(sale.id,request,'Staff'));let current=result.sale;assert.equal(current.standaloneReturn?.unpaidCancelledPence,800000);assert.equal(saleWorkspaceTotals(current.draft,current.payments).balance,-200000);assert.deepEqual(current.documents.slice(0,-1),frozen);assert.equal(current.payments.length,sale.payments.length);assert.ok((await read()).documentArchives?.[current.documents.at(-1)!.id]);
  assert.equal((await within(()=>saleOperation(sale.id,request,'Staff')) as {replayed?:boolean}).replayed,true);await assert.rejects(within(()=>saleOperation(sale.id,{...request,reason:'different'},'Staff')),/different details/);
  const car=(await engine.query<any>('SELECT * FROM vehicles WHERE id=$1',[sale.draft.vehicleId])).rows[0];assert.equal(car.inventory_status,'hidden');assert.equal(car.audit_metadata.returnInspectionPending,true);assert.equal(car.audit_metadata.preserved,'original');
  await assert.rejects(within(()=>saleOperation(sale.id,{action:'refund-credit',expectedRevision:current.revision,requestId:randomUUID(),amount:'2000.01',method:'Bank transfer',date:'2026-11-04',confirmReceived:true},'Staff')),/exceeds/);
  await assert.rejects(within(()=>saleOperation(sale.id,{action:'refund-credit',expectedRevision:current.revision,requestId:randomUUID(),amount:'1000',method:'Bank transfer',date:'2026-11-04',confirmReceived:false},'Staff')),/actually been paid/);
  const refund={action:'refund-credit',expectedRevision:current.revision,requestId:randomUUID(),amount:'1000',method:'Bank transfer',date:'2026-11-04',confirmReceived:true};current=(await within(()=>saleOperation(sale.id,refund,'Staff'))).sale;assert.equal(saleWorkspaceTotals(current.draft,current.payments).balance,-100000);assert.equal((await within(()=>saleOperation(sale.id,refund,'Staff')) as {replayed?:boolean}).replayed,true);assert.equal(current.payments.at(-1)?.signedAmountPence,-100000);
  current=(await within(()=>saleOperation(sale.id,{...refund,expectedRevision:current.revision,requestId:randomUUID()},'Staff'))).sale;assert.equal(saleWorkspaceTotals(current.draft,current.payments).balance,0);assert.equal(saleWorkspaceTotals(current.draft,current.payments).confirmedPaid,0);
  const inspected=await completeSaleReturnInspection(pool,a.dealerId,sale.id,{expectedRevision:current.revision,requestId:randomUUID(),confirm:true,note:'Returned car checked, keys and papers present.'},'Inspector');assert.ok(inspected.sale.returnInspection);assert.equal((await engine.query<any>('SELECT inventory_status FROM vehicles WHERE id=$1',[sale.draft.vehicleId])).rows[0].inventory_status,'available');assert.deepEqual(inspected.sale.documents.slice(0,frozen.length),frozen);assert.equal(inspected.sale.lifecycle?.status,'returned');
 }finally{/* suite hook closes the isolated database */}
});
