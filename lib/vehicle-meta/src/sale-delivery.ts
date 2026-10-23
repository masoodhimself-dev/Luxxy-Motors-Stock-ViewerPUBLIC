import type { SaleWorkspaceFulfilment, SaleWorkspaceRecord } from './sale-workspace.ts';

export function saleHandoverStatus(value?: SaleWorkspaceFulfilment) {
  if (value?.completedAt) return value.method === 'delivery' ? 'Delivered' : 'Collected';
  if (value?.stage === 'unsuccessful') return 'Delivery needs rearranging';
  if (value?.stage === 'on_way') return 'On the way';
  if (value?.stage === 'to_arrange') return 'To arrange';
  return value?.scheduledDate && (value.method !== 'delivery' || value.address.trim()) ? 'Booked' : 'To arrange';
}
export type SaleDeliveryTask = { id: string; customer: string; vehicle: string; date: string; timeWindow: string; driver: string; stage: string };
export function saleDeliveryTask(sale: Pick<SaleWorkspaceRecord, 'id' | 'draft' | 'completedAt' | 'lifecycle'>): SaleDeliveryTask | null {
  const value = sale.draft.fulfilment;
  if (value?.method !== 'delivery' || value.completedAt || sale.lifecycle?.status === 'released') return null;
  return { id: sale.id, customer: sale.draft.customer, vehicle: sale.draft.vehicle, date: value.scheduledDate, timeWindow: value.timeWindow, driver: value.driver || '', stage: saleHandoverStatus(value) };
}
export function saleHandoverMessage(sale: Pick<SaleWorkspaceRecord, 'draft'>, dealer: string) {
  const v = sale.draft.fulfilment;
  if (!v) return '';
  const date = v.scheduledDate ? new Date(`${v.scheduledDate}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone:'Europe/London', weekday:'long', day:'numeric', month:'long', year:'numeric' }) : '';
  const lines = [`Hi ${sale.draft.customer || 'there'},`, '', `${v.method === 'delivery' ? 'Delivery' : 'Collection'} details for your ${sale.draft.vehicle}:`];
  if (v.completedAt) lines.push(`Status: ${v.method === 'delivery' ? 'Delivered' : 'Collected'}.`);
  else if (v.stage === 'unsuccessful') lines.push('We need to rearrange your delivery. Please contact us to agree a new time.');
  else if (v.stage === 'on_way') lines.push('Your car is on its way.');
  if (v.completedAt) lines.push(`Received: ${new Date(v.completedAt).toLocaleString('en-GB',{timeZone:'Europe/London'})} (UK time).`);
  else if (date) lines.push(`${v.stage === 'unsuccessful' ? 'Previous planned date' : 'Planned date'}: ${date}${v.timeWindow ? `, ${v.timeWindow}` : ''} (UK time).`);
  else if (!v.completedAt) lines.push('The date and time are still to be arranged. We’ll confirm these with you.');
  if (v.method === 'delivery' && v.address) lines.push(`Delivery address: ${v.address}`);
  if (v.recipient) lines.push(`Receiving the car: ${v.recipient}`);
  lines.push('', 'Please reply if any details need changing or you have any questions.', '', dealer);
  return lines.join('\n');
}
