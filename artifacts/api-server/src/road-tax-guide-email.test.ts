import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaleWorkspace, changeSaleWorkspace, type SaleWorkspaceContext, type SaleWorkspaceDraft, type SaleWorkspaceCommand } from '@workspace/vehicle-meta';
import { emailRoadTaxGuide } from './lib/road-tax-guide-email';
const context: SaleWorkspaceContext = {now:'2026-10-20T12:00:00.000Z',actor:'Staff',nextId:()=>crypto.randomUUID(),nextNumber:()=> 'SALE-1',branding:{identity:{name:'Test Motors',logoText:'TEST',logoAsset:''},contact:{phone:'',email:''},address:{street:'',city:'London',region:'',postcode:''},legal:{companyName:'',companyNumber:'',vatNumber:''}}};
const draft: SaleWorkspaceDraft = {id:'draft',customer:'Sample buyer',email:'buyer@example.invalid',phone:'',address:'',vehicleId:'test-car',vehicle:'Ford Focus',registration:'AB20XYZ',vin:'WVWZZZ1JZXW000001',roadTaxGuide:true,roadTaxGuideRoute:'green-slip',price:'5000',partExchange:false,pxRegistration:'',pxDescription:'',pxValue:'',deposit:'',paymentMethod:'',notes:'',collection:'',preparation:false,documents:false,handover:false};
function fixture() {
 let sale=createSaleWorkspace({draft,requestId:'create-test'},context,'SALE-1').sale;
 const commands: unknown[]=[];const sends: any[]=[];let fail=false;
 const service={get:async(id:string)=>{if(id!==sale.id)throw new Error('Not found');return structuredClone(sale)},mutate:async(input:any)=>{commands.push(input);const result=changeSaleWorkspace(sale,input.command,{requestId:input.requestId,expectedRevision:input.expectedRevision},context);sale=result.sale;return result},finishEmail:async(id:string,requestId:string,command:SaleWorkspaceCommand)=>{commands.push(command);const result=changeSaleWorkspace(sale,command,{requestId,expectedRevision:sale.revision},context);sale=result.sale;return result}};
 const deps={service:service as any,branding:async()=>context.branding,send:async(input:any)=>{sends.push(input);if(fail)throw new Error('PROVIDER-PRIVATE-123456789012');return 'provider-id'},now:()=>new Date(context.now)};
 const input=()=>({saleId:sale.id,expectedRevision:sale.revision,requestId:'tax-request-001',reference:'123456789012',route:'green-slip',confirmedRecipient:sale.draft.email,actor:'Staff',dealerId:'dealer-a'});
 return {deps,input,sends,commands,get:()=>sale, fail:(value:boolean)=>{fail=value},change:(update:Partial<SaleWorkspaceDraft>)=>{sale.draft={...sale.draft,...update}}};
}
test('sends only the saved customer a PDF and replays without a duplicate; stores no slip',async()=>{
 const f=fixture();const result=await emailRoadTaxGuide(f.input(),f.deps);assert.equal(result.sale.roadTaxGuideEmails?.[0].status,'sent');assert.equal(f.sends.length,1);
 const sent=f.sends[0];assert.equal(sent.to,'buyer@example.invalid');assert.equal(sent.attachments[0].filename,'road-tax-guide.pdf');assert.ok(Buffer.from(sent.attachments[0].content,'base64').toString().includes('123456789012'));
 assert.ok(!JSON.stringify(f.commands).includes('123456789012'));assert.ok(!JSON.stringify(f.get()).includes('123456789012'));
 assert.equal((await emailRoadTaxGuide(f.input(),f.deps)).replayed,true);assert.equal(f.sends.length,1);
});
test('rejects stale revisions, wrong recipients, invalid slips and routes before sending',async()=>{
 for(const change of [{expectedRevision:0},{confirmedRecipient:'other@example.invalid'},{reference:'123'},{route:'anything'}]){
  const f=fixture();await assert.rejects(emailRoadTaxGuide({...f.input(),...change},f.deps));assert.equal(f.sends.length,0);
 }
 const f=fixture();await assert.rejects(emailRoadTaxGuide({...f.input(),saleId:'another-dealer-sale'},f.deps));assert.equal(f.sends.length,0);
});
test('no-logbook route needs no reference and never includes an accidentally supplied slip',async()=>{
 const f=fixture();f.change({roadTaxGuideRoute:'no-logbook'});await emailRoadTaxGuide({...f.input(),route:'no-logbook',reference:'123456789012'},f.deps);
 const pdf=Buffer.from(f.sends[0].attachments[0].content,'base64').toString();assert.ok(pdf.includes('V62'));assert.ok(pdf.includes('New buyer'));assert.ok(!pdf.includes('123456789012'));
});
test('failed sends retain a generic error and retry with exactly the same attachment and provider key',async()=>{
 const f=fixture();f.fail(true);const result=await emailRoadTaxGuide(f.input(),f.deps);assert.equal(result.sale.roadTaxGuideEmails?.[0].status,'failed');assert.ok(!JSON.stringify(f.get()).includes('PROVIDER-PRIVATE'));
 f.fail(false);await emailRoadTaxGuide(f.input(),f.deps);assert.equal(f.sends[0].idempotencyKey,f.sends[1].idempotencyKey);assert.equal(f.sends[0].attachments[0].content,f.sends[1].attachments[0].content);assert.equal(f.get().roadTaxGuideEmails?.[0].status,'sent');
});
