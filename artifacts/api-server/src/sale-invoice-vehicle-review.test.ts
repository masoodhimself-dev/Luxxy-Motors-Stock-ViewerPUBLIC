import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { changeSaleWorkspace, createSaleWorkspace, saleWorkspaceBranding, type MotHistory, type SaleWorkspaceCommand, type SaleWorkspaceContext } from '@workspace/vehicle-meta';
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
