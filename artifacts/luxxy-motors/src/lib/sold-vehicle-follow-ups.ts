import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';

export type SoldVehicleCustomer = {
  enquiryId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  preferredContact: string | null;
  kind: 'appointment' | 'interest';
  appointmentAt: string | null;
  appointmentRevision: number;
  appointmentCancelledAt: string | null;
  status: 'pending' | 'contacted' | 'not_needed';
  revision: number;
  cancelledByReview: boolean;
  contactedAt: string | null;
  outcome: 'phone' | 'email' | 'not_needed' | null;
  emailStatus: 'sent' | 'delivered' | 'opened' | 'clicked' | 'prepared' | 'sending' | 'scheduled' | 'queued' | 'delivery_delayed' | 'failed' | 'unknown' | 'bounced' | 'complained' | 'suppressed' | null;
  urgent: boolean;
  emailRequestId?: string | null;
  blockedReason?: string | null;
  emailBlocked?: boolean;
  note?: string | null;
  relatedEnquiryIds?: string[];
  appointments?: { enquiryId: string; at: string; revision: number; cancelledAt: string | null }[];
};

export type SoldVehicleFollowUpReview = {
  saleId: string;
  vehicleId: string;
  vehicleTitle: string;
  registration: string | null;
  imageUrl: string | null;
  sold: boolean;
  createdAt: string | null;
  customers: SoldVehicleCustomer[];
  remaining: number;
  upcomingAppointments: number;
};

export type SoldVehicleFollowUpsResponse = { tasks: SoldVehicleFollowUpReview[]; total: number; generatedAt: string };
export const soldVehicleFollowUpsQueryKey = ['staff-sold-vehicle-follow-ups'] as const;
export const soldVehicleReviewQueryKey = (saleId: string) => ['staff-sold-vehicle-follow-up', saleId] as const;
export const soldVehicleReviewPath = (saleId: string) => `/api/staff/sold-vehicle-follow-ups/${encodeURIComponent(saleId)}`;

export function useSoldVehicleFollowUps() {
  return useQuery({ queryKey: soldVehicleFollowUpsQueryKey,
    queryFn: () => customFetch<SoldVehicleFollowUpsResponse>('/api/staff/sold-vehicle-follow-ups'),
    retry: false, refetchInterval: 60_000, refetchOnWindowFocus: true });
}

export function soldVehicleDraftLink(saleId: string, enquiryId: string) {
  return `/portal?section=notifications&workView=email&compose=${encodeURIComponent(enquiryId)}&soldSaleId=${encodeURIComponent(saleId)}`;
}

export function soldVehicleEmail(review: SoldVehicleFollowUpReview, enquiryId: string, dealerName: string) {
  const customer = review.customers.find(item => item.enquiryId === enquiryId);
  if (!review.sold) return { error: 'Mark the car sold before preparing this update.' };
  if (!customer || customer.status !== 'pending' || !customer.email)
    return { error: 'This customer no longer needs this update. Return to the customer review.' };
  if (customer.blockedReason) return { error: customer.blockedReason };
  if (customer.emailStatus) return { error: 'An approved email is already recorded for this follow-up. Check its delivery in Email or finish the follow-up from Home; do not send another copy.' };
  const activeAppointment = customer.appointments
    ? customer.appointments.some(item => !item.cancelledAt && Date.parse(item.at) > Date.now())
    : !customer.appointmentCancelledAt && Boolean(customer.appointmentAt && Date.parse(customer.appointmentAt) > Date.now());
  if (customer.kind === 'appointment' && activeAppointment)
    return { error: 'Cancel the appointment from the customer review before preparing a cancellation email.' };
  const cancelled = customer.kind === 'appointment' && customer.cancelledByReview;
  const vehicle = review.vehicleTitle.trim() || 'car';
  const date = customer.appointmentAt ? new Date(customer.appointmentAt).toLocaleString('en-GB', {
    timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  }) : '';
  const message = cancelled
    ? `The ${vehicle} you were due to view${date ? ` on ${date}` : ''} has now sold, so we’ve cancelled your test drive. Sorry for the inconvenience.`
    : `A quick update—the ${vehicle} you asked about has now sold.`;
  return { content: {
    label: cancelled ? 'Test drive cancellation' : 'Sold car update',
    applyLabel: cancelled ? 'Use cancellation wording' : 'Use sold update wording',
    subject: cancelled ? `Your test drive of the ${vehicle}` : `An update about the ${vehicle}`,
    message: [`Hi ${customer.customerName.trim() || 'there'},`, message,
      'If you’re still looking, reply here or give us a call. We’ll be happy to help you find a similar car.',
      `Kind regards,\n${dealerName.trim() || 'The showroom team'}`].join('\n\n'),
  } };
}
