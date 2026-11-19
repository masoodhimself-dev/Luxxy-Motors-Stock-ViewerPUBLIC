import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Car } from '@/lib/stock-context';
import { SavedCarsProvider } from '@/lib/saved-cars-context';
import { MultiStockFilters } from '@/components/multi-stock-filters';
import { createStockFilters } from '@/features/stock-search/url';
import { GraphiteStockPage, type GraphiteStockPageProps } from './graphite-stock';
import { GraphiteCarCard } from './graphite-car-card';

function car(overrides: Partial<Car> = {}): Car {
  return {
    id: 'lexus-test', advertId: 'lexus-test', title: 'Lexus RX', make: 'Lexus', model: 'RX', variant: '450h Luxury CVT', trim: null,
    year: 2015, price: 9500, priceType: 'fixed', currency: 'GBP', mileage: 74120, mileageText: null, registration: 'SK15 NVJ', registrationBand: null,
    plate: null, vrm: null, vrmVerified: null, fuel: 'Petrol Hybrid', transmission: 'Automatic', bodyType: 'SUV', engineSize: '3.5L', engineCC: 3456,
    doors: 5, seats: 5, colour: 'Grey', emissionClass: null, drivetrain: null, owners: null, writeOffCategory: null, advertUrl: null,
    dealerName: 'Test Motors', dealerLocation: 'Test Town', imageCount: 2, heroImage: 'https://images.example.com/lexus-front.jpg',
    images: ['https://images.example.com/lexus-front.jpg', 'https://images.example.com/lexus-rear.jpg'], specifications: null, sourceExtras: null,
    ...overrides,
  };
}

function renderGraphite(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><SavedCarsProvider persistent={false}><div className="graphite-site">{children}</div></SavedCarsProvider></QueryClientProvider>);
}

function pageProps(overrides: Partial<GraphiteStockPageProps> = {}): GraphiteStockPageProps {
  const vehicle = car();
  return {
    title: 'Browse stock', cars: [vehicle], filteredCars: [vehicle], displayedCars: [vehicle], loading: false, hasError: false, showCatalogue: true,
    hasStock: true, savedCount: 0, view: 'cards', viewMode: 'default', showPromiseAd: false, photoControls: true, filters: createStockFilters(),
    filterControls: <div>Stock filters</div>, viewOptions: <button type="button">View options</button>, compareActionFor: () => undefined,
    onRetry: vi.fn(), onShowMore: vi.fn(), onClearFilters: vi.fn(), onChangeFilters: vi.fn(), ...overrides,
  };
}

beforeEach(() => { window.history.replaceState({}, '', '/stock'); window.localStorage.clear(); });
afterEach(cleanup);

describe('Graphite vehicle cards', () => {
  it('keeps exact vehicle facts, the full supplied derivative and the stock return route', () => {
    renderGraphite(<GraphiteCarCard car={car()} source="stock" />);
    expect(screen.getByRole('heading', { level: 3, name: 'Lexus RX' })).toBeVisible();
    expect(screen.getByText('450h Luxury CVT')).toBeVisible();
    expect(screen.getByText('£9,500')).toBeVisible();
    expect(screen.getAllByRole('definition')).toHaveLength(6);
    expect(screen.getAllByRole('definition').map(fact => fact.textContent)).toEqual(['2015', '74,120 miles', 'Petrol Hybrid', 'Automatic', '3.5L', 'SUV']);
    expect(screen.getByTestId('uk-number-plate')).toHaveTextContent('SK15 NVJ');
    expect(screen.getByLabelText('Mileage: 74,120 miles')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Gearbox: Automatic' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Body: SUV' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'View car' }).getAttribute('href')).toMatch(/\?from=stock$/);
  });

  it('browses supplied photographs and keeps Save and Compare available', () => {
    const onToggle = vi.fn();
    renderGraphite(<GraphiteCarCard car={car()} compareAction={{ selected: false, disabled: false, onToggle }} />);
    const photo = screen.getByAltText('Lexus RX');
    const firstSource = photo.getAttribute('src');
    fireEvent.click(screen.getByRole('button', { name: 'Next photo of Lexus RX' }));
    expect(screen.getByAltText('Lexus RX').getAttribute('src')).not.toBe(firstSource);
    expect(screen.getByText('2 / 2')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save Lexus RX to your saved cars' }));
    expect(screen.getByRole('button', { name: 'Remove Lexus RX from your saved cars' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Compare Lexus RX' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('shows missing photos honestly and does not invent a price or specifications', () => {
    renderGraphite(<GraphiteCarCard car={car({ heroImage: null, images: [], imageCount: 0, price: null, year: null, mileage: null, engineSize: null, transmission: null, fuel: null, bodyType: null })} />);
    expect(screen.getByText('Photographs to follow')).toBeVisible();
    expect(screen.getByText('Price on request')).toBeVisible();
    expect(screen.queryByLabelText('Vehicle specifications')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Next photo/ })).not.toBeInTheDocument();
  });

  it('retains reservation and insurance disclosure and honours the comparison limit', () => {
    renderGraphite(<GraphiteCarCard car={car({ inventoryStatus: 'reserved', writeOffCategory: 'CAT S' })} compareAction={{ selected: false, disabled: true, onToggle: vi.fn() }} />);
    expect(screen.getByText('Reserved')).toBeVisible();
    expect(screen.getByRole('button', { name: /Category S/i })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Compare Lexus RX' })).toBeDisabled();
  });

  it('keeps factual help available from the compact specifications without opening the car', () => {
    renderGraphite(<GraphiteCarCard car={car()} source="stock" />);
    fireEvent.click(screen.getByRole('button', { name: 'Gearbox: Automatic' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('An automatic gearbox changes gears for you.');
    expect(window.location.pathname).toBe('/stock');
    expect(screen.getByRole('link', { name: 'View car' }).getAttribute('href')).toMatch(/\?from=stock$/);
  });

  it.each([0, -1, Infinity, NaN, null])('uses enquiry-only pricing for an unusable price: %s', price => {
    renderGraphite(<GraphiteCarCard car={car({ price, priceType: 'VAT exclusive' })} />);
    expect(screen.getByText('Price on request')).toBeVisible();
    expect(screen.queryByText(/Excludes VAT|Confirm the full price with us|£/)).not.toBeInTheDocument();
  });

  it.each(['+ VAT', 'VAT exclusive', 'Excluding VAT', 'ex VAT'])('keeps a VAT-exclusive price clearly qualified: %s', priceType => {
    renderGraphite(<GraphiteCarCard car={car({ priceType })} />);
    expect(screen.getByText('£9,500')).toBeVisible();
    expect(screen.getByText('Excludes VAT')).toBeVisible();
  });

  it('retains an unknown supplier qualification without inventing a full price', () => {
    renderGraphite(<GraphiteCarCard car={car({ priceType: 'supplier-special' })} />);
    expect(screen.getByText('Confirm the full price with us')).toBeVisible();
  });

  it('counts only distinct usable photos, disregarding a stale supplier image count', () => {
    renderGraphite(<GraphiteCarCard car={car({ images: ['https://images.example.com/lexus-front.jpg'], imageCount: 99 })} />);
    expect(screen.getByLabelText('1 photo')).toBeVisible();
    expect(screen.queryByText('99')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next photo of Lexus RX' })).not.toBeInTheDocument();
  });

  it('keeps photo browsing available from the keyboard without navigating away from stock', () => {
    renderGraphite(<GraphiteCarCard car={car()} source="stock" />);
    const photoLink = screen.getByRole('link', { name: 'View full details for Lexus RX' });
    photoLink.focus();
    fireEvent.keyDown(photoLink, { key: 'ArrowRight' });
    expect(screen.getByText('2 / 2')).toBeVisible();
    expect(photoLink).toHaveFocus();
    fireEvent.keyDown(photoLink, { key: 'ArrowLeft' });
    expect(screen.getByText('1 / 2')).toBeVisible();
    expect(window.location.pathname).toBe('/stock');
  });

  it('swipes a photo without opening the car and leaves vertical scrolling to the browser', () => {
    renderGraphite(<GraphiteCarCard car={car()} source="stock" />);
    const photoLink = screen.getByRole('link', { name: 'View full details for Lexus RX' });
    const pointer = (type: string, clientX: number, clientY: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, {
        pointerType: { value: 'touch' }, isPrimary: { value: true }, pointerId: { value: 1 },
        clientX: { value: clientX }, clientY: { value: clientY },
      });
      fireEvent(photoLink, event);
    };
    pointer('pointerdown', 250, 100);
    pointer('pointermove', 145, 103);
    pointer('pointerup', 145, 103);
    expect(screen.getByText('2 / 2')).toBeVisible();
    expect(fireEvent.click(photoLink, { detail: 1 })).toBe(false);
    expect(window.location.pathname).toBe('/stock');
    pointer('pointerdown', 145, 103);
    pointer('pointermove', 140, 220);
    pointer('pointerup', 140, 220);
    expect(screen.getByText('2 / 2')).toBeVisible();
  });

  it('retries the supplied original before skipping a failed photo and lets the customer retry all photos', () => {
    const front = 'https://m.atcdn.co.uk/a/media/w800/front.jpg';
    const rear = 'https://m.atcdn.co.uk/a/media/w800/rear.jpg';
    renderGraphite(<GraphiteCarCard car={car({ heroImage: front, images: [front, rear] })} source="stock" />);
    const photo = screen.getByAltText('Lexus RX');
    expect(photo).toHaveAttribute('srcset');
    fireEvent.error(photo);
    expect(photo).toHaveAttribute('src', front);
    expect(photo).not.toHaveAttribute('srcset');
    expect(screen.getByText('1 / 2')).toBeVisible();
    fireEvent.error(photo);
    const remainingPhoto = screen.getByAltText('Lexus RX');
    expect(remainingPhoto).toHaveAttribute('src', rear);
    expect(screen.getByLabelText('1 photo')).toBeVisible();
    fireEvent.error(remainingPhoto);
    fireEvent.error(remainingPhoto);
    expect(screen.getByText('Photographs to follow')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry photos' }));
    expect(screen.getByAltText('Lexus RX')).toHaveAttribute('src', front);
    expect(screen.getByText('1 / 2')).toBeVisible();
  });

  it('allows a quiet homepage photo while retaining the real car and save actions', () => {
    renderGraphite(<GraphiteCarCard car={car()} source="showroom" photoControls={false} />);
    expect(screen.getByAltText('Lexus RX')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Next photo|Previous photo/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/1 \/ 2/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View car' }).getAttribute('href')).not.toContain('?from=stock');
    fireEvent.click(screen.getByRole('button', { name: 'Save Lexus RX to your saved cars' }));
    expect(screen.getByRole('button', { name: 'Remove Lexus RX from your saved cars' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps supplied equipment and ULEZ evidence available without inventing records', () => {
    renderGraphite(<GraphiteCarCard car={car({ fuel: 'Petrol', emissionClass: 'Euro 6', sourceExtras: { features: ['Heated seats'] } })} />);
    const disclosure = screen.getByText('Checks & details').closest('details')!;
    expect(disclosure).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Checks & details'));
    expect(disclosure).toHaveAttribute('open');
    expect(within(disclosure).getByText('Heated seats')).toBeVisible();
    fireEvent.click(within(disclosure).getByRole('button', { name: 'ULEZ compliant' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Check the vehicle’s ULEZ status before travelling in the zone.');
    expect(screen.queryByText(/MOT passed|inspection completed/i)).not.toBeInTheDocument();
  });
});

describe('Graphite stock composition', () => {
  it('places the existing promise advert in slot eight and excludes it from the count', () => {
    const cars = Array.from({ length: 9 }, (_, index) => car({ id: `showroom-${index}` }));
    renderGraphite(<GraphiteStockPage {...pageProps({ cars, filteredCars: cars, displayedCars: cars, showPromiseAd: true })} />);
    const results = screen.getByLabelText('Vehicle results');
    const articles = within(results).getAllByRole('article');
    expect(articles).toHaveLength(10);
    expect(articles[7]).toHaveAttribute('aria-label', 'What comes with every car from Multi Choice Motors');
    expect(articles[8]).toHaveAttribute('data-testid', 'card-vehicle-showroom-7');
    expect(screen.getByText('Showing 9 of 9 cars')).toBeVisible();
  });

  it('keeps already-loaded stock usable after refresh failure and allows a retry', () => {
    const onRetry = vi.fn();
    renderGraphite(<GraphiteStockPage {...pageProps({ hasError: true, onRetry })} />);
    expect(screen.getByRole('status')).toHaveTextContent('You’re viewing the last loaded stock.');
    expect(screen.getByTestId('card-vehicle-lexus-test')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh stock' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('retains the recovery action when stock is unavailable', () => {
    const onRetry = vi.fn();
    renderGraphite(<GraphiteStockPage {...pageProps({ hasError: true, showCatalogue: false, hasStock: false, cars: [], filteredCars: [], displayedCars: [], onRetry })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Stock is temporarily unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/contact');
  });

  it('keeps no-match recovery and the disabled-enquiry contact route available', () => {
    const onClearFilters = vi.fn();
    const first = renderGraphite(<GraphiteStockPage {...pageProps({ filteredCars: [], displayedCars: [], hasStock: false, onClearFilters })} />);
    expect(screen.getByRole('heading', { name: 'No matches' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledOnce();
    first.unmount();
    renderGraphite(<GraphiteStockPage {...pageProps({ cars: [], filteredCars: [], displayedCars: [], hasStock: false, publicEnquiriesEnabled: false })} />);
    expect(screen.getByRole('link', { name: 'Ask about upcoming stock' })).toHaveAttribute('href', '/contact');
  });
});


describe('Graphite inline catalogue controls', () => {
  it('keeps the shared search and sort callbacks usable while filters expand in the page', () => {
    const vehicle = car();
    const filters = createStockFilters();
    const onChange = vi.fn();
    const { container } = renderGraphite(<GraphiteStockPage {...pageProps({
      filters,
      filterControls: <MultiStockFilters cars={[vehicle]} filters={filters} onChange={onChange} onClear={vi.fn()} matchCount={1} />,
    })} />);
    const toggle = screen.getByRole('button', { name: 'Show filters', expanded: false });
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toContainElement(screen.getByRole('searchbox', { name: 'Search cars' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search cars' }), { target: { value: 'Lexus' } });
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search cars' }), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({ search: 'Lexus' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort cars' }), { target: { value: 'price-desc' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sort: 'price-desc' }));
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.gr-stock-tools')).toHaveAttribute('data-filters-expanded', 'true');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('honours a chosen compact view and preserves pagination, saved count and additional content', () => {
    const onShowMore = vi.fn();
    const vehicles = [car(), car({ id: 'another-car' })];
    const { container } = renderGraphite(<GraphiteStockPage {...pageProps({
      cars: vehicles, filteredCars: vehicles, displayedCars: vehicles.slice(0, 1), savedCount: 2,
      view: 'compact', viewMode: 'override', onShowMore,
    })}><p>Stock page additional information</p></GraphiteStockPage>);
    expect(container.querySelector('.gr-stock-page')).toHaveAttribute('data-stock-mode', 'override');
    expect(screen.getByTestId('compact-vehicle-lexus-test')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Saved cars (2)' })).toHaveAttribute('href', '/saved');
    expect(screen.getByText('Showing 1 of 2 cars')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show more cars' }));
    expect(onShowMore).toHaveBeenCalledOnce();
    expect(screen.getByText('Stock page additional information')).toBeVisible();
  });

  it('renders a loading state without stale vehicle actions or controls', () => {
    renderGraphite(<GraphiteStockPage {...pageProps({ loading: true })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading used cars');
    expect(screen.queryByRole('button', { name: 'Show filters' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View car' })).not.toBeInTheDocument();
  });
});
