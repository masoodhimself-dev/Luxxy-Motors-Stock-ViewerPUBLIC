import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig, type DealerConfig } from '@/config/dealer';
import Contact from './contact';

type Settings = DealerConfig & { testDriveBooking: { enabled: boolean } };
const car = {
  id: '245f82bf-10cb-4f6e-b5c2-1ee1fedae0ca', make: 'Volvo', model: 'V90', title: 'Volvo V90',
  year: 2021, price: 15500, plate: 'SF21 JXG', inventoryStatus: 'available',
  heroImage: 'https://images.example.test/volvo.jpg', sourceExtras: { publicVehicleCode: 'c1f178d2' },
};
const state = vi.hoisted(() => ({
  settings: {} as Settings,
  settingsLoading: false,
  settingsError: false,
  publicEnquiriesEnabled: true,
  cars: [] as (typeof car)[],
  stockLoading: false,
  form: vi.fn(),
}));

vi.mock('@/lib/dealer-settings-context', () => ({
  useDealerSettings: () => ({
    settings: state.settings, isLoading: state.settingsLoading, isError: state.settingsError,
    publicEnquiriesEnabled: state.publicEnquiriesEnabled,
  }),
}));
vi.mock('@/lib/stock-context', () => ({
  useStock: () => ({ stock: { cars: state.cars }, isLoading: state.stockLoading, error: null }),
}));
vi.mock('@/components/enquiry-form', () => ({
  EnquiryForm: (props: Record<string, unknown>) => {
    state.form(props);
    return <form aria-label="Customer enquiry"><button>Send message</button></form>;
  },
}));
vi.mock('@/hooks/use-page-meta', () => ({ usePageMeta: vi.fn() }));

function showroomOrigin(content: string) {
  const meta = document.createElement('meta');
  meta.name = 'luxxy-canonical-origin';
  meta.content = content;
  meta.setAttribute('data-page-meta', '');
  meta.setAttribute('data-apex-contact-test', '');
  document.head.append(meta);
  return meta;
}

beforeEach(() => {
  state.settings = {
    ...dealerConfig,
    identity: { name: 'Multi Choice Motors', logoText: 'Multi Choice Motors' },
    contact: { phone: '020 7946 0123', email: 'showroom@example.test', whatsapp: '+44 7700 900123' },
    address: { street: '36a Coldharbour Lane', city: 'Hayes', region: 'London', postcode: 'UB3 3EP' },
    hours: [{ days: 'Monday–Friday', times: '09:00–18:00' }, { days: 'Saturday', times: '10:00–17:00' }, { days: 'Sunday', times: 'Closed' }],
    presentation: { websiteTemplate: 'autodeal' },
    testDriveBooking: { enabled: true },
  };
  state.settingsLoading = false;
  state.settingsError = false;
  state.publicEnquiriesEnabled = true;
  state.cars = [car];
  state.stockLoading = false;
  state.form.mockReset();
  window.history.replaceState({}, '', '/contact');
  showroomOrigin('https://multichoicemotors.co.uk');
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('[data-apex-contact-test]').forEach(meta => meta.remove());
  window.history.replaceState({}, '', '/');
  vi.useRealTimers();
});

it('shows the configured showroom, direct contact links, booking and opening hours on the Apex contact route', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-21T12:00:00Z'));
  render(<Contact />);

  expect(screen.getByRole('heading', { level: 1, name: 'Contact Multi Choice Motors' })).toBeVisible();
  expect(screen.getByText(/Visits are by appointment only/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Book a test drive' })).toHaveAttribute('href', '/enquire?type=viewing');
  expect(screen.getByTestId('contact-phone')).toHaveAttribute('href', 'tel:02079460123');
  expect(screen.getByTestId('contact-email')).toHaveAttribute('href', 'mailto:showroom@example.test');
  expect(screen.getByTestId('contact-whatsapp')).toHaveAttribute('href', expect.stringContaining('https://wa.me/447700900123?'));
  expect(screen.getByTestId('contact-directions')).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=36a%20Coldharbour%20Lane%2C%20Hayes%2C%20London%2C%20UB3%203EP');
  expect(screen.getByText('Today').closest('p')).toHaveTextContent('10:00–17:00');

  const hours = screen.getByText('Full opening hours');
  const disclosure = hours.closest('details')!;
  expect(disclosure).not.toHaveAttribute('open');
  fireEvent.click(hours);
  expect(disclosure).toHaveAttribute('open');
  expect(within(disclosure).getByText('Closed')).toBeVisible();
});

it('passes the advert UUID to the existing enquiry and booking flows and links back to the actual car', () => {
  window.history.replaceState({}, '', `/contact?vehicleId=${car.id}#contact-message`);
  render(<Contact />);

  expect(screen.getByRole('heading', { name: 'Send us a message' })).toHaveFocus();
  expect(screen.getByRole('link', { name: /Volvo V90.*SF21 JXG/ })).toHaveAttribute('href', '/cars/volvo-v90-c1f178d2');
  expect(screen.getByRole('link', { name: 'Book a test drive' })).toHaveAttribute('href', `/enquire?type=viewing&vehicleId=${car.id}`);
  expect(state.form).toHaveBeenCalledWith({ initialType: 'general', embedded: true, presentation: 'contact', vehicle: car });
  const message = new URL(screen.getByTestId('contact-whatsapp').getAttribute('href')!).searchParams.get('text');
  expect(message).toContain('Volvo V90');
  expect(message).toContain('Registration: SF21 JXG');
});

it('waits for the advert before falling back to a general enquiry when it cannot be found', () => {
  window.history.replaceState({}, '', '/contact?vehicleId=5030e5a6-a46d-4741-9d7f-378150326263');
  state.cars = [];
  state.stockLoading = true;
  const view = render(<Contact />);
  expect(screen.getByText('Finding the car from your advert…')).toBeVisible();
  expect(state.form).not.toHaveBeenCalled();

  state.stockLoading = false;
  view.rerender(<Contact />);
  expect(screen.getByText(/couldn’t find that advert/i)).toBeVisible();
  expect(state.form).toHaveBeenCalledWith({ initialType: 'general', embedded: true, presentation: 'contact', vehicle: undefined });
  expect(screen.getByRole('link', { name: 'Book a test drive' })).toHaveAttribute('href', '/enquire?type=viewing');
});

it('keeps booking and enquiries independently gated and hides absent contact channels', () => {
  state.settings.contact = { phone: '020 7946 0123' };
  state.publicEnquiriesEnabled = false;
  const view = render(<Contact />);
  expect(screen.queryByRole('link', { name: 'Send a message' })).not.toBeInTheDocument();
  expect(screen.queryByTestId('contact-email')).not.toBeInTheDocument();
  expect(screen.queryByTestId('contact-whatsapp')).not.toBeInTheDocument();
  expect(screen.getByText(/Online enquiries are currently unavailable/)).toBeVisible();
  expect(state.form).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Book a test drive' })).toBeVisible();

  state.settings.testDriveBooking.enabled = false;
  state.publicEnquiriesEnabled = true;
  view.rerender(<Contact />);
  expect(screen.queryByRole('link', { name: 'Book a test drive' })).not.toBeInTheDocument();
  expect(screen.getByRole('form', { name: 'Customer enquiry' })).toBeVisible();
});

it.each(['sample', 'loading', 'error'] as const)('withholds directions and copying for an unconfirmed address (%s)', mode => {
  if (mode === 'sample') state.settings.address = { street: '12 Example Road', city: 'Sample Town', postcode: 'AB1 2CD' };
  state.settingsLoading = mode === 'loading';
  state.settingsError = mode === 'error';
  render(<Contact />);
  expect(screen.queryByTestId('contact-directions')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Copy address' })).not.toBeInTheDocument();
  if (mode === 'loading') expect(screen.getByText('Loading the enquiry form…')).toBeVisible();
  if (mode === 'error') expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
});

it('keeps the shared Apex template on the existing contact page for other dealership domains', () => {
  document.querySelector('meta[data-apex-contact-test]')!.remove();
  showroomOrigin('https://harbour.example.test');
  render(<Contact />);
  expect(screen.getByRole('link', { name: 'Back to showroom' })).toBeVisible();
  expect(screen.queryByText(/Visits are by appointment only/)).not.toBeInTheDocument();
  expect(state.form).not.toHaveBeenCalled();
});
