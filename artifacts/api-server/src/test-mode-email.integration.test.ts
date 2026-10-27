import './test/setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import { createCanvas } from '@napi-rs/canvas';
const {pool}=await import('@workspace/db');
const {runWithTenant}=await import('./lib/tenant-context');
const {dealerIntegrationsStore}=await import('./lib/dealer-integrations-store');
const {default:router}=await import('./routes/test-mode-email');
const {default:salesTestRouter}=await import('./routes/sales-test');
const {defaultEmailTemplates}=await import('@workspace/vehicle-meta');
process.env.MULTI_TENANT_ENABLED='false';
process.env.RESEND_ENABLED='true';process.env.RESEND_API_KEY='re_fake_12345678';process.env.RESEND_FROM_EMAIL='Dealer <dealer@example.test>';process.env.RESEND_REPLY_TO_EMAIL='real-customer@example.test';
(dealerIntegrationsStore as any).readPrivate=async()=>({resendConfigured:true,resend:{enabled:true,apiKey:'re_fake_12345678',from:'Dealer <dealer@example.test>',replyTo:'real-customer@example.test'}});
(dealerIntegrationsStore as any).listTemplates=async()=>({templates:defaultEmailTemplates});
const safeFetch=globalThis.fetch;const sent:any[]=[];
globalThis.fetch=async(input,init)=>{
  if(String(input)==='https://api.resend.com/emails'){sent.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({id:'mock-provider-id'}),{status:200,headers:{'Content-Type':'application/json'}});}
  return safeFetch(input,init);
};
const app=express();app.use(express.json({limit:'5mb'}));
app.use((req,_res,next)=>{req.log={error(info:any){console.error(info.err)},warn(){},info(){}} as any;req.staff={authUserId:'test-owner',name:'Owner',email:null,role:(req.headers['x-role'] as any)||'owner'};runWithTenant({dealerId:String(req.headers['x-dealer']||'email-test-parent'),canonicalOrigin:'http://127.0.0.1',platform:'cazoo',retailerId:'fixture',sourceUrl:'https://example.test'},next);});
app.use('/api',salesTestRouter);app.use('/api',router);const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(server.address() as any).port}/api`;
async function call(path:string,method='GET',body?:unknown,headers:Record<string,string>={}){const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json() as any};}
const parent='email-test-parent',sid=randomUUID(),vehicle=randomUUID(),enquiry=randomUUID(),sandbox=`__sales_test__${randomUUID()}`;
test('preview and send are isolated and use only the owner-designated test inbox',async()=>{
 await pool.query("INSERT INTO dealerships(id,name,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,'Email Test Dealer','https://email-test.example','cazoo','fixture','https://example.test') ON CONFLICT(id) DO NOTHING",[parent]);
 await pool.query("INSERT INTO sales_test_sessions(id,parent_dealer_id,staff_user_id,sandbox_dealer_id,vehicle_id,vehicle_title,vehicle_registration,customer_name,customer_phone,customer_email,expires_at) VALUES($1,$2,'test-owner',$3,$4,'Real copied car','AA11AAA','Real copied customer','01234','real-customer@example.test',now()+interval '1 hour')",[sid,parent,sandbox,vehicle]);
 await pool.query("INSERT INTO sales_test_enquiries(id,session_id,request_id,request_fingerprint,vehicle_id,vehicle_title,customer_name,phone,email,type,message) VALUES($1,$2,$3,'fixture',$4,'Real copied car','Real copied customer','01234','real-customer@example.test','general','Original enquiry')",[enquiry,sid,randomUUID(),vehicle]);
 const before=(await pool.query('SELECT count(*)::int n FROM email_outbox')).rows[0].n;
 assert.equal((await call('/test-email-settings','PUT',{email:'customer@example.test'},{'x-role':'salesperson'})).status,403);
 assert.equal((await call('/test-email-settings','PUT',{email:'test@example.test'})).status,200);
 const path=`/sales-test/sessions/${sid}`;
 assert.equal((await call(path+'/email-preview','POST',{enquiryId:enquiry,templateId:'enquiry_message'})).status,400);
 const p=await call(path+'/email-preview','POST',{enquiryId:enquiry,templateId:'enquiry_message',message:'Hello from staff https://example.test <script>alert(1)</script>',to:'real-customer@example.test'});assert.equal(p.status,200,JSON.stringify(p.data));assert.equal(p.data.to,'test@example.test');assert.match(p.data.subject,/^TEST/);assert.match(p.data.text,/Hello from staff \[link omitted in test\]/);assert.match(p.data.html,/&lt;script&gt;/);assert.doesNotMatch(p.data.html,/<script|\s(?:src|href|on\w+)=/i);assert.doesNotMatch(p.data.html,/https:\/\/example\.test/);
 assert.equal((await call(path+'/email-send','POST',{previewId:p.data.previewId})).status,400);
 const result=await call(path+'/email-send','POST',{previewId:p.data.previewId,confirmSend:true,to:'real-customer@example.test',from:'attacker@example.test'});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.recipient,'test@example.test');assert.deepEqual(sent[0].to,['test@example.test']);assert.equal(sent[0].text,p.data.text);assert.equal(sent[0].html,p.data.html);assert.equal(sent[0].subject,p.data.subject);assert.equal(sent[0].from,'Dealer <dealer@example.test>');assert.equal(sent[0].reply_to,undefined);assert.equal(sent[0].headers,undefined);
 assert.equal((await call(path+'/email-send','POST',{previewId:p.data.previewId,confirmSend:true})).status,409);assert.equal(sent.length,1);
 const changed=await call(path+'/email-preview','POST',{enquiryId:enquiry,templateId:'enquiry_acknowledgement'});assert.equal(changed.status,200);assert.match(changed.data.text,/AA11AAA/);await call('/test-email-settings','PUT',{email:'new-test@example.test'});assert.equal((await call(path+'/email-send','POST',{previewId:changed.data.previewId,confirmSend:true})).status,409);
 assert.equal((await call(path+'/email-preview','POST',{enquiryId:enquiry,templateId:'enquiry_acknowledgement'},{'x-dealer':'another-dealer'})).status,404);
 assert.equal((await pool.query('SELECT count(*)::int n FROM email_outbox')).rows[0].n,before);
});
test('enquiry email uses the selected test car rather than the session car',async()=>{
 const id=randomUUID();
 await pool.query(`INSERT INTO sales_test_enquiries(id,session_id,request_id,request_fingerprint,vehicle_id,vehicle_title,vehicle_registration,customer_name,phone,email,type,message) VALUES($1,$2,$3,'other-vehicle',$4,'Second car','CC11CCC','Test customer','01234','customer@example.test','general','Interested')`,[id,sid,randomUUID(),randomUUID()]);
 const preview=await call(`/sales-test/sessions/${sid}/email-preview`,'POST',{enquiryId:id,templateId:'enquiry_acknowledgement'});
 assert.equal(preview.status,200,JSON.stringify(preview.data));assert.match(preview.data.text,/Second car/);assert.match(preview.data.text,/CC11CCC/);assert.doesNotMatch(preview.data.text,/AA11AAA/);
 await pool.query('DELETE FROM sales_test_enquiries WHERE id=$1',[id]);
});
test('general enquiries do not inherit the session car in emails',async()=>{
 const id=randomUUID(), path=`/sales-test/sessions/${sid}`;
 await pool.query(`INSERT INTO sales_test_enquiries(id,session_id,request_id,request_fingerprint,vehicle_id,vehicle_title,customer_name,phone,email,type,message) VALUES($1,$2,$3,'no-car',NULL,'','Test customer','01234','customer@example.test','general','Opening hours?')`,[id,sid,randomUUID()]);
 for(const templateId of ['enquiry_acknowledgement','dealer_notification','callback','enquiry_message']){
   const preview=await call(path+'/email-preview','POST',{enquiryId:id,templateId,message:'General question'});assert.equal(preview.status,200,JSON.stringify(preview.data));assert.doesNotMatch(preview.data.text,/Real copied car|AA11AAA/);assert.doesNotMatch(preview.data.html,/Real copied car|AA11AAA/);
 }
 const image=createCanvas(12,12);const png='data:image/png;base64,'+image.toBuffer('image/png').toString('base64');
 const custom=await call(path+'/email-preview','POST',{enquiryId:id,templateId:'enquiry_message',message:'General question',photos:[png]});assert.equal(custom.status,200,JSON.stringify(custom.data));assert.doesNotMatch(custom.data.text,/Real copied car|AA11AAA/);
  for(const templateId of ['vehicle_details','invoice_copy','service_history','pre_accident_photos','appointment_details','booking_request','booking_confirmation','booking_change','booking_cancellation','booking_reminder']){
   const result=await call(path+'/email-preview','POST',{enquiryId:id,templateId});assert.equal(result.status,409,templateId);
 }
 assert.equal((await call(path+'/email-preview','POST',{enquiryId:id,templateId:'enquiry_acknowledgement'},{'x-dealer':'another-dealer'})).status,404);
 await pool.query('DELETE FROM sales_test_enquiries WHERE id=$1',[id]);
});
test('invoice preview includes only a verified sandbox PDF',async()=>{
 const sale=randomUUID(),doc=randomUUID(),data=Buffer.from('%PDF-1.4\nSandbox test invoice');const archive={content:data.toString('base64'),sha256:createHash('sha256').update(data).digest('hex')};
 await pool.query('INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES($1,$2,$3,1,$4::jsonb)',[sale,sandbox,'TEST-EMAIL-INV',JSON.stringify({documents:[{id:doc,number:'TEST-123',type:'invoice',balanceAtIssue:12500,snapshot:{draft:{customer:'Invoice snapshot customer',email:'buyer@example.test',vehicle:'Snapshot car',registration:'AB12CDE'},branding:{contact:{email:'dealer@example.test',phone:'1234'}},totals:{totalDue:50000,confirmedPaid:37500}}}],documentArchives:{[doc]:archive}})]);
 const path=`/sales-test/sessions/${sid}`;let preview=await call(path+'/email-preview','POST',{saleId:sale,documentId:doc});assert.equal(preview.status,200,JSON.stringify(preview.data));assert.equal(preview.data.attachment,'TEST-TEST-123.pdf');assert.match(preview.data.text,/Invoice snapshot customer/);assert.match(preview.data.text,/Snapshot car/);
 let response=await call(path+'/email-send','POST',{previewId:preview.data.previewId,confirmSend:true});assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(sent[1].attachments[0].content,archive.content);assert.equal(sent[1].to[0],'new-test@example.test');
 await pool.query("UPDATE sale_workspace SET state=jsonb_set(state,ARRAY['documentArchives',$2,'sha256'],to_jsonb('wrong'::text)) WHERE id=$1",[sale,doc]);preview=await call(path+'/email-preview','POST',{saleId:sale,documentId:doc});assert.equal(preview.status,409);
 await pool.query('DELETE FROM sale_workspace WHERE id=$1',[sale]);
});
test('collection and review previews use only the copied sale and test inbox',async()=>{
 const sale=randomUUID(),outsideSale=randomUUID();
 const state={id:sale,reference:'TEST-1',revision:1,completedAt:'2026-10-27T12:00:00Z',draft:{customer:'Copied customer',vehicle:'Copied vehicle',fulfilment:{method:'collection',viewed:'viewed',address:'',recipient:'Copied customer',phone:'01234',scheduledDate:'2026-11-01',timeWindow:'Afternoon',instructions:''}},documents:[],payments:[],events:[]};
 await pool.query('INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES($1,$2,$3,1,$4::jsonb)',[sale,sandbox,'TEST-HANDOVER',JSON.stringify(state)]);
 await pool.query('INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES($1,$2,$3,1,$4::jsonb)',[outsideSale,parent,`LIVE-HANDOVER-${outsideSale}`,JSON.stringify({...state,id:outsideSale})]);
 await pool.query('INSERT INTO dealer_settings(dealer_id,config) VALUES($1,$2::jsonb) ON CONFLICT(dealer_id) DO UPDATE SET config=excluded.config',[parent,JSON.stringify({contact:{googleReviewUrl:'https://g.page/r/example/review'}})]);
 const path=`/sales-test/sessions/${sid}`;
 let result=await call(path+'/email-preview','POST',{saleId:outsideSale,templateId:'handover_confirmation'});assert.equal(result.status,404);
 result=await call(path+'/email-preview','POST',{saleId:sale,templateId:'handover_confirmation',to:'real-customer@example.test'});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.to,'new-test@example.test');assert.match(result.data.text,/Collection details for your Copied vehicle/);assert.match(result.data.text,/Copied customer/);
 let send=await call(path+'/email-send','POST',{previewId:result.data.previewId,confirmSend:true});assert.equal(send.status,200,JSON.stringify(send.data));assert.deepEqual(sent.at(-1).to,['new-test@example.test']);
 await pool.query("UPDATE sale_workspace SET state=jsonb_set(jsonb_set(state,'{draft,fulfilment,method}',to_jsonb('delivery'::text)),'{draft,fulfilment,address}',to_jsonb('Test delivery address'::text)) WHERE id=$1",[sale]);
 result=await call(path+'/email-preview','POST',{saleId:sale,templateId:'handover_confirmation'});assert.equal(result.status,200);assert.match(result.data.text,/Delivery address: Test delivery address/);assert.match(result.data.subject,/Delivery/);
 result=await call(path+'/email-preview','POST',{saleId:sale,templateId:'review_request'});assert.equal(result.status,200,JSON.stringify(result.data));assert.match(result.data.text,/honest Google review/);assert.match(result.data.text,/\[link omitted in test\]/);assert.doesNotMatch(result.data.text,/https:\/\/g\.page/);
 send=await call(path+'/email-send','POST',{previewId:result.data.previewId,confirmSend:true});assert.equal(send.status,200,JSON.stringify(send.data));assert.deepEqual(sent.at(-1).to,['new-test@example.test']);
 await pool.query('DELETE FROM sale_workspace WHERE id=ANY($1::uuid[])',[[sale,outsideSale]]);
});
test('photos are isolated, validated, normalised and sent to the test inbox only',async()=>{
 const image=createCanvas(800,600);const context=image.getContext('2d');const pixels=context.createImageData(800,600);let random=12345;
 for(let i=0;i<pixels.data.length;i+=4){random=(random*1664525+1013904223)>>>0;pixels.data[i]=(random>>>16)&255;random=(random*1664525+1013904223)>>>0;pixels.data[i+1]=(random>>>16)&255;random=(random*1664525+1013904223)>>>0;pixels.data[i+2]=(random>>>16)&255;pixels.data[i+3]=255;}context.putImageData(pixels,0,0);
 const jpeg='data:image/jpeg;base64,'+image.toBuffer('image/jpeg',90).toString('base64');assert.ok(jpeg.length>256_000);
 const path=`/sales-test/sessions/${sid}`;
 const body={enquiryId:enquiry,templateId:'service_history',photos:[jpeg,jpeg],to:'real-customer@example.test'};
 for(const invalid of [[],[jpeg,jpeg,jpeg],['https://example.test/photo.jpg'],['data:image/jpeg;base64,SGVsbG8=']]){
   const response=await call(path+'/email-preview','POST',{...body,photos:invalid});assert.ok(response.status>=400,JSON.stringify(response.data));
 }
 assert.equal((await call(path+'/email-preview','POST',{...body,photos:[],padding:'x'.repeat(4_100_001)})).status,413);
 assert.equal((await call(path+'/enquiries','POST',{padding:'x'.repeat(256_001)})).status,413);
 const preview=await call(path+'/email-preview','POST',body);assert.equal(preview.status,200,JSON.stringify(preview.data));assert.deepEqual(preview.data.photos,['TEST-photo-1.jpg','TEST-photo-2.jpg']);assert.equal(preview.data.to,'new-test@example.test');
 const record=(await pool.query('SELECT photo_attachments FROM sales_test_email_previews WHERE id=$1 AND session_id=$2',[preview.data.previewId,sid])).rows[0];assert.equal(record.photo_attachments.length,2);
 const result=await call(path+'/email-send','POST',{previewId:preview.data.previewId,confirmSend:true,to:'real-customer@example.test'});assert.equal(result.status,200,JSON.stringify(result.data));assert.deepEqual(sent.at(-1).to,['new-test@example.test']);assert.equal(sent.at(-1).attachments.length,2);assert.deepEqual(sent.at(-1).attachments.map((a:any)=>a.filename),preview.data.photos);
});
test('an enquiry invoice copy is verified from its linked test sale and appears in history only after acceptance',async()=>{
 const sale=randomUUID(),doc=randomUUID(),pdf=Buffer.from('%PDF-1.4\nSandbox linked invoice');const archive={content:pdf.toString('base64'),sha256:createHash('sha256').update(pdf).digest('hex')};
 await pool.query('INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES($1,$2,$3,1,$4::jsonb)',[sale,sandbox,`TEST-LINK-${sale}`,JSON.stringify({documents:[{id:doc,number:'TEST-LINK',type:'invoice'}],documentArchives:{[doc]:archive}})]);
 await pool.query('UPDATE sales_test_enquiries SET sale_id=$2 WHERE id=$1',[enquiry,sale]);
 const path=`/sales-test/sessions/${sid}`;
 assert.equal((await call(path+'/email-preview','POST',{enquiryId:enquiry,templateId:'invoice_copy',documentId:randomUUID()})).status,404);
 const before=await call(`${path}/email-history?enquiryId=${enquiry}`);assert.equal(before.status,200);const count=before.data.messages.length;
 const preview=await call(path+'/email-preview','POST',{enquiryId:enquiry,templateId:'invoice_copy',documentId:doc});assert.equal(preview.status,200,JSON.stringify(preview.data));assert.equal(preview.data.attachment,'TEST-TEST-LINK.pdf');
 assert.equal((await call(`${path}/email-history?enquiryId=${enquiry}`)).data.messages.length,count);
 const sentResult=await call(path+'/email-send','POST',{previewId:preview.data.previewId,confirmSend:true});assert.equal(sentResult.status,200,JSON.stringify(sentResult.data));
 const history=await call(`${path}/email-history?enquiryId=${enquiry}`);assert.equal(history.status,200);assert.equal(history.data.messages.length,count+1);assert.equal(history.data.messages[0].subject,preview.data.subject);assert.equal(history.data.messages[0].text,preview.data.text);assert.equal(sent.at(-1).attachments[0].content,archive.content);
 assert.equal((await call(`${path}/email-history?enquiryId=${randomUUID()}`)).status,404);
 assert.equal((await call(`${path}/email-history?enquiryId=${enquiry}`,'GET',undefined,{'x-dealer':'another-dealer'})).status,404);
 await pool.query('UPDATE sales_test_enquiries SET sale_id=NULL WHERE id=$1',[enquiry]);await pool.query('DELETE FROM sale_workspace WHERE id=$1',[sale]);
});
test('test template edits affect only test email previews',async()=>{
 const templates=defaultEmailTemplates.map(t=>t.id==='enquiry_acknowledgement'?{...t,body:'Sandbox wording for {{customer_name}} from {{dealer_name}}'}:t);
 await pool.query('INSERT INTO sales_test_settings(session_id,config,templates) VALUES($1,$2::jsonb,$3::jsonb)',[sid,JSON.stringify({identity:{name:'Sandbox dealership',brandColors:{primaryHsl:'0 100% 50%'}},contact:{googleReviewUrl:'https://g.page/r/sandbox/review'}}),JSON.stringify(templates)]);
 await pool.query('INSERT INTO dealer_settings(dealer_id,config) VALUES($1,$2::jsonb) ON CONFLICT(dealer_id) DO NOTHING',[parent,JSON.stringify({identity:{name:'Real dealership'}})]);
 const realBefore=(await pool.query('SELECT config FROM dealer_settings WHERE dealer_id=$1',[parent])).rows[0].config;
 const result=await call(`/sales-test/sessions/${sid}/email-preview`,'POST',{enquiryId:enquiry,templateId:'enquiry_acknowledgement'});
 assert.equal(result.status,200,JSON.stringify(result.data));assert.match(result.data.text,/Sandbox wording for Real copied customer from Sandbox dealership/);assert.match(result.data.html,/#FF0000/i);
 await pool.query('UPDATE sales_test_settings SET templates=$2::jsonb WHERE session_id=$1',[sid,JSON.stringify(defaultEmailTemplates)]);
 const sentResult=await call(`/sales-test/sessions/${sid}/email-send`,'POST',{previewId:result.data.previewId,confirmSend:true});assert.equal(sentResult.status,200,JSON.stringify(sentResult.data));assert.equal(sent.at(-1).html,result.data.html);assert.equal(sent.at(-1).text,result.data.text);
 const sale=randomUUID();await pool.query('INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES($1,$2,$3,1,$4::jsonb)',[sale,sandbox,`TEST-REVIEW-${sale}`,JSON.stringify({id:sale,completedAt:'2026-10-27T12:00:00Z',draft:{customer:'Copied customer',vehicle:'Copied vehicle'},documents:[],payments:[],events:[]})]);
 const review=await call(`/sales-test/sessions/${sid}/email-preview`,'POST',{saleId:sale,templateId:'review_request'});assert.equal(review.status,200,JSON.stringify(review.data));assert.match(review.data.text,/Sandbox dealership/);await pool.query('DELETE FROM sale_workspace WHERE id=$1',[sale]);
 assert.deepEqual((await pool.query('SELECT config FROM dealer_settings WHERE dealer_id=$1',[parent])).rows[0].config,realBefore);
});
test.after(async()=>{await pool.query('DELETE FROM sales_test_sessions WHERE id=$1',[sid]);await pool.query('DELETE FROM test_email_settings WHERE dealer_id=$1',[parent]);await pool.query('DELETE FROM dealer_settings WHERE dealer_id=$1',[parent]);await pool.query('DELETE FROM dealerships WHERE id=$1',[parent]);await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();});
