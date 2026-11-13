import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import type { DealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import type { FilterState } from './filters';
import { MultiChoiceHomepage } from './multi-choice-homepage';
import { partExchangeDraftKey, readPartExchangeDraft, savePartExchangeDraft } from '@/lib/part-exchange-draft';
import { multiChoiceHomeSections } from '@/lib/multi-choice-home-sections';
import { clearHomepagePartExchangeLookup, readHomepagePartExchangeLookup } from '@/lib/homepage-part-exchange';
const events = vi.hoisted(() => ({ search: vi.fn(), analytics: vi.fn(), contact: vi.fn(), lookup: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => events.lookup(...args) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: (...args: unknown[]) => events.analytics(...args) }));
vi.mock('@/components/ai-car-finder', () => ({ AiCarFinder: ({ collapsible }: { collapsible?: boolean }) => collapsible ? <details data-testid="ai-finder"><summary>Search by describing a car</summary></details> : null }));
vi.mock('@/components/delivery-estimator', () => ({ DeliveryEstimator: () => <button type="button">Estimate delivery</button> }));
const defaultFilters: FilterState = { make: '', model: '', minPrice: '', maxPrice: '', fuel: '', transmission: '', bodyType: '', search: '', ulez: false, sort: '' };
const car = (id: string, extra: Record<string, unknown>) => ({ id, advertId: id, make: 'Ford', model: 'Focus', title: 'Ford Focus', price: 5000, year: 2020, mileage: 20000, fuel: 'Petrol', transmission: 'Manual', images: [], heroImage: `https://photos.example.test/${id}.jpg`, inventoryStatus: 'available', sourceExtras: null, ...extra } as unknown as Car);
const cars = [car('ford', { bodyType: 'Hatchback' }), car('toyota', { title: 'Toyota Yaris', make: 'Toyota', model: 'Yaris', price: 9000, bodyType: 'Hatchback' }), car('ford-auto', { title: 'Ford Fiesta', model: 'Fiesta', price: 7000, bodyType: 'Saloon' })];
const settings = (): DealerConfig => ({ ...dealerConfig, identity: { name: 'Multi Choice Motors' }, hero: { ...dealerConfig.hero, copy: 'Find your next car' }, address: { street: '36A Coldharbour Lane', city: 'Hayes', postcode: 'UB3 3EP' }, contact: { phone: '02046286488', email: 'enquiries@multichoicemotors.co.uk', whatsapp: '+447564580875' }, presentation: { heroImageUrl: 'https://multichoicemotors.co.uk/our-photo.jpg', heroImageAlt: 'Our Range Rover and Ford Mondeo' }, whyBuy: [], hours: [{ days: 'Monday–Saturday', times: '10:00–18:00' }, { days: 'Sunday', times: 'Closed' }] });
function Harness({ config = settings(), stock = cars, loading = false, error = null, initialFilters = {} }: { config?: DealerConfig; stock?: Car[]; loading?: boolean; error?: string | null; initialFilters?: Partial<FilterState> }) {
  const [filters, setFilters] = useState(() => ({ ...defaultFilters, ...initialFilters }));
  return <MultiChoiceHomepage settings={config} cars={stock} isLoading={loading} error={error} publicEnquiriesEnabled filters={filters} setFilters={setFilters} onSearch={events.search} />;
}
const motReply = (registration = 'AB12CDE') => ({ status: 'estimated', registration, vehicle: { make: 'FORD', model: 'FOCUS', registrationDate: '2012-04-01' }, estimate: { mileage: 88000, lastTestDate: '2026-01-02', lastTestMileage: 80000, annualMiles: 10000 }, mot: { checkedAt: '2026-11-01T10:00:00Z', dueDate: '2027-01-01', latestTestResult: 'PASSED' } });
beforeEach(() => { sessionStorage.clear(); clearHomepagePartExchangeLookup(); events.search.mockReset(); events.analytics.mockReset(); events.lookup.mockReset(); events.lookup.mockImplementation((url: string) => Promise.resolve(motReply(new URL(url, window.location.origin).searchParams.get('registration')!))); window.history.replaceState({}, '', '/'); const meta = document.createElement('meta'); meta.name = 'luxxy-canonical-origin'; meta.content = 'https://multichoicemotors.co.uk'; meta.setAttribute('data-page-meta', ''); meta.setAttribute('data-homepage-test', ''); document.head.append(meta); });
afterEach(() => { cleanup(); document.querySelectorAll('[data-homepage-test]').forEach(node => node.remove()); });

it('uses the shared homepage with only another dealership’s published content and neutral fallback reasons', () => {
  document.querySelector<HTMLMetaElement>('[data-homepage-test]')!.content = 'https://shoredrive.uk';
  const config: DealerConfig = { ...settings(), identity: { name: 'Shore Drive' }, contact: { phone: '02079460123', email: 'hello@shoredrive.uk' }, address: { street: '10 Shore Road', city: 'Brighton', postcode: 'BN1 1AA' }, presentation: { heroImageUrl: '/shore-showroom.jpg', heroImageAlt: 'Shore Drive showroom' }, trustItems: [], whyBuy: [{ title: 'Our published approach', description: 'Ask about the vehicle records before your visit.' }] };
  const before = JSON.stringify(config);
  const view = render(<Harness config={config} />);
  expect(screen.getByRole('img', { name: 'Shore Drive showroom' })).toHaveAttribute('src', '/shore-showroom.jpg');
  expect(screen.getByRole('region', { name: 'Buying from Shore Drive' })).toHaveAttribute('id', 'about');
  expect(screen.getByText('Ask about the vehicle records before your visit.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Email us\s*hello@shoredrive.uk/ })).toHaveAttribute('href', 'mailto:hello@shoredrive.uk');
  expect(view.container.textContent).not.toMatch(/6.month warranty|36 months|price.checked daily|triple.check|same day drive away|hayes|coldharbour/i);
  expect(view.container.innerHTML).not.toContain('multichoicemotors.co.uk');
  expect(JSON.stringify(config)).toBe(before);
});

it('uses the dealership’s own stock photograph when no hero is configured and leaves a neutral introduction when no photos exist', () => {
  document.querySelector<HTMLMetaElement>('[data-homepage-test]')!.content = 'https://new-dealer.example';
  const config = { ...settings(), identity: { name: 'New Dealership' }, presentation: {}, whyBuy: [], trustItems: [] };
  const view = render(<Harness config={config} />);
  expect(screen.getByRole('img', { name: 'New Dealership cars' })).toHaveAttribute('src', 'https://photos.example.test/toyota.jpg');
  view.rerender(<Harness config={config} stock={[]} />);
  expect(document.querySelector('.mh-hero-photo')).toBeNull();
  expect(screen.getByRole('heading', { level: 1, name: 'Find your next car' })).toBeInTheDocument();
  expect(screen.queryByText(/6.month warranty/i)).not.toBeInTheDocument();
});

it('does not substitute Multi-Choice artwork based on another dealer’s matching uploaded asset path', () => {
  document.querySelector<HTMLMetaElement>('[data-homepage-test]')!.content = 'https://shoredrive.uk';
  const ownPhoto = '/api/website-assets/12f86896-51f9-4e38-be24-b8ab5d243c9c';
  render(<Harness config={{ ...settings(), presentation: { heroImageUrl: ownPhoto, heroImageAlt: 'Our own uploaded photo' } }} />);
  expect(screen.getByRole('img', { name: 'Our own uploaded photo' })).toHaveAttribute('src', ownPhoto);
});

it('frames only Shore Drive’s published forecourt photo and respects a new photo', () => {
  const origin = document.querySelector<HTMLMetaElement>('[data-homepage-test]')!;
  origin.content = 'https://www.shoredrive.uk';
  const knownPhoto = '/api/website-assets/7934f681-e43a-4e8b-a812-2feb02de64e9';
  const config = { ...settings(), presentation: { heroImageUrl: knownPhoto, heroImageAlt: 'Our forecourt' } };
  const view = render(<Harness config={config} />);
  const hero = screen.getByRole('img', { name: /Audi SUV and silver Ford/ });
  expect(hero.querySelector('image')).toHaveAttribute('href', knownPhoto);

  view.rerender(<Harness config={{ ...config, presentation: { ...config.presentation, heroImageUrl: '/new-forecourt.jpg' } }} />);
  expect(screen.getByRole('img', { name: 'Our forecourt' })).toHaveAttribute('src', '/new-forecourt.jpg');

  origin.content = 'https://new-dealer.example';
  view.rerender(<Harness config={config} />);
  expect(screen.getByRole('img', { name: 'Our forecourt' })).toHaveAttribute('src', knownPhoto);
});

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

it('supports keyboard tabs and looks up a valid registration only after an explicit action', async () => {
  savePartExchangeDraft(partExchangeDraftKey(), { details: { registration: '', makeModel: '', mileage: '', condition: '', conditionNotes: '', keys: '', v5: '', serviceHistory: '', name: 'Alex Buyer', phone: '07700900123', email: '' }, vehicleId: '', delivery: 'website' });
  render(<Harness />);
  const buy = screen.getByRole('tab', { name: 'Buy a car' }); buy.focus();
  fireEvent.keyDown(buy, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Part exchange' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Part exchange' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Part exchange' }), { key: 'Home' });
  expect(buy).toHaveAttribute('aria-selected', 'true'); expect(buy).toHaveFocus();
  fireEvent.keyDown(buy, { key: 'End' });
  expect(screen.getByRole('tab', { name: 'Part exchange' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Part exchange' })).toHaveFocus();
  const form = screen.getByRole('form', { name: 'Start part exchange' });
  fireEvent.submit(form); expect(within(form).getByRole('alert')).toHaveTextContent('complete UK registration'); expect(window.location.pathname).toBe('/');
  fireEvent.change(within(form).getByTestId('homepage-px-registration-hero'), { target: { value: 'ab12cde' } });
  expect(window.location.pathname).toBe('/'); expect(events.lookup).not.toHaveBeenCalled();
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/enquire?type=part_exchange'));
  expect(events.lookup).toHaveBeenCalledTimes(1);
  expect(events.lookup).toHaveBeenCalledWith('/api/mot-mileage-estimate?registration=AB12CDE&identity=dvla', { signal: expect.any(AbortSignal) });
  expect(readHomepagePartExchangeLookup('AB12CDE')?.vehicle).toMatchObject({ make: 'FORD', model: 'FOCUS' });
  const draft = readPartExchangeDraft(partExchangeDraftKey());
  expect(draft?.details).toMatchObject({ name: 'Alex Buyer', phone: '07700900123' }); expect(draft?.details.registration.replace(/\s/g, '')).toBe('AB12CDE');
});

it('discards a late lookup when the plate changes and can find the new car without submitting an enquiry', async () => {
  let resolve!: (reply: unknown) => void;
  events.lookup.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(<Harness />);
  fireEvent.click(screen.getByRole('tab', { name: 'Part exchange' }));
  const form = screen.getByRole('form', { name: 'Start part exchange' }), plate = within(form).getByTestId('homepage-px-registration-hero');
  fireEvent.change(plate, { target: { value: 'AB12CDE' } }); fireEvent.submit(form);
  const signal = events.lookup.mock.calls[0][1].signal as AbortSignal;
  expect(within(form).getByRole('button', { name: 'Finding your car…' })).toBeDisabled();
  fireEvent.change(plate, { target: { value: 'YS67LMK' } }); expect(signal.aborted).toBe(true);
  resolve(motReply('AB12CDE'));
  await waitFor(() => expect(within(form).getByRole('button', { name: 'Find my car' })).not.toBeDisabled());
  expect(window.location.pathname).toBe('/'); expect(readHomepagePartExchangeLookup('AB12CDE')).toBeNull();
  fireEvent.submit(form);
  await waitFor(() => expect(window.location.pathname).toBe('/enquire'));
  expect(readHomepagePartExchangeLookup('YS67LMK')?.registration).toBe('YS67LMK');
  expect(events.lookup.mock.calls.every(([url]) => String(url).startsWith('/api/mot-mileage-estimate?'))).toBe(true);
});

it.each(['YS67LMK', 'AB12CDE'])('lets only the latest homepage form navigate when both forms request %s', async secondPlate => {
  let resolveHero!: (reply: unknown) => void, resolveStrip!: (reply: unknown) => void;
  events.lookup.mockImplementationOnce(() => new Promise(done => { resolveHero = done; })).mockImplementationOnce(() => new Promise(done => { resolveStrip = done; }));
  render(<Harness />); fireEvent.click(screen.getByRole('tab', { name: 'Part exchange' }));
  const hero = screen.getByRole('form', { name: 'Start part exchange' }), strip = screen.getByRole('form', { name: 'Part-exchange valuation' });
  fireEvent.change(within(hero).getByTestId('homepage-px-registration-hero'), { target: { value: 'AB12CDE' } }); fireEvent.submit(hero);
  fireEvent.change(within(strip).getByTestId('homepage-px-registration-strip'), { target: { value: secondPlate } }); fireEvent.submit(strip);
  expect(events.lookup).toHaveBeenCalledTimes(2);
  await act(async () => { resolveHero(motReply('AB12CDE')); });
  expect(window.location.pathname).toBe('/'); expect(readHomepagePartExchangeLookup('AB12CDE')).toBeNull();
  expect(within(hero).getByRole('button', { name: 'Find my car' })).not.toBeDisabled();
  await act(async () => { resolveStrip(motReply(secondPlate)); });
  expect(window.location.pathname + window.location.search).toBe('/enquire?type=part_exchange');
  expect(readHomepagePartExchangeLookup(secondPlate)?.registration).toBe(secondPlate);
  expect(events.analytics).toHaveBeenCalledTimes(1);
});

it('releases a superseded stalled form at its deadline without a misleading error or a late navigation', async () => {
  vi.useFakeTimers();
  let resolveHero!: (reply: unknown) => void;
  try {
    events.lookup.mockImplementationOnce(() => new Promise(done => { resolveHero = done; }));
    render(<Harness />); fireEvent.click(screen.getByRole('tab', { name: 'Part exchange' }));
    const hero = screen.getByRole('form', { name: 'Start part exchange' }), strip = screen.getByRole('form', { name: 'Part-exchange valuation' });
    fireEvent.change(within(hero).getByTestId('homepage-px-registration-hero'), { target: { value: 'AB12CDE' } }); fireEvent.submit(hero);
    const oldSignal = events.lookup.mock.calls[0][1].signal as AbortSignal;
    // Editing the other form is a new intent even before its Find button is pressed.
    fireEvent.change(within(strip).getByTestId('homepage-px-registration-strip'), { target: { value: 'YS67LMK' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(oldSignal.aborted).toBe(true); expect(within(hero).getByRole('button', { name: 'Find my car' })).not.toBeDisabled();
    expect(within(hero).queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => { resolveHero(motReply('AB12CDE')); });
    expect(window.location.pathname).toBe('/'); expect(readHomepagePartExchangeLookup('AB12CDE')).toBeNull();
  } finally { vi.useRealTimers(); }
});

it('offers manual entry for a mismatched MOT response and preserves the plate and contact answers', async () => {
  events.lookup.mockResolvedValueOnce(motReply('YS67LMK'));
  render(<Harness />);
  const form = screen.getByRole('form', { name: 'Part-exchange valuation' });
  fireEvent.change(within(form).getByTestId('homepage-px-registration-strip'), { target: { value: 'AB12CDE' } }); fireEvent.submit(form);
  expect(await within(form).findByRole('alert')).toHaveTextContent('We couldn’t find your car');
  expect(window.location.pathname).toBe('/'); expect(readHomepagePartExchangeLookup('AB12CDE')).toBeNull();
  fireEvent.click(within(form).getByRole('button', { name: 'Enter details manually' }));
  expect(window.location.pathname + window.location.search).toBe('/enquire?type=part_exchange&manual=true');
  expect(readPartExchangeDraft(partExchangeDraftKey())?.details.registration).toBe('AB12CDE');
});

it('aborts lookup on unmount without navigating when its response arrives late', async () => {
  let resolve!: (reply: unknown) => void;
  events.lookup.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = render(<Harness />), form = screen.getByRole('form', { name: 'Part-exchange valuation' });
  fireEvent.change(within(form).getByTestId('homepage-px-registration-strip'), { target: { value: 'AB12CDE' } }); fireEvent.submit(form);
  const signal = events.lookup.mock.calls[0][1].signal as AbortSignal;
  view.unmount(); expect(signal.aborted).toBe(true);
  resolve(motReply()); await Promise.resolve();
  expect(window.location.pathname).toBe('/'); expect(readHomepagePartExchangeLookup('AB12CDE')).toBeNull();
});

it('times out a stalled lookup and allows an explicit retry', async () => {
  vi.useFakeTimers();
  try {
    events.lookup.mockImplementationOnce(() => new Promise(() => {}));
    render(<Harness />);
    const form = screen.getByRole('form', { name: 'Part-exchange valuation' });
    fireEvent.change(within(form).getByTestId('homepage-px-registration-strip'), { target: { value: 'AB12CDE' } }); fireEvent.submit(form);
    const signal = events.lookup.mock.calls[0][1].signal as AbortSignal;
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(signal.aborted).toBe(true);
    expect(within(form).getByRole('alert')).toHaveTextContent('Try again');
    expect(within(form).getByRole('button', { name: 'Find my car' })).not.toBeDisabled();
    fireEvent.submit(form); await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(events.lookup).toHaveBeenCalledTimes(2); expect(window.location.pathname).toBe('/enquire');
  } finally { vi.useRealTimers(); }
});

it('shows only enabled services and keeps AI available without an automatic action', () => {
  const config = settings(); config.partExchange = { ...config.partExchange!, enabled: false }; config.warranty = { ...config.warranty!, enabled: false }; config.delivery = { ...config.delivery!, enabled: false };
  render(<Harness config={config} />);
  expect(screen.queryByRole('tab', { name: 'Part exchange' })).not.toBeInTheDocument();
  expect(document.getElementById('part-exchange')).toBeNull(); expect(document.getElementById('delivery')).toBeNull(); expect(document.getElementById('warranty')).toBeNull();
  expect(screen.queryByText('Can I arrange a test drive?')).not.toBeInTheDocument();
  expect(screen.getByTestId('ai-finder')).not.toHaveAttribute('open');
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
  expect(screen.getByRole('link', { name: 'Hatchback' })).toHaveAttribute('href', '/stock?bodyType=Hatchback');
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

it('shows identical opening hours together and keeps directions alongside', () => {
  render(<Harness />);
  const hours = screen.getByRole('region', { name: 'Opening hours' });
  expect(within(hours).getByText('Monday to Saturday').nextElementSibling).toHaveTextContent('10:00 – 18:00');
  expect(within(hours).getByText('Sunday').nextElementSibling).toHaveTextContent('Closed');
  expect(within(hours).getAllByText('10:00 – 18:00')).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Get directions' }).getAttribute('href')).toContain('UB3%203EP');
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


it('keeps all six published dealership reasons and updates their content without replacing it with defaults', () => {
  const config = settings();
  config.whyBuy = Array.from({ length: 6 }, (_, index) => ({ title: `Published reason ${index + 1}`, description: `The dealership’s supplied explanation ${index + 1}.` }));
  const view = render(<Harness config={config} />);
  let rail = screen.getByRole('list', { name: 'Reasons to choose us' });
  expect(within(rail).getAllByRole('listitem')).toHaveLength(6);
  for (const reason of config.whyBuy) {
    expect(within(rail).getByRole('heading', { name: reason.title })).toBeInTheDocument();
    expect(within(rail).getByText(reason.description)).toBeInTheDocument();
  }
  const replacement = { ...config, whyBuy: config.whyBuy.map((reason, index) => index === 5 ? { title: 'Updated final reason', description: 'The latest published explanation.' } : reason) };
  view.rerender(<Harness config={replacement} />);
  rail = screen.getByRole('list', { name: 'Reasons to choose us' });
  expect(within(rail).getAllByRole('listitem')).toHaveLength(6);
  expect(within(rail).getByRole('heading', { name: 'Updated final reason' })).toBeInTheDocument();
  expect(within(rail).queryByText('Published reason 6')).not.toBeInTheDocument();
});

it('keeps the buying facts readable together without slide controls', () => {
  render(<Harness />);
  const facts = screen.getByRole('list', { name: 'Reasons to choose us' });
  expect(within(facts).getByRole('heading', { name: 'Multipoint inspection' })).toBeInTheDocument();
  expect(within(facts).getByRole('heading', { name: 'Visits by appointment' })).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Choose a reason' })).not.toBeInTheDocument();
});

it('keeps featured carousel controls keyboard-operable without opening a car and honours motion preferences', () => {
  const media = vi.fn(() => ({ matches: true })); vi.stubGlobal('matchMedia', media);
  try {
    render(<Harness />);
    const rail = screen.getByRole('group', { name: 'Featured cars; scroll for more' });
    const cars = within(rail).getAllByRole('article');
    Object.defineProperty(rail, 'clientWidth', { value: 320 });
    Object.defineProperty(rail, 'scrollWidth', { value: cars.length * 320 });
    cars.forEach((car, index) => Object.defineProperty(car, 'getBoundingClientRect', {
      value: () => ({ left: index * 320 - rail.scrollLeft, right: (index + 1) * 320 - rail.scrollLeft }),
    }));
    const scroll = vi.fn(({ left }: ScrollToOptions) => {
      rail.scrollLeft = left ?? 0;
      fireEvent.scroll(rail);
    });
    Object.defineProperty(rail, 'scrollTo', { value: scroll });
    fireEvent.scroll(rail);
    const previous = screen.getByRole('button', { name: 'Previous featured cars' });
    const next = screen.getByRole('button', { name: 'Next featured cars' });
    expect(previous).toBeDisabled();
    expect(screen.getByText(`1 of ${cars.length} cars`)).toBeVisible();
    next.focus();
    fireEvent.click(next);
    expect(scroll).toHaveBeenLastCalledWith({ left: 320, behavior: 'auto' });
    expect(screen.getByText(`2 of ${cars.length} cars`)).toBeVisible();
    expect(next).toHaveFocus();
    media.mockReturnValue({ matches: false });
    fireEvent.keyDown(rail, { key: 'End' });
    expect(scroll).toHaveBeenLastCalledWith({ left: (cars.length - 1) * 320, behavior: 'smooth' });
    expect(next).toBeDisabled();
    fireEvent.keyDown(rail, { key: 'Home' });
    expect(scroll).toHaveBeenLastCalledWith({ left: 0, behavior: 'smooth' });
    expect(previous).toBeDisabled();
    expect(window.location.pathname).toBe('/');
    expect(events.analytics).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

it('recovers a featured photograph when a stock refresh supplies a new source for the same car', () => {
  const original = car('same-car', { title: 'Ford Focus', heroImage: 'https://photos.example.test/old.jpg' });
  const view = render(<Harness stock={[original]} />);
  let card = screen.getByRole('article', { name: 'Ford Focus' });
  fireEvent.error(within(card).getByRole('img', { name: 'Ford Focus' }));
  expect(within(card).getByText('Photograph unavailable')).toBeInTheDocument();
  view.rerender(<Harness stock={[{ ...original, heroImage: 'https://photos.example.test/new.jpg' }]} />);
  card = screen.getByRole('article', { name: 'Ford Focus' });
  expect(within(card).getByRole('img', { name: 'Ford Focus' })).toHaveAttribute('src', 'https://photos.example.test/new.jpg');
  expect(within(card).queryByText('Photograph unavailable')).not.toBeInTheDocument();
});

it('keeps the published featured, visit and review section headings', () => {
  const config = settings();
  config.presentation = { ...config.presentation,
    websiteCopy: { featuredHeading: 'Our selected cars', visitHeading: 'Visit our Hayes showroom', reviewsHeading: 'Customer stories' },
    reviews: [{ rating: 5, review: 'Helpful throughout our visit.', name: 'Published customer', source: 'Dealer feedback', date: 'October 2026' }],
  };
  render(<Harness config={config} />);
  expect(screen.getByRole('heading', { name: 'Our selected cars' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Visit our Hayes showroom' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Customer stories' })).toBeInTheDocument();
});

it('keeps delivery on demand inside the FAQ and warranty on its dedicated page without a duplicate service block', async () => {
  const config = settings();
  config.warranty = { enabled: true, title: 'Warranty support', description: 'Please check the policy details with us for your chosen car.', ctaLabel: 'Read our cover information' };
  config.delivery = { enabled: true, title: 'Delivery to your postcode', description: 'We will confirm delivery availability and arrangements with you.', ctaLabel: 'Talk to us about delivery' };
  const view = render(<Harness config={config} />);
  const delivery = document.getElementById('delivery')! as HTMLDetailsElement;
  expect(document.querySelector('.mh-services')).toBeNull();
  expect(document.getElementById('warranty')).toBeNull();
  expect(screen.getByRole('link', { name: 'Warranty information' })).toHaveAttribute('href', '/warranty');
  expect(delivery.tagName).toBe('DETAILS');
  expect(delivery.open).toBe(false);
  expect(within(delivery).getByText(config.delivery.description)).toBeInTheDocument();
  window.history.replaceState({}, '', '/#delivery');
  fireEvent(window, new HashChangeEvent('hashchange'));
  await waitFor(() => expect(delivery.open).toBe(true));
  const deliveryLink = within(delivery).getByRole('link', { name: 'Ask about delivery' });
  const question = new URL(deliveryLink.getAttribute('href')!, window.location.origin).searchParams.get('searchRequest');
  expect(question).toContain('my postcode');
  view.rerender(<Harness config={{ ...config, warranty: { ...config.warranty, enabled: false }, delivery: { ...config.delivery, enabled: false } }} />);
  expect(document.getElementById('delivery')).toBeNull();
  expect(screen.queryByRole('link', { name: 'Warranty information' })).not.toBeInTheDocument();
});

it('retains published team and arrival details in the visit section and respects its visibility switch', () => {
  const config = settings();
  config.presentation = { ...config.presentation, teamImageUrl: 'https://multichoicemotors.co.uk/our-team.jpg', teamImageAlt: 'Our showroom team', teamIntroduction: 'Our team can help you choose your next car.', websiteCopy: { teamHeading: 'Meet our Hayes team' }, visitInstructions: 'Please check in at reception when you arrive.', parkingInstructions: 'Use the marked visitor parking bays.' };
  const view = render(<Harness config={config} />);
  const visit = document.getElementById('find-us')!;
  expect(within(visit).getByRole('img', { name: 'Our showroom team' })).toHaveAttribute('src', 'https://multichoicemotors.co.uk/our-team.jpg');
  expect(within(visit).getByRole('heading', { name: 'Meet our Hayes team' })).toBeInTheDocument();
  expect(within(visit).getByText(config.presentation.teamIntroduction!)).toBeInTheDocument();
  expect(within(visit).getByText(config.presentation.visitInstructions!)).toBeInTheDocument();
  expect(within(visit).getByText(config.presentation.parkingInstructions!)).toBeInTheDocument();
  view.rerender(<Harness config={{ ...config, presentation: { ...config.presentation, visitEnabled: false } }} />);
  expect(document.getElementById('find-us')).toBeNull();
  expect(screen.queryByRole('img', { name: 'Our showroom team' })).not.toBeInTheDocument();
});

it('loads the real showroom map only on request, retains directions and withholds maps for sample addresses', () => {
  const config = settings(), view = render(<Harness config={config} />);
  expect(screen.queryByTitle('Dealership location')).not.toBeInTheDocument();
  const directions = screen.getByRole('link', { name: 'Get directions' });
  expect(directions).toHaveAttribute('target', '_blank');
  fireEvent.click(screen.getByRole('button', { name: 'Show map' }));
  const frame = screen.getByTitle('Dealership location');
  expect(frame).toHaveAttribute('loading', 'lazy');
  expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer-when-downgrade');
  const source = new URL(frame.getAttribute('src')!);
  expect(source.protocol).toBe('https:'); expect(['www.google.com', 'maps.google.com']).toContain(source.hostname);
  expect(source.searchParams.get('q') || source.searchParams.get('query')).toContain('UB3 3EP');
  expect(directions).toBeInTheDocument();
  view.rerender(<Harness config={{ ...config, address: { street: 'Sample road', city: 'Example town', postcode: 'UB3 3EP' } }} />);
  expect(screen.queryByTitle('Dealership location')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Show map' })).not.toBeInTheDocument();
});


it('does not offer an empty delivery calculator when delivery pricing is disabled', () => {
  const config = settings(); config.deliveryPricing = { enabled: false, basePrice: '40', pricePerMile: '1.20' };
  const view = render(<Harness config={config} />);
  let delivery = document.getElementById('delivery')! as HTMLDetailsElement;
  expect(within(delivery).queryByText('Estimate delivery')).not.toBeInTheDocument();
  expect(delivery.querySelector('details')).toBeNull();
  expect(delivery.open).toBe(false);
  view.rerender(<Harness config={{ ...config, deliveryPricing: { ...config.deliveryPricing, enabled: true } }} />);
  delivery = document.getElementById('delivery')! as HTMLDetailsElement;
  expect(within(delivery).getByRole('button', { name: 'Estimate delivery', hidden: true })).toBeInTheDocument();
  expect(delivery.open).toBe(false);
});

it('retains published trust points only as the fallback when no detailed reasons are supplied', () => {
  const config = settings(); config.whyBuy = []; config.trustItems = ['Independent dealership', 'Visit us in Hayes', 'Ask us about your next car', ' '];
  const view = render(<Harness config={config} />);
  let about = document.getElementById('about')!;
  const trustList = within(about).getByRole('list', { name: 'Dealership details' });
  for (const item of config.trustItems.filter(item => item.trim())) expect(within(trustList).getByText(item)).toBeInTheDocument();
  expect(trustList.querySelectorAll('li')).toHaveLength(3);
  view.rerender(<Harness config={{ ...config, whyBuy: [{ title: 'Our published approach', description: 'Speak with our team before choosing your next car.' }] }} />);
  about = document.getElementById('about')!;
  expect(within(about).getByRole('heading', { name: 'Our published approach' })).toBeInTheDocument();
  expect(within(about).queryByText('Independent dealership')).not.toBeInTheDocument();
});

it('preserves the published hero announcement as escaped text', () => {
  const config = settings(); config.hero = { ...config.hero, announcement: '<img src=x onerror=alert(1)> New arrivals & showroom visits' };
  render(<Harness config={config} />);
  expect(screen.getByText(config.hero.announcement!)).toBeInTheDocument();
  expect(document.querySelector('.mh-announcement img')).toBeNull();
  expect(screen.getByRole('heading', { level: 1, name: 'Used cars in Hayes' })).toBeInTheDocument();
});

it('updates only the known original forecourt artwork and keeps a later staff-selected hero photograph exactly', () => {
  const config = settings();
  config.presentation = { ...config.presentation, heroImageUrl: 'https://multichoicemotors.co.uk/api/website-assets/12f86896-51f9-4e38-be24-b8ab5d243c9c' };
  const view = render(<Harness config={config} />);
  expect(screen.getByRole('img', { name: 'Our Range Rover and Ford Mondeo' })).toHaveAttribute('src', '/brand/multi-choice-motors/hero-cars-1200.webp');
  const custom = 'https://multichoicemotors.co.uk/photos/our-new-forecourt.webp?version=2';
  view.rerender(<Harness config={{ ...config, presentation: { ...config.presentation, heroImageUrl: custom } }} />);
  expect(screen.getByRole('img', { name: 'Our Range Rover and Ford Mondeo' })).toHaveAttribute('src', custom);
});
