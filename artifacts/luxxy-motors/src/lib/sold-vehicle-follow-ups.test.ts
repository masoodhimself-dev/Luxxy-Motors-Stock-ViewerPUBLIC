import { expect, it } from 'vitest';
import { soldVehicleEmail, soldVehicleDraftLink, type SoldVehicleFollowUpReview } from './sold-vehicle-follow-ups';
const review: SoldVehicleFollowUpReview = { saleId: 'sale', vehicleId: 'car', vehicleTitle: 'Toyota Yaris', registration: null, imageUrl: null, sold: true, createdAt: '2026-10-20T11:00:00Z', remaining: 1, upcomingAppointments: 0,
 customers: [{ enquiryId: 'enquiry', customerName: 'Alex', email: 'alex@example.test', phone: null, preferredContact: null, kind: 'appointment', appointmentAt: '2026-10-22T10:00:00Z', appointmentRevision: 4, appointmentCancelledAt: '2026-10-20T11:00:00Z', cancelledByReview: true, status: 'pending', revision: 2, contactedAt: null, outcome: null, emailStatus: null, urgent: false }] };
it('writes an accurate cancellation only after the booking was cancelled', () => {
 const result = soldVehicleEmail(review, 'enquiry', 'Luxxy Motors');
 expect(result.content?.message).toMatch(/Thursday.*22 October.*11:00/);
 expect(result.content?.message).toContain('we’ve cancelled your test drive');
 expect(result.content?.message).toContain('Luxxy Motors');
 expect(result.content?.message).not.toMatch(/refund|deposit|invoice/i);
 expect(soldVehicleEmail({ ...review, customers: [{ ...review.customers[0], cancelledByReview: false, appointmentCancelledAt: null }] }, 'enquiry', '').error).toContain('Cancel the appointment');
});
it('prepares optional interest wording without claiming any appointment was cancelled', () => {
 const result = soldVehicleEmail({ ...review, customers: [{ ...review.customers[0], kind: 'interest' }] }, 'enquiry', 'Dealer');
 expect(result.content?.message).toContain('has now sold');
 expect(result.content?.message).not.toContain('cancelled');
});
it('blocks unsold, missing, completed, and no-email customers', () => {
 expect(soldVehicleEmail({ ...review, sold: false }, 'enquiry', '').error).toBeTruthy();
 expect(soldVehicleEmail(review, 'buyer-not-in-list', '').error).toBeTruthy();
 expect(soldVehicleEmail({ ...review, customers: [{ ...review.customers[0], status: 'contacted' }] }, 'enquiry', '').error).toBeTruthy();
 expect(soldVehicleEmail({ ...review, customers: [{ ...review.customers[0], email: null }] }, 'enquiry', '').error).toBeTruthy();
});
it('keeps sale context in an encoded draft link', () => {
 expect(soldVehicleDraftLink('sale/one', 'enquiry/one')).toBe('/portal?section=notifications&workView=email&compose=enquiry%2Fone&soldSaleId=sale%2Fone');
});
it('updates a customer after a missed appointment without claiming it was cancelled', () => {
 const result = soldVehicleEmail({ ...review, customers: [{ ...review.customers[0], cancelledByReview: false, appointmentCancelledAt: null, appointmentAt: '2020-01-01T10:00:00Z' }] }, 'enquiry', 'Dealer');
 expect(result.content?.message).toContain('has now sold');
 expect(result.content?.message).not.toContain('cancelled');
});
