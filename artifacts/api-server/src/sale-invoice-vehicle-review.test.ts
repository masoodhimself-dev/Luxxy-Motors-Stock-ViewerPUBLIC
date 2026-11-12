import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { changeSaleWorkspace, createSaleWorkspace, customerSaleDocument, saleInvoiceMotWarning, saleWorkspaceBranding, type MotHistory, type SaleWorkspaceCommand, type SaleWorkspaceContext } from '@workspace/vehicle-meta';
import { DvlaVehicleCheckError } from './lib/dvla-vehicle-check';
import { prepareSaleInvoiceVehicleReview } from './lib/sale-invoice-vehicle-review';

const now = '2026-11-04T12:00:00.000Z';
const stock = { id:'00000000-0000-4000-8000-000000000001', plate:'AB20 XYZ', vrm:null, registration:null, make:'Toyota', year:2020, colour:'Grey', mileage:48000 };
const context = (): SaleWorkspaceContext => ({
  now, actor:'Fixture staff', actorId:'staff', nextId:randomUUID, nextNumber:()=>`INV-${randomUUID()}`,
  requireInvoiceVehicleReview:true, branding:saleWorkspaceBranding({identity:{name:'Example Motors'}}),
  paperwork:{saleTerms:'Example terms.',reservationTerms:''},
});
const sale = (registration = stock.plate, vehicleId = stock.id) =>
  createSaleWorkspace({ draft:{ customer:'Example buyer', vehicle:'Toyota Prius', vehicleId, registration, price:'10000' }, requestId:randomUUID() },context(),'SALE-EXAMPLE').sale;
const dvla = async (registration: string) => ({ registration,checkedAt:now,make:'TOYOTA',yearOfManufacture:2020,colour:'GRAY',motExpiry:'2027-06-01',motStatus:'Valid' as const });
const mot = async (): Promise<MotHistory> => ({
  registration:'AB20XYZ',make:'Toyota',model:'Prius',checkedAt:'2026-11-04T11:45:00.000Z',recall:'Unknown',
  tests:[{completedDate:'2026-05-18',result:'PASSED',expiryDate:'2027-05-17',mileage:'76000',mileageUnit:'KM',defects:[]}],
});
const sources = { dvla,mot,now:()=>new Date(now) };
const stage = (current: ReturnType<typeof sale>, review: Awaited<ReturnType<typeof prepareSaleInvoiceVehicleReview>>) => {
  current.invoiceVehicleReview = { review, revision:current.revision, actorId:'staff',stockIdentity:'' };
};
const issue = { action:'issue-invoice',kind:'full',acknowledge:true } as const;
const apply = (current:ReturnType<typeof sale>,command:SaleWorkspaceCommand,ctx = context()) =>
  changeSaleWorkspace(current,command,{expectedRevision:current.revision,requestId:randomUUID()},ctx);

test('MOT warnings use strict calendar dates and the inclusive London 30-day cutoff', () => {
  const londonMidnight = new Date('2026-07-06T23:30:00.000Z');
  assert.deepEqual(saleInvoiceMotWarning('2026-07-06',londonMidnight),{kind:'expired',daysUntilExpiry:-1});
  assert.deepEqual(saleInvoiceMotWarning('2026-07-07',londonMidnight),{kind:'due-today',daysUntilExpiry:0});
  assert.deepEqual(saleInvoiceMotWarning('2026-07-08',londonMidnight),{kind:'due-soon',daysUntilExpiry:1});
  assert.deepEqual(saleInvoiceMotWarning('2026-08-06',londonMidnight),{kind:'due-soon',daysUntilExpiry:30});
  assert.equal(saleInvoiceMotWarning('2026-08-07',londonMidnight),undefined);
  assert.deepEqual(saleInvoiceMotWarning('2028-02-29',new Date('2028-02-28T23:30:00.000Z')),{kind:'due-soon',daysUntilExpiry:1});
  for (const bad of [undefined,'','0000-01-01','2026-7-07','2026-07-07T00:00:00Z','2026-02-29','2026-04-31','2026-13-01','2026-07-07\n']) {
    assert.equal(saleInvoiceMotWarning(bad,londonMidnight),undefined);
  }
  assert.equal(saleInvoiceMotWarning('2026-07-07',new Date(NaN)),undefined);
});

test('invoice requires separate MOT acknowledgement only when warned and records it on staff paperwork', async () => {
  for (const expiryDate of ['2026-11-03','2026-11-04','2026-12-04','2026-12-05',undefined]) {
    const current = sale();
    const review = await prepareSaleInvoiceVehicleReview(current,stock,sources);
    review.mot = expiryDate ? {expiryDate,source:'DVSA',checkedAt:now} : undefined;
    stage(current,review);
    const vehicleReview = {id:review.id,mileage:48001,acknowledge:true};
    const warning = expiryDate !== undefined && expiryDate !== '2026-12-05';
    if (warning) {
      for (const acknowledgeMot of [undefined,false,'true']) {
        assert.throws(()=>apply(current,{...issue,vehicleReview:{...vehicleReview,acknowledgeMot}}),/acknowledge the MOT warning/i);
      }
    }
    const issued = apply(current,{...issue,vehicleReview:{...vehicleReview,...(warning ? {acknowledgeMot:true} : {})}}).document!;
    assert.equal(issued.snapshot.vehicle?.invoiceReview?.motAcknowledgedAt,warning ? now : undefined);
    const customerReview = customerSaleDocument(issued).snapshot.vehicle?.invoiceReview;
    assert.equal(customerReview?.motExpiry,expiryDate);
    assert.equal(customerReview?.motAcknowledgedAt,undefined);
  }
});

test('an MOT moving into the warning period at London midnight is checked again on issue', () => {
  const current = sale();
  const checkedAt = '2026-07-06T22:59:00.000Z';
  const expiryDate = '2026-08-06';
  assert.equal(saleInvoiceMotWarning(expiryDate,new Date(checkedAt)),undefined);
  stage(current,{id:randomUUID(),registration:'AB20 XYZ',checkedAt,status:'checked',warnings:[],mot:{expiryDate,source:'DVSA',checkedAt}});
  const vehicleReview = {id:current.invoiceVehicleReview!.review.id,mileage:48001,acknowledge:true};
  const afterMidnight = {...context(),now:'2026-07-06T23:01:00.000Z'};
  assert.throws(()=>apply(current,{...issue,vehicleReview},afterMidnight),/acknowledge the MOT warning/i);
  assert.equal(apply(current,{...issue,vehicleReview:{...vehicleReview,acknowledgeMot:true}},afterMidnight).document?.snapshot.vehicle?.invoiceReview?.motAcknowledgedAt,afterMidnight.now);
});

test('review uses matched stock, shows the freshest stored DVSA facts and preserves MOT odometer units',async()=>{
  const review=await prepareSaleInvoiceVehicleReview(sale(''),stock,sources);
  assert.equal(review.status,'checked');
  assert.equal(review.registration,'AB20 XYZ');
  assert.deepEqual(review.warnings,[]);
  assert.equal(review.stockMileage,48000);
  assert.deepEqual(review.mot,{expiryDate:'2027-05-17',source:'DVSA',checkedAt:'2026-11-04T11:45:00.000Z'});
  assert.deepEqual(review.lastMotMileage,{reading:76000,unit:'km',recordedAt:'2026-05-18'});
});

test('a different saved plate skips external calls and an official make conflict cannot attest the stock vehicle',async()=>{
  let calls=0;
  const wrongPlate=await prepareSaleInvoiceVehicleReview(sale('XY20 ABC'),stock,{...sources,dvla:async plate=>{calls++;return dvla(plate);},mot:async()=>{calls++;return mot();}});
  assert.equal(calls,0);
  assert.equal(wrongPlate.status,'needs-review');
  assert.equal(wrongPlate.dvla,undefined);
  assert.equal(wrongPlate.mot,undefined);
  const current=sale();
  const wrongMake=await prepareSaleInvoiceVehicleReview(current,stock,{...sources,dvla:async plate=>({...await dvla(plate),make:'Honda'})});
  assert.equal(wrongMake.status,'needs-review');
  assert.match(wrongMake.warnings[0]!,/make differs/);
  assert.equal(wrongMake.mot,undefined);
  stage(current,wrongMake);
  assert.equal(apply(current,{...issue,vehicleReview:{id:wrongMake.id,mileage:48001,acknowledge:true}}).document!.snapshot.vehicle?.invoiceReview?.verification,'manual');
});

test('DVLA outage and missing plates still allow explicit manual confirmation without inventing an MOT expiry',async()=>{
  const unavailable={...sources,dvla:async()=>{throw new DvlaVehicleCheckError('not_configured','Unavailable fixture',503);}};
  const first=sale();
  const outage=await prepareSaleInvoiceVehicleReview(first,stock,unavailable);
  assert.equal(outage.status,'unavailable');
  assert.equal(outage.mot?.source,'DVSA');
  stage(first,outage);
  const invoice=apply(first,{...issue,vehicleReview:{id:outage.id,mileage:48011,acknowledge:true}});
  assert.equal(invoice.document!.snapshot.vehicle?.invoiceReview?.verification,'manual');
  assert.equal(invoice.document!.snapshot.vehicle?.invoiceReview?.dvlaCheckedAt,undefined);
  assert.equal(invoice.document!.snapshot.vehicle?.invoiceReview?.motSource,'DVSA');
  assert.equal(invoice.sale.invoiceVehicleReview,undefined);

  const noPlate=sale('','');
  const manual=await prepareSaleInvoiceVehicleReview(noPlate,undefined,unavailable);
  assert.equal(manual.status,'unavailable');
  stage(noPlate,manual);
  assert.equal(apply(noPlate,{...issue,vehicleReview:{id:manual.id,mileage:0,acknowledge:true}}).document!.snapshot.vehicle?.invoiceReview?.motExpiry,undefined);
});

test('stale cache cannot supply expiry and a fresh failed DVSA test suppresses DVLA expiry',async()=>{
  const stale=await prepareSaleInvoiceVehicleReview(sale(),stock,{...sources,mot:async()=>({...await mot(),checkedAt:'2026-11-02T12:00:00.000Z'})});
  assert.equal(stale.mot?.source,'DVLA');
  assert.equal(stale.lastMotMileage,undefined);
  const failed=await prepareSaleInvoiceVehicleReview(sale(),stock,{...sources,mot:async()=>{
    const history=await mot();
    history.tests[0]!.result='FAILED';
    return history;
  }});
  assert.equal(failed.mot,undefined);
  assert.equal(failed.lastMotMileage?.reading,76000);
  assert.match(failed.warnings.join(' '),/test failed/);
  const expired = await prepareSaleInvoiceVehicleReview(sale(),stock,{...sources,mot:async()=>{
    const history=await mot();
    history.tests[0]!.expiryDate='2026-11-03';
    return history;
  }});
  assert.equal(expired.mot?.expiryDate,'2026-11-03');
  assert.deepEqual(expired.warnings,[]);
});

test('invoice commands require review in staff HTTP context, leave statements alone and reject stale or invalid odometers',async()=>{
  const current=sale();
  const review=await prepareSaleInvoiceVehicleReview(current,stock,sources);
  stage(current,review);
  assert.throws(()=>apply(current,issue),/check and confirm/i);
  assert.throws(()=>apply(current,{action:'document',type:'invoice'}),/check and confirm/i);
  assert.equal(apply(current,{action:'document',type:'statement'}).document?.type,'statement');
  for (const mileage of ['48000',1.5,-1,2_000_001,NaN]) {
    assert.throws(()=>apply(current,{...issue,vehicleReview:{id:review.id,mileage,acknowledge:true}}),/odometer/i);
  }
  const payload={id:review.id,mileage:48001,acknowledge:true};
  assert.throws(()=>apply(current,{...issue,vehicleReview:payload},{...context(),now:'2026-11-04T12:31:00.000Z'}),/check the vehicle again/i);
  assert.throws(()=>apply({...current,revision:current.revision+1},{...issue,vehicleReview:payload}),/check the vehicle again/i);
  const issued=apply(current,{action:'document',type:'invoice',vehicleReview:payload});
  const legacy=apply(issued.sale,issue,{...context(),requireInvoiceVehicleReview:false,vehicle:undefined});
  assert.equal(legacy.document?.snapshot.vehicle?.invoiceReview,undefined);
  assert.equal(issued.document?.snapshot.vehicle?.invoiceReview?.mileage,48001);
});

test('legacy complete-sale cannot issue a staff invoice without review after financial eligibility succeeds',async()=>{
  const current=sale();
  const complete={action:'complete-sale',acknowledge:true} as const;
  assert.throws(()=>apply(current,complete),/remaining payment/);
  const paid=apply(current,{action:'payment',payment:{amount:'10000',method:'Bank transfer',date:'2026-11-04',reference:'',kind:'final-payment',status:'confirmed'}}).sale;
  const review=await prepareSaleInvoiceVehicleReview(paid,stock,sources);
  stage(paid,review);
  assert.throws(()=>apply(paid,complete),/check and confirm/i);
  const done=apply(paid,{...complete,vehicleReview:{id:review.id,mileage:48002,acknowledge:true}});
  assert.equal(done.sale.lifecycle?.status,'sold');
  assert.equal(done.document?.snapshot.vehicle?.invoiceReview?.mileage,48002);
  assert.ok(done.sale.documents.filter(document=>document.type!=='invoice').every(document=>!document.snapshot.vehicle?.invoiceReview));
});
