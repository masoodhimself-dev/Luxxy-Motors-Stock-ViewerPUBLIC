import { readFileSync } from 'node:fs';
import type { CSSProperties, ReactNode } from 'react';
import type { DealerSettings } from '@workspace/api-client-react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { defaultBookingSettings } from '@/lib/test-drive-dates';
import { multiCustomerThemeVariables } from '@/lib/multi-customer-theme';
import { useCustomerBodyTheme } from './multi-customer-theme';
import { TestDriveBooking } from './test-drive-booking';
import { VehicleCall } from './vehicle-call';
import { VehicleQuickChecks } from './vehicle-quick-checks';

const state = vi.hoisted(() => ({
  settings: {} as typeof dealerConfig & Pick<DealerSettings, 'testDriveBooking'>,
  availabilityError: false,
  loadingSettings: false,
  callbackSuccess: false,
  callbackError: false,
  fetch: vi.fn(), mutate: vi.fn(), reset: vi.fn(), intent: vi.fn(),
}));
vi.mock('wouter', () => ({
  useLocation: () => ['/enquire', vi.fn()],
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/lib/dealer-settings-context', () => ({
  useDealerSettings: () => ({ settings: state.settings, isLoading: state.loadingSettings, isError: false }),
}));
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({ enabled: () => true }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: (...args: unknown[]) => state.intent(...args) }));
vi.mock('@/lib/cta-helpers', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/cta-helpers')>(),
  recordContactIntent: (...args: unknown[]) => state.intent(...args),
}));
vi.mock('@workspace/api-client-react', () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
  useCreateEnquiry: () => ({ isPending: false, isSuccess: state.callbackSuccess, isError: state.callbackError, mutate: state.mutate, reset: state.reset }),
  getGetEnquiryAvailabilityQueryKey: (params: unknown) => [params],
  useGetEnquiryAvailability: ({ date }: { date: string }) => ({
    isLoading: false, isFetching: false, isError: state.availabilityError,
    data: { slots: [{ available: true, label: '10:00 am', startAt: `${date}T10:00:00.000Z` }] }, refetch: vi.fn(),
  }),
}));

const car = {
  id: 'style-fixture-car', title: 'Ford Fiesta', make: 'Ford', model: 'Fiesta',
  price: 6500, year: 2020, fuel: 'Petrol', transmission: 'Manual',
  images: [], inventoryStatus: 'available',
} as unknown as Car;
const otherCar = { ...car, id: 'style-second-car', title: 'Honda Jazz', make: 'Honda', model: 'Jazz' };
const theme = multiCustomerThemeVariables('showroom-navy') as CSSProperties;

function Fixture({ children }: { children: ReactNode }) {
  useCustomerBodyTheme(theme);
  return <div className="customer-site dealer-site-theme showroom-navy-site" style={theme}><main>{children}</main></div>;
}

function setCanonical(multi: boolean) {
  document.querySelector('meta[name="luxxy-canonical-origin"]')?.remove();
  const meta = document.createElement('meta');
  meta.name = 'luxxy-canonical-origin';
  meta.content = multi ? 'https://multichoicemotors.co.uk' : 'https://shoredrive.uk';
  meta.setAttribute('data-page-meta', '');
  meta.dataset.styleMigrationTest = '';
  document.head.append(meta);
}

function loadRouteStyles() {
  const sheet = document.createElement('style');
  sheet.dataset.styleMigrationTest = '';
  // Reproduce an already themed page followed by a newly loaded route chunk.
  // No external imports/resources are loaded by this test.
  sheet.textContent = [
    'src/components/multi-customer-theme.css',
    'src/components/premium-showroom.css',
    'src/components/customer-finish.css',
    'src/pages/customer-workflows.css',
    'src/components/test-drive-booking.css',
    'src/components/vehicle-dialog.css',
    'src/components/vehicle-call.css',
    'src/components/vehicle-checks.css',
    'src/components/ui/popup-surfaces.css',
    'src/components/registration-plate/styles/registration-plate.css',
    'src/components/uk-number-plate.css',
  ].map(path => readFileSync(path, 'utf8').replace(/^@import[^;]+;\s*$/gm, '')).join('\n');
  document.head.append(sheet);
}

/** JSDOM retains var() expressions. Resolve only inherited custom properties,
 * leaving the browser's selector cascade intact; this is not pixel/contrast QA. */
function property(element: Element, name: string): string {
  const readVariable = (name: string) => {
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      const value = getComputedStyle(parent).getPropertyValue(name).trim();
      if (value) return value;
    }
    return '';
  };
  const computed = getComputedStyle(element);
  let value = computed.getPropertyValue(name).trim();
  if (['font-family', 'font-weight', 'color'].includes(name) && (!value || value === 'inherit')) {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const inherited = getComputedStyle(parent).getPropertyValue(name).trim();
      if (inherited && inherited !== 'inherit') { value = inherited; break; }
    }
  }
  // JSDOM does not expand a var() background shorthand to background-color.
  if (name === 'background-color' && computed.background.includes('var(')) value = computed.background;
  for (let pass = 0; pass < 12 && value.includes('var('); pass++) {
    const previous = value;
    value = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_match, variable, fallback) => readVariable(variable) || fallback?.trim() || '');
    if (value === previous) break;
  }
  return value;
}
function colour(element: Element, name: string): string {
  const probe = document.createElement('span');
  probe.style.color = property(element, name);
  document.body.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}
function openCall() {
  fireEvent.click(screen.getByRole('link', { name: 'Call about Ford Fiesta' }));
  return screen.getByRole('dialog');
}
function toDetails() {
  fireEvent.click(within(screen.getByTestId('group-viewing-slots')).getByRole('button'));
  fireEvent.click(screen.getByTestId('button-continue-to-details'));
}

beforeEach(() => {
  state.availabilityError = false; state.loadingSettings = false;
  state.callbackSuccess = false; state.callbackError = false;
  state.mutate.mockReset(); state.reset.mockReset(); state.intent.mockReset(); state.fetch.mockReset();
  state.settings = {
    ...dealerConfig,
    identity: { ...dealerConfig.identity, name: 'Example Motors' },
    address: { street: '36A Coldharbour Lane', city: 'Hayes', postcode: 'UB3 3EP' },
    contact: { ...dealerConfig.contact, phone: '02046286488' },
    hours: [{ days: 'Monday – Sunday', times: '09:00 – 18:00' }],
    partExchange: { title: 'Part exchange', description: 'Tell us about your car.', ctaLabel: 'Value my car', ...dealerConfig.partExchange, enabled: true },
    delivery: { title: 'Delivery', description: 'Ask about delivery.', ctaLabel: 'Ask about delivery', ...dealerConfig.delivery, enabled: false },
    testDriveBooking: { ...defaultBookingSettings, daysAhead: 3, weeklyHours: Array.from({ length: 7 }, (_, day) => ({ day, enabled: true, open: '09:00', close: '18:00' })) },
  };
  state.fetch.mockResolvedValue({ status: 'uncached' });
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/enquire?type=viewing&vehicleId=style-fixture-car');
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T08:00:00Z'));
  setCanonical(true);
  loadRouteStyles();
});
afterEach(() => {
  cleanup();
  document.querySelectorAll('[data-style-migration-test]').forEach(element => element.remove());
  vi.useRealTimers(); vi.restoreAllMocks();
});

describe('Shared dealership style migration on real customer workflows', () => {
  it('retires the old nested stock palette for current and future dealership catalogues', () => {
    const source = readFileSync('src/index.css', 'utf8');
    const start = source.indexOf('/* Balanced homepage palette:');
    expect(start).toBeGreaterThan(-1);
    const sheet = document.createElement('style');
    sheet.dataset.styleMigrationTest = '';
    sheet.textContent = source.slice(start, source.indexOf('}', start) + 1);
    document.head.append(sheet);
    const view = render(<Fixture><div className="homepage-refined" data-testid="stock-scope">Stock results</div></Fixture>);
    const stock = screen.getByTestId('stock-scope');
    expect(getComputedStyle(stock).getPropertyValue('--muted-foreground').trim()).not.toBe('195 7% 36%');
    expect(getComputedStyle(stock).getPropertyValue('--background').trim()).not.toBe('195 14% 97%');
    setCanonical(false);
    view.rerender(<Fixture><div className="homepage-refined" data-testid="stock-scope">Stock results</div></Fixture>);
    expect(document.body).toHaveAttribute('data-dealer-customer', 'true');
    expect(getComputedStyle(screen.getByTestId('stock-scope')).getPropertyValue('--muted-foreground').trim()).not.toBe('195 7% 36%');
    expect(getComputedStyle(screen.getByTestId('stock-scope')).getPropertyValue('--background').trim()).not.toBe('195 14% 97%');
  });
  it('keeps the actual public car picker and booking details on the homepage control style after route CSS loads', () => {
    const view = render(<Fixture><TestDriveBooking stockCars={[car, otherCar]} /></Fixture>);
    const picker = screen.getByRole('group', { name: 'Choose your car' });
    expect(within(picker).getByRole('radio', { name: 'Select Ford Fiesta' })).toBeVisible();
    const heading = screen.getByRole('heading', { name: 'Choose a car' });
    expect(property(heading, 'font-weight')).toBe('700');
    expect(property(heading, 'font-family')).toContain('Multi Montserrat');
    view.rerender(<Fixture><TestDriveBooking vehicle={car} stockCars={[car, otherCar]} /></Fixture>);
    toDetails();
    const input = screen.getByTestId('input-customer-name');
    expect(property(input, 'border-radius')).toBe('4px');
    expect(property(input, 'font-family')).toContain('Multi Montserrat');
    expect(colour(input, 'background-color')).toBe('rgb(255, 255, 255)');
    expect(colour(input, 'color')).toBe('rgb(24, 34, 53)');
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('keeps booking selection clear and preserves the dedicated plate face within the real optional part-exchange fields', () => {
    render(<Fixture><TestDriveBooking vehicle={car} stockCars={[car]} /></Fixture>);
    const selectedDate = within(screen.getByTestId('group-viewing-dates')).getAllByRole('button').find(button => button.getAttribute('aria-pressed') === 'true')!;
    expect(property(selectedDate, 'border-radius')).toBe('4px');
    fireEvent.click(within(screen.getByTestId('group-viewing-slots')).getByRole('button'));
    expect(within(screen.getByTestId('group-viewing-slots')).getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('button-continue-to-details'));
    fireEvent.click(screen.getByRole('button', { name: 'Add a part exchange (optional)' }));
    const plate = screen.getByTestId('enquiry-part-exchange-plate-input');
    expect(property(plate, 'font-family')).toMatch(/Forecourt Plate UK|app-registration-font/);
    expect(property(plate, 'font-family')).not.toContain('Multi Montserrat');
    expect(property(plate, 'font-weight')).toBe('400');
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('keeps an availability failure visible and blocks continuation while retaining the shared booking presentation', () => {
    const view = render(<Fixture><TestDriveBooking vehicle={car} stockCars={[car]} /></Fixture>);
    fireEvent.click(within(screen.getByTestId('group-viewing-slots')).getByRole('button'));
    state.availabilityError = true;
    view.rerender(<Fixture><TestDriveBooking vehicle={car} stockCars={[car]} /></Fixture>);
    const alert = screen.getByTestId('status-availability-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert.className).toContain('destructive');
    expect(screen.getByTestId('button-continue-to-details')).toBeDisabled();
    expect(property(screen.getByRole('heading', { name: 'Choose a time' }), 'font-family')).toContain('Multi Montserrat');
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('carries the same panel and control geometry into the real body-portalled callback dialog without recolouring validation errors', () => {
    const view = render(<Fixture><VehicleCall car={car} /></Fixture>);
    const dialog = openCall();
    expect(view.container).not.toContainElement(dialog);
    expect(property(dialog, 'border-radius')).toBe('8px');
    expect(colour(dialog, 'background-color')).toBe('rgb(255, 255, 255)');
    expect(colour(dialog, 'color')).toBe('rgb(24, 34, 53)');
    expect(property(within(dialog).getByRole('heading', { level: 2 }), 'font-weight')).toBe('700');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Request a callback' }));
    const name = within(dialog).getByRole('textbox', { name: 'Your name' });
    const telephone = within(dialog).getByRole('textbox', { name: 'Telephone' });
    expect(property(name, 'border-radius')).toBe('4px');
    expect(property(name, 'font-family')).toContain('Multi Montserrat');
    fireEvent.change(name, { target: { value: 'Example Buyer' } });
    fireEvent.change(telephone, { target: { value: 'invalid' } });
    fireEvent.submit(within(dialog).getByRole('form', { name: 'Request a callback' }));
    const error = within(dialog).getByRole('alert');
    expect(colour(error, 'color')).toBe('rgb(139, 57, 50)');
    expect(colour(error, 'background-color')).toBe('rgb(252, 244, 243)');
    // Exercise the received response state directly; no request is sent.
    state.callbackSuccess = true;
    view.rerender(<Fixture><VehicleCall car={car} /></Fixture>);
    const success = within(dialog).getByText('We’ve received your callback request').closest('[role="status"]')!;
    expect(success).toHaveTextContent('We’ve received your callback request');
    expect(colour(success, 'color')).toBe('rgb(24, 41, 87)');
    expect(colour(success, 'background-color')).toBe('rgb(237, 240, 245)');
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('distinguishes open, closed and unknown showroom hours', () => {
    state.loadingSettings = true;
    const view = render(<Fixture><VehicleCall car={car} /></Fixture>);
    const dialog = openCall();
    const status = () => screen.getByRole('dialog').querySelector('.vehicle-call-status')!;
    expect(colour(status(), 'background-color')).toBe('rgb(237, 240, 245)');
    expect(colour(status(), 'color')).toBe('rgb(82, 93, 112)');
    state.loadingSettings = false;
    view.rerender(<Fixture><VehicleCall car={car} /></Fixture>);
    expect(status()).toHaveTextContent('Closed now');
    expect(colour(status(), 'background-color')).toBe('rgb(255, 243, 223)');
    vi.setSystemTime(new Date('2026-11-02T10:00:00Z'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    openCall();
    expect(status()).toHaveTextContent('Open now');
    expect(colour(status(), 'background-color')).toBe('rgb(237, 240, 245)');
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('themes the actual MOT history dialog and shows the public summary without advisory details or outbound writes', async () => {
    state.fetch.mockImplementation((url: string) => Promise.resolve(url.includes('cacheOnly') ? { status: 'uncached' } : {
      status: 'available', history: {
        registration: 'AB12CDE', make: 'FORD', model: 'FIESTA', checkedAt: '2026-11-02T08:00:00Z', recall: 'Unknown',
        tests: [{ completedDate: '2026-10-01T09:00:00Z', result: 'PASSED', expiryDate: '2027-10-01', mileage: '42000', mileageUnit: 'MI', defects: [{ type: 'ADVISORY', text: 'Tyre worn close to legal limit', dangerous: false }] }],
      },
    }));
    const view = render(<Fixture><VehicleQuickChecks vehicleId={car.id}>{({ motAction }) => motAction}</VehicleQuickChecks></Fixture>);
    fireEvent.click(screen.getByRole('button', { name: 'MOT history' }));
    const pass = await screen.findByText('Latest test: Passed');
    const dialog = screen.getByRole('dialog');
    expect(view.container).not.toContainElement(dialog);
    expect(property(dialog, 'border-radius')).toBe('16px');
    expect(property(within(dialog).getByRole('heading', { name: 'MOT history' }), 'font-weight')).toBe('700');
    expect(pass).toHaveAttribute('data-result', 'PASSED');
    expect(within(dialog).queryByText(/Tyre worn close/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'View full MOT history on GOV.UK' })).toBeVisible();
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
    expect(state.fetch.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('uses the shared callback and booking geometry for another dealership despite late route styles', () => {
    setCanonical(false);
    const view = render(<Fixture><VehicleCall car={car} /></Fixture>);
    const dialog = openCall();
    expect(document.body).toHaveAttribute('data-dealer-customer', 'true');
    expect(property(dialog, 'border-radius')).toBe('8px');
    expect(property(dialog, 'font-family')).toContain('Multi Montserrat');
    expect(property(within(dialog).getByRole('heading', { level: 2 }), 'font-weight')).toBe('700');
    expect(dialog.style.getPropertyValue('--dialog-accent')).toBe('#182957');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Request a callback' }));
    expect(property(within(dialog).getByRole('textbox', { name: 'Your name' }), 'border-radius')).toBe('4px');
    view.unmount();
    render(<Fixture><TestDriveBooking vehicle={car} stockCars={[car]} /></Fixture>);
    toDetails();
    const bookingInput = screen.getByTestId('input-customer-name');
    expect(property(bookingInput, 'border-radius')).toBe('4px');
    expect(property(bookingInput, 'font-family')).toContain('Multi Montserrat');
    expect(state.mutate).not.toHaveBeenCalled();
  });
});
