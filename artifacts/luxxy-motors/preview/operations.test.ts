import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { operationsPreview } from './operations';
import { previewSettings } from './settings';
test('local operations enforce roles, require publication revisions and preserve concurrent edits in history',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'luxxy-operations-test-'));
  let settings=structuredClone(previewSettings) as unknown as Record<string,unknown>;
  const server=createServer((req,res)=>{void operationsPreview(req,res,new URL(req.url??'/',`http://${req.headers.host}`),{stateFile:join(folder,'operations.json'),readSettings:async()=>settings,writeSettings:async config=>{settings=config;},readEnquiries:async()=>[],readSales:async()=>[]}).then(handled=>{if(!handled){res.statusCode=200;res.end('allowed');}});});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
  try {
    const original=await fetch(`${base}/api/dealer-settings`);assert.equal(original.headers.get('x-settings-revision'),'0');const config=await original.json();
    const missing=await fetch(`${base}/api/dealer-settings`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(config)});assert.equal(missing.status,428);
    const denied=await fetch(`${base}/api/dealer-integrations`,{headers:{'x-preview-staff-id':'preview-jamie'}});assert.equal(denied.status,403);
    const permissions=await fetch(`${base}/api/staff/access`,{headers:{'x-preview-staff-id':'preview-jamie'}});assert.equal((await permissions.json()).role,'salesperson');
    const a={...config,identity:{...config.identity,name:'Dealer A'}},b={...config,identity:{...config.identity,name:'Dealer B'}};
    const [first,second]=await Promise.all([a,b].map(value=>fetch(`${base}/api/dealer-settings`,{method:'PATCH',headers:{'Content-Type':'application/json','If-Match':'"0"'},body:JSON.stringify(value)})));
    assert.deepEqual([first.status,second.status].sort(),[200,409]);
    const history=await(await fetch(`${base}/api/staff/settings-history`)).json();assert.equal(history.revision,1);assert.equal(history.versions.length,2);
    const restored=await fetch(`${base}/api/staff/settings-history/0/restore`,{method:'POST',headers:{'If-Match':'"1"'}});assert.equal(restored.status,200);assert.equal(restored.headers.get('x-settings-revision'),'2');assert.equal((await restored.json()).config.identity.name,config.identity.name);
    assert.equal((settings.identity as {name:string}).name,config.identity.name);
    const ownerId='00000000-0000-4000-8000-000000000001';
    const noOwner=await fetch(`${base}/api/staff/team/${ownerId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'salesperson'})});assert.equal(noOwner.status,409);
    const csvDenied=await fetch(`${base}/api/dealer-operations/payments.csv`,{headers:{'x-preview-staff-id':'preview-jamie'}});assert.equal(csvDenied.status,403);
    const add=await fetch(`${base}/api/staff/team`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({authUserId:'preview-finance',email:'accounts@example.test',role:'accounts'})});assert.equal(add.status,201);
    const csv=await fetch(`${base}/api/dealer-operations/payments.csv`,{headers:{'x-preview-staff-id':'preview-finance'}});assert.equal(csv.status,200);assert.match(csv.headers.get('Content-Type')??'',/text\/csv/);
    const accountsEdit=await fetch(`${base}/api/staff/enquiries/test/workspace`,{method:'PATCH',headers:{'x-preview-staff-id':'preview-finance'}});assert.equal(accountsEdit.status,403);
    const crossOrigin=await fetch(`${base}/api/staff/access`,{headers:{Origin:'https://untrusted.example'}});assert.equal(crossOrigin.status,403);
  } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(folder,{recursive:true,force:true});}
});
