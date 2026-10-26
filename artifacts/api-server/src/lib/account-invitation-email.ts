import { defaultEmailAppearance, renderEmailTemplate } from '@workspace/vehicle-meta';

export function invitationEmailReadiness() {
  const ready = process.env.ACCOUNT_INVITATIONS_ENABLED !== 'false' && Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM_EMAIL?.trim());
  return { ready, message: ready ? 'Invitations are sent by Luxxy. The recipient must accept before access is added.' : 'Account invitation email is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL on the server, and check ACCOUNT_INVITATIONS_ENABLED is not false.' };
}
export function invitationEmail(input: {email:string;dealerName:string;role:string;url:string;expiresAt:Date;demoSetup?:boolean}) {
  const setupNote=input.demoSetup?'\n\nThis gives you owner access for setup and review. The dealership remains a demonstration until its live launch is completed. Customer emails remain restricted to the approved test inbox and real payments stay disabled.':'';
  const rendered=renderEmailTemplate({subject:'You’re invited to {{dealer_name}}',headline:input.demoSetup?'Your dealership setup account':'Your dealership account',body:'You have been invited to join {{dealer_name}}.\n\nUse the button below to create your account or sign in, then accept your invitation. You must use the email address this invitation was sent to.'+setupNote+'\n\nIf you were not expecting this invitation, you can ignore this email.'}, {dealer_name:input.dealerName}, [{label:'Access',value:input.role==='owner'?'Dealership owner':input.role==='accounts'?'Accounts':'Salesperson'},{label:'Invitation expires',value:input.expiresAt.toLocaleString('en-GB',{timeZone:'Europe/London'})+' (UK time)'}], {...defaultEmailAppearance,heading:'Luxxy',brandColour:'#245e80'}, {templateId:'account_invitation',actionUrl:input.url,actionLabel:'Accept invitation'});
  return {from:process.env.RESEND_FROM_EMAIL!.trim(),to:[input.email],subject:rendered.subject,html:rendered.html,text:rendered.text};
}
export async function sendAccountInvitation(input:{email:string;dealerName:string;role:string;url:string;expiresAt:Date;attempt:string;demoSetup?:boolean}, transport:typeof fetch=fetch) {
  const response=await transport('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY!.trim()}`,'Content-Type':'application/json','Idempotency-Key':`account-invite:${input.attempt}`},body:JSON.stringify(invitationEmail(input))});
  if(!response.ok) throw new InvitationDeliveryError(response.status >= 500 || response.status===408 || response.status===429 ? 'unknown':'failed');
  const result=await response.json() as {id?:string};if(!result.id)throw new InvitationDeliveryError('unknown');return result.id;
}
export class InvitationDeliveryError extends Error { readonly outcome:'failed'|'unknown'; constructor(outcome:'failed'|'unknown'){super('Invitation email could not be confirmed.');this.outcome=outcome;} }
