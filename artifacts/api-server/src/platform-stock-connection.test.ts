import assert from 'node:assert/strict';
import test from 'node:test';
import { createCipheriv, randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import express from 'express';
import { eq } from 'drizzle-orm';
import { db, engine, dealershipsTable, dealerPrivateSettingsTable, dealerImportKeysTable } from './test/tenant-test-db';

process.env.MULTI_TENANT_ENABLED='true';
process.env.PLATFORM_ADMIN_HOST='admin.example.test';
process.env.PLATFORM_ADMIN_USER_IDS='user_admin';
process.env.INTEGRATIONS_ENCRYPTION_KEY='ab'.repeat(32);

function encrypted(connection?: Record<string,unknown>) {
  const state = {version:1,revision:1,updatedAt:null,resend:{enabled:true,apiKey:'never-return-resend-secret',from:'sender@example.test',replyTo:''},stripe:{enabled:false,mode:'test',secretKey:'never-return-stripe-secret'},templates:{private:'never-return-template'},...(connection ? {stockConnection:connection} : {})};
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(process.env.INTEGRATIONS_ENCRYPTION_KEY!,'hex'),iv);
  const data=Buffer.concat([cipher.update(JSON.stringify(state),'utf8'),cipher.final()]);
  return {encrypted:true,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};
}

test('platform effective stock source is scoped, read-only and secret-free', async t => {
  for(const file of (await readdir('../../lib/db/drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort()) await engine.exec(await readFile(join('../../lib/db/drizzle',file),'utf8'));
  const dealer={id:'source-a',name:'Fictional Source A',canonicalOrigin:'https://a.example.test',stockPlatform:'autotrader' as const,retailerId:'retailer-a',sourceUrl:'https://www.autotrader.co.uk/cars/retailer/stock?retailerId=retailer-a'};
  const other={...dealer,id:'source-b',name:'Fictional Source B',canonicalOrigin:'https://b.example.test',retailerId:'retailer-b',sourceUrl:'https://www.autotrader.co.uk/cars/retailer/stock?retailerId=retailer-b'};
  await db.insert(dealershipsTable).values([dealer,other]);
  const [aKey]=await db.insert(dealerImportKeysTable).values({dealerId:dealer.id,secretHash:'never-return-a-key-hash'}).returning();
  await db.insert(dealerImportKeysTable).values({dealerId:other.id,secretHash:'never-return-b-key-hash'});
  const {default:router}=await import('./routes/platform-dealers');
  const app=express();app.use(express.json());app.use('/api/platform',router);
  const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error('Local test server unavailable');
  const request=(id=dealer.id,user='user_admin',host='admin.example.test'):Promise<{status:number;body:any;text:string}>=>new Promise((resolve,reject)=>{
    const req=httpRequest(`http://127.0.0.1:${address.port}/api/platform/dealers/${encodeURIComponent(id)}/workspace`,{headers:{host,'x-test-user':user}},res=>{
      let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode!,body:JSON.parse(text),text}));
    });req.on('error',reject);req.end();
  });
  try {
    await t.test('uses registered source only when private settings were successfully read as absent',async()=>{
      const result=await request();assert.equal(result.status,200);
      assert.deepEqual(result.body.effectiveStockConnection,{status:'known',platform:'autotrader',retailerId:'retailer-a',sourceUrl:dealer.sourceUrl,enabled:true,usesOverride:false});
      assert.deepEqual(result.body.keys.map((key:{id:string})=>key.id),[aKey.id]);
      assert.deepEqual(Object.keys(result.body.keys[0]).sort(),['createdAt','disabledAt','id']);
      assert.ok(!result.text.includes('never-return'));
    });
    await t.test('reports a saved override and disabled imports without leaking any private settings',async()=>{
      const sourceUrl=dealer.sourceUrl+'&sort=price-asc';
      const payload=encrypted({platform:'autotrader',retailerId:'retailer-a',sourceUrl,enabled:false,privateToken:'never-return-connection-token'});
      await db.insert(dealerPrivateSettingsTable).values({dealerId:dealer.id,revision:1,encryptedPayload:payload});
      const result=await request();assert.deepEqual(result.body.effectiveStockConnection,{status:'known',platform:'autotrader',retailerId:'retailer-a',sourceUrl,enabled:false,usesOverride:true});
      assert.ok(!result.text.includes('never-return'));assert.ok(!result.text.includes('encryptedPayload'));
      assert.deepEqual(Object.keys(result.body.effectiveStockConnection).sort(),['enabled','platform','retailerId','sourceUrl','status','usesOverride']);
      const [after]=await db.select().from(dealerPrivateSettingsTable).where(eq(dealerPrivateSettingsTable.dealerId,dealer.id));assert.deepEqual(after.encryptedPayload,payload);
      assert.equal((await request(other.id)).body.effectiveStockConnection.sourceUrl,other.sourceUrl);
      assert.equal((await request(other.id)).body.effectiveStockConnection.usesOverride,false);
    });
    await t.test('keeps registry identity authoritative and marks a mismatched private connection unknown',async()=>{
      await db.update(dealerPrivateSettingsTable).set({encryptedPayload:encrypted({platform:'autotrader',retailerId:'retailer-b',sourceUrl:other.sourceUrl,enabled:true})}).where(eq(dealerPrivateSettingsTable.dealerId,dealer.id));
      const result=await request();assert.equal(result.status,200);assert.deepEqual(result.body.effectiveStockConnection,{status:'unknown',platform:null,retailerId:null,sourceUrl:null,enabled:null,usesOverride:null});
      assert.equal(result.body.dealer.sourceUrl,dealer.sourceUrl);assert.ok(!JSON.stringify(result.body.effectiveStockConnection).includes('retailer-b'));
    });
    await t.test('fails closed when private settings cannot be decrypted instead of presenting registry as active',async()=>{
      await db.update(dealerPrivateSettingsTable).set({encryptedPayload:{encrypted:true,iv:'bad',tag:'bad',data:'never-return-corrupt-payload'}}).where(eq(dealerPrivateSettingsTable.dealerId,dealer.id));
      const result=await request();assert.equal(result.body.effectiveStockConnection.status,'unknown');assert.equal(result.body.effectiveStockConnection.sourceUrl,null);assert.ok(!result.text.includes('never-return'));
    });
    await t.test('preserves platform authorization, known dealer and source URL boundaries',async()=>{
      assert.equal((await request(dealer.id,'user_other')).status,403);
      assert.equal((await request(dealer.id,'user_admin','a.example.test')).status,403);
      assert.equal((await request('source-missing')).status,404);
      for(const sourceUrl of ['http://www.autotrader.co.uk/stock','https://evil.example.test/stock','https://secret@www.autotrader.co.uk/stock']) {
        await db.update(dealerPrivateSettingsTable).set({encryptedPayload:encrypted({platform:'autotrader',retailerId:'retailer-a',sourceUrl,enabled:true})}).where(eq(dealerPrivateSettingsTable.dealerId,dealer.id));
        assert.equal((await request()).body.effectiveStockConnection.status,'unknown');
      }
    });
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await engine.close();}
});
