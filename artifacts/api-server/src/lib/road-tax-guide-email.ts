import { createHash } from 'node:crypto';
import { SaleWorkspaceError, type SaleWorkspaceBranding, type SaleWorkspaceMutation, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { roadTaxGuidePdfBytes } from '@workspace/vehicle-meta/sale-document-pdf';
import type { PostgresSaleWorkspaceStore } from './sale-workspace-store';
import type { sendTemplatedEmail } from './email-provider';
type Delivery = NonNullable<SaleWorkspaceRecord['roadTaxGuideEmails']>[number];
export async function emailRoadTaxGuide(input: {
  saleId: string; expectedRevision: unknown; requestId: unknown; reference: unknown; route: unknown; confirmedRecipient: unknown; actor: string; dealerId: string;
}, deps: {
  service: Pick<PostgresSaleWorkspaceStore, 'get' | 'mutate' | 'finishEmail'>;
  branding: (sale: SaleWorkspaceRecord) => Promise<SaleWorkspaceBranding>;
  send: typeof sendTemplatedEmail;
  now?: () => Date;
}): Promise<SaleWorkspaceMutation> {
  const { requestId, route } = input;
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId) || (route !== 'green-slip' && route !== 'no-logbook')) throw new SaleWorkspaceError('Check the tax guide request.');
  const reference = route === 'green-slip' ? input.reference : '';
  if (typeof reference !== 'string' || (route === 'green-slip' && !/^\d{12}$/.test(reference))) throw new SaleWorkspaceError('Enter the 12-digit green slip reference.');
  let current = await deps.service.get(input.saleId); // Store is already tenant-scoped.
  const to = current.draft.email.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || input.confirmedRecipient !== to) throw new SaleWorkspaceError('Confirm the customer email saved on this sale.');
  let delivery = current.roadTaxGuideEmails?.find(item => item.id === requestId);
  if (delivery && (delivery.to !== to || delivery.route !== route)) throw new SaleWorkspaceError('Use a new request for changed guide details.', 409);
  if (delivery?.status === 'sent') return { sale: current, replayed: true };
  if (current.revision !== input.expectedRevision) throw new SaleWorkspaceError('This sale changed. Reload before emailing the guide.', 409);
  if (!current.draft.roadTaxGuide || (current.draft.roadTaxGuideRoute ?? 'green-slip') !== route) throw new SaleWorkspaceError('Save the selected tax guide option first.');
  const now = deps.now?.() ?? new Date();
  if (delivery && now.getTime() - Date.parse(delivery.attemptedAt) > 20 * 3600000) throw new SaleWorkspaceError('This email attempt is too old to retry safely. Check delivery before sending a new guide.', 409);
  if (!delivery && (current.roadTaxGuideEmails ?? []).filter(item => now.getTime() - Date.parse(item.attemptedAt) < 60000).length >= 3) throw new SaleWorkspaceError('Please wait a minute before sending another tax guide.', 429);
  const branding = await deps.branding(current);
  // Build only from the saved sale; never accept arbitrary attachments or recipients.
  const pdf = roadTaxGuidePdfBytes({ registration: current.draft.registration, vehicle: current.draft.vehicle, vin: current.draft.vin ?? '', reference, route, dealerName: branding.identity.name,
    fileId: createHash('sha256').update(input.dealerId + ':' + input.saleId + ':' + requestId).digest('hex').slice(0,32), createdAt: delivery?.attemptedAt ?? now.toISOString() });
  if (!delivery) {
    delivery = { id: requestId, to, route, status: 'sending', attemptedAt: now.toISOString() };
    const started = await deps.service.mutate({ id: current.id, expectedRevision: current.revision, requestId: 'tax-email-start-' + requestId, actor: input.actor, command: { action: 'tax-guide-email-status', delivery } });
    current = started.sale;
  }
  let result: Delivery;
  try {
    const providerId = await deps.send({ templateId: 'document_email', to,
      variables: { customer_name: current.draft.customer, customer_email: to, dealer_name: branding.identity.name, dealer_email: branding.contact.email, dealer_phone: branding.contact.phone, vehicle_title: current.draft.vehicle, vehicle_registration: current.draft.registration, document_title: 'Road Tax guide', document_type: 'Road Tax guide', document_number: '' },
      facts: [{label:'Document',value:'Road Tax guide'}, {label:'Vehicle',value:current.draft.vehicle}, {label:'Registration',value:current.draft.registration}, {label:'Route',value:route === 'green-slip' ? 'Green new keeper slip' : 'Post Office / V62 guidance'}],
      idempotencyKey: `tax-guide-${input.dealerId}-${current.id}-${requestId}`, attachments: [{filename:'road-tax-guide.pdf',content:Buffer.from(pdf).toString('base64')}] });
    result = {...delivery,status:'sent',sentAt:now.toISOString(),providerId};
  } catch {
    // Provider errors can contain request details. Persist only a fixed message.
    result = {...delivery,status:'failed',error:'Email acceptance was not confirmed. Retry with the same details; check delivery before starting a new attempt.'};
  }
  return deps.service.finishEmail(current.id, `tax-email-finish-${requestId}-${result.status}`, {action:'tax-guide-email-status',delivery:result}, input.actor);
}
