import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultEmailAppearance } from '@workspace/vehicle-meta';
import { emailWebsiteBranding, resolveEmailWebsiteAppearance } from './lib/email-website-branding';
import { DealerIntegrationsStore } from './lib/dealer-integrations-store';

const custom = { ...defaultEmailAppearance, logoUrl:'https://custom.example.test/logo.png', brandColour:'#224466', heading:'Approved heading', footer:'Approved footer wording' };
const website = { logoUrl:'https://dealer.example.test/logo.svg', brandColour:'#CC8800' };
async function fixture(work: (store: DealerIntegrationsStore, filename: string, setWebsite: (next: typeof website) => void, calls: ()=>number) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(),'luxxy-branding-')), filename = join(dir,'settings.json');
  let current = website, calls = 0;
  const store = new DealerIntegrationsStore({filename,production:false,readWebsiteBranding:async()=>{calls++;return current;}});
  try { await work(store,filename,next=>{current=next;},()=>calls); } finally { await rm(dir,{recursive:true,force:true}); }
}

test('website branding converts colours and resolves relative logos on the dealer origin',()=>{
  assert.deepEqual(emailWebsiteBranding({identity:{logoAsset:'/api/demo-logo',brandColors:{accentHsl:'40 100% 50%'}}},'https://dealer.example.test'),{logoUrl:'https://dealer.example.test/api/demo-logo',brandColour:'#FFAA00'});
  assert.equal(emailWebsiteBranding({identity:{brandColors:{accentHsl:'120 100% 25%'}}},'https://dealer.example.test').brandColour,'#008000');
  assert.equal(emailWebsiteBranding({identity:{brandColors:{accentHsl:'invalid'}}},'https://dealer.example.test').brandColour,'#172033');
});
test('unsafe, credential-bearing, and data logos never become email markup',()=>{
  for(const asset of ['javascript:alert(1)','data:image/png;base64,abc','https://user:pass@example.test/logo.svg','http://example.test/a.svg']) assert.equal(emailWebsiteBranding({identity:{logoAsset:asset}},'https://dealer.example.test').logoUrl,'');
  assert.deepEqual(resolveEmailWebsiteAppearance(custom,true,website),{...custom,...website});
  assert.deepEqual(resolveEmailWebsiteAppearance(custom,false,website),custom);
});
test('new configurations inherit published branding, retain custom wording and follow later website edits',async()=>fixture(async(store,filename,setWebsite)=>{
  const first = await store.listTemplates();
  assert.equal(first.useWebsiteBranding,true); assert.equal(first.appearance.logoUrl,website.logoUrl);
  const saved = await store.updateAppearance({expectedRevision:0,appearance:custom,useWebsiteBranding:true});
  assert.deepEqual(saved.appearance,{...custom,...website}); assert.deepEqual(saved.customAppearance,custom);
  setWebsite({...website,brandColour:'#557799'});
  assert.equal((await store.readPrivate()).appearance.brandColour,'#557799');
  assert.equal((await store.listTemplates()).appearance.footer,custom.footer);
  const stored = JSON.parse(await readFile(filename,'utf8'));
  assert.deepEqual(stored.appearance,custom); assert.equal(stored.resend.enabled,false);
}));
test('existing saved configurations preserve their custom branding until an owner opts in',async()=>fixture(async(store,filename)=>{
  await store.updateAppearance({expectedRevision:0,appearance:custom});
  const legacy = JSON.parse(await readFile(filename,'utf8')); delete legacy.useWebsiteBranding;
  await writeFile(filename,JSON.stringify(legacy));
  const saved = await store.listTemplates(); assert.equal(saved.useWebsiteBranding,false); assert.deepEqual(saved.appearance,custom);
  assert.deepEqual((await store.readPrivate()).appearance,custom);
}));
test('turning inheritance off restores the preserved override; template saves never overwrite it',async()=>fixture(async(store)=>{
  await store.updateAppearance({expectedRevision:0,appearance:custom,useWebsiteBranding:true});
  const next = await store.updateTemplate({expectedRevision:1,id:'enquiry_acknowledgement',subject:'Approved subject',body:'Approved dealer wording'});
  assert.equal(next.useWebsiteBranding,true); assert.deepEqual(next.customAppearance,custom);
  const result = await store.updateAppearance({expectedRevision:2,appearance:next.customAppearance,useWebsiteBranding:false});
  assert.deepEqual(result.appearance,custom);
  assert.equal(result.templates.find(t=>t.id==='enquiry_acknowledgement')?.body,'Approved dealer wording');
}));
test('rejects invalid flags, stale revisions and invalid custom fields without saving',async()=>fixture(async(store)=>{
  await assert.rejects(store.updateAppearance({expectedRevision:0,appearance:custom,useWebsiteBranding:'yes'}),/valid email branding/);
  await assert.rejects(store.updateAppearance({expectedRevision:0,appearance:{...custom,logoUrl:'javascript:x'},useWebsiteBranding:true}),/HTTPS/);
  await store.updateAppearance({expectedRevision:0,appearance:custom,useWebsiteBranding:true});
  await assert.rejects(store.updateAppearance({expectedRevision:0,appearance:custom,useWebsiteBranding:false}),/another session/);
  assert.equal((await store.listTemplates()).useWebsiteBranding,true);
}));
test('stock, readiness and transactional reads never acquire a branding connection',async()=>fixture(async(store,_filename,_set,calls)=>{
  await store.readStockConnection({}); await store.readMasked(); await store.readPrivate({});
  assert.equal(calls(),0);
  await store.listTemplates(); assert.equal(calls(),1);
}));
