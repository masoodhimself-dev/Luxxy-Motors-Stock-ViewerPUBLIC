import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultInvoiceSettings, currentInvoiceSettings, invoiceTextLimits, invoiceBranding, saleWorkspaceBranding, saleWorkspaceNumber } from '@workspace/vehicle-meta';
import { DealerIntegrationsStore } from './lib/dealer-integrations-store';
test('approved branded stationery is the default without overwriting an explicit dealer choice',()=>{
 assert.equal(defaultInvoiceSettings.style,'branded');
 assert.equal(currentInvoiceSettings().style,'branded');
 assert.equal(currentInvoiceSettings({style:'understated'}).style,'understated');
 assert.equal(currentInvoiceSettings({style:'modern'}).style,'understated');
});
test('references cannot reset or collide across types, prefixes, years or dealers', () => {
 const a: Record<string, number> = {}, b: Record<string, number> = {}, now = '2026-10-10T10:00:00Z';
 const options = { ...defaultInvoiceSettings, referencePrefix: 'ABC', startingSequence: 100 };
 assert.equal(saleWorkspaceNumber(a,'invoice',now,options),'ABC-INV-2026-00100');
 assert.equal(saleWorkspaceNumber(a,'invoice',now,{...options,startingSequence:1}),'ABC-INV-2026-00101');
 assert.equal(saleWorkspaceNumber(a,'invoice',now),'INV-2026-00102');
 assert.equal(saleWorkspaceNumber(a,'invoice',now,options),'ABC-INV-2026-00103');
 assert.equal(saleWorkspaceNumber(a,'receipt',now,options),'ABC-RCP-2026-00100');
 assert.equal(saleWorkspaceNumber(b,'invoice',now,options),'ABC-INV-2026-00100');
 assert.equal(saleWorkspaceNumber(a,'invoice','2027-01-01',options),'ABC-INV-2027-00100');
 assert.throws(()=>saleWorkspaceNumber(a,'invoice',now,{...options,startingSequence:0}));
 assert.throws(()=>saleWorkspaceNumber(a,'invoice',now,{...options,referencePrefix:'bad prefix'}));
});
test('A4 settings reject oversized wording on the server and preserve the original settings',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'a4-invoice-settings-'));
 try {
  const store=new DealerIntegrationsStore({filename:join(dir,'a.json'),dealerId:'a4',production:false,databaseBacked:false});
  const initial=await store.readSalesPaperwork();
  for(const key of Object.keys(invoiceTextLimits) as Array<keyof typeof invoiceTextLimits>) {
   const input={expectedRevision:initial.revision,saleTerms:'Approved',reservationTerms:'',invoiceSettings:{...defaultInvoiceSettings}};
   if(key==='saleTerms'||key==='reservationTerms') input[key]='x'.repeat(invoiceTextLimits[key]+1);
   else input.invoiceSettings[key]='x'.repeat(invoiceTextLimits[key]+1);
   await assert.rejects(store.updateSalesPaperwork(input),/Shorten/);
   assert.deepEqual(await store.readSalesPaperwork(),initial);
  }
  const saved=await store.updateSalesPaperwork({expectedRevision:initial.revision,saleTerms:'x'.repeat(invoiceTextLimits.saleTerms),reservationTerms:'',invoiceSettings:{...defaultInvoiceSettings,style:'branded'}});
  assert.equal(saved.invoiceSettings?.style,'branded');
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('settings are isolated, revision protected, validated and backward compatible', async () => {
 const dir = await mkdtemp(join(tmpdir(),'invoice-settings-'));
 try {
  const a = new DealerIntegrationsStore({filename:join(dir,'a.json'),dealerId:'a',production:false,databaseBacked:false});
  const b = new DealerIntegrationsStore({filename:join(dir,'b.json'),dealerId:'b',production:false,databaseBacked:false});
  const options = {...defaultInvoiceSettings, referencePrefix:'ABC',startingSequence:500,footer:'Thank you',useWebsiteColour:false,accent:'#6a3d70'};
  const initial = await a.readSalesPaperwork();
  const saved = await a.updateSalesPaperwork({expectedRevision:initial.revision,saleTerms:'Approved',reservationTerms:'',invoiceSettings:options});
  assert.deepEqual((await a.readSalesPaperwork()).invoiceSettings,options);
  assert.equal((await b.readSalesPaperwork()).invoiceSettings.referencePrefix,'');
  await assert.rejects(a.updateSalesPaperwork({expectedRevision:initial.revision,saleTerms:'',reservationTerms:'',invoiceSettings:options}));
  for (const invalid of [{...options,startingSequence:-1},{...options,referencePrefix:'INV-RCP'}]) await assert.rejects(a.updateSalesPaperwork({expectedRevision:saved.revision,saleTerms:'',reservationTerms:'',invoiceSettings:invalid}));
  await a.updateSalesPaperwork({expectedRevision:saved.revision,saleTerms:'Revised',reservationTerms:''});
  assert.deepEqual((await a.readSalesPaperwork()).invoiceSettings,options);
  const frozen = invoiceBranding(saleWorkspaceBranding({identity:{name:'Dealer A'}}),options);
  options.footer='Changed';assert.equal(frozen.invoiceSettings?.footer,'Thank you');assert.equal(frozen.presentation?.linkColour,'#6a3d70');
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('seller overrides survive older settings clients, remain isolated and freeze into issued branding', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'invoice-seller-'));
 try {
  const a = new DealerIntegrationsStore({ filename: join(dir, 'a.json'), dealerId: 'seller-a', production: false, databaseBacked: false });
  const b = new DealerIntegrationsStore({ filename: join(dir, 'b.json'), dealerId: 'seller-b', production: false, databaseBacked: false });
  const initial = await a.readSalesPaperwork();
  const saved = await a.updateSalesPaperwork({ expectedRevision: initial.revision, saleTerms: 'CUSTOM TERMS', reservationTerms: 'CUSTOM DEPOSIT', invoiceDetails: { name: 'Seller A', vatNumber: '', email: 'a@example.test' } });
  const frozen = invoiceBranding(saleWorkspaceBranding({ identity: { name: 'Website A' } }), saved.invoiceSettings, saved.invoiceDetails);
  const before = JSON.stringify(frozen);
  await assert.rejects(a.updateSalesPaperwork({ expectedRevision: saved.revision, saleTerms: 'CUSTOM TERMS', reservationTerms: '', invoiceDetails: { name: 'bad\nname' } }));
  await assert.rejects(a.updateSalesPaperwork({ expectedRevision: saved.revision, saleTerms: 'CUSTOM TERMS', reservationTerms: '', invoiceDetails: { email: 'invalid' } }));
  const legacy = await a.updateSalesPaperwork({ expectedRevision: saved.revision, saleTerms: '', reservationTerms: 'CUSTOM DEPOSIT' });
  assert.equal(legacy.invoiceDetails?.name, 'Seller A');
  assert.equal((await a.readSalesPaperwork()).saleTerms, '');
  assert.deepEqual((await b.readSalesPaperwork()).invoiceDetails, {});
  await a.updateSalesPaperwork({ expectedRevision: legacy.revision, saleTerms: 'NEW TERMS', reservationTerms: '', invoiceDetails: { name: 'New seller' } });
  assert.equal(JSON.stringify(frozen), before);
  assert.equal(frozen.identity.name, 'Seller A');
  assert.equal(frozen.legal.vatNumber, '');
 } finally { await rm(dir, { recursive: true, force: true }); }
});
