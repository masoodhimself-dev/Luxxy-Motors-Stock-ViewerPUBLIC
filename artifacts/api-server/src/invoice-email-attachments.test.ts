import test from 'node:test';
import assert from 'node:assert/strict';
import {createSaleWorkspace,changeSaleWorkspace,type SaleWorkspaceContext,type SaleWorkspaceDraft} from '@workspace/vehicle-meta';
import {invoiceEmailAttachments} from './lib/invoice-email-attachments';
const context: SaleWorkspaceContext={now:'2026-10-20T12:00:00.000Z',actor:'Staff',nextId:()=>crypto.randomUUID(),nextNumber:()=> 'INV-1',branding:{identity:{name:'Test Motors',logoText:'TEST',logoAsset:''},contact:{phone:'',email:''},address:{street:'',city:'London',region:'',postcode:''},legal:{companyName:'',companyNumber:'',vatNumber:''}}};
const draft: SaleWorkspaceDraft={id:'draft',customer:'Buyer',email:'buyer@example.invalid',phone:'',address:'',vehicleId:'car',vehicle:'Ford Focus',registration:'AB20XYZ',vin:'WVWZZZ1JZXW000001',roadTaxGuide:true,price:'5000',partExchange:false,pxRegistration:'',pxDescription:'',pxValue:'',deposit:'',paymentMethod:'',notes:'',collection:'',preparation:false,documents:false,handover:false};
const options={reference:'012345678901',fileId:'0123456789abcdef0123456789abcdef',createdAt:context.now};
function issued(){const s=createSaleWorkspace({draft,requestId:'create-test'},context,'SALE-1').sale;return changeSaleWorkspace(s,{action:'issue-invoice',kind:'full',acknowledge:true},{requestId:'issue-test',expectedRevision:s.revision},context).document!;}
test('invoice email attaches only the immutable issued PDF, including historical documents with old guide flags',()=>{
 const doc=issued(),before=JSON.stringify(doc);
 assert.deepEqual(invoiceEmailAttachments(doc,'EXACT-INVOICE-BYTES'),[{filename:'INV-1.pdf',content:'EXACT-INVOICE-BYTES'}]);
 assert.equal(JSON.stringify(doc),before);
});
