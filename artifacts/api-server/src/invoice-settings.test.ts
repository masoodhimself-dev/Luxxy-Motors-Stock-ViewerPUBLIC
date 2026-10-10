import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultInvoiceSettings, invoiceBranding, saleWorkspaceBranding, saleWorkspaceNumber } from '@workspace/vehicle-meta';
import { DealerIntegrationsStore } from './lib/dealer-integrations-store';
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
