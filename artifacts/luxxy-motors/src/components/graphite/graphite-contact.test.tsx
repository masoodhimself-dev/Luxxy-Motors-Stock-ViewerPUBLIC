import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import type { DealerConfig } from '@/config/dealer';
import { GraphiteContact } from './graphite-contact';

type Settings = DealerConfig & { testDriveBooking?: { enabled: boolean } };
const state = vi.hoisted(() => ({ settings: {} as Settings, loading: false, error: false, enquiries: true, form: vi.fn(), copy: vi.fn() }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: state.settings, isLoading: state.loading, isError: state.error, publicEnquiriesEnabled: state.enquiries }) }));
vi.mock('@/components/enquiry-form', () => ({ EnquiryForm: (props: Record<string, unknown>) => { state.form(props); return <form aria-label="Existing enquiry form"><button>Send message</button></form>; } }));
const config = (): Settings => ({ ...dealerConfig, identity: { name: 'Harbour Cars', logoText: 'Harbour Cars' }, contact: { phone: '02079460123', email: 'sales@harbour.example', whatsapp: '+447700900123' }, address: { street: '10 Harbour Road', city: 'Brighton', postcode: 'BN1 1AA', mapsUrl: 'https://maps.example/harbour' }, hours: [{ days: 'Monday–Saturday', times: '09:00–18:00' }, { days: 'Sunday', times: 'Closed' }], presentation: {}, testDriveBooking: { enabled: false } });
beforeEach(() => { state.settings = config(); state.loading = false; state.error = false; state.enquiries = true; state.form.mockReset(); state.copy.mockReset(); state.copy.mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: state.copy } }); document.querySelectorAll('[data-graphite-contact-test]').forEach(node => node.remove()); });
afterEach(cleanup);

it('uses supplied dealer details, current hours and the existing contact presentation of EnquiryForm', () => {
  render(<GraphiteContact />);
  expect(screen.getByTestId('contact-phone')).toHaveAttribute('href', 'tel:02079460123');
  expect(screen.getByTestId('contact-address')).toHaveTextContent('10 Harbour RoadBrightonBN1 1AA');
  expect(screen.getByRole('heading', { name: 'Find us in Brighton' })).toBeInTheDocument();
  expect(screen.getByText('Closed')).toBeInTheDocument();
  expect(screen.getByTestId('contact-directions')).toHaveAttribute('href', 'https://maps.example/harbour');
  expect(state.form).toHaveBeenCalledWith(expect.objectContaining({ initialType: 'general', embedded: true, presentation: 'contact' }));
  expect(screen.queryByText(/Multi Choice|Hayes|Luxxy/)).not.toBeInTheDocument();
});

it('copies only the confirmed showroom address and announces completion', async () => {
  render(<GraphiteContact />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Address copied'));
  expect(state.copy).toHaveBeenCalledWith('10 Harbour Road, Brighton, BN1 1AA');
});

it.each(['sample', 'loading', 'error'] as const)('withholds directions and copying for unconfirmed details (%s)', status => {
  if (status === 'sample') state.settings.address = { street: '12 Example Road', city: 'Sample Town', postcode: 'AB1 2CD' };
  if (status === 'loading') state.loading = true;
  if (status === 'error') state.error = true;
  render(<GraphiteContact />);
  expect(screen.queryByRole('link', { name: 'Get directions' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Copy address' })).not.toBeInTheDocument();
  expect(state.copy).not.toHaveBeenCalled();
  if (status === 'loading') expect(screen.getByRole('status')).toHaveTextContent('Loading contact');
  if (status === 'error') { expect(screen.getByRole('alert')).toHaveTextContent('Please contact us before travelling'); expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument(); }
});

it('keeps custom contact wording and independently gated booking when public enquiries are disabled', () => {
  state.settings.presentation = { websiteCopy: { contactTitle: 'Speak with Harbour Cars', contactIntroduction: 'Our published contact introduction.' } };
  state.settings.testDriveBooking = { enabled: true }; state.enquiries = false;
  render(<GraphiteContact />);
  expect(screen.getByRole('heading', { level: 1, name: 'Speak with Harbour Cars' })).toBeInTheDocument();
  expect(screen.getByText('Our published contact introduction.')).toBeInTheDocument();
  expect(state.form).not.toHaveBeenCalled();
  expect(screen.queryByRole('form', { name: 'Existing enquiry form' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Call the showroom' })).toHaveAttribute('href', 'tel:02079460123');
  expect(screen.getByRole('link', { name: 'Arrange a test drive' })).toHaveAttribute('href', '/enquire?type=viewing');
});

it('keeps optional contact channels and arrival instructions available without inventing booking', () => {
  state.settings.presentation = { visitInstructions: 'Call from the gate.', parkingInstructions: 'Use the marked visitor bay.' };
  render(<GraphiteContact />);
  expect(screen.queryByRole('link', { name: 'Arrange a test drive' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Other ways to contact us'));
  expect(screen.getByRole('link', { name: 'sales@harbour.example' })).toHaveAttribute('href', 'mailto:sales@harbour.example');
  expect(screen.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', expect.stringContaining('https://wa.me/447700900123'));
  const arrival = screen.getByText('Before your visit').closest('details')!;
  fireEvent.click(screen.getByText('Before your visit'));
  expect(within(arrival).getByText('Call from the gate.')).toBeInTheDocument();
  expect(within(arrival).getByText('Use the marked visitor bay.')).toBeInTheDocument();
});

it('shows appointment-only wording only for the verified Multi Choice website', () => {
  const meta = document.createElement('meta'); meta.name = 'luxxy-canonical-origin'; meta.content = 'https://multichoicemotors.co.uk'; meta.setAttribute('data-page-meta', ''); meta.setAttribute('data-graphite-contact-test', ''); document.head.append(meta);
  render(<GraphiteContact />);
  expect(screen.getByText('Visits are by appointment only. Please arrange a time before travelling.')).toBeInTheDocument();
});

it('does not fall back to another dealership identity, phone or location when settings are empty', () => {
  state.settings = { ...config(), identity: { name: '', logoText: '' }, contact: {}, address: {}, hours: [] };
  render(<GraphiteContact />);
  expect(screen.queryByText(/Harbour|Multi Choice|Luxxy|Hayes|020/)).not.toBeInTheDocument();
  expect(screen.queryByTestId('contact-phone')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Opening hours' })).not.toBeInTheDocument();
  expect(screen.getByText('Contact us for our showroom address.')).toBeInTheDocument();
});
