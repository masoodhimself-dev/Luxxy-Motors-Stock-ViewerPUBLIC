import type { Enquiry } from '@workspace/api-client-react';
export { callOutcomes } from '../../../api-server/src/lib/enquiry-workspace';
export type { CallOutcome } from '../../../api-server/src/lib/enquiry-workspace';

export const contactPhone = (value?: string | null) => {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.startsWith('0044') ? `0${digits.slice(4)}` : digits.startsWith('44') ? `0${digits.slice(2)}` : digits;
};
export function sameCustomer(a: { phone?: string | null; email?: string | null }, b: { phone?: string | null; email?: string | null }) {
  const phone = contactPhone(a.phone);
  const email = a.email?.trim().toLowerCase();
  return Boolean((phone.length >= 7 && phone === contactPhone(b.phone)) || (email && email.includes('@') && email === b.email?.trim().toLowerCase()));
}
export function deskMatches(query: string, values: unknown[]) {
  const normal = (value: string) => value.toLowerCase().replace(/[\s()+.\-]/g, '');
  return normal(values.filter(v => v != null).join(' ')).includes(normal(query)) || values.some(value => typeof value === 'string' && contactPhone(query).length >= 7 && contactPhone(value) === contactPhone(query));
}
export function nextAction(entry: Enquiry) {
  if (entry.followUpAt && !entry.followUpCompletedAt) return entry.followUpNote || `Call ${entry.customerName}`;
  if (entry.appointmentCancelledAt) return 'Appointment cancelled';
  if (entry.attendance === 'completed') return 'Visit completed';
  if (entry.attendance === 'no_show') return 'Customer did not attend — arrange a follow-up';
  if (entry.attendance === 'arrived') return 'Customer has arrived — prepare their test drive';
  if (entry.appointmentAt) return entry.appointmentStatus === 'pending' ? 'Review the appointment request in Test drives' : 'Prepare the car for the appointment';
  if (entry.callOutcome === 'not_interested' || entry.status === 'closed') return 'No further action';
  if (entry.callOutcome === 'information_given') return 'Information given — no follow-up scheduled';
  return `Reply to ${entry.customerName}`;
}

export type CallDraft = {
  vehicleMode: 'stock' | 'adhoc' | 'none'; carId: string; adHocTitle: string; adHocRegistration: string; adHocPrice: string;
  name: string; phone: string; email: string; message: string; booking: boolean; time: string;
  followUp: boolean; followUpTime: string; followUpNote: string; manualTime: boolean;
  assignedToId: string; outcome: string;
};
export function readCallDraft(key: string): CallDraft | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved || !Number.isFinite(saved.savedAt) || saved.savedAt > Date.now() || Date.now() - saved.savedAt > 7 * 86400000) { localStorage.removeItem(key); return null; }
    const d = saved.data;
    if (!d || !['stock','adhoc','none'].includes(d.vehicleMode) || !['carId','adHocTitle','adHocRegistration','adHocPrice','name','phone','email','message','time','followUpTime','followUpNote','assignedToId','outcome'].every(k => typeof d[k] === 'string' && d[k].length <= 4000) || !['booking','followUp','manualTime'].every(k => typeof d[k] === 'boolean')) return null;
    return d;
  } catch { return null; }
}
export function saveCallDraft(key: string, data: CallDraft) {
  try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data })); return true; } catch { return false; }
}
export function removeCallDraft(key: string) { try { localStorage.removeItem(key); } catch {} }
