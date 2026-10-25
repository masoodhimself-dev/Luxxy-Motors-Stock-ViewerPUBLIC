import { expect, it } from 'vitest';
import { stockChangeEmail } from './stock-change-email';
import type { StockChangeTask } from './stock-change-tasks';

const entry = { id: 'enquiry-one', customerName: 'Alex', vehicleId: 'car-one' };
const task: StockChangeTask = {
  id: 'update-one', kind: 'price_drop', status: 'open', revision: 0,
  createdAt: '2026-10-20T10:00:00Z', updatedAt: '2026-10-20T10:00:00Z',
  vehicleId: 'car-one', vehicleTitle: 'Toyota Yaris', registration: null, imageUrl: null,
  previousPrice: 8995, currentPrice: 8495, reduction: 500, missingCount: 0,
  lastSeenAt: '2026-10-20T10:00:00Z', publiclyVisible: true, urgency: 'normal',
  affectedCustomers: [{ enquiryId: entry.id, customerName: 'Alex', email: 'alex@example.test', phone: null, preferredContact: 'email', appointmentAt: null, appointmentStatus: null }],
  upcomingAppointments: 0, paidReservations: 0,
};
it('prepares a truthful advertised-price update without promising a changed agreement', () => {
  const before = structuredClone(task);
  const result = stockChangeEmail(task, entry, 'Example Motors');
  expect(result.content?.message).toContain('has been reduced from £8,995 to £8,495');
  expect(result.content?.message).not.toMatch(/invoice|deposit|your agreed price|update-one|enquiry-one/);
  expect(result.content?.message).toContain('Example Motors');
  expect(task).toEqual(before);
});
it.each([false, true])('keeps missing-stock wording unconfirmed, whether publicly visible is %s', publiclyVisible => {
  const result = stockChangeEmail({ ...task, kind: 'missing_stock', publiclyVisible, missingCount: 2 }, entry, 'Example Motors');
  expect(result.content?.message).toContain('checking the availability');
  expect(result.content?.message).toContain('check with us before travelling');
  expect(result.content?.message).not.toMatch(/sold|cancelled|refunded|your appointment is cancelled/i);
});
it.each([
  { publiclyVisible: false }, { currentPrice: 0 }, { currentPrice: null },
  { previousPrice: 8000 }, { previousPrice: null }, { status: 'resolved' as const },
])('does not prepare an outdated or unsupported reduction: %o', changes => {
  expect(stockChangeEmail({ ...task, ...changes }, entry, 'Example Motors').error).toBeTruthy();
});
it('does not use a task for another vehicle or a customer no longer eligible for outreach', () => {
  expect(stockChangeEmail(task, { ...entry, vehicleId: 'another-car' }, 'Example Motors').error).toBeTruthy();
  expect(stockChangeEmail({ ...task, affectedCustomers: [] }, entry, 'Example Motors').error).toBeTruthy();
  expect(stockChangeEmail({ ...task, affectedCustomers: [{ ...task.affectedCustomers[0], email: null }] }, entry, 'Example Motors').error).toBeTruthy();
});
it('allows a reviewed but still-current update without creating another task', () => {
  expect(stockChangeEmail({ ...task, status: 'reviewed' }, entry, 'Example Motors').content?.label).toBe('Price update');
});

it('allows a phone-only WhatsApp draft while keeping email eligibility separate', () => {
  const phoneOnly = { ...task, affectedCustomers: [{ ...task.affectedCustomers[0], email: null, phone: '07700900123' }] };
  expect(stockChangeEmail(phoneOnly, entry, 'Example Motors', 'whatsapp').content?.message).toContain('has been reduced from £8,995 to £8,495');
  expect(stockChangeEmail(phoneOnly, entry, 'Example Motors').error).toBeTruthy();
  expect(stockChangeEmail({ ...phoneOnly, affectedCustomers: [{ ...phoneOnly.affectedCustomers[0], phone: '123' }] }, entry, 'Example Motors', 'whatsapp').error).toBeTruthy();
});

it('does not prepare a price update for a reserved or unavailable car, even when still publicly visible', () => {
  expect(stockChangeEmail({ ...task, publiclyVisible: true, availableForPriceUpdate: false }, entry, 'Example Motors').error).toBeTruthy();
  expect(stockChangeEmail({ ...task, publiclyVisible: true, availableForPriceUpdate: false, affectedCustomers: [{ ...task.affectedCustomers[0], phone: '07700900123' }] }, entry, 'Example Motors', 'whatsapp').error).toBeTruthy();
});
