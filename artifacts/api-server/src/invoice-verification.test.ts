import test from 'node:test';
import assert from 'node:assert/strict';
import { attachInvoiceVerification, invoiceVerificationView } from './lib/invoice-verification';
import { PostgresSaleWorkspaceStore } from './lib/sale-workspace-store';
import { customerSaleDocument, createSaleWorkspace, changeSaleWorkspace, invoiceBranding, defaultInvoiceSettings, type SaleWorkspaceContext, type SaleWorkspaceDraft } from '@workspace/vehicle-meta';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveFrontend } from './lib/serve-frontend';

const draft: SaleWorkspaceDraft={id:'test',customer:'Private buyer',email:'private@customer.invalid',phone:'PRIVATE-PHONE',address:'PRIVATE-ADDRESS',vehicleId:'',vehicle:'2020 Mercedes-Benz E-Class',registration:'AB20 XYZ',price:'12000',partExchange:false,pxRegistration:'',pxDescription:'',pxValue:'',deposit:'',paymentMethod:'',notes:'PRIVATE-STAFF-NOTE',collection:'',preparation:false,documents:false,handover:false};
function issued() {
  const context: SaleWorkspaceContext={now:'2026-10-14T12:00:00Z',actor:'Private staff',nextId:randomUUID,nextNumber:()=>`INV-${randomUUID()}`,branding:invoiceBranding({identity:{name:'Test Motors',logoAsset:'',logoText:''},address:{street:'',city:'',region:'',postcode:''},contact:{phone:'',email:''},legal:{companyName:'',companyNumber:'',vatNumber:''}},defaultInvoiceSettings)};
  const sale=createSaleWorkspace({draft,requestId:'create-test'},context,'SALE-TEST').sale;
  const result=changeSaleWorkspace(sale,{action:'issue-invoice',kind:'full',acknowledge:true},{requestId:'issue-test',expectedRevision:sale.revision},context);
  attachInvoiceVerification(result.document!,sale.id,'https://dealer-a.example');
  const token=result.document!.verification!.url.split('/').at(-1)!;
  return {...result,token,context};
}
test('verification returns only frozen invoice details; random tokens and document substitutions fail',()=>{
  const {sale,document,token}=issued();
  const proof=invoiceVerificationView(sale,document!.id,token);
  assert.equal(proof.verified,true);assert.equal(proof.balanceAtIssuePence,1200000);
  assert.deepEqual(Object.keys(proof).sort(),['verified','number','title','issuedAt','dealer','vehicle','registration','saleTotalPence','paymentsReceivedPence','balanceAtIssuePence','paymentCount','supersededBy'].sort());
  assert.doesNotMatch(JSON.stringify(proof),/PRIVATE|Private buyer|customer.invalid|tokenHash|receipt|snapshot/);
  for(const wrong of ['','a'.repeat(64),'G'.repeat(64),token.slice(0,-1)]) assert.throws(()=>invoiceVerificationView(sale,document!.id,wrong),/could not be verified/);
  assert.throws(()=>invoiceVerificationView(sale,randomUUID(),token));
  assert.throws(()=>invoiceVerificationView(undefined,document!.id,token));
  sale.draft.price='5';sale.draft.customer='Someone else';
  assert.deepEqual(invoiceVerificationView(sale,document!.id,token),proof);
  assert.equal(customerSaleDocument(document!).verification?.url,document!.verification?.url);
  assert.equal(customerSaleDocument(document!).verification?.tokenHash,undefined);
});
test('newer same-kind invoice is identified without changing the original financial proof',()=>{
  const {sale,document,token}=issued();
  sale.documents.push({...document!,id:randomUUID(),number:'INV-NEWER',issuedAt:'2026-10-15T12:00:00Z'});
  const proof=invoiceVerificationView(sale,document!.id,token);
  assert.equal(proof.supersededBy,'INV-NEWER');assert.equal(proof.number,document!.number);
});
test('verification reads the tenant-scoped saved row and never loads private dealer integrations',async()=>{
  const {sale,document,token}=issued();
  const queries:unknown[][]=[];
  const database={query:async(sql:string,params:any[]=[])=>{queries.push([sql,...params]);return {rows:params[0]==='dealer-a'&&params[1]===sale.id?[{state:sale}]:[]};},connect:async()=>{throw new Error('Verification must not open a write transaction');}};
  const assets=async()=>{throw new Error('Verification must not read integrations');};
  const a=new PostgresSaleWorkspaceStore('dealer-a',assets,database),b=new PostgresSaleWorkspaceStore('dealer-b',assets,database);
  assert.equal((await a.verifyInvoice(sale.id,document!.id,token)).verified,true);
  await assert.rejects(b.verifyInvoice(sale.id,document!.id,token),/could not be verified/);
  assert.ok(queries.every(q=>String(q[0]).includes('dealer_id = $1 AND id = $2')));
});
test('the production SPA fallback preserves private verification-page response headers',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'invoice-proof-spa-'));
  await writeFile(join(dir,'index.html'),'<!doctype html><title>Invoice proof fixture</title>');
  const app=express();
  app.use('/verify-invoice',(_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'});next();});
  serveFrontend(app,dir);
  const server=createServer(app);
  try {
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const address=server.address();assert.ok(address&&typeof address!=='string');
    const base=`http://127.0.0.1:${address.port}`;
    const response=await fetch(base+'/verify-invoice/example',{headers:{Accept:'text/html'}});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');
    const publicResponse=await fetch(base+'/',{headers:{Accept:'text/html'}});assert.equal(publicResponse.headers.get('cache-control'),'no-cache');
  } finally {server.closeAllConnections();server.close();await rm(dir,{recursive:true,force:true});}
});
