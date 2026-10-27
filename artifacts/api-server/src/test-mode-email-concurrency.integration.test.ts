import './test/setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import express from 'express';

process.env.DB_POOL_MAX='1';process.env.DB_CONNECTION_TIMEOUT_MS='1000';
process.env.MULTI_TENANT_ENABLED='true';process.env.INTEGRATIONS_ENCRYPTION_KEY=Buffer.alloc(32,17).toString('base64');
process.env.DEMO_EMAIL_DOMAIN='demos.example.test';process.env.DEMO_EMAIL_RECIPIENTS='test@example.test';
process.env.DEMO_RESEND_VERIFIED='true';process.env.DEMO_RESEND_API_KEY='re_test_fake_key';
const {pool}=await import('@workspace/db');
const {runWithTenant}=await import('./lib/tenant-context');
const {default:emailRouter}=await import('./routes/test-mode-email');
const {default:salesRouter}=await import('./routes/sales-test');
const originalFetch=globalThis.fetch;let acceptedBody:any;
let providerStarted!:()=>void,providerRelease!:()=>void;
const started=new Promise<void>(resolve=>{providerStarted=resolve});
const released=new Promise<void>(resolve=>{providerRelease=resolve});
globalThis.fetch=async(input,init)=>{
  if(String(input)==='https://api.resend.com/emails'){acceptedBody=JSON.parse(String(init?.body));providerStarted();await released;return new Response(JSON.stringify({id:'mocked-acceptance'}),{status:200,headers:{'content-type':'application/json'}});}
  return originalFetch(input,init);
};
const dealer='test-email-single-pool',sessionId=randomUUID(),vehicleId=randomUUID(),enquiryId=randomUUID(),sandbox=`__sales_test__${randomUUID()}`;
const app=express();app.use(express.json());app.use((req,_res,next)=>{req.log={error(){},warn(){},info(){}} as any;req.staff={authUserId:'owner-1',name:'Test owner',email:null,role:(req.headers['x-role'] as any)||'owner'};runWithTenant({dealerId:dealer,canonicalOrigin:'http://127.0.0.1',platform:'cazoo',retailerId:'fixture',sourceUrl:'https://example.test',demo:true},next);});app.use('/api',emailRouter);app.use('/api',salesRouter);
const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(server.address() as any).port}/api`;
async function call(path:string,method='GET',body?:unknown,headers:Record<string,string>={}){const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json() as any};}
test('a demo preview is the exact sent envelope and a delayed provider does not hold the only database connection',async()=>{
 await pool.query("INSERT INTO dealerships(id,name,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,'Test Dealer','https://pool.example.test','cazoo','test','https://example.test')",[dealer]);
 await pool.query("INSERT INTO dealer_demos(dealer_id,recipient,expires_at,updated_by) VALUES($1,'test@example.test',now()+interval '1 hour','fixture')",[dealer]);
 await pool.query("INSERT INTO test_email_settings(dealer_id,email) VALUES($1,'test@example.test')",[dealer]);
 await pool.query("INSERT INTO sales_test_sessions(id,parent_dealer_id,staff_user_id,sandbox_dealer_id,vehicle_id,vehicle_title,vehicle_registration,customer_name,customer_phone,customer_email,expires_at) VALUES($1,$2,'owner-1',$3,$4,'Copied car','AA11AAA','Copied customer','01234','customer@example.test',now()+interval '1 hour')",[sessionId,dealer,sandbox,vehicleId]);
 await pool.query("INSERT INTO sales_test_enquiries(id,session_id,request_id,request_fingerprint,vehicle_id,vehicle_title,customer_name,phone,email,type,message) VALUES($1,$2,$3,'fixture',$4,'Copied car','Copied customer','01234','customer@example.test','general','Hello')",[enquiryId,sessionId,randomUUID(),vehicleId]);
 const path=`/sales-test/sessions/${sessionId}`;let preview=await call(path+'/email-preview','POST',{enquiryId,templateId:'enquiry_acknowledgement'});
 assert.equal(preview.status,200,JSON.stringify(preview.data));assert.match(preview.data.subject,/^\[DEMO\]/);assert.match(preview.data.html,/DEMONSTRATION/);assert.equal(preview.data.to,'test@example.test');
 const promise=call(path+'/email-send','POST',{previewId:preview.data.previewId,confirmSend:true});
 await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Provider was never called')),5000))]);
 try{
   const query=await Promise.race([pool.query('SELECT 42 AS n'),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('The only connection was held during sending')),1500))]);assert.equal(query.rows[0].n,42);
   assert.equal(pool.options.max,1);const connections=(await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name='dealer-platform-api' AND pid<>pg_backend_pid()")).rows[0].n;assert.equal(connections,0,'The test must not hide another application pool.');
   assert.equal((await call('/test-email-settings','PUT',{email:'elsewhere@example.test'})).status,409);
   assert.equal((await call(path,'DELETE')).status,409);
   assert.deepEqual(acceptedBody.to,['test@example.test']);assert.equal(acceptedBody.from,preview.data.from);assert.equal(acceptedBody.subject,preview.data.subject);assert.equal(acceptedBody.text,preview.data.text);assert.equal(acceptedBody.html,preview.data.html);
 }finally{providerRelease();}
 const result=await promise;assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal((await call(path+'/email-send','POST',{previewId:preview.data.previewId,confirmSend:true})).status,409);
 const changedSender=await call(path+'/email-preview','POST',{enquiryId,templateId:'enquiry_acknowledgement'});assert.equal(changedSender.status,200);
 process.env.DEMO_EMAIL_DOMAIN='changed.example.test';assert.equal((await call(path+'/email-send','POST',{previewId:changedSender.data.previewId,confirmSend:true})).status,409);process.env.DEMO_EMAIL_DOMAIN='demos.example.test';
 await pool.query("UPDATE test_email_settings SET email='other@example.test' WHERE dealer_id=$1",[dealer]);
 preview=await call(path+'/email-preview','POST',{enquiryId,templateId:'enquiry_acknowledgement'});assert.equal(preview.status,409);
});
test('stale claims become unknown and are never retried automatically',async()=>{
 await pool.query("UPDATE test_email_settings SET email='test@example.test' WHERE dealer_id=$1",[dealer]);
 const id=randomUUID();await pool.query("INSERT INTO sales_test_email_previews(id,session_id,recipient,subject,body,status,sending_at) VALUES($1,$2,'test@example.test','TEST','old','sending',now()-interval '6 minutes')",[id,sessionId]);
 assert.equal((await call('/test-email-settings','PUT',{email:'test@example.test'})).status,200);
 assert.equal((await pool.query('SELECT status FROM sales_test_email_previews WHERE id=$1',[id])).rows[0].status,'unknown');
 assert.equal((await call(`/sales-test/sessions/${sessionId}/email-send`,'POST',{previewId:id,confirmSend:true})).status,409);
});
test('only authorised staff can preview a practice team invitation to the designated inbox',async()=>{
 const member=randomUUID();await pool.query('INSERT INTO sales_test_settings(session_id,config,team) VALUES($1,$2::jsonb,$3::jsonb)',[sessionId,JSON.stringify({identity:{name:'Demo Dealer'}}),JSON.stringify([{id:member,email:'real.person@example.test',role:'salesperson',invited:true}])]);
 const path=`/sales-test/sessions/${sessionId}/email-preview`;
 assert.equal((await call(path,'POST',{teamMemberId:member},{'x-role':'salesperson'})).status,403);
 assert.equal((await call(path,'POST',{teamMemberId:randomUUID()})).status,404);
 const result=await call(path,'POST',{teamMemberId:member,to:'real.person@example.test'});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.to,'test@example.test');assert.match(result.data.text,/No account has been created/);
});
test('an unconfirmed provider outcome is recorded as unknown and is not resent',async()=>{
 let attempts=0;globalThis.fetch=async(input,init)=>{if(String(input)==='https://api.resend.com/emails'){attempts++;throw new Error('Simulated network interruption');}return originalFetch(input,init);};
 const path=`/sales-test/sessions/${sessionId}`;const preview=await call(path+'/email-preview','POST',{enquiryId,templateId:'enquiry_acknowledgement'});assert.equal(preview.status,200,JSON.stringify(preview.data));
 assert.equal((await call(path+'/email-send','POST',{previewId:preview.data.previewId,confirmSend:true})).status,500);
 assert.equal((await pool.query('SELECT status FROM sales_test_email_previews WHERE id=$1',[preview.data.previewId])).rows[0].status,'unknown');
 assert.equal((await call(path+'/email-send','POST',{previewId:preview.data.previewId,confirmSend:true})).status,409);assert.equal(attempts,1);
});
test.after(async()=>{providerRelease();await pool.query('DELETE FROM sales_test_sessions WHERE id=$1',[sessionId]);await pool.query('DELETE FROM test_email_settings WHERE dealer_id=$1',[dealer]);await pool.query('DELETE FROM dealer_demos WHERE dealer_id=$1',[dealer]);await pool.query('DELETE FROM dealerships WHERE id=$1',[dealer]);await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();});
