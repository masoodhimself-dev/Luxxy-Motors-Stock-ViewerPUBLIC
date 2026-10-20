import test from 'node:test';
import assert from 'node:assert/strict';
import {createSaleWorkspace,changeSaleWorkspace,type SaleWorkspaceContext,type SaleWorkspaceDraft} from '@workspace/vehicle-meta';
import {invoiceEmailAttachments} from './lib/invoice-email-attachments';
const context: SaleWorkspaceContext={now:'2026-10-20T12:00:00.000Z',actor:'Staff',nextId:()=>crypto.randomUUID(),nextNumber:()=> 'INV-1',branding:{identity:{name:'Test Motors',logoText:'TEST',logoAsset:''},contact:{phone:'',email:''},address:{street:'',city:'London',region:'',postcode:''},legal:{companyName:'',companyNumber:'',vatNumber:''}}};
const draft: SaleWorkspaceDraft={id:'draft',customer:'Buyer',email:'buyer@example.invalid',phone:'',address:'',vehicleId:'car',vehicle:'Ford Focus',registration:'AB20XYZ',vin:'WVWZZZ1JZXW000001',roadTaxGuide:true,price:'5000',partExchange:false,pxRegistration:'',pxDescription:'',pxValue:'',deposit:'',paymentMethod:'',notes:'',collection:'',preparation:false,documents:false,handover:false};
const options={reference:'012345678901',fileId:'0123456789abcdef0123456789abcdef',createdAt:context.now};
function issued(){const s=createSaleWorkspace({draft,requestId:'create-test'},context,'SALE-1').sale;return changeSaleWorkspace(s,{action:'issue-invoice',kind:'full',acknowledge:true},{requestId:'issue-test',expectedRevision:s.revision},context).document!;}
test('full invoice email bundles the archived invoice and green-slip guide, without changing the issued snapshot',()=>{
 const doc=issued();const original=JSON.stringify(doc);const result=invoiceEmailAttachments(doc,'EXACT-INVOICE-BYTES',options);
 assert.deepEqual(result.map(a=>a.filename),['INV-1.pdf','road-tax-guide.pdf']);assert.equal(result[0].content,'EXACT-INVOICE-BYTES');
 const pdf=Buffer.from(result[1].content,'base64').toString();assert.ok(pdf.includes('012345678901'));assert.ok(pdf.includes('WVWZZZ1JZXW000001'));assert.ok(pdf.includes('Ford Focus'));assert.ok(!pdf.includes('V62'));assert.equal(JSON.stringify(doc),original);assert.ok(!original.includes('012345678901'));
 assert.deepEqual(invoiceEmailAttachments(doc,'EXACT-INVOICE-BYTES',options),result);
});
test('deposit invoices, other documents and unselected or historical full invoices never attach a guide',()=>{
 for(const variant of ['deposit','receipt','unselected','historical']){
  const doc=issued();if(variant==='deposit')doc.invoiceKind='deposit';if(variant==='receipt')doc.type='receipt';if(variant==='unselected')doc.snapshot.draft.roadTaxGuide=false;if(variant==='historical')delete doc.snapshot.draft.roadTaxGuide;
  assert.deepEqual(invoiceEmailAttachments(doc,'INVOICE',{...options,reference:undefined}),[{filename:'INV-1.pdf',content:'INVOICE'}]);
 }
});
test('selected guide needs a valid green slip before the invoice email can be sent',()=>{
 for(const reference of [undefined,'','123','12345678901x','1234567890123'])assert.throws(()=>invoiceEmailAttachments(issued(),'INVOICE',{...options,reference}),/12-digit green slip/);
});
