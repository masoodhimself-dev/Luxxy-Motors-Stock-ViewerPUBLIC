import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer,request as httpRequest } from 'node:http';
import express from 'express';
import { db,engine,stockImportRunsTable,dealerImportKeysTable,portalUsersTable } from './test/tenant-test-db';
process.env.MULTI_TENANT_ENABLED='true';process.env.PLATFORM_ADMIN_HOST='admin.example.test';process.env.PLATFORM_ADMIN_USER_IDS='user_admin';
test('platform onboarding and operational views preserve access checks and omit secrets',async()=>{
 for(const file of (await readdir('../../lib/db/drizzle')).filter(n=>/^\d+.*\.sql$/.test(n)).sort()) await engine.exec(await readFile(join('../../lib/db/drizzle',file),'utf8'));
 const {default:router}=await import('./routes/platform-dealers'); const {resolveTenant}=await import('./middlewares/tenant');
 const app=express();app.use(express.json());app.use('/api/platform',router);app.use(resolveTenant);app.get('/',(_req,res)=>res.send('dealer'));
 const server=createServer(app);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw Error('No server');
 const request=(path:string,method='GET',body?:unknown,user='user_admin',host='admin.example.test',origin?:string):Promise<Response>=>new Promise((resolve,reject)=>{const req=httpRequest(`http://127.0.0.1:${address.port}${path}`,{method,headers:{host,'content-type':'application/json','x-test-user':user,...(origin?{origin}:{})}},r=>{let s='';r.on('data',c=>s+=c);r.on('end',()=>resolve(new Response(s||null,{status:r.statusCode,headers:{'Content-Type':r.headers['content-type']??'application/json',...(r.headers.location?{location:r.headers.location}:{})}})));});req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();});
 const input={id:'test-dealer',name:'Test Dealer',canonicalOrigin:'https://dealer.example.test',platform:'autotrader',retailerId:'fictional',sourceUrl:'https://www.autotrader.co.uk/fictional',useMyAccount:true};
 try{
  assert.equal((await request('/api/platform/overview','GET',undefined,'user_other')).status,403);
  assert.equal((await request('/api/platform/overview','GET',undefined,'user_admin','other.example.test')).status,403);
  assert.equal((await request('/api/platform/dealers','POST',input,'user_admin','admin.example.test','https://evil.example.test')).status,403);
  const root=await request('/');assert.equal(root.status,302);assert.equal(root.headers.get('location'),'/platform');
  assert.equal((await request('/api/platform/dealers','POST',{...input,canonicalOrigin:'https://admin.example.test'})).status,400);
  assert.equal((await request('/api/platform/dealers','POST',input)).status,201);
  assert.equal((await request('/api/platform/dealers/test-dealer/domains','POST',{hostname:'admin.example.test'})).status,400);
  assert.equal((await db.select().from(portalUsersTable))[0].authUserId,'user_admin');
  assert.equal((await request('/api/platform/dealers','POST',input)).status,409);
  assert.equal((await request('/api/platform/dealers','POST',{...input,id:'bad-source',sourceUrl:'https://evil.example.test'})).status,400);
  assert.equal((await request('/api/platform/dealers','POST',{...input,id:'two-owners',ownerAuthUserId:'user_owner'})).status,400);
  assert.equal((await request('/api/platform/dealers','POST',{...input,id:'email-dealer',canonicalOrigin:'https://email.example.test',useMyAccount:undefined,ownerEmail:'owner@example.test'})).status,201);
  assert.equal((await request('/api/platform/dealers','POST',{...input,id:'missing-owner',canonicalOrigin:'https://missing.example.test',useMyAccount:undefined,ownerEmail:'missing@example.test'})).status,400);
  assert.equal((await request('/api/platform/dealers/test-dealer/status','PUT',{status:'active'})).status,409);
  await db.insert(dealerImportKeysTable).values({dealerId:'test-dealer',secretHash:'never-return-this-hash'});
  for(const [runId,status,time] of [['run-good','completed','2026-10-10T08:00:00Z'],['run-held','quarantined','2026-10-10T20:00:00Z']] as const) await db.insert(stockImportRunsTable).values({runId,status,receivedAt:new Date(time),scrapedAt:new Date(time),dealerId:'test-dealer',source:'grok',retailerId:'fictional',schemaVersion:'1',expectedCount:1,receivedCount:1,rawSnapshot:{secret:'never-return-this-snapshot'}});
  const overview=await request('/api/platform/overview');assert.equal(overview.status,200);const text=await overview.text();assert.ok(!text.includes('never-return'));const data=JSON.parse(text);const dealer=data.dealers.find((d:{id:string})=>d.id==='test-dealer');assert.equal(dealer.latestImport.runId,'run-held');assert.equal(dealer.lastSuccessfulImport.runId,'run-good');assert.equal(dealer.activeKeyCount,1);
  const workspace=await request('/api/platform/dealers/test-dealer/workspace');assert.equal(workspace.status,200);const details=await workspace.text();assert.ok(!details.includes('never-return'));assert.equal(JSON.parse(details).imports.length,2);
  assert.equal((await request('/api/platform/dealers/unknown/workspace')).status,404);
 }finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));await engine.close();}
});
