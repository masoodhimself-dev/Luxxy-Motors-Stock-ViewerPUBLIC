import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultEmailAppearance, defaultEmailTemplates, renderEmailTemplate, type EmailFacts } from '@workspace/vehicle-meta';
import { previewEmailTemplate, sampleEmailVariables } from './lib/email-template-preview';
const template = { subject:'Your car — {{customer_name}}', body:'Hi {{customer_name}},\n\nHere are your details.\nAnother line.\n\nThanks,\n{{dealer_name}}' };
test('every template renders a complete responsive HTML email and a useful text alternative',()=>{
 for (const item of defaultEmailTemplates) {
  const preview=previewEmailTemplate(item.id,item);
  assert.match(preview.html,/<!doctype html>/i);assert.match(preview.html,/lang="en"/);
  assert.match(preview.html,/name="viewport"/);assert.match(preview.html,/@media only screen/);
  assert.match(preview.html,/role="presentation"/);assert.match(preview.html,/mso/);
  assert.match(preview.html,/Example Motors/);assert.ok(preview.text.length>40);
  assert.ok(!preview.html.includes('{{'));assert.equal(preview.sent,false);assert.equal(preview.sample,true);
  assert.ok(Buffer.byteLength(preview.html)<102_000);
 }
});
test('facts omit missing values but retain meaningful zeros and custom wording',()=>{
 const facts:EmailFacts=[{label:'Amount received',value:0},{label:'Missing registration',value:''},{label:'Missing history',value:null},{label:'Missing colour',value:undefined}];
 const rendered=renderEmailTemplate(template,{...sampleEmailVariables,customer_name:'Pat'},facts);
 assert.match(rendered.html,/Amount received/);assert.match(rendered.text,/Amount received: 0/);
 for(const name of ['Missing registration','Missing history','Missing colour'])assert.ok(!rendered.html.includes(name));
 assert.match(rendered.html,/Hi Pat/);assert.match(rendered.html,/Another line/);
 assert.ok(!rendered.html.includes('Confirmed details'));
 const empty=renderEmailTemplate(template,{},[],{...defaultEmailAppearance,heading:''});assert.ok(!empty.html.includes('padding:32px 36px 24px'));assert.match(empty.html,/Hi there,/);
});
test('untrusted subjects, messages, facts, footers and attachment names never become HTML',()=>{
 const attack='<img src=x onerror=evil()>';
 const rendered=renderEmailTemplate({subject:'{{customer_name}}',body:'{{message}}'},{customer_name:'Pat\r\nBCC: attacker',message:`${attack}\n<script>bad()</script>`},[{label:attack,value:attack}],{...defaultEmailAppearance,heading:'{{customer_name}}',footer:attack},{attachments:[attack+'.pdf']});
 assert.ok(!rendered.html.includes('<img'));assert.ok(!rendered.html.includes('<script>'));assert.ok(rendered.html.includes('&lt;img'));
 assert.ok(!/[\r\n]/.test(rendered.subject));assert.ok(rendered.text.includes(attack));
});
test('only valid secure links become action buttons, with actions omitted after cancellation',()=>{
 const booking=defaultEmailTemplates.find(t=>t.id==='booking_confirmation')!;
 const ready=renderEmailTemplate(booking,sampleEmailVariables,[],defaultEmailAppearance,{templateId:booking.id});
 assert.match(ready.html,/Manage your test drive/);assert.match(ready.text,/Manage your test drive: https:\/\/example.test/);
 for(const url of ['javascript:evil()','http://example.test/path','https://user:password@example.test/path','https://example.test/" onclick="evil()','https://example.test\\@evil.test/path']) {
  const rendered=renderEmailTemplate(booking,{...sampleEmailVariables,manage_url:url},[],defaultEmailAppearance,{templateId:booking.id});
  assert.ok(!rendered.html.includes('class="email-button"'));
 }
 const cancelled=renderEmailTemplate(booking,sampleEmailVariables,[],defaultEmailAppearance,{templateId:'booking_cancellation'});
 assert.ok(!cancelled.html.includes('class="email-button"'));
});
test('accent buttons keep contrasting text and copy stays readable with a bright brand colour',()=>{
 const dark=renderEmailTemplate(template,sampleEmailVariables,[],{...defaultEmailAppearance,brandColour:'#172033'},{templateId:'customer_access_link'});
 const light=renderEmailTemplate(template,sampleEmailVariables,[],{...defaultEmailAppearance,brandColour:'#FFFFFF'},{templateId:'customer_access_link'});
 assert.match(dark.html,/background:#172033;color:#ffffff/);assert.match(light.html,/background:#FFFFFF;color:#172033/);
 assert.match(light.html,/color:#344454/);
 const mid=renderEmailTemplate(template,sampleEmailVariables,[],{...defaultEmailAppearance,brandColour:'#777777'},{templateId:'customer_access_link'});assert.match(mid.html,/background:#777777;color:#000000/);
});
test('attachment card lists only supplied file names and supports image-blocked email clients',()=>{
 const withFiles=renderEmailTemplate(template,sampleEmailVariables,[],defaultEmailAppearance,{attachments:['INV-100.pdf','service-book.jpg']});
 assert.match(withFiles.html,/Included with this email/);assert.match(withFiles.html,/INV-100.pdf/);assert.match(withFiles.text,/service-book.jpg/);
 const none=renderEmailTemplate(template,sampleEmailVariables,[]);assert.ok(!none.html.includes('Included with this email'));assert.ok(!none.html.includes('<img'));
 const branded=renderEmailTemplate(template,sampleEmailVariables,[],{...defaultEmailAppearance,logoUrl:'https://example.test/logo.png'});assert.match(branded.html,/alt="Example Motors"/);assert.match(branded.html,/>Example Motors<\/p>/);
});
test('booking and reservation previews present truthful sample states',()=>{
 const preview=(id:string)=>previewEmailTemplate(id,defaultEmailTemplates.find(t=>t.id===id)!);
 assert.match(preview('booking_request').text,/not confirmed yet/);
 assert.match(preview('booking_request').text,/Appointment status: requested — awaiting confirmation/);
 assert.match(preview('booking_cancellation').text,/Appointment status: cancelled/);
 assert.match(preview('reservation_confirmation').text,/Amount received: £0.00/);
 assert.match(preview('reservation_confirmation').text,/Payment status: pending/);
 assert.match(preview('reservation_refund').text,/Amount refunded: £100.00/);
 assert.match(preview('reservation_refund').text,/Payment status: refunded/);
});

test('dealers can customise the in-email title without changing recorded facts',()=>{
 const rendered=renderEmailTemplate({...template,headline:'Ready when you are, {{customer_name}}'},sampleEmailVariables,[{label:'Payment status',value:'pending'}],defaultEmailAppearance,{templateId:'booking_request'});
 assert.match(rendered.html,/Ready when you are, Alex Taylor/);assert.match(rendered.html,/pending/);assert.match(rendered.text,/Ready when you are/);
 assert.throws(()=>renderEmailTemplate({...template,headline:'Unsafe\nheader'},sampleEmailVariables,[]),/one line/);
});
