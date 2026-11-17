import { createHash } from 'node:crypto';
import { defaultEmailAppearance, isRestrictedAppleRelayEmail, renderEmailTemplate } from '@workspace/vehicle-meta';
import type { ResendSettings } from './dealer-integrations-store';

export function websiteEnquirySender(): ResendSettings {
  const apiKey = process.env.RESEND_API_KEY?.trim() || '';
  const from = process.env.RESEND_FROM_EMAIL?.trim() || '';
  return { enabled: Boolean(apiKey && from), apiKey, from, replyTo: '' };
}

export function websiteEnquirySenderProof() {
  const sender = websiteEnquirySender();
  return createHash('sha256').update(JSON.stringify([sender.from, sender.apiKey])).digest('hex');
}

export function websiteOnlyEnquiryEmail(input: {
  dealerName: string;
  reference: string;
  type: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  message: string;
  vehicleTitle?: string | null;
  vehicleRegistration?: string | null;
  partExchangeRegistration?: string | null;
  partExchangeMileage?: number | null;
  appointmentAt?: Date | null;
  test?: boolean;
}) {
  const appleRelay = isRestrictedAppleRelayEmail(input.email);
  const typeLabel = input.type === 'part_exchange' ? 'Part exchange' : input.type === 'viewing' ? 'Test drive' : input.type === 'website_callback' ? 'Callback' : 'Website enquiry';
  const rendered = renderEmailTemplate({
    headline: input.test ? 'Test website enquiry' : typeLabel,
    subject: `${input.test ? '[TEST] Website enquiry' : typeLabel} ${input.reference}`,
    body: input.test
      ? 'This is a test from DealerOS. New website enquiries will arrive at this address after the dealership goes live.\n\n{{message}}'
      : `{{message}}${appleRelay ? '\n\nPlease call the customer first if a number is available. This email address uses Apple Private Relay.' : ''}`,
  }, { message: input.message }, [
    { label: 'Dealership', value: input.dealerName },
    { label: 'Name', value: input.customerName },
    { label: 'Email', value: input.email },
    { label: 'Phone', value: input.phone },
    { label: 'Car', value: input.vehicleTitle },
    { label: 'Registration', value: input.vehicleRegistration },
    { label: 'Part exchange', value: input.partExchangeRegistration },
    { label: 'Part-exchange mileage', value: input.partExchangeMileage == null ? null : `${input.partExchangeMileage.toLocaleString('en-GB')} miles` },
    { label: 'Appointment', value: input.appointmentAt?.toLocaleString('en-GB', { timeZone: 'Europe/London' }) },
  ], defaultEmailAppearance);
  return { ...rendered, ...(input.email && !appleRelay && !input.test ? { replyTo: input.email } : {}) };
}
