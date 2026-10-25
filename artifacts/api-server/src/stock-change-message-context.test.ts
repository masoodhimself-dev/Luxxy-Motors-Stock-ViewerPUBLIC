import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer, request } from 'node:http';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { db, engine, pool, dealershipsTable, portalUsersTable, vehiclesTable, enquiriesTable, stockChangeTasksTable, stockChangeCustomerOutcomesTable } from './test/tenant-test-db';
import { EmailProviderError } from './lib/email-provider';
import { deliverEmailOutbox } from './lib/email-outbox';
import { rebuildStaffOutboxEmail, createEnquiryEmailRouter } from './routes/enquiry-emails';
import { createStaffNotificationsRouter } from './routes/staff-notifications';
import phoneShares from './routes/phone-shares';
import { runWithTenant } from './lib/tenant-context';
import { defaultEmailAppearance } from '@workspace/vehicle-meta';
import { permissionsForRole } from './lib/staff-permissions';
import { savedStockChangeContext, requireSavedStockChangeContext } from './lib/stock-change-message-context';

process.env.MULTI_TENANT_ENABLED='true';process.env.INTEGRATIONS_ENCRYPTION_KEY='cd'.repeat(32);process.env.SESSION_SECRET='fictional-price-context';
await engine.waitReady;
globalThis.fetch=async()=>{throw new Error('External requests forbidden.');};
test('price-update provenance protects saved emails, WhatsApp handoff and customer attribution',async t=>{
  for(const name of (await readdir('../../lib/db/drizzle')).filter(n=>/^\d.*\.sql$/.test(n)).sort()) await engine.exec(await readFile('../../lib/db/drizzle/'+name,'utf8'));
  const dir=await mkdtemp(join(tmpdir(),'luxxy-price-context-'));process.env.INTEGRATIONS_PRIVATE_DIR=dir;
  const dealer='price-context-a',other='price-context-b',car=randomUUID(),enquiry=randomUUID(),task=randomUUID(),otherCar=randomUUID(),otherEnquiry=randomUUID();
  const tenant=(id=dealer)=>({dealerId:id,canonicalOrigin:`https://${id}.example.test`,platform:'autotrader' as const,retailerId:'fictional',sourceUrl:'https://www.autotrader.co.uk/cars/retailer/stock?retailerId=fictional',kind:'website' as const});
  for(const id of [dealer,other]){await db.insert(dealershipsTable).values({id,name:'Fictional dealer',status:'active',canonicalOrigin:tenant(id).canonicalOrigin,stockPlatform:'autotrader',retailerId:'fictional',sourceUrl:tenant(id).sourceUrl});await db.insert(portalUsersTable).values({dealerId:id,authUserId:'fictional-owner',role:'owner'});}
  await db.insert(vehiclesTable).values({id:car,dealerId:dealer,source:'autotrader',advertId:'fictional',title:'Ford Focus',sourcePrice:8495,inventoryStatus:'available'});
  await db.insert(enquiriesTable).values({id:enquiry,dealerId:dealer,type:'general',customerName:'Fictional Sarah',email:'sarah@example.test',phone:'07700900123',vehicleId:car,vehicleTitle:'Ford Focus',message:'Tell me about the car.'});
  await db.insert(stockChangeTasksTable).values({id:task,dealerId:dealer,vehicleId:car,kind:'price_drop',changeKey:'fictional-drop',previousPrice:8995,currentPrice:8495});
  await db.insert(vehiclesTable).values({id:otherCar,dealerId:other,source:'autotrader',advertId:'fictional-other',title:'Other dealer car',sourcePrice:8495,inventoryStatus:'available'});
  await db.insert(enquiriesTable).values({id:otherEnquiry,dealerId:other,type:'general',customerName:'Other dealer customer',email:'other@example.test',phone:'07700900456',vehicleId:otherCar,vehicleTitle:'Other dealer car',message:'Other dealer request.'});
  const context={taskId:task,revision:0},draft={to:'sarah@example.test',subject:'Price update',message:'My reviewed words: £8,495. {{literal}}',includeVehicle:false,includeAppointment:false,photoIds:[],documentIds:[],customPhotoIds:[],vehiclePhotoIndices:[],includeVideo:false,expectedRevision:0,stockChange:context};
  const config:any={version:1,revision:0,updatedAt:null,resend:{enabled:true,apiKey:'re_fictional',from:'sales@example.test',replyTo:''},stripe:{enabled:false,mode:'test',publishableKey:'',secretKey:'',webhookSecret:''},templates:{},appearance:defaultEmailAppearance},sends:any[]=[];
  let providerMode:'success'|'queued'='success';
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.log={error(){},warn(){},info(){},debug(){}} as any;req.staff={authUserId:'fictional-owner',name:'Fictional owner',email:'owner@example.test',role:'owner',permissions:permissionsForRole('owner')};runWithTenant(tenant(req.get('x-test-dealer')||dealer),next);});
  app.use('/api',createEnquiryEmailRouter({settings:async()=>config,send:async(_config,body)=>{sends.push(body);if(providerMode==='queued')throw new EmailProviderError(429,60);return randomUUID();}}),createStaffNotificationsRouter(),phoneShares);
  const server=createServer(app);await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=(server.address() as {port:number}).port;
  const call=(path:string,body?:unknown,id=dealer,headers:Record<string,string>={})=>new Promise<{status:number;data:any}>((resolve,reject)=>{const r=request({host:'127.0.0.1',port,path:'/api'+path,method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-test-dealer':id,...headers}},res=>{const parts:Buffer[]=[];res.on('data',p=>parts.push(p));res.on('end',()=>{try{resolve({status:res.statusCode!,data:JSON.parse(Buffer.concat(parts).toString())});}catch(e){reject(e);}});});r.on('error',reject);r.end(body===undefined?undefined:JSON.stringify(body));});
  const base=`/staff/enquiries/${enquiry}`,preview=(body:any=draft,id=dealer)=>call(base+'/email-preview',body,id),pack=(body:any=draft)=>({requestId:randomUUID(),token:randomUUID().replaceAll('-','')+randomUUID().replaceAll('-',''),source:{kind:'enquiry-message',enquiryId:enquiry,draft:body}});
  try{
    await t.test('ordinary Inbox edits retain context and exact wording, and omission cannot bypass preview',async()=>{
      const saved=await call(base+'/email-draft',{expectedVersion:0,content:draft});assert.equal(saved.status,200,JSON.stringify(saved.data));assert.deepEqual(saved.data.savedDraft.content.stockChange,context);
      const {stockChange:_context,...ordinary}=draft,edited=await call(base+'/email-draft',{expectedVersion:1,content:{...ordinary,message:'Edited staff wording: £8,495.'}});assert.equal(edited.status,200,JSON.stringify(edited.data));assert.deepEqual(edited.data.savedDraft.content.stockChange,context);assert.equal(edited.data.savedDraft.content.message,'Edited staff wording: £8,495.');
      assert.equal((await preview(ordinary)).status,409);const loaded=await call(base+'/email-context');assert.equal(loaded.status,200);assert.deepEqual(loaded.data.savedDraft.content.stockChange,context);
      const reviewed=await preview({...draft,message:'Edited staff wording: £8,495.'});assert.equal(reviewed.status,200,JSON.stringify(reviewed.data));assert.match(reviewed.data.text,/Edited staff wording: £8,495/);
    });
    await t.test('changed price, availability, agreement, email and tenant block before send',async()=>{
      const approved=await preview();assert.equal(approved.status,200,JSON.stringify(approved.data));await pool.query('UPDATE vehicles SET source_price=7995 WHERE id=$1',[car]);assert.equal((await preview()).status,409);
      const blocked=await call(base+'/email',{...draft,requestId:randomUUID(),previewHash:approved.data.previewHash});assert.equal(blocked.status,409,JSON.stringify(blocked.data));assert.equal(sends.length,0);
      await pool.query("UPDATE vehicles SET source_price=8495,inventory_status='reserved' WHERE id=$1",[car]);assert.equal((await preview()).status,409);await pool.query("UPDATE vehicles SET inventory_status='available' WHERE id=$1",[car]);
      await pool.query("INSERT INTO leads(id,dealer_id,enquiry_id,customer_name,email,phone,vehicle_id,stage,source) VALUES($1,$2,$3,'Fictional Sarah','sarah@example.test','07700900123',$4,'sale_agreed','phone')",[randomUUID(),dealer,enquiry,car]);assert.equal((await preview()).status,409);await pool.query('DELETE FROM leads WHERE dealer_id=$1',[dealer]);assert.equal((await preview(draft,other)).status,404);assert.equal((await call(`/staff/enquiries/${otherEnquiry}/email-preview`,{...draft,to:'other@example.test'},other)).status,409);assert.equal((await preview({...draft,to:'wrong@example.test'})).status,409);
    });
    await t.test('explicit current-price wording can replace context; passive and stale replacements fail',async()=>{
      const before=await preview();
      await pool.query('UPDATE stock_change_tasks SET revision=1 WHERE id=$1',[task]);
      const replacement={...draft,stockChange:{...context,revision:1}};
      const data={expectedVersion:2,content:replacement};
      assert.equal((await call(base+'/email-draft',data)).status,409);
      assert.equal((await call(base+'/email-draft',{...data,replaceStockChangeContext:true,content:{...replacement,stockChange:{...context,revision:99}}})).status,409);
      const saved=await call(base+'/email-draft',{...data,replaceStockChangeContext:true});assert.equal(saved.status,200,JSON.stringify(saved.data));
      context.revision=1;assert.deepEqual(saved.data.savedDraft.content.stockChange,context);
      const after=await preview();assert.equal(after.status,200,JSON.stringify(after.data));assert.notEqual(after.data.previewHash,before.data.previewHash);
    });
    await t.test('phone-only save, WhatsApp context identity, stale replay/handoff and exact sent confirmation',async()=>{
      const saved=await call(base+'/email-draft',{expectedVersion:(await call(base+'/email-context')).data.version,content:{...draft,to:''}});assert.equal(saved.status,200,JSON.stringify(saved.data));const body=pack({...draft,to:''}),created=await call('/staff/phone-shares',body);assert.equal(created.status,201,JSON.stringify(created.data));assert.deepEqual(created.data.stockChange,context);assert.equal(created.data.customerPhone,'07700900123');assert.equal((await call('/staff/phone-shares',body)).data.replayed,true);
      const handoff=()=>call('/phone-shares',undefined,dealer,{'x-phone-share-token':body.token});assert.equal((await handoff()).status,200);
      const fallback={requestId:randomUUID(),enquiryId:enquiry,email:'sarah@example.test',grantId:created.data.id};const prepared=await call('/staff/phone-shares/email-enquiry',fallback);assert.equal(prepared.status,201,JSON.stringify(prepared.data));assert.deepEqual(prepared.data.stockChange,context);
      assert.equal((await call('/staff/phone-shares/email-enquiry',{...fallback,requestId:randomUUID(),email:'wrong@example.test'})).status,409);
      await pool.query('UPDATE vehicles SET source_price=7995 WHERE id=$1',[car]);assert.equal((await handoff()).status,409);assert.equal((await call('/staff/phone-shares/email-enquiry',fallback)).status,409);assert.equal((await call('/staff/phone-shares',body)).status,409);assert.equal((await call('/staff/phone-shares',pack({...draft,to:''}))).status,409);await pool.query('UPDATE vehicles SET source_price=8495 WHERE id=$1',[car]);
      const wrong=await call('/staff/phone-shares/confirm-whatsapp',{requestId:randomUUID(),newCustomer:{name:'Different customer'},phone:'07700900123',message:'Sent',confirmed:true,grantId:created.data.id});assert.equal(wrong.status,409);
      const confirmed={requestId:randomUUID(),enquiryId:enquiry,phone:'07700900123',message:'Staff confirms actual sent price update.',confirmed:true,grantId:created.data.id},first=await call('/staff/phone-shares/confirm-whatsapp',confirmed);assert.equal(first.status,201,JSON.stringify(first.data));assert.equal(first.data.enquiryId,enquiry);assert.equal((await call('/staff/phone-shares/confirm-whatsapp',confirmed)).data.replayed,true);
      const events=(await pool.query('SELECT detail FROM enquiry_events WHERE id=$1',[confirmed.requestId])).rows;assert.equal(events.length,1);assert.deepEqual(events[0].detail.stockChange,context);
      const contacts=(await pool.query("SELECT * FROM stock_change_contact_events WHERE dealer_id=$1 AND channel='whatsapp'",[dealer])).rows;assert.equal(contacts.length,1);assert.equal(new Date(contacts[0].contacted_at).toISOString(),new Date(first.data.confirmedAt).toISOString());
      // Simulate a transient post-commit outcome failure: replay must repair it
      // at the original sent-confirmation time, never extend the contact interval.
      await pool.query('DELETE FROM stock_change_contact_events WHERE event_key=$1',[`whatsapp:${confirmed.requestId}`]);
      assert.equal((await call('/staff/phone-shares/confirm-whatsapp',confirmed)).data.replayed,true);
      const repaired=(await pool.query('SELECT contacted_at FROM stock_change_contact_events WHERE event_key=$1',[`whatsapp:${confirmed.requestId}`])).rows[0];assert.equal(new Date(repaired.contacted_at).toISOString(),new Date(first.data.confirmedAt).toISOString());
    });
    await t.test('explicit discard permits a general message',async()=>{
      const loaded=await call(base+'/email-context'),discarded=await call(base+'/email-draft/discard',{expectedVersion:loaded.data.version});assert.equal(discarded.status,200,JSON.stringify(discarded.data));const {stockChange:_context,...ordinary}=draft,next={...ordinary,expectedRevision:1};assert.equal((await preview(next)).status,200);assert.equal((await call('/staff/phone-shares',pack({...next,to:''}))).status,201);
      assert.throws(()=>requireSavedStockChangeContext(undefined,{savedDraft:{content:{stockChange:context}}}),/saved draft is a price update/);assert.equal(savedStockChangeContext({savedDraft:null}),undefined);
    });
    await t.test('queued retries block stale prices without another provider call, and a successful email records one contact',async()=>{
      const current={...draft,expectedRevision:1};providerMode='queued';
      const approved=await preview(current);assert.equal(approved.status,200,JSON.stringify(approved.data));
      const requestBody={...current,requestId:randomUUID(),previewHash:approved.data.previewHash};
      const first=await call(base+'/email',requestBody);assert.equal(first.status,201,JSON.stringify(first.data));
      const queued=(await pool.query('SELECT * FROM email_outbox WHERE delivery_id=$1',[first.data.delivery.id])).rows[0];assert.equal(queued.status,'queued');assert.equal(sends.length,1);
      await pool.query('UPDATE vehicles SET source_price=7995 WHERE id=$1',[car]);
      const blocked=await runWithTenant(tenant(),()=>deliverEmailOutbox(queued.id,{now:new Date(Date.now()+90000),settings:async()=>config.resend,rebuild:row=>rebuildStaffOutboxEmail(row,config),send:async()=>{throw new Error('Stale provider attempt is forbidden.');}}));
      assert.equal(blocked?.status,'failed');assert.equal(blocked?.error_code,'price_update_changed');assert.equal(sends.length,1);
      assert.equal(Number((await pool.query("SELECT count(*) FROM stock_change_contact_events WHERE dealer_id=$1 AND channel='email'",[dealer])).rows[0].count),0);
      await pool.query('UPDATE vehicles SET source_price=8495 WHERE id=$1',[car]);await pool.query("UPDATE email_account_throttle SET next_allowed_at=now()-interval '1 second'");providerMode='success';
      const fresh=await preview(current),body={...current,requestId:randomUUID(),previewHash:fresh.data.previewHash};const sent=await call(base+'/email',body);assert.equal(sent.status,201,JSON.stringify(sent.data));assert.equal(sent.data.delivery.status,'sent');
      assert.equal((await call(base+'/email',body)).data.replayed,true);assert.equal(sends.length,2);
      assert.equal(Number((await pool.query("SELECT count(*) FROM stock_change_contact_events WHERE dealer_id=$1 AND channel='email'",[dealer])).rows[0].count),1);
    });
    await t.test('a real WhatsApp confirmation finishes its reminder while late replay preserves a newer callback',async()=>{
      const customerId=randomUUID(),at=new Date(Date.now()+86400000),before=new Date(Date.now()-1000),marker=`Price update follow-up (${task})`;
      await db.insert(enquiriesTable).values({id:customerId,dealerId:dealer,type:'general',customerName:'Fictional reminder customer',phone:'07700900222',vehicleId:car,vehicleTitle:'Ford Focus',message:'Fictional reminder case.',followUpAt:at,followUpNote:marker+'\nOriginal reminder',followUpRevision:1,followUpCompletedAt:null,updatedAt:before});
      await db.insert(stockChangeCustomerOutcomesTable).values({dealerId:dealer,taskId:task,enquiryId:customerId,status:'follow_up',followUpAt:at,revision:1,updatedBy:'Fictional owner',updatedAt:before});
      const body={requestId:randomUUID(),token:randomUUID().replaceAll('-','')+randomUUID().replaceAll('-',''),source:{kind:'enquiry-message',enquiryId:customerId,draft:{...draft,to:'',expectedRevision:0}}};
      const grant=await call('/staff/phone-shares',body);assert.equal(grant.status,201,JSON.stringify(grant.data));
      const confirm={requestId:randomUUID(),enquiryId:customerId,phone:'07700900222',message:'Fictional confirmation: answered the price question.',confirmed:true,grantId:grant.data.id};
      const first=await call('/staff/phone-shares/confirm-whatsapp',confirm);assert.equal(first.status,201,JSON.stringify(first.data));
      const initial=(await pool.query('SELECT follow_up_completed_at,follow_up_revision FROM enquiries WHERE dealer_id=$1 AND id=$2',[dealer,customerId])).rows[0];
      assert.ok(initial.follow_up_completed_at,'The actual confirmation should complete its own existing reminder.');assert.equal(initial.follow_up_revision,2);
      const initialOutcome=(await pool.query('SELECT status FROM stock_change_customer_outcomes WHERE dealer_id=$1 AND task_id=$2 AND enquiry_id=$3',[dealer,task,customerId])).rows[0];assert.equal(initialOutcome.status,'contacted');
      // A missing post-commit outcome write can be repaired after a newer callback.
      await pool.query('DELETE FROM stock_change_contact_events WHERE event_key=$1',[`whatsapp:${confirm.requestId}`]);
      const newerTime=new Date(Date.parse(first.data.confirmedAt)+1000),laterAt=new Date(at.getTime()+86400000);
      await pool.query("UPDATE stock_change_customer_outcomes SET status='follow_up',follow_up_at=$1,revision=revision+1,updated_at=$2 WHERE dealer_id=$3 AND task_id=$4 AND enquiry_id=$5",[laterAt,newerTime,dealer,task,customerId]);
      await pool.query('UPDATE enquiries SET follow_up_at=$1,follow_up_note=$2,follow_up_completed_at=NULL,follow_up_revision=follow_up_revision+1,updated_at=$3 WHERE dealer_id=$4 AND id=$5',[laterAt,marker+'\nNew callback after the message',newerTime,dealer,customerId]);
      const replay=await call('/staff/phone-shares/confirm-whatsapp',confirm);assert.equal(replay.status,200,JSON.stringify(replay.data));assert.equal(replay.data.replayed,true);
      const preserved=(await pool.query('SELECT follow_up_at,follow_up_note,follow_up_completed_at,follow_up_revision FROM enquiries WHERE dealer_id=$1 AND id=$2',[dealer,customerId])).rows[0];
      assert.equal(new Date(preserved.follow_up_at).toISOString(),laterAt.toISOString());assert.equal(preserved.follow_up_completed_at,null);assert.equal(preserved.follow_up_revision,3);assert.match(preserved.follow_up_note,/New callback/);
      const outcome=(await pool.query('SELECT status,follow_up_at FROM stock_change_customer_outcomes WHERE dealer_id=$1 AND task_id=$2 AND enquiry_id=$3',[dealer,task,customerId])).rows[0];assert.equal(outcome.status,'follow_up');assert.equal(new Date(outcome.follow_up_at).toISOString(),laterAt.toISOString());
      const recorded=(await pool.query('SELECT contacted_at FROM stock_change_contact_events WHERE event_key=$1',[`whatsapp:${confirm.requestId}`])).rows[0];assert.equal(new Date(recorded.contacted_at).toISOString(),new Date(first.data.confirmedAt).toISOString());
    });
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await engine.close();await rm(dir,{recursive:true,force:true});}
});
