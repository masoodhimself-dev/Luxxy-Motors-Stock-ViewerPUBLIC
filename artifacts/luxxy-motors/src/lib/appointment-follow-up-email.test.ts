import { expect, it } from 'vitest';
import type { Enquiry } from '@workspace/api-client-react';
import type { Car } from './stock-context';
import { appointmentFollowUpEmail, canFollowUpAppointment } from './appointment-follow-up-email';
const entry = { id: 'appointment', customerName: 'Alex Buyer', appointmentAt: '2026-10-18T11:00:00Z', attendance: 'scheduled', vehicleTitle: 'Toyota Yaris' } as Enquiry;
const car = { id: 'car', make: 'Toyota', model: 'Yaris', inventoryStatus: 'available' } as Car;
it('offers follow-up after an appointment, but not a future or cancelled visit', () => {
 const now = Date.parse('2026-10-20T11:00:00Z');
 expect(canFollowUpAppointment(entry, now)).toBe(true);
 expect(canFollowUpAppointment({ ...entry, appointmentAt: '2026-10-22T11:00:00Z' }, now)).toBe(false);
 expect(canFollowUpAppointment({ ...entry, appointmentCancelledAt: '2026-10-18T10:00:00Z' }, now)).toBe(false);
 expect(canFollowUpAppointment({ ...entry, appointmentAt: null }, now)).toBe(false);
});
it('uses accurate wording for missed, completed and unconfirmed attendance', () => {
 expect(appointmentFollowUpEmail({ ...entry, attendance: 'no_show' }, car, 'Example Motors').message).toContain('We missed you');
 expect(appointmentFollowUpEmail({ ...entry, attendance: 'no_show' }, car, 'Example Motors').message).not.toContain('Thanks for coming');
 expect(appointmentFollowUpEmail(entry, car, 'Example Motors').message).toContain('We’re following up');
 expect(appointmentFollowUpEmail({ ...entry, attendance: 'completed' }, car, 'Example Motors').message).toContain('Thanks for coming');
});
it('asks about questions and a deposit without inventing terms or reserving stock', () => {
 const copy = appointmentFollowUpEmail(entry, car, 'Example Motors');
 expect(copy.subject).toContain('Toyota Yaris'); expect(copy.message).toContain('Hi Alex Buyer,');
 expect(copy.message).toContain('Reply if you have any questions');
 expect(copy.message).toContain('If you’d like to leave a deposit'); expect(copy.message).toContain('confirm availability');
 expect(copy.message).not.toContain('£'); expect(copy.message).toContain('Example Motors');
});
it.each(['sold', 'reserved', 'archived', 'hidden', undefined])('does not suggest a deposit on stock with state %s', inventoryStatus => {
 expect(appointmentFollowUpEmail(entry, { ...car, inventoryStatus } as Car, 'Example Motors').message).not.toContain('deposit');
});
it('keeps a useful follow-up when the car has left stock', () => {
 expect(appointmentFollowUpEmail(entry, undefined, 'Example Motors').message).toContain('Toyota Yaris');
 expect(appointmentFollowUpEmail(entry, undefined, 'Example Motors').message).not.toContain('deposit');
});
it('keeps the attendance state and one reply next step distinct without claiming an unrecorded visit', () => {
 const unknown = appointmentFollowUpEmail(entry, undefined, 'Example Motors');
 expect(unknown.message).not.toMatch(/Thanks for coming|We missed you/);
 const missed = appointmentFollowUpEmail({ ...entry, attendance: 'no_show' }, undefined, 'Example Motors');
 expect(missed.message).toContain('Reply if you’d like to arrange another time');
 expect(missed.message.match(/arrange another time/g)).toHaveLength(1);
 expect(missed.message).not.toContain('Thanks for coming');
});
it('offers a deposit conversation without supplying payment terms or claiming stock is reserved', () => {
 const before = JSON.stringify({ entry, car });
 const copy = appointmentFollowUpEmail(entry, car, 'Example Motors');
 expect(copy.message).toContain('confirm availability and explain the terms before you pay');
 expect(copy.message).not.toMatch(/non.?refundable|refundable|reserved for you|reservation confirmed|pay now|£|%/i);
 expect(JSON.stringify({ entry, car })).toBe(before);
});
