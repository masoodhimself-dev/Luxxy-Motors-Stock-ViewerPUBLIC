import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import type { DealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import type { FilterState } from './filters';
import { MultiChoiceHomepage } from './multi-choice-homepage';
import { partExchangeDraftKey, readPartExchangeDraft, savePartExchangeDraft } from '@/lib/part-exchange-draft';
import { multiChoiceHomeSections } from '@/lib/multi-choice-home-sections';
const events = vi.hoisted(() => ({ search: vi.fn(), analytics: vi.fn(), contact: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackEvent: (...args: unknown[]) => events.analytics(...args) }));
vi.mock('@/components/ai-car-finder', () => ({ AiCarFinder: () => <div data-testid="ai-finder">Existing AI finder</div> }));
vi.mock('@/components/delivery-estimator', () => ({ DeliveryEstimator: () => <button type="button">Estimate delivery</button> }));
vi.mock('@/components/showroom-opening-status', () => ({ ShowroomOpeningStatus: () => null }));
const defaultFilters: FilterState = { make: '', model: '', minPrice: '', maxPrice: '', fuel: '', transmission: '', bodyType: '', search: '', ulez: false, sort: '' };
const car = (id: string, extra: Record<string, unknown>) => ({ id, advertId: id, make: 'Ford', model: 'Focus', title: 'Ford Focus', price: 5000, year: 2020, mileage: 20000, fuel: 'Petrol', transmission: 'Manual', images: [], heroImage: `https://photos.example.test/${id}.jpg`, inventoryStatus: 'available', sourceExtras: null, ...extra } as unknown as Car);
const cars = [car('ford', { bodyType: 'Hatchback' }), car('toyota', { title: 'Toyota Yaris', make: 'Toyota', model: 'Yaris', price: 9000, bodyType: 'Hatchback' }), car('ford-auto', { title: 'Ford Fiesta', model: 'Fiesta', price: 7000, bodyType: 'Saloon' })];
const settings = (): DealerConfig => ({ ...dealerConfig, identity: { name: 'Multi Choice Motors' }, hero: { ...dealerConfig.hero, copy: 'Find your next car' }, address: { street: '36A Coldharbour Lane', city: 'Hayes', postcode: 'UB3 3EP' }, contact: { phone: '02046286488', email: 'enquiries@multichoicemotors.co.uk', whatsapp: '+447564580875' }, presentation: { heroImageUrl: 'https://multichoicemotors.co.uk/our-photo.jpg', heroImageAlt: 'Our Range Rover and Ford Mondeo' }, whyBuy: [], hours: [{ days: 'Monday–Saturday', times: '10:00–18:00' }, { days: 'Sunday', times: 'Closed' }] });
function Harness({ config = settings(), stock = cars, loading = false, error = null, initialFilters = {} }: { config?: DealerConfig; stock?: Car[]; loading?: boolean; error?: string | null; initialFilters?: Partial<FilterState> }) {
  const [filters, setFilters] = useState(() => ({ ...defaultFilters, ...initialFilters }));
  return <MultiChoiceHomepage settings={config} cars={stock} isLoading={loading} error={error} publicEnquiriesEnabled filters={filters} setFilters={setFilters} onSearch={events.search} />;
}
beforeEach(() => { sessionStorage.clear(); events.search.mockReset(); events.analytics.mockReset(); window.history.replaceState({}, '', '/'); });
afterEach(cleanup);

it('keeps exclusive and unknown price qualifications visible without inventing a VAT-inclusive price', () => {
  render(<Harness stock={[car('exclusive', { title: 'VAT-exclusive car', priceType: 'VAT exclusive' }), car('unknown', { title: 'Unconfirmed price car', priceType: 'supplier-special' }), car('poa', { title: 'POA car', price: 0, priceType: 'retail' })]} />);
  expect(within(screen.getByRole('article', { name: 'VAT-exclusive car' })).getByText('Excludes VAT')).toBeInTheDocument();
  expect(within(screen.getByRole('article', { name: 'Unconfirmed price car' })).getByText('Confirm the full price with us')).toBeInTheDocument();
  expect(within(screen.getByRole('article', { name: 'POA car' })).getByText('Price on request')).toBeInTheDocument();
});

it('searches real stock with dependent make/model and cash budgets without navigation or requests while editing', () => {
  render(<Harness />);
  const search = screen.getByRole('form', { name: 'Search used cars' });
  const make = within(search).getByRole('combobox', { name: 'Make' }), model = within(search).getByRole('combobox', { name: 'Model' });
  expect(model).toBeDisabled();
  fireEvent.change(make, { target: { value: 'Ford' } });
  expect(model).not.toBeDisabled(); expect(model).not.toHaveTextContent('Yaris');
  fireEvent.change(model, { target: { value: 'Focus' } });
  fireEvent.change(within(search).getByRole('combobox', { name: 'Maximum price' }), { target: { value: '5000' } });
  expect(within(search).getByRole('button', { name: 'Search 1 car' })).toBeInTheDocument(); expect(events.search).not.toHaveBeenCalled();
  fireEvent.submit(search);
  expect(events.search).toHaveBeenCalledWith(expect.objectContaining({ make: 'Ford', model: 'Focus', maxPrice: '5000' }));
  fireEvent.change(make, { target: { value: 'Toyota' } }); expect(model).toHaveValue('');
  expect(screen.queryByText(/monthly|APR|finance/i)).not.toBeInTheDocument();
});

it('supports keyboard tabs and preserves a valid registration in the existing draft only after an explicit valuation action', () => {
  savePartExchangeDraft(partExchangeDraftKey(), { details: { registration: '', makeModel: '', mileage: '', condition: '', conditionNotes: '', keys: '', v5: '', serviceHistory: '', name: 'Alex Buyer', phone: '07700900123', email: '' }, vehicleId: '', delivery: 'website' });
  render(<Harness />);
  const buy = screen.getByRole('tab', { name: 'Buy a car' }); buy.focus();
  fireEvent.keyDown(buy, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Part exchange' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Part exchange' })).toHaveFocus();
  const form = screen.getByRole('form', { name: 'Start part exchange' });
  fireEvent.submit(form); expect(within(form).getByRole('alert')).toHaveTextContent('complete UK registration'); expect(window.location.pathname).toBe('/');
  fireEvent.change(within(form).getByTestId('homepage-px-registration-hero'), { target: { value: 'ab12cde' } });
  expect(window.location.pathname).toBe('/');
  fireEvent.submit(form);
  expect(window.location.pathname + window.location.search).toBe('/enquire?type=part_exchange');
  const draft = readPartExchangeDraft(partExchangeDraftKey());
  expect(draft?.details).toMatchObject({ name: 'Alex Buyer', phone: '07700900123' }); expect(draft?.details.registration.replace(/\s/g, '')).toBe('AB12CDE');
});

it('shows only enabled services and keeps AI available without an automatic action', () => {
  const config = settings(); config.partExchange = { ...config.partExchange!, enabled: false }; config.warranty = { ...config.warranty!, enabled: false }; config.delivery = { ...config.delivery!, enabled: false };
  render(<Harness config={config} />);
  expect(screen.queryByRole('tab', { name: 'Part exchange' })).not.toBeInTheDocument();
  expect(document.getElementById('part-exchange')).toBeNull(); expect(document.getElementById('delivery')).toBeNull(); expect(document.getElementById('warranty')).toBeNull();
  expect(screen.queryByText('Can I arrange a test drive?')).not.toBeInTheDocument();
  expect(screen.getByTestId('ai-finder').closest('details')).not.toHaveAttribute('open');
  expect(events.search).not.toHaveBeenCalled();
});

it('preserves staff featured choices, omits sold/hidden/withdrawn cars and keeps card photographs free of overlay controls', () => {
  const config = settings(); config.featuredVehicleIds = ['ford'];
  render(<Harness config={config} stock={[cars[0], cars[1], car('sold', { title: 'Sold vehicle', inventoryStatus: 'sold' }), car('hidden', { title: 'Hidden vehicle', inventoryStatus: 'hidden' }), car('withdrawn', { title: 'Withdrawn vehicle', inventoryStatus: 'withdrawn' })]} />);
  const rail = screen.getByLabelText('Featured cars; scroll for more');
  const cards = within(rail).getAllByRole('article'); expect(cards[0]).toHaveAccessibleName('Ford Focus');
  expect(within(rail).queryByText('Sold vehicle')).not.toBeInTheDocument(); expect(within(rail).queryByText('Hidden vehicle')).not.toBeInTheDocument(); expect(within(rail).queryByText('Withdrawn vehicle')).not.toBeInTheDocument();
  expect(within(rail).queryByRole('button')).not.toBeInTheDocument();
  expect(within(cards[0]).getByRole('link', { name: 'View car' })).toHaveAttribute('href', '/vehicle/ford');
});

it('uses supplied body types and make links, and only the dealership’s configured hero photo', () => {
  render(<Harness />);
  expect(screen.getByAltText('Our Range Rover and Ford Mondeo')).toHaveAttribute('src', 'https://multichoicemotors.co.uk/our-photo.jpg');
  expect(screen.getByRole('link', { name: 'Hatchback 2 cars' })).toHaveAttribute('href', '/stock?bodyType=Hatchback');
  expect(screen.getByRole('link', { name: 'Used Toyota' })).toHaveAttribute('href', '/stock?make=Toyota');
  expect(screen.queryByText(/SUV/)).not.toBeInTheDocument();
});

it('has truthful loading/error and empty-stock states without invented stock counts or review scores', () => {
  const view = render(<Harness stock={[]} loading />);
  expect(screen.getByRole('button', { name: 'Loading cars…' })).toBeDisabled(); expect(screen.getByText('Loading featured cars…')).toBeInTheDocument();
  view.rerender(<Harness stock={[]} error="Network unavailable" />);
  expect(screen.getByText('Stock is temporarily unavailable')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Search 0 cars' })).not.toBeInTheDocument();
  expect(document.getElementById('reviews')).toBeNull();
  view.rerender(<Harness stock={[]} />); expect(screen.getByText('No featured cars to show right now')).toBeInTheDocument();
});

it('renders only real configured reviews, respects the review switch and rejects unsafe source URLs', () => {
  const config = settings(); config.presentation = { ...config.presentation, reviews: [{ rating: 4, review: 'A clear and helpful process.', name: 'An actual reviewer', source: 'Published feedback', date: 'October 2026' }], reviewsUrl: 'javascript:alert(1)' };
  const view = render(<Harness config={config} />);
  expect(screen.getByText('A clear and helpful process.')).toBeInTheDocument(); expect(screen.getByLabelText('4 out of 5 stars')).toBeInTheDocument(); expect(screen.queryByRole('link', { name: 'Read customer reviews' })).not.toBeInTheDocument();
  view.rerender(<Harness config={{ ...config, presentation: { ...config.presentation, reviewsEnabled: false } }} />);
  expect(document.getElementById('reviews')).toBeNull(); expect(multiChoiceHomeSections({ ...config, presentation: { reviews: [], reviewsUrl: '' } }).reviews).toBe(false);
});

it('expands published grouped hours into seven days and highlights the current London day with real directions', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-07-05T23:30:00Z'));
  try { render(<Harness />);
    const hours = screen.getByRole('heading', { name: 'Opening times' }).closest('section')!;
    const today = within(hours).getByText('Monday', { exact: true }); expect(today.closest('div')).toHaveAttribute('data-today', 'true');
    expect(within(hours).getByText('Sunday').nextElementSibling).toHaveTextContent('Closed');
    expect(within(hours).getAllByText('10:00 – 18:00')).toHaveLength(6);
    expect(screen.getByRole('link', { name: /Open map and directions/ }).getAttribute('href')).toContain('UB3%203EP');
  } finally { vi.useRealTimers(); }
});

it('does not open a car after swiping the featured rail, while retaining immediate keyboard and fresh-tap activation', () => {
  render(<Harness />);
  const rail = screen.getByLabelText('Featured cars; scroll for more'), link = within(rail).getByRole('link', { name: 'View Ford Focus' });
  fireEvent.touchStart(rail, { touches: [{ identifier: 1, clientX: 200, clientY: 100 }] });
  fireEvent.touchMove(rail, { touches: [{ identifier: 1, clientX: 80, clientY: 104 }] });
  fireEvent.touchEnd(rail, { touches: [], changedTouches: [{ identifier: 1, clientX: 80, clientY: 104 }] });
  const afterSwipe = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }); fireEvent(link, afterSwipe);
  expect(afterSwipe.defaultPrevented).toBe(true); expect(events.analytics).not.toHaveBeenCalled();
  fireEvent.click(link, { detail: 0 }); expect(events.analytics).toHaveBeenCalledTimes(1);
  fireEvent.touchStart(rail, { touches: [{ identifier: 2, clientX: 100, clientY: 100 }] });
  fireEvent.touchEnd(rail, { touches: [], changedTouches: [{ identifier: 2, clientX: 100, clientY: 100 }] });
  fireEvent.click(link, { detail: 1 }); expect(events.analytics).toHaveBeenCalledTimes(2);
});


it('keeps remembered unavailable make and model visibly selected without clearing them during loading or errors', () => {
  const initialFilters = { make: 'Fiat', model: 'Panda' };
  const view = render(<Harness initialFilters={initialFilters} stock={[]} loading />);
  let search = screen.getByRole('form', { name: 'Search used cars' });
  expect(within(search).getByRole('combobox', { name: 'Make' })).toHaveValue('Fiat');
  expect(within(search).getByRole('option', { name: 'Fiat (saved choice)' })).toBeInTheDocument();
  expect(within(search).getByRole('combobox', { name: 'Model' })).toHaveValue('Panda');
  view.rerender(<Harness initialFilters={initialFilters} stock={[]} error="Stock unavailable" />);
  expect(within(search).getByRole('option', { name: 'Panda (saved choice)' })).toBeInTheDocument();
  view.rerender(<Harness initialFilters={initialFilters} />);
  search = screen.getByRole('form', { name: 'Search used cars' });
  expect(within(search).getByRole('option', { name: 'Fiat (not in current stock)' })).toBeInTheDocument();
  expect(within(search).getByRole('option', { name: 'Panda (not in current stock)' })).toBeInTheDocument();
  expect(within(search).getByRole('button', { name: 'Search 0 cars' })).toBeInTheDocument();
  fireEvent.submit(search); expect(events.search).toHaveBeenLastCalledWith(expect.objectContaining(initialFilters));
  fireEvent.change(within(search).getByRole('combobox', { name: 'Make' }), { target: { value: 'Ford' } });
  expect(within(search).getByRole('combobox', { name: 'Model' })).toHaveValue('');
  expect(within(search).getByRole('button', { name: 'Search 2 cars' })).toBeInTheDocument();
});

it('shows an orphaned saved model and asks the customer to choose a make or explicitly clear it before searching', () => {
  render(<Harness initialFilters={{ model: 'Focus' }} />);
  const search = screen.getByRole('form', { name: 'Search used cars' }), model = within(search).getByRole('combobox', { name: 'Model' });
  expect(model).toHaveValue('Focus'); expect(model).not.toBeDisabled();
  expect(within(search).getByRole('option', { name: 'Focus (choose a make)' })).toBeInTheDocument();
  expect(within(search).getByText('Choose a make or clear the saved model before searching.')).toBeInTheDocument();
  expect(within(search).getByRole('button', { name: 'Search 1 car' })).toBeDisabled();
  fireEvent.submit(search); expect(events.search).not.toHaveBeenCalled();
  fireEvent.change(model, { target: { value: '' } });
  expect(within(search).queryByText(/clear the saved model/)).not.toBeInTheDocument();
  fireEvent.submit(search); expect(events.search).toHaveBeenCalledWith(expect.objectContaining({ make: '', model: '' }));
});
