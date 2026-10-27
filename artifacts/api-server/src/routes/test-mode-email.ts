import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { pool } from '@workspace/db';
import { currentDealerId } from '../lib/tenant-context';
import { requireStaff, requirePermission, staffHasPermission } from '../middlewares/staff-auth';
import { dealerIntegrationsStore, effectiveResendSettings } from '../lib/dealer-integrations-store';
import { prepareEmailWithSettings, sendPreparedEmail } from '../lib/email-provider';
import { session, active, sandboxStore } from './sales-test';
import { assertTestEnvelope, assertTestPdf, assertTestHtml, renderTestText } from '../lib/test-mode-email-safety';
import { renderEmailTemplate, reviewReminderEmail, reviewReminderNote, saleHandoverMessage } from '@workspace/vehicle-meta';
import { normaliseWebsiteImage } from '../lib/website-asset-image';
import { testModeTemplates } from '../lib/test-mode-templates';
import { emailWebsiteBranding, publishedEmailAppearance } from '../lib/email-website-branding';

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const allowed = new Set(['enquiry_acknowledgement','dealer_notification','callback','vehicle_details','invoice_copy','service_history','pre_accident_photos','appointment_details','enquiry_message','booking_request','booking_confirmation','booking_change','booking_cancellation','booking_reminder']);
function fail(req:Request,res:Response,e:unknown) {
  const status=Number((e as any)?.status);
  if(status>=400&&status<500){res.status(status).json({error:(e as Error).message});return;}
  req.log.error({err:e},'Test email failed');res.status(500).json({error:'The test email could not be completed. Check the test inbox and email settings.'});
}
function inputError(message:string,status=400):never {throw Object.assign(new Error(message),{status});}
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
const envelopeHash=(body:unknown)=>createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
/** Never retry a claim after a crash; its provider acceptance is unknown. */
async function expireSendClaims(client:{query:(sql:string,params?:any[])=>Promise<any>},dealerId:string){
  await client.query(`UPDATE sales_test_email_previews p SET status='unknown' FROM sales_test_sessions s
    WHERE p.session_id=s.id AND s.parent_dealer_id=$1 AND p.status='sending'
      AND coalesce(p.sending_at,p.created_at) < now()-interval '5 minutes'`,[dealerId]);
}
async function prepareTestEnvelope(recipient:string,subject:string,text:string,html:string,attachments:Array<{filename:string;content:string}>,id:string){
  assertTestHtml(html);
  const config=effectiveResendSettings(await dealerIntegrationsStore.readPrivate());
  const prepared=await prepareEmailWithSettings(config,{to:recipient,subject,text,html,idempotencyKey:`test-email:${id}`,...(attachments.length?{attachments}:{})});
  delete prepared.body.reply_to;delete prepared.body.headers;
  try{assertTestEnvelope(prepared.body,recipient);assertTestHtml(prepared.body.html);}catch{inputError('The email provider changed the test recipient or content. Check the dealership email setup.',409);}
  return prepared;
}
router.use(['/test-email-settings','/sales-test'],requireStaff,(req,res,next)=>{res.set('Cache-Control','no-store, private');next();});
router.get('/test-email-settings',requirePermission('sales.manage'),async(req,res)=>{try{const row=(await pool.query('SELECT email FROM test_email_settings WHERE dealer_id=$1',[currentDealerId()])).rows[0];res.json({email:row?.email??null});}catch(e){fail(req,res,e);}});
router.put('/test-email-settings',requirePermission('settings.publish'),async(req,res)=>{try{
  const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
  if(email.length>254||!EMAIL.test(email))inputError('Enter a valid test inbox.');
  const dealer=currentDealerId(),client=await pool.connect();
  try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`test-email-inbox:${dealer}`]);
    await expireSendClaims(client,dealer);
    if((await client.query("SELECT 1 FROM sales_test_email_previews p JOIN sales_test_sessions s ON s.id=p.session_id WHERE s.parent_dealer_id=$1 AND p.status='sending' LIMIT 1",[dealer])).rows.length)inputError('Wait for the test email to finish before changing the inbox.',409);
    await client.query('INSERT INTO test_email_settings(dealer_id,email) VALUES($1,$2) ON CONFLICT(dealer_id) DO UPDATE SET email=EXCLUDED.email,updated_at=now()',[dealer,email]);
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  res.json({email});
}catch(e){fail(req,res,e);}});

router.post('/sales-test/sessions/:sessionId/email-preview',requirePermission('sales.manage'),async(req,res)=>{try{
  const s=await session(req);active(s);
  const target=(await pool.query('SELECT email FROM test_email_settings WHERE dealer_id=$1',[s.parent_dealer_id])).rows[0]?.email as string|undefined;
  if(!target)inputError('An owner must set a test inbox first.',409);
  const copiedSettings=(await pool.query('SELECT config FROM sales_test_settings WHERE session_id=$1',[s.id])).rows[0]?.config;
  let templateId:string, values:Record<string,string>, attachmentName:string|null=null, attachmentContent:string|null=null;
  let explicitMessage:{subject:string;body:string}|undefined;
  let linkedEnquiryId:string|null=null;
  const photoAttachments:Array<{filename:string;content:string}> = [];
  if(req.body?.saleId && req.body?.documentId && !req.body?.enquiryId){
    if(!UUID.test(req.body.saleId)||!UUID.test(req.body.documentId))inputError('Document not found.',404);
    const {document,archive}=await sandboxStore(s).pdf(req.body.saleId,req.body.documentId);
    try { assertTestPdf(archive.content, archive.sha256); } catch { inputError('The test invoice could not be verified.',409); }
    attachmentName=`TEST-${document.number.replace(/[^a-z0-9_-]/gi,'')}.pdf`;attachmentContent=archive.content;
    templateId=document.type==='statement'?'balance_statement':document.type==='receipt'?'payment_receipt':document.type==='invoice'?'invoice':'document_email';
    // Use the immutable document snapshot, so the email agrees with the PDF even
    // when staff subsequently edit the copied customer or sale.
    const buyer=document.snapshot?.draft, branding=document.snapshot?.branding;
    const money=(pence:unknown)=>typeof pence==='number' && Number.isFinite(pence) ? new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(pence/100) : '';
    values={customer_name:buyer?.customer??s.customer_name,customer_email:buyer?.email??s.customer_email,vehicle_title:buyer?.vehicle??s.vehicle_title,vehicle_registration:buyer?.registration??s.vehicle_registration,document_number:document.number,document_type:document.title??'',dealer_email:branding?.contact?.email??'',dealer_phone:branding?.contact?.phone??'',amount:money(document.paymentAmountPence??document.snapshot?.totals?.totalDue),amount_received:money(document.snapshot?.totals?.confirmedPaid),balance:money(document.balanceAtIssue)};
  }else if(req.body?.teamMemberId){
    if(!staffHasPermission(req,'team.manage'))inputError('Only an owner can review a practice invitation.',403);
    if(!UUID.test(String(req.body.teamMemberId)))inputError('Practice invitation not found.',404);
    const members=(await pool.query('SELECT team FROM sales_test_settings WHERE session_id=$1',[s.id])).rows[0]?.team;
    const member=Array.isArray(members) ? members.find(item=>item.id===req.body.teamMemberId && item.invited===true) : null;
    if(!member)inputError('Practice invitation not found.',404);
    templateId='account_invitation';values={};
    explicitMessage={subject:'You’re invited to {{dealer_name}}',body:`You have been invited to join {{dealer_name}}.\n\nAccess: ${member.role==='owner'?'Dealership owner':member.role==='accounts'?'Accounts':'Salesperson'}.\n\nThis is a practice invitation. No account has been created and no access has been granted.\n\nIf you were not expecting this invitation, you can ignore this email.`};
  }else if(req.body?.saleId && ['handover_confirmation','review_request'].includes(req.body?.templateId)){
    if(!UUID.test(String(req.body.saleId)))inputError('Sale not found.',404);
    const sale=await sandboxStore(s).get(String(req.body.saleId));
    const dealer=(await pool.query('SELECT name FROM dealerships WHERE id=$1',[s.parent_dealer_id])).rows[0];
    const dealerName=String(copiedSettings?.identity?.name || dealer?.name || '');
    if(req.body.templateId==='handover_confirmation'){
      if(!sale.draft.fulfilment)inputError('Arrange collection or delivery before preparing this email.',409);
      const name=sale.draft.fulfilment.method==='delivery'?'Delivery':'Collection';
      explicitMessage={subject:`${name} details — ${dealerName}`,body:saleHandoverMessage(sale,dealerName)};
    } else {
      if(!sale.completedAt)inputError('Complete the test sale before requesting a review.',409);
      const config=copiedSettings ?? (await pool.query('SELECT config FROM dealer_settings WHERE dealer_id=$1',[s.parent_dealer_id])).rows[0]?.config;
      const review=reviewReminderEmail(reviewReminderNote(String(config?.contact?.googleReviewUrl??'')),sale.draft.customer,sale.draft.vehicle,dealerName);
      if(!review)inputError('Add a Google review link in dealership settings first.',409);
      explicitMessage={subject:review.subject,body:review.message};
    }
    templateId=req.body.templateId;values={};
  }else{
    const id=String(req.body?.enquiryId??''), kind=String(req.body?.templateId??'');
    if(!UUID.test(id)||!allowed.has(kind))inputError('Choose a test enquiry and email template.');
    const enquiry=(await pool.query('SELECT * FROM sales_test_enquiries WHERE id=$1 AND session_id=$2',[id,s.id])).rows[0];
    if(!enquiry)inputError('Test enquiry not found.',404);
    linkedEnquiryId=id;
    if(!enquiry.vehicle_id && ['vehicle_details','invoice_copy','service_history','pre_accident_photos','appointment_details','booking_request','booking_confirmation','booking_change','booking_cancellation','booking_reminder'].includes(kind))inputError('Choose a car before preparing this email.',409);
    if(kind==='invoice_copy'){
      if(!enquiry.sale_id || !UUID.test(String(req.body?.documentId??'')))inputError('Choose an invoice from this enquiry’s test sale.',409);
      const {document,archive}=await sandboxStore(s).pdf(String(enquiry.sale_id),String(req.body.documentId));
      if(document.type!=='invoice')inputError('Choose an invoice from this enquiry’s test sale.',409);
      try{assertTestPdf(archive.content,archive.sha256);}catch{inputError('The test invoice could not be verified.',409);}
      attachmentName=`TEST-${document.number.replace(/[^a-z0-9_-]/gi,'')}.pdf`;attachmentContent=archive.content;
    }
    if(kind.startsWith('booking_') && !enquiry.appointment_at)inputError('This test enquiry has no booking.',409);
    if(kind==='booking_cancellation' && enquiry.appointment_status!=='cancelled')inputError('Cancel the test booking first.',409);
    if(['booking_confirmation','booking_reminder','booking_change'].includes(kind) && enquiry.appointment_status!=='confirmed')inputError('A confirmed test booking is required.',409);
    const message=typeof req.body?.message==='string'?req.body.message.trim():'';
    if(kind==='enquiry_message' && !message)inputError('Enter a message for the test email.');
    if(message.length>4000)inputError('Message is too long.');
    const photos=req.body?.photos ?? [];
    if(!Array.isArray(photos)||photos.length>2)inputError('Choose up to two photos.');
    if(photos.length && !['vehicle_details','service_history','pre_accident_photos','enquiry_message'].includes(kind))inputError('Photos cannot be attached to this email.');
    if(['service_history','pre_accident_photos'].includes(kind) && photos.length===0)inputError('Choose at least one photo for this email.');
    for(const [index,photo] of photos.entries()){
      // The normaliser accepts only bounded data URLs (never remote URLs), fully
      // decodes the still image, strips metadata and re-encodes safe raster bytes.
      const image=await normaliseWebsiteImage(photo);
      const extension=image.mimeType==='image/jpeg'?'jpg':image.mimeType==='image/png'?'png':'webp';
      photoAttachments.push({filename:`TEST-photo-${index+1}.${extension}`,content:image.bytes.toString('base64')});
    }
    templateId=kind;values={customer_name:enquiry.customer_name,customer_email:enquiry.email,vehicle_title:enquiry.vehicle_id ? enquiry.vehicle_title : 'your enquiry',vehicle_registration:enquiry.vehicle_registration || (enquiry.vehicle_id===s.vehicle_id ? s.vehicle_registration : ''),message,preferred_contact:'phone',appointment_time:enquiry.appointment_at?new Date(enquiry.appointment_at).toLocaleString('en-GB',{timeZone:'Europe/London'}):'',appointment_status:enquiry.appointment_status??''};
  }
  const dealer=(await pool.query('SELECT name FROM dealerships WHERE id=$1',[s.parent_dealer_id])).rows[0];
  if(!linkedEnquiryId && req.body?.saleId && UUID.test(String(req.body.saleId))){
    linkedEnquiryId=(await pool.query('SELECT id FROM sales_test_enquiries WHERE session_id=$1 AND sale_id=$2',[s.id,req.body.saleId])).rows[0]?.id??null;
  }
  values.dealer_name=copiedSettings?.identity?.name || dealer?.name || '';
  // Facts and contact values are rendered as well as template prose. Clean all
  // of them before composing the text alternative or the HTML layout.
  values=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,renderTestText(String(value??''),{})]));
  const {templates}=await testModeTemplates(s.id);
  const template=explicitMessage??templates.find(item=>item.id===templateId);
  if(!template)inputError('This email template is unavailable.',409);
  const render=(value:string)=>renderTestText(value,values);
  const appearance=copiedSettings ? publishedEmailAppearance(emailWebsiteBranding(copiedSettings,'')) : (await dealerIntegrationsStore.listTemplates()).appearance;
  const facts=[{label:'Vehicle',value:values.vehicle_title === 'your enquiry' ? '' : values.vehicle_title},{label:'Registration',value:values.vehicle_registration},{label:'Appointment',value:values.appointment_time},{label:'Status',value:values.appointment_status},{label:'Document',value:values.document_number},{label:'Amount',value:values.amount},{label:'Paid',value:values.amount_received},{label:'Balance',value:values.balance}].filter(fact=>Boolean(fact.value));
  const rendered=renderEmailTemplate({subject:`TEST — ${render(template.subject).replace(/[\r\n\x00-\x1f]/g,' ').slice(0,185)}`,body:`TEST EMAIL — no customer action required\n\n${render(template.body)}`,...('headline' in template && typeof template.headline==='string' && template.headline ? {headline:render(template.headline)} : {})},
    {...values,manage_url:'',portal_url:''},facts,{...appearance,logoUrl:'',heading:render(appearance.heading),footer:render(appearance.footer)},
    {templateId,attachments:[...(attachmentName?[attachmentName]:[]),...photoAttachments.map(photo=>photo.filename)]});
  const subject=rendered.subject,text=rendered.text;
  // The renderer is trusted, but links in a test must not perform customer
  // actions. Strip generated anchors' destinations and omit external images.
  const html=rendered.html.replace(/\s+href="[^"]*"/gi,'');
  assertTestHtml(html);
  const previewId=randomUUID();
  const attachments=[...(attachmentName?[{filename:attachmentName,content:attachmentContent!}]:[]),...photoAttachments];
  const prepared=await prepareTestEnvelope(target,subject,text,html,attachments,previewId);
  await pool.query('INSERT INTO sales_test_email_previews(id,session_id,recipient,subject,body,attachment_name,attachment_content,photo_attachments,rendered_html,reviewed_hash,reviewed_sender,enquiry_id,reviewed_subject,reviewed_text) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14)',[previewId,s.id,target,subject,text,attachmentName,attachmentContent,JSON.stringify(photoAttachments),html,envelopeHash(prepared.body),prepared.body.from,linkedEnquiryId,prepared.body.subject,prepared.body.text??'']);
  res.json({previewId,to:target,from:prepared.body.from,subject:prepared.body.subject,text:prepared.body.text,html:prepared.body.html,attachment:attachmentName,photos:photoAttachments.map(photo=>photo.filename)});
}catch(e){fail(req,res,e);}});

router.post('/sales-test/sessions/:sessionId/email-send',requirePermission('sales.manage'),async(req,res)=>{try{
  const s=await session(req);active(s);
  const id=String(req.body?.previewId??'');if(!UUID.test(id)||req.body?.confirmSend!==true)inputError('Review and confirm this test email first.');
  // Prepare without a held pool connection. The final provider envelope must
  // match the sender, transformed content and recipient the staff reviewed.
  const row=(await pool.query("SELECT * FROM sales_test_email_previews WHERE id=$1 AND session_id=$2 AND status='draft'",[id,s.id])).rows[0];
  if(!row||!row.reviewed_hash||!row.reviewed_sender||!row.rendered_html)inputError('Create a fresh preview before sending.',409);
  const attachments=[...(row.attachment_name?[{filename:row.attachment_name,content:row.attachment_content}]:[]),...(Array.isArray(row.photo_attachments)?row.photo_attachments:[])];
  const prepared=await prepareTestEnvelope(row.recipient,row.subject,row.body,row.rendered_html,attachments,id);
  if(envelopeHash(prepared.body)!==row.reviewed_hash||prepared.body.from!==row.reviewed_sender)inputError('Email settings changed. Prepare and review a new test email.',409);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`test-email-inbox:${s.parent_dealer_id}`]);
    const locked=(await client.query('SELECT * FROM sales_test_sessions WHERE id=$1 AND parent_dealer_id=$2 AND staff_user_id=$3 FOR UPDATE',[s.id,s.parent_dealer_id,s.staff_user_id])).rows[0];
    if(!locked)inputError('Test session not found.',404);
    active(locked);
    await expireSendClaims(client,s.parent_dealer_id);
    const claim=(await client.query(`UPDATE sales_test_email_previews p SET status='sending',sending_at=now() FROM test_email_settings t
      WHERE p.id=$1 AND p.session_id=$2 AND p.status='draft' AND t.dealer_id=$3
        AND lower(t.email)=lower(p.recipient) AND p.reviewed_hash=$4 RETURNING p.id`,[id,s.id,s.parent_dealer_id,row.reviewed_hash])).rows[0];
    if(!claim)inputError('The test email has already been sent, is no longer available, or the test inbox changed. Create a new preview.',409);
    await client.query('COMMIT');
  } catch(e) {await client.query('ROLLBACK').catch(()=>{});throw e;} finally {client.release();}
  // No transaction, locks, or checked-out connection cross the network call.
  try {
    const transport=globalThis.fetch;
    await sendPreparedEmail(prepared.config,JSON.stringify(prepared.body),`test-email:${id}`,async(url,options)=>{
      // The provider helper can wait for capacity or feature checks. Recheck
      // the claim just before network I/O, leaving a generous margin before
      // stale recovery and never holding a connection during the request.
      const ready=(await pool.query(`SELECT 1 FROM sales_test_email_previews p JOIN test_email_settings t ON t.dealer_id=$3
        WHERE p.id=$1 AND p.session_id=$2 AND p.status='sending' AND p.sending_at>now()-interval '2 minutes'
        AND lower(p.recipient)=lower(t.email) AND p.reviewed_hash=$4`,[id,s.id,s.parent_dealer_id,row.reviewed_hash])).rows.length;
      if(!ready)throw new Error('The approved test send is no longer active.');
      return transport(url,options);
    });
    const saved=await pool.query("UPDATE sales_test_email_previews SET status='sent',sent_at=now() WHERE id=$1 AND session_id=$2 AND status='sending' RETURNING id",[id,s.id]);
    if(!saved.rows.length)inputError('Acceptance could not be recorded. Check the test inbox before trying again.',409);
    res.json({sent:true,recipient:row.recipient});
  } catch(e) {
    await pool.query("UPDATE sales_test_email_previews SET status='unknown' WHERE id=$1 AND session_id=$2 AND status='sending'",[id,s.id]).catch(()=>{});
    throw e;
  }
}catch(e){fail(req,res,e);}});
router.get('/sales-test/sessions/:sessionId/email-history',requirePermission('sales.manage'),async(req,res)=>{try{
  const s=await session(req);active(s);const enquiryId=String(req.query.enquiryId??'');
  if(!UUID.test(enquiryId))inputError('Test enquiry not found.',404);
  if(!(await pool.query('SELECT 1 FROM sales_test_enquiries WHERE id=$1 AND session_id=$2',[enquiryId,s.id])).rows.length)inputError('Test enquiry not found.',404);
  const history=await pool.query("SELECT id,recipient,coalesce(reviewed_subject,subject) AS subject,coalesce(reviewed_text,body) AS body,sent_at FROM sales_test_email_previews WHERE session_id=$1 AND enquiry_id=$2 AND status='sent' ORDER BY sent_at DESC LIMIT 100",[s.id,enquiryId]);
  res.json({messages:history.rows.map(row=>({id:row.id,to:row.recipient,subject:row.subject,text:row.body,sentAt:row.sent_at}))});
}catch(e){fail(req,res,e);}});
export default router;
