import type { Enquiry } from '@workspace/api-client-react';
import type { Car } from './stock-context';
import { vehicleDisplayTitle } from './utils';

export function canFollowUpAppointment(entry: Enquiry, now = Date.now()) {
  if (!entry.appointmentAt || entry.appointmentCancelledAt) return false;
  const at = Date.parse(entry.appointmentAt);
  return Number.isFinite(at) && (at <= now || entry.attendance === 'completed' || entry.attendance === 'no_show');
}

/** Staff-reviewed wording only: never creates a reservation, payment or email. */
export function appointmentFollowUpEmail(entry: Enquiry, car: Car | undefined, dealerName: string) {
  const vehicle = car ? vehicleDisplayTitle(car) : entry.vehicleTitle?.trim();
  const about = vehicle ? `the ${vehicle}` : 'the car';
  const opening = entry.attendance === 'no_show'
    ? `We missed you at your appointment to see ${about}. If you’d like to arrange another time, let us know what works for you.`
    : entry.attendance === 'completed'
      ? `Thanks for coming to see ${about}.`
      : `Just following up about your appointment to see ${about}.`;
  const deposit = car?.inventoryStatus === 'available'
    ? 'If you’d like to leave a deposit, let us know. We’ll confirm availability and explain how it works before you make any payment.'
    : '';
  return {
    subject: vehicle ? `Any questions about the ${vehicle}?` : 'Following up on your appointment',
    message: [`Hi ${entry.customerName?.trim() || 'there'},`, opening,
      'Reply here or give us a call if you have any questions about the car or its history.',
      deposit, `Kind regards,\n${dealerName.trim() || 'The showroom team'}`].filter(Boolean).join('\n\n'),
    label: 'Appointment follow-up',
  };
}
