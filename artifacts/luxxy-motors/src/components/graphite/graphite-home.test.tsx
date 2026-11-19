import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import type { FilterState } from '@/components/filters';
import { SavedCarsProvider } from '@/lib/saved-cars-context';
import { clearHomepagePartExchangeLookup, readHomepagePartExchangeLookup } from '@/lib/homepage-part-exchange';
import { GraphiteHomepage, type GraphiteHomepageProps } from './graphite-home';

const events = vi.hoisted(() => ({ search: vi.fn(), lookup: vi.fn() }));
vi.mock('@/lib/part-exchange-lookup', () => ({ lookupPartExchangeCar: (...args: unknown[]) => events.lookup(...args) }));
vi.mock('@/components/ai-car-finder', () => ({ AiCarFinder: () => <details><summary>Search by describing a car</summary></details> }));
vi.mock('@/components/delivery-estimator', () => ({ DeliveryEstimator: () => <button>Estimate delivery</button> }));
const defaults: FilterState = { make: '', model: '', minPrice: '', maxPrice: '', fuel: '', transmission: '', bodyType: '', search: '', ulez: false, sort: '' };
const car = (id: string, make: string, model: string, price: number, status = 'available') => ({ id, advertId: id, make, model, title: `${make} ${model}`, price, currency: 'GBP', year: 2020, mileage: 30000, fuel: 'Petrol', transmission: 'Manual', bodyType: 'Hatchback', registration: 'AB20 CDE', heroImage: `https://images.example/${id}.jpg`, images: [], inventoryStatus: status, sourceExtras: null } as unknown as Car);
const cars = [car('ford', 'Ford', 'Focus', 5000), car('toyota', 'Toyota', 'Yaris', 9000), car('volvo', 'Volvo', 'V90', 15000), car('sold', 'Audi', 'A1', 3000, 'sold')];
const config = (): GraphiteHomepageProps['settings'] => ({ ...dealerConfig, identity: { name: 'Harbour Cars' }, hero: { ...dealerConfig.hero, copy: 'Find your next car', announcement: '' }, address: { street: '10 Harbour Road', city: 'Brighton', postcode: 'BN1 1AA' }, contact: { phone: '02079460123', email: 'hello@harbour.example' }, featuredVehicleIds: ['toyota'], warranty: { ...dealerConfig.warranty!, enabled: false }, delivery: { ...dealerConfig.delivery!, enabled: false }, partExchange: { ...dealerConfig.partExchange!, enabled: true }, whyBuy: [], trustItems: [], hours: [{ days: 'Monday–Saturday', times: '10:00–18:00' }, { days: 'Sunday', times: 'Closed' }] });
function Harness({ settings = config(), initialFilters = {}, stock = cars, loading = false, error = null, publicEnquiriesEnabled = true }: { settings?: GraphiteHomepageProps['settings']; initialFilters?: Partial<FilterState>; stock?: Car[]; loading?: boolean; error?: string | null; publicEnquiriesEnabled?: boolean }) {
  const [filters, setFilters] = useState(() => ({ ...defaults, ...initialFilters }));
  return <GraphiteHomepage settings={settings} cars={stock} isLoading={loading} error={error} publicEnquiriesEnabled={publicEnquiriesEnabled} filters={filters} setFilters={setFilters} onSearch={events.search} />;
}
function show(props: Parameters<typeof Harness>[0] = {}) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SavedCarsProvider persistent={false}><div className="graphite-site"><Harness {...props} /></div></SavedCarsProvider></QueryClientProvider>);
}
beforeEach(() => { events.search.mockReset(); events.lookup.mockReset(); clearHomepagePartExchangeLookup(); sessionStorage.clear(); window.history.replaceState({}, '', '/'); });
afterEach(cleanup);

it('uses the real dealership, shared staff picks and current availability without sample content', () => {
  show();
  expect(screen.getByRole('heading', { level: 1, name: 'Used cars in Brighton' })).toBeInTheDocument();
  const stock = screen.getByRole('region', { name: 'On the forecourt' });
  expect(within(stock).getAllByRole('article')[0]).toHaveAttribute('aria-label', 'Toyota Yaris');
  expect(within(stock).queryByRole('heading', { name: 'Audi A1' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Multi Choice|Hayes|020 4628/)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Used Toyota' })).toHaveAttribute('href', '/stock?make=Toyota');
});

it('resets a dependent model and searches make/model/budget without hidden old filters', () => {
  show({ initialFilters: { make: 'Ford', model: 'Focus', fuel: 'Diesel', search: 'old search', minPrice: '1000', sort: 'price-desc' } });
  const form = screen.getByRole('form', { name: 'Search used cars' });
  fireEvent.change(within(form).getByRole('combobox', { name: 'Make' }), { target: { value: 'Toyota' } });
  expect(within(form).getByRole('combobox', { name: 'Model' })).toHaveValue('');
  fireEvent.change(within(form).getByRole('combobox', { name: 'Model' }), { target: { value: 'Yaris' } });
  fireEvent.change(within(form).getByRole('combobox', { name: 'Maximum price' }), { target: { value: '10000' } });
  fireEvent.submit(form);
  expect(events.search).toHaveBeenCalledWith({ ...defaults, make: 'Toyota', model: 'Yaris', maxPrice: '10000' });
  expect(within(form).getByRole('button', { name: 'See 1 car' })).toBeInTheDocument();
});

it('preserves custom dealer wording and keeps feature-disabled routes out of the page', () => {
  const settings = config();
  settings.hero = { ...settings.hero, copy: 'Chosen cars at Harbour', announcement: 'Please arrange your visit', subcopy: 'Our published welcome.' };
  settings.presentation = { showHeroDescription: true, featuredEnabled: false, visitEnabled: false, servicesEnabled: false };
  settings.partExchange = { ...settings.partExchange!, enabled: false };
  show({ settings });
  expect(screen.getByRole('heading', { level: 1, name: 'Chosen cars at Harbour' })).toBeInTheDocument();
  expect(screen.getByText('Our published welcome.')).toBeInTheDocument();
  expect(screen.getByText('Please arrange your visit')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'On the forecourt' })).not.toBeInTheDocument();
  expect(screen.queryByRole('form', { name: 'Start part exchange' })).not.toBeInTheDocument();
  expect(screen.queryByText('Can you deliver my car?')).not.toBeInTheDocument();
  expect(screen.queryByText('What warranty is available?')).not.toBeInTheDocument();
  expect(screen.queryByText('Opening hours and visit details')).not.toBeInTheDocument();
});

it('does not show stale featured stock on error and leaves a stock recovery route', () => {
  show({ error: 'Unavailable' });
  const stock = screen.getByRole('region', { name: 'On the forecourt' });
  expect(within(stock).queryByRole('article')).not.toBeInTheDocument();
  expect(within(stock).getByRole('link', { name: 'Browse stock' })).toHaveAttribute('href', '/stock');
  expect(screen.getByRole('button', { name: 'Browse stock' })).toBeEnabled();
});

it('offers manual entry when the part-exchange lookup fails', async () => {
  events.lookup.mockRejectedValueOnce(new Error('Unavailable'));
  show();
  const form = screen.getByRole('form', { name: 'Start part exchange' });
  fireEvent.change(within(form).getByRole('textbox', { name: 'Your registration' }), { target: { value: 'ab12 cde' } });
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('enter the details manually'));
  fireEvent.click(screen.getByRole('button', { name: 'Enter details manually' }));
  expect(window.location.pathname + window.location.search).toBe('/enquire?type=part_exchange&manual=true');
  expect(events.lookup).toHaveBeenCalledWith('AB12CDE', expect.any(AbortSignal));
});

it('hands the lookup result to the existing part-exchange form without putting vehicle facts in the URL', async () => {
  const result = { registration: 'AB12CDE', vehicle: { make: 'Ford', model: 'Focus', registrationDate: '2012-04-01' }, mot: null };
  events.lookup.mockResolvedValueOnce(result);
  show();
  const form = screen.getByRole('form', { name: 'Start part exchange' });
  fireEvent.change(within(form).getByRole('textbox', { name: 'Your registration' }), { target: { value: 'AB12 CDE' } });
  fireEvent.submit(form);
  await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/enquire?type=part_exchange'));
  expect(readHomepagePartExchangeLookup('AB12CDE')).toMatchObject(result);
});

it('ignores a late lookup after the buyer changes the registration', async () => {
  let complete!: (result: unknown) => void;
  events.lookup.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  show();
  const form = screen.getByRole('form', { name: 'Start part exchange' });
  const registration = within(form).getByRole('textbox', { name: 'Your registration' });
  fireEvent.change(registration, { target: { value: 'AB12 CDE' } });
  fireEvent.submit(form);
  fireEvent.change(registration, { target: { value: 'XY20 ZZZ' } });
  await act(async () => complete({ registration: 'AB12CDE', vehicle: { make: 'Ford', model: 'Focus' }, mot: null }));
  expect(window.location.pathname).toBe('/');
  expect(readHomepagePartExchangeLookup('AB12CDE')).toBeNull();
  expect(within(form).getByRole('button', { name: 'Find my car' })).toBeEnabled();
});

it('sends disabled public enquiries to contact and retains configured visit information', () => {
  show({ publicEnquiriesEnabled: false });
  expect(screen.queryByRole('form', { name: 'Start part exchange' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Ask about part exchange' }).every(link => link.getAttribute('href') === '/contact')).toBe(true);
  const details = screen.getByText('Opening hours and visit details').closest('details')!;
  fireEvent.click(screen.getByText('Opening hours and visit details'));
  expect(within(details).getByText('Closed')).toBeInTheDocument();
  expect(within(details).getByRole('button', { name: 'Show map' })).toBeInTheDocument();
  expect(screen.queryByTitle('Dealership location')).not.toBeInTheDocument();
});

it('retains published reviews and enabled delivery, warranty and booking information', () => {
  const settings = config();
  settings.presentation = { reviews: [{ name: 'A real buyer', rating: 5, review: 'Published dealership feedback.', date: '2026-11-19', source: 'Published settings' }] };
  settings.warranty = { ...settings.warranty!, enabled: true, description: 'Our published warranty wording.' };
  settings.delivery = { ...settings.delivery!, enabled: true };
  settings.deliveryPricing = { enabled: true, basePrice: '40', pricePerMile: '1.20' };
  settings.testDriveBooking = { enabled: true } as GraphiteHomepageProps['settings']['testDriveBooking'];
  window.history.replaceState({}, '', '/#delivery');
  show({ settings });
  expect(screen.getByText('Published dealership feedback.')).toBeInTheDocument();
  expect(screen.getAllByText('Our published warranty wording.').length).toBeGreaterThan(0);
  expect(document.getElementById('delivery')).toHaveAttribute('open');
  expect(screen.getByRole('button', { name: 'Estimate delivery' })).toBeInTheDocument();
  expect(screen.getByText('Can I arrange a test drive?')).toBeInTheDocument();
});
