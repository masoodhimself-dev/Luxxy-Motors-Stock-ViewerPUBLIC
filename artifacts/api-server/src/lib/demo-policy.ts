import { currentTenant, currentDealerId, multiTenantEnabled } from './tenant-context';
export function demoProvisioning() {
  const domain = (process.env.DEMO_BASE_DOMAIN ?? '').trim().toLowerCase();
  const emailDomain = (process.env.DEMO_EMAIL_DOMAIN ?? '').trim().toLowerCase();
  const recipients = (process.env.DEMO_EMAIL_RECIPIENTS ?? '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  const domainValid = (v: string) => /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(v);
  return { domain: domainValid(domain) ? domain : '', emailDomain: domainValid(emailDomain) ? emailDomain : '', recipients,
    domainsReady: process.env.DEMO_DOMAINS_READY === 'true', emailReady: process.env.DEMO_RESEND_VERIFIED === 'true' && Boolean(process.env.DEMO_RESEND_API_KEY), };
}
export async function activeDemo() {
  if (!multiTenantEnabled()) return undefined;
  const id = currentDealerId(); // fail closed if a multi-tenant sender has no tenant context
  const {db,dealerDemosTable}=await import('@workspace/db'); const {and,eq,isNull}=await import('drizzle-orm');
  const [demo] = await db.select().from(dealerDemosTable).where(and(eq(dealerDemosTable.dealerId, id),isNull(dealerDemosTable.convertedAt)));
  return demo;
}
export async function demoEmailEnvelope(request: {to: string; subject: string; html: string; text?: string}, config: {enabled: boolean;apiKey:string;from:string;replyTo:string}) {
  const demo = await activeDemo();
  if (!demo) {
    // A request that began as a demo may already hold the shared demo sender.
    // Never let promotion mid-request turn that sender into a real customer send.
    if (currentTenant()?.demo) throw new Error('This demonstration changed while the email was being prepared. Reload before sending.');
    return {request, config};
  }
  const provision = demoProvisioning();
  if (demo.expiresAt.getTime() <= Date.now() || !provision.emailReady || !provision.emailDomain || !provision.recipients.includes(demo.recipient.toLowerCase())) throw new Error('Demo email is disabled until a verified sender and approved test recipient are configured.');
  const id = currentTenant()!.dealerId;
  return {config: {enabled:true, apiKey:process.env.DEMO_RESEND_API_KEY!,from:`${id} Demo <${id}@${provision.emailDomain}>`,replyTo:''}, request:{...request,to:demo.recipient,subject:`[DEMO] ${request.subject}`.slice(0,200),html:`<p><strong>DEMONSTRATION — sample email. Delivered only to the approved test recipient.</strong></p>${request.html}`,text:`DEMONSTRATION — sample email.\n${request.text ?? ''}`}};
}
