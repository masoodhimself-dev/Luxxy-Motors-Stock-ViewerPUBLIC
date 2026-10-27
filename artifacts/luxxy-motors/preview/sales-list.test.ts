import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createSaleWorkspace, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { salesPreview, type PreviewSaleWorkspaceStore } from './sales';
const branding={identity:{name:'Fictional Motors',logoText:'TEST',logoAsset:''},contact:{phone:'',email:''},address:{street:'',city:'',region:'',postcode:''},legal:{companyName:'',companyNumber:'',vatNumber:''}};
const records=Array.from({length:61},(_,index)=>{const id=`sale-${String(index).padStart(3,'0')}`,sale=createSaleWorkspace({requestId:`create-${id}`,draft:{customer:`Buyer ${index}`,email:'buyer@example.test',phone:'07700900123',address:'PRIVATE INVOICE ADDRESS',vehicle:'Ford Focus',registration:`AB${index}CDE`,price:'6000',sourceEnquiryId:`enquiry-${index}`}},{now:'2026-10-20T10:00:00Z',actor:'Test',nextId:()=>id,nextNumber:()=>id,branding},id).sale;sale.documentArchives={secret:{content:'PRIVATE ARCHIVE',sha256:'private'}};return sale;});
async function call(path:string){let output='';const req=Readable.from([]) as IncomingMessage;req.method='GET';req.headers={host:'127.0.0.1:4190'};req.socket={remoteAddress:'127.0.0.1'} as IncomingMessage['socket'];const res={statusCode:200,setHeader(){},end(body:string){output=body}} as unknown as ServerResponse;const store={list:async()=>records,get:async(id:string)=>records.find(row=>row.id===id)!} as unknown as PreviewSaleWorkspaceStore;assert.equal(await salesPreview(req,res,new URL(path,'http://127.0.0.1:4190'),store),true);return {status:res.statusCode,data:JSON.parse(output),output};}
test('local Sales mirrors bounded compact pages, exact lookup and lazy full-file access',async()=>{
 const first=await call('/api/sale-workspace');assert.equal(first.status,200);assert.equal(first.data.sales.length,50);assert.equal(first.data.hasMore,true);assert.equal(first.data.sales[0].listSummary,true);assert.equal(first.data.sales[0].listTotalDue,600000);assert.deepEqual(first.data.sales[0].documents,[]);assert.deepEqual(first.data.sales[0].payments,[]);assert.equal(first.data.sales[0].draft.address,undefined);assert.doesNotMatch(first.output,/PRIVATE ARCHIVE|PRIVATE INVOICE ADDRESS/);
 const next=await call('/api/sale-workspace?offset=50');assert.equal(next.data.sales.length,11);assert.equal(next.data.hasMore,false);assert.equal(new Set([...first.data.sales,...next.data.sales].map(row=>row.id)).size,61);
 const source=await call('/api/sale-workspace?enquiryId=enquiry-2');assert.equal(source.data.sales.length,1);assert.equal(source.data.sales[0].id,'sale-002');
 const search=await call('/api/sale-workspace?q=AB2CDE');assert.equal(search.data.sales.length,1);assert.equal(search.data.sales[0].id,'sale-002');
 const full=await call('/api/sale-workspace/sale-002');assert.equal(full.data.sale.draft.address,'PRIVATE INVOICE ADDRESS');assert.equal(full.data.sale.id,'sale-002');
 assert.equal((await call('/api/sale-workspace?offset=-1')).status,400);
 assert.equal((await call('/api/sale-workspace?offset=1.5')).status,400);
});
