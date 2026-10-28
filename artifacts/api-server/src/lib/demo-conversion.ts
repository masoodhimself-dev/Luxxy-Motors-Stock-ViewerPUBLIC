import type { SaleWorkspaceReadClient } from './sale-workspace-store';
import { DealerIntegrationsStore,integrationReadiness } from './dealer-integrations-store';
import { demoProvisioning } from './demo-policy';
import { isPlatformAdmin } from './platform-admin';
import { normaliseTenantHost } from './tenant-context';

const manualChecks=[['business','Business details and authorised stock agreed'],['https','Render HTTPS on the live domain tested'],['owner_login','Dealer staff sign-in on the live domain tested'],['branding','Branding and contact details reviewed'],['terms','Sale terms and invoice references approved'],['email','Live sender domain and reply-to verified'],['email_test','Live sender delivery checked'],['approval','Dealer approved launch']] as const;
export function isDemoHost(host:string){const base=demoProvisioning().domain;return Boolean(base&&(host===base||host.endsWith(`.${base}`)));}
const sampleNames=['Alex Morgan (fictional)','Jamie Taylor (fictional)','Sam Ellis (fictional)'];
export async function conversionReadiness(client:SaleWorkspaceReadClient,id:string,requestedOrigin?:string){
 const dealer=(await client.query('SELECT t.*,d.converted_at,d.converted_by,d.revision,d.baseline,d.conversion_receipt,d.expires_at FROM dealerships t LEFT JOIN dealer_demos d ON d.dealer_id=t.id WHERE t.id=$1',[id])).rows[0];
 if(!dealer)return null;
 if(dealer.converted_at)return {demo:false,converted:true,revision:dealer.revision,ready:false,checks:[],blockedReasons:[],domainOrigin:dealer.canonical_origin,eligibleOrigins:[],convertedAt:dealer.converted_at,receipt:dealer.conversion_receipt};
 if(dealer.expires_at==null)return {demo:false,converted:false,ready:false,revision:0,checks:[],blockedReasons:['This is already a regular dealership.'],domainOrigin:dealer.canonical_origin,eligibleOrigins:[]};
 const checks:Array<{id:string;label:string;ready:boolean;detail:string}>=[];
 const check=(key:string,label:string,ready:boolean,detail:string)=>checks.push({id:key,label,ready,detail});
 const domains=(await client.query('SELECT hostname,verified FROM dealer_domains WHERE dealer_id=$1 ORDER BY length(hostname),hostname',[id])).rows;
 const reserved=[normaliseTenantHost(process.env.PLATFORM_ADMIN_HOST??''),normaliseTenantHost(process.env.STOCK_IMPORT_API_HOST??'')];
 const connected=(await client.query("SELECT hostname,hostnames FROM domain_setup_jobs WHERE dealer_id=$1 AND status='completed'",[id])).rows;
 const redirects=new Set(connected.flatMap(j=>Array.isArray(j.hostnames)?j.hostnames.filter((h:string)=>h!==j.hostname):[]));
 const eligibleOrigins=domains.filter(d=>d.verified&&!isDemoHost(d.hostname)&&!reserved.includes(d.hostname)&&!redirects.has(d.hostname)).map(d=>`https://${d.hostname}`);
 const domainOrigin=requestedOrigin??(eligibleOrigins.includes(dealer.canonical_origin)?dealer.canonical_origin:eligibleOrigins[0]??'');
 check('domain','Verified live dealership domain',eligibleOrigins.includes(domainOrigin),'Add and verify the dealer’s own domain in Domains, then confirm its Render HTTPS and Clerk setup in the launch checklist.');
 const config=(await client.query('SELECT config FROM dealer_settings WHERE dealer_id=$1',[id])).rows[0]?.config;
 const demoEmailDomain=demoProvisioning().emailDomain;
 const contactEmail=String(config?.contact?.email??'').trim();
 check('contact','Real showroom contact details',Boolean(config?.identity?.name?.trim()&&config?.contact?.phone?.trim()&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)&&!contactEmail.toLowerCase().endsWith(`@${demoEmailDomain}`)&&config?.address?.street?.trim()&&config?.address?.city?.trim()&&config?.address?.postcode?.trim()),'Replace the demo contact email and confirm the showroom phone and address in the dealer’s Settings.');
 const staff=(await client.query("SELECT auth_user_id FROM portal_users WHERE dealer_id=$1 AND role='owner' AND disabled_at IS NULL",[id])).rows;
 check('staff','Dealership owner account assigned',staff.some(s=>!isPlatformAdmin(s.auth_user_id)),'Add the dealer’s own existing Clerk account as an owner in the dealer portal. Your platform admin membership is kept.');
 const latest=(await client.query('SELECT run_id,status,received_count,expected_count,scraped_at FROM stock_import_runs WHERE dealer_id=$1 ORDER BY received_at DESC LIMIT 1',[id])).rows[0];
 const stockCount=Number((await client.query('SELECT count(*)::int AS count FROM vehicles WHERE dealer_id=$1',[id])).rows[0].count);
 check('stock','Complete stock and dedicated credential',Boolean(stockCount>0&&latest?.status==='completed'&&Date.now()-new Date(latest.scraped_at).getTime()<=24*3600000&&new Date(latest.scraped_at).getTime()<=Date.now()+300000&&latest.received_count>0&&latest.received_count===latest.expected_count&&(await client.query('SELECT id FROM dealer_import_keys WHERE dealer_id=$1 AND disabled_at IS NULL LIMIT 1',[id])).rows.length),'Complete a full stock import collected within 24 hours and keep its dealer-specific import credential.');
 const job=(await client.query("SELECT id FROM demo_completion_jobs WHERE dealer_id=$1 AND status IN ('queued','running')",[id])).rows;
 check('completion','No unfinished completion job',job.length===0,'Finish or review the existing demo completion job first.');
 let privateReady=false,paperworkReady=false,paymentsOff=false;
 try{
  const stored=(await client.query('SELECT encrypted_payload FROM dealer_private_settings WHERE dealer_id=$1',[id])).rows[0];
  if(stored){
   const state=new DealerIntegrationsStore({dealerId:id,databaseBacked:true,production:true}).readPrivateSnapshot(stored.encrypted_payload);
   const resend=state.resend;const sharedKeys=[process.env.DEMO_RESEND_API_KEY,process.env.DEMO_RESEND_STATUS_API_KEY].filter(Boolean);
   const sender=resend.from.match(/<?([^\s<>]+@[^\s<>]+)>?$/)?.[1]??'';
   privateReady=Boolean(resend.enabled&&integrationReadiness(state).resend.ready&&!sharedKeys.includes(resend.apiKey)&&!sender.toLowerCase().endsWith(`@${demoEmailDomain}`));
   paperworkReady=Boolean(state.salesPaperwork?.saleTerms?.trim()&&!/SAMPLE ONLY|fictional demonstration|no real money/i.test(state.salesPaperwork.saleTerms));
   paymentsOff=!state.stripe.enabled&&!config?.onlineReservation?.enabled;
  }
 }catch{/* Never expose encrypted settings, keys or provider bodies in readiness. */}
 check('email','Separate live email configuration',privateReady,'Save the dealer’s own enabled Resend key and verified sender in Settings. Shared demo credentials/senders cannot be promoted. No provider test is performed by this check.');
 check('paperwork','Approved live sale terms configured',paperworkReady,'Replace sample/default terms with the dealer’s approved sale terms in invoice settings.');
 check('payments','Online payments remain disabled at cutover',paymentsOff,'Leave Stripe and website online reservations disabled. Enable real payments separately after conversion and testing.');
 for(const [key,label] of manualChecks)check(`review-${key}`,label,dealer.onboarding_checklist?.[key]?.status==='done',`Mark “${label}” complete in Setup after testing. This is an operator confirmation, not an automatic external verification.`);
 if(config?.testDriveBooking?.enabled)check('review-booking','Live booking rules tested',dealer.onboarding_checklist?.booking?.status==='done','Confirm opening hours, appointment capacity and website booking in Setup, or leave online booking disabled.');
 const enquiries=(await client.query('SELECT id,source,customer_name,email FROM enquiries WHERE dealer_id=$1',[id])).rows;
 const leads=(await client.query('SELECT id,customer_name,email,summary,deposit_reference,deposit_pence,deposit_method,stage FROM leads WHERE dealer_id=$1',[id])).rows;
 const sales=(await client.query('SELECT id,reference,state FROM sale_workspace WHERE dealer_id=$1',[id])).rows;
 const knownEnquiries=enquiries.filter(e=>e.source==='demo'&&sampleNames.includes(e.customer_name)&&/^demo[123]@example\.invalid$/.test(e.email??''));
 const seedLeadEvents=(await client.query('SELECT e.lead_id,e.actor_type,e.body FROM lead_events e JOIN leads l ON l.id=e.lead_id WHERE l.dealer_id=$1',[id])).rows;
 const knownLeads=leads.filter(l=>l.summary==='Fictional demonstration reservation. No real funds.'&&l.deposit_reference==='SAMPLE'&&l.customer_name===sampleNames[0]&&l.email==='demo1@example.invalid'&&l.deposit_pence===20000&&l.deposit_method==='bank_transfer'&&l.stage==='reserved'&&seedLeadEvents.filter(e=>e.lead_id===l.id).length===1&&seedLeadEvents.filter(e=>e.lead_id===l.id).every(e=>e.actor_type==='system'&&e.body==='SAMPLE — fictional reservation for demonstration only.'));
 const knownSales=sales.filter(s=>/^SAMPLE-SALE-[12]$/.test(s.reference)&&sampleNames.includes(s.state?.draft?.customer)&&/^demo[12]@example\.invalid$/.test(s.state?.draft?.email??'')&&s.state?.draft?.notes==='SAMPLE — no real sale or payment.'&&!s.state?.customerAccess&&!s.state?.customerLinkEmail&&Object.keys(s.state?.providerPayments??{}).length===0&&Object.keys(s.state?.documentArchives??{}).length===0&&!s.state?.emailDeliveries?.length&&Array.isArray(s.state?.payments)&&s.state.payments.every((p:any)=>p.reference==='FICTIONAL-PAYMENT'&&p.recordedBy==='Demo setup (fictional)')&&Array.isArray(s.state?.events)&&s.state.events.every((e:any)=>e.actor==='Demo setup (fictional)')&&Array.isArray(s.state?.documents)&&s.state.documents.every((d:any)=>d.issuedBy==='Demo setup (fictional)'&&d.snapshot?.branding?.identity?.name?.includes('SAMPLE / DEMO')));
 const unknownRows=[];
 for(const table of ['sales','customers','customer_intake_sessions','dealer_chat','enquiry_emails'])if((await client.query(`SELECT 1 FROM ${table} WHERE dealer_id=$1 LIMIT 1`,[id])).rows.length)unknownRows.push(table);
 check('practice','Only recognised fictional practice data remains',!unknownRows.length&&knownEnquiries.length===enquiries.length&&knownLeads.length===leads.length&&knownSales.length===sales.length,'Conversion removes only recognised seeded samples. Other customers, conversations, emails or sales need review first; no ambiguous financial record is deleted.');
 return {demo:true,converted:false,revision:dealer.revision,domainOrigin,eligibleOrigins,ready:checks.every(c=>c.ready),checks,blockedReasons:checks.filter(c=>!c.ready).map(c=>c.label),stockCount,lastImportRunId:latest?.run_id??null,cleanup:{enquiryIds:knownEnquiries.map(e=>e.id),leadIds:knownLeads.map(l=>l.id),saleIds:knownSales.map(s=>s.id)},config};
}
