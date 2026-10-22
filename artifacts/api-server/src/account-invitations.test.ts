import assert from 'node:assert/strict';
import test from 'node:test';
import {readdir,readFile} from 'node:fs/promises';
import {createServer,request as httpRequest} from 'node:http';
import express from 'express';
import {engine} from './test/tenant-test-db';
import {invitationProfiles} from './test/invitation-clerk';
import {invitationTokenHash} from './lib/account-invitations';
process.env.MULTI_TENANT_ENABLED='true';process.env.PLATFORM_ADMIN_HOST='admin.example.test';process.env.PLATFORM_ADMIN_USER_IDS='user_admin';
process.env.RESEND_API_KEY='re_fictional_invites_only';process.env.RESEND_FROM_EMAIL='Luxxy <accounts@example.test>';
function profile(id:string,email:string,verified=true){invitationProfiles.set(id,{id,firstName:'Fictional',lastName:id,primaryEmailAddress:{emailAddress:email},emailAddresses:[{emailAddress:email,verification:{status:verified?'verified':'unverified'}}]});}
profile('user_admin','admin@example.test');profile('user_owner','owner@example.test');profile('user_new_owner','new-owner@example.test');profile('user_alice','alice@example.test');profile('user_other','other@example.test');profile('user_unverified','alice@example.test',false);profile('user_sales','sales@example.test');profile('user_cross','cross@example.test');

test.after(async()=>{await engine.close();});
test('owner and staff invitations use verified identity, isolated memberships and reversible pending access',async(t)=>{
 for(const file of (await readdir('../../lib/db/drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort())await engine.exec(await readFile('../../lib/db/drizzle/'+file,'utf8'));
 await engine.exec("INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES ('invite-a','Fictional Motors A','active','https://a.example.test','autotrader','fake-a','https://www.autotrader.co.uk/fake'),('invite-b','Fictional Motors B','active','https://b.example.test','autotrader','fake-b','https://www.autotrader.co.uk/fake'); INSERT INTO dealer_domains(hostname,dealer_id,verified,verification_token) VALUES('a.example.test','invite-a',true,'fictional'),('b.example.test','invite-b',true,'fictional'); INSERT INTO portal_users(dealer_id,auth_user_id,email,role) VALUES('invite-a','user_owner','owner@example.test','owner'),('invite-a','user_sales','sales@example.test','salesperson'),('invite-b','user_owner','owner@example.test','owner');");
 const {default:platform}=await import('./routes/platform-dealers');const {default:publicRouter}=await import('./routes/account-invitations');const {default:staff}=await import('./routes/dealer-operations');const {resolveTenant}=await import('./middlewares/tenant');
 const app=express();app.use(express.json());app.use('/api/platform',platform);app.use('/api/account-invitations',publicRouter);app.use(resolveTenant);app.use('/api',staff);app.get('/join',(_req,res)=>res.send('join page'));
 const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Missing listener');
 const call=(path:string,options:{method?:string;body?:unknown;host?:string;user?:string;token?:string;origin?:string}={}):Promise<Response>=>new Promise((resolve,reject)=>{const req=httpRequest(`http://127.0.0.1:${address.port}${path}`,{method:options.method??'GET',headers:{host:options.host??'a.example.test','content-type':'application/json','x-test-user':options.user??'user_owner',...(options.token?{'x-account-invitation-token':options.token}:{}),...(options.origin?{origin:options.origin}:{})}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve(new Response(text||null,{status:res.statusCode,headers:{'content-type':'application/json','cache-control':res.headers['cache-control']??''}})));});req.on('error',reject);if(options.body)req.write(JSON.stringify(options.body));req.end();});
 const messages:any[]=[];let providerStatus=200;const originalFetch=globalThis.fetch;globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.resend.com/emails');const message=JSON.parse(String(init?.body));messages.push(message);assert.match(String((init?.headers as Record<string,string>)['Idempotency-Key']),/^account-invite:/);return Response.json(providerStatus===200?{id:`fictional-${messages.length}`}:{error:'fictional failure'},{status:providerStatus});};
 const tokenFromLastMail=()=>{const url=/https:\/\/[^\s<>]+\/join#[a-f0-9]{64}/.exec(messages.at(-1).text)?.[0];assert.ok(url,messages.at(-1).text);return new URL(url).hash.slice(1);};
 const invite=async(email:string,role='salesperson',host='a.example.test')=>{const response=await call('/api/staff/team/invitations',{method:'POST',body:{email,role},host});assert.equal(response.status,201,await response.clone().text());return {data:(await response.json() as any).invitation,token:tokenFromLastMail()};};
 const accept=(token:string,user:string,host='a.example.test')=>call('/api/account-invitations/accept',{method:'POST',body:{},token,user,host});
 try {
 await t.test('a platform draft can invite an unregistered owner without granting access or requiring its new domain',async()=>{
  invitationProfiles.delete('user_new_owner');
  const input={id:'invite-new',name:'New Fictional Dealer',canonicalOrigin:'https://new.example.test',platform:'autotrader',retailerId:'fake-new',sourceUrl:'https://www.autotrader.co.uk/fake',inviteOwnerEmail:'new-owner@example.test'};
  const denied=await call('/api/platform/dealers',{method:'POST',body:input,host:'admin.example.test',user:'user_other'});assert.equal(denied.status,403);
  const response=await call('/api/platform/dealers',{method:'POST',body:input,host:'admin.example.test',user:'user_admin'});assert.equal(response.status,201,await response.clone().text());const created=await response.json() as any;assert.equal(created.ownerInvitation.deliveryStatus,'sent');assert.match(messages.at(-1).html,/Accept invitation/);assert.deepEqual(messages.at(-1).to,['new-owner@example.test']);
  assert.equal((await engine.query<any>("SELECT * FROM portal_users WHERE dealer_id='invite-new' AND auth_user_id='user_new_owner'")).rows.length,0);
  const token=tokenFromLastMail();assert.match(messages.at(-1).text,/https:\/\/admin.example.test\/join#/);assert.equal((await call('/join',{host:'admin.example.test',user:''})).status,200);
  assert.equal((await accept(token,'user_new_owner','a.example.test')).status,403);
  profile('user_new_owner','new-owner@example.test');
  const accepted=await accept(token,'user_new_owner','admin.example.test');assert.equal(accepted.status,200);assert.equal((await accepted.json() as any).portalUrl,null);
  assert.equal((await engine.query<any>("SELECT role FROM portal_users WHERE dealer_id='invite-new' AND auth_user_id='user_new_owner'")).rows[0].role,'owner');
 });
 let alice:{data:any;token:string};
 await t.test('owners can invite staff, but unauthorised staff and cross-origin requests cannot',async()=>{
  assert.equal((await call('/api/staff/team/invitations',{user:'user_sales'})).status,403);
  assert.equal((await call('/api/staff/team/invitations',{method:'POST',user:'user_sales',body:{email:'alice@example.test',role:'owner'}})).status,403);
  assert.equal((await call('/api/staff/team/invitations',{method:'POST',origin:'https://b.example.test',body:{email:'alice@example.test',role:'owner'}})).status,403);
  assert.equal((await call('/api/staff/team/invitations',{method:'POST',body:{email:'bad',role:'admin'}})).status,400);
  alice=await invite('ALICE@example.test');assert.equal(alice.data.email,'alice@example.test');assert.equal(alice.data.deliveryStatus,'sent');
  assert.equal((await engine.query<any>("SELECT * FROM portal_users WHERE dealer_id='invite-a' AND auth_user_id='user_alice'")).rows.length,0);
  const stored=(await engine.query<any>('SELECT * FROM account_invitations WHERE id=$1',[alice.data.id])).rows[0];assert.equal(stored.token_hash,invitationTokenHash(alice.token));assert.ok(!JSON.stringify(stored).includes(alice.token));
  assert.equal((await call('/api/staff/team/invitations',{method:'POST',body:{email:'alice@example.test',role:'owner'}})).status,409);
 });
 await t.test('preview is private and masked; sign-in must use the matching verified email',async()=>{
  const preview=await call('/api/account-invitations/preview',{token:alice.token,user:''});assert.equal(preview.status,200);assert.equal(preview.headers.get('cache-control'),'no-store');const text=await preview.text();assert.ok(!text.includes('alice@example.test'));assert.ok(!text.includes('token_hash'));
  assert.equal((await accept(alice.token,'')).status,401);assert.equal((await accept(alice.token,'user_other')).status,403);assert.equal((await accept(alice.token,'user_unverified')).status,403);
  assert.equal((await call('/api/account-invitations/accept',{method:'POST',body:{role:'owner',dealerId:'invite-b'},token:alice.token,user:'user_alice',origin:'https://evil.example.test'})).status,403);
  const accepted=await accept(alice.token,'user_alice');assert.equal(accepted.status,200,await accepted.clone().text());assert.equal((await accepted.json() as any).portalUrl,'https://a.example.test/portal');
  assert.equal((await accept(alice.token,'user_alice')).status,200);assert.equal((await accept(alice.token,'user_other')).status,403);
  await engine.exec("UPDATE portal_users SET disabled_at=now() WHERE dealer_id='invite-a' AND auth_user_id='user_alice'");assert.equal((await accept(alice.token,'user_alice')).status,409);await engine.exec("UPDATE portal_users SET disabled_at=NULL WHERE dealer_id='invite-a' AND auth_user_id='user_alice'");
  const members=(await engine.query<any>("SELECT dealer_id,role FROM portal_users WHERE auth_user_id='user_alice'")).rows;assert.deepEqual(members,[{dealer_id:'invite-a',role:'salesperson'}]);
  assert.equal((await call(`/api/staff/team/invitations/${alice.data.id}/cancel`,{method:'POST'})).status,404);
 });
 await t.test('expired and cancelled invitations cannot add memberships',async()=>{
  profile('user_expired','expired@example.test');const expired=await invite('expired@example.test');await engine.query<any>("UPDATE account_invitations SET expires_at=now()-interval '1 minute' WHERE id=$1",[expired.data.id]);assert.equal((await accept(expired.token,'user_expired')).status,410);
  profile('user_cancelled','cancelled@example.test');const cancelled=await invite('cancelled@example.test');assert.equal((await call(`/api/staff/team/invitations/${cancelled.data.id}/cancel`,{method:'POST',host:'b.example.test'})).status,404);assert.equal((await call(`/api/staff/team/invitations/${cancelled.data.id}/cancel`,{method:'POST'})).status,200);assert.equal((await accept(cancelled.token,'user_cancelled')).status,410);
 });
 await t.test('resending rotates the secret, rate limits retries and invalidates old links',async()=>{
  profile('user_resend','resend@example.test');const item=await invite('resend@example.test');const path=`/api/staff/team/invitations/${item.data.id}/resend`;
  assert.equal((await call(path,{method:'POST'})).status,429);await engine.query<any>("UPDATE account_invitations SET last_sent_at=now()-interval '2 minutes' WHERE id=$1",[item.data.id]);
  assert.equal((await call(path,{method:'POST'})).status,200);const next=tokenFromLastMail();assert.notEqual(next,item.token);assert.equal((await accept(item.token,'user_resend')).status,404);assert.equal((await accept(next,'user_resend')).status,200);
  const limited=await invite('limited@example.test');await engine.query<any>("UPDATE account_invitations SET send_count=5,last_sent_at=now()-interval '2 minutes' WHERE id=$1",[limited.data.id]);assert.equal((await call(`/api/staff/team/invitations/${limited.data.id}/resend`,{method:'POST'})).status,429);
 });
 await t.test('former owners and disabled recipients cannot use outstanding invitations',async()=>{
  profile('user_disabled','disabled@example.test');const disabled=await invite('disabled@example.test');await engine.exec("INSERT INTO portal_users(dealer_id,auth_user_id,email,role,disabled_at) VALUES('invite-a','user_disabled','disabled@example.test','salesperson',now())");assert.equal((await accept(disabled.token,'user_disabled')).status,409);
  profile('user_former','former@example.test');const former=await invite('former@example.test');await engine.exec("UPDATE portal_users SET role='salesperson' WHERE dealer_id='invite-a' AND auth_user_id='user_owner'");assert.equal((await accept(former.token,'user_former')).status,410);await engine.exec("UPDATE portal_users SET role='owner' WHERE dealer_id='invite-a' AND auth_user_id='user_owner'");
 });
 await t.test('acceptance never silently changes an existing role',async()=>{
  profile('user_existing','existing@example.test');const existing=await invite('existing@example.test','owner');await engine.exec("INSERT INTO portal_users(dealer_id,auth_user_id,email,role) VALUES('invite-a','user_existing','existing@example.test','accounts')");assert.equal((await accept(existing.token,'user_existing')).status,200);assert.equal((await engine.query<any>("SELECT role FROM portal_users WHERE dealer_id='invite-a' AND auth_user_id='user_existing'")).rows[0].role,'accounts');
 });
 await t.test('legacy direct staff-add uses dealer-scoped uniqueness and rejects duplicates',async()=>{
  const input={email:'cross@example.test',role:'accounts'};assert.equal((await call('/api/staff/team',{method:'POST',body:input})).status,201);assert.equal((await call('/api/staff/team',{method:'POST',body:input,host:'b.example.test'})).status,201);assert.equal((await call('/api/staff/team',{method:'POST',body:input})).status,409);assert.equal((await engine.query<any>("SELECT * FROM portal_users WHERE auth_user_id='user_cross'")).rows.length,2);
 });
 await t.test('delivery failure is visible, never reported as sent and grants no access',async()=>{
  providerStatus=500;const item=await invite('delivery-failed@example.test');assert.equal(item.data.deliveryStatus,'unknown');const listing=await (await call('/api/staff/team/invitations')).json() as any;assert.equal(listing.invitations.find((row:any)=>row.id===item.data.id).deliveryStatus,'unknown');assert.ok(!JSON.stringify(listing).includes(item.token));providerStatus=200;
  delete process.env.RESEND_API_KEY;assert.equal((await call('/api/staff/team/invitations',{method:'POST',body:{email:'not-sent@example.test',role:'salesperson'}})).status,503);process.env.RESEND_API_KEY='re_fictional_invites_only';
 });
 }finally{globalThis.fetch=originalFetch;await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
