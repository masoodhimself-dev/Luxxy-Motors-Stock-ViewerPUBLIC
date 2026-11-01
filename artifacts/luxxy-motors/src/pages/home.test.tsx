import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Home from '@/pages/home';
import { SavedCarsProvider } from '@/lib/saved-cars-context';
import type { Car } from '@/lib/stock-context';
import { Link, Route, Switch } from 'wouter';
import { browseReturnHref, readBrowseSession, requestBrowseRestore } from '@/lib/browse-session';
import { RouteScrollReset } from '@/components/route-scroll-reset';

const { stockFixture, dealerConfigFixture, recentHandoversState, scrollToHomeTarget, focusHomeTarget } = vi.hoisted(() => {
  const baseCar: Car = {
    id: '',
    advertId: '',
    title: '',
    variant: null,
    make: '',
    model: '',
    trim: null,
    year: 2022,
    price: null,
    priceType: 'fixed',
    currency: 'GBP',
    mileage: null,
    mileageText: null,
    registration: null,
    registrationBand: null,
    plate: null,
    vrm: null,
    vrmVerified: null,
    fuel: null,
    transmission: null,
    bodyType: 'Hatchback',
    engineSize: null,
    engineCC: null,
    doors: 5,
    seats: 5,
    colour: null,
    emissionClass: null,
    drivetrain: null,
    owners: null,
    writeOffCategory: null,
    advertUrl: null,
    dealerName: 'Test Motors',
    dealerLocation: 'Test Town',
    imageCount: 0,
    heroImage: null,
    images: [],
    specifications: null,
    sourceExtras: null,
  };

  const car = (overrides: Partial<Car>) => ({ ...baseCar, ...overrides });
  const cars = [
    car({
      id: 'bmw-1-series',
      advertId: 'bmw-1-series',
      title: 'BMW 1 Series',
      make: 'BMW',
      model: '1 Series',
      price: 5000,
      mileage: 30000,
      fuel: 'Petrol',
      transmission: 'Automatic',
      registration: 'AB12 BMW',
      heroImage: 'https://cdn.example.com/bmw-1.jpg',
    }),
    car({
      id: 'bmw-3-series',
      advertId: 'bmw-3-series',
      title: 'BMW 3 Series',
      make: 'BMW',
      model: '3 Series',
      price: 10000,
      mileage: 10000,
      fuel: 'Diesel',
      transmission: 'Manual',
      writeOffCategory: 'CAT S',
      heroImage: 'https://cdn.example.com/bmw-3.jpg',
    }),
    car({
      id: 'ford-fiesta',
      advertId: 'ford-fiesta',
      title: 'Ford Fiesta',
      make: 'Ford',
      model: 'Fiesta',
      price: 7500,
      mileage: 50000,
      fuel: 'Petrol',
      transmission: 'Manual',
      writeOffCategory: 'CAT N',
    }),
    car({
      id: 'audi-a3',
      advertId: 'audi-a3',
      title: 'Audi A3',
      make: 'Audi',
      model: 'A3',
      price: 5000,
      mileage: 20000,
      fuel: 'Hybrid',
      transmission: 'Automatic',
    }),
    car({
      id: 'vw-golf',
      advertId: 'vw-golf',
      title: 'VW Golf',
      make: 'Volkswagen',
      model: 'Golf',
      price: 4999,
      mileage: 40000,
      fuel: 'Petrol',
      transmission: 'Automatic',
    }),
  ];

  const dealerConfigBase = {
    identity: { name: 'Test Motors', brandColors: { primaryHsl: '0 0 0', accentHsl: '0 0 0' } },
    contact: { phone: '01234567890' },
    address: { city: 'Test City', region: 'Test Region' },
    hero: { copy: 'Find your next car', subcopy: 'Subcopy', announcement: 'Test Announcement', primaryCta: 'See stock', secondaryCta: 'Part exchange' },
    bookViewing: { title: 'Book a Test Drive', ctaLabel: 'Book now', description: 'Book a Test Drive' },
    trustItems: ['Trust point 1'],
    whyBuy: [{ title: 'How we work', description: 'A clear buying process.' }],
    featuredVehicleIds: [] as string[],
    recentHandovers: { enabled: true, count: 3 },
    delivery: { enabled: true, title: 'Delivery', description: 'Delivery available', ctaLabel: 'Delivery enquiry' },
    warranty: { enabled: true, title: 'Warranty', description: 'Warranty available', ctaLabel: 'Warranty enquiry' },
    partExchange: { enabled: true, title: 'Part exchange', description: 'Part exchange available', ctaLabel: 'Part exchange enquiry' },
  };

  return {
    stockFixture: {
      schemaVersion: 1,
      dealerName: 'Test Motors',
      dealerLocation: 'Test Town',
      count: cars.length,
      scrapedAt: null,
      cars,
    },
    dealerConfigFixture: dealerConfigBase,
    recentHandoversState: {
      value: {
        schemaVersion: 1,
        handovers: [] as Array<{
          vehicle: { make: string | null; model: string | null; trim: string | null; year: number | null; bodyType: string | null; fuel: string | null; transmission: string | null };
          handoverMonth: string;
        }>,
        isLoading: false,
        isError: false,
      },
    },
    scrollToHomeTarget: vi.fn(() => true),
    focusHomeTarget: vi.fn(),
  };
});

let stockIsLoading = false;
let demoSiteMode = false;
vi.mock('@/lib/demo-status',()=>({useDemoStatus:()=>demoSiteMode}));
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({ enabled: () => true }) }));

let overrideSettings: typeof dealerConfigFixture & {
  presentation?: { websiteTemplate?: 'existing' | 'classic' | 'premium' | 'focused'; showHeroDescription?: boolean; websiteCopy?: { stockIntroduction?: string; featuredHeading?: string }; heroImageUrl?: string; heroImageAlt?: string; heroImagePosition?: 'center' | 'left' | 'right' | 'top' | 'bottom'; showroomImageUrl?: string; showroomImageAlt?: string };
} = dealerConfigFixture;

vi.mock('@/lib/dealer-settings-context', () => ({
  useDealerSettings: () => ({ settings: overrideSettings, isLoading: false, isError: false }),
}));

vi.mock('@/lib/stock-context', () => ({
  useStock: () => ({ stock: stockFixture, isLoading: stockIsLoading, error: null }),
}));

vi.mock('@/lib/home-navigation', () => ({
  flushPendingHomeTarget: vi.fn(),
  hasPendingHomeTarget: () => false,
  scrollToHomeTarget,
  focusHomeTarget,
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetRecentHandovers: () => ({ data: recentHandoversState.value, isLoading: recentHandoversState.value.isLoading, isError: recentHandoversState.value.isError }),
  getGetRecentHandoversQueryKey: () => ['/api/recent-handovers'],
}));

function renderHome(browseStock = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SavedCarsProvider>
        <Home browseStock={browseStock} />
      </SavedCarsProvider>
    </QueryClientProvider>,
  );
}

function resultsRegion() {
  const region = document.getElementById('vehicle-results');
  if (!region) throw new Error('Vehicle results section was not rendered');
  return within(region);
}

function resultTitles() {
  return resultsRegion()
    .getAllByRole('heading', { level: 3, hidden: true })
    .map((heading) => heading.textContent);
}

const originalCars = stockFixture.cars.map((car) => ({ ...car }));

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll('[data-stock-photo-test]').forEach(element => element.remove());
});

beforeEach(() => {
  stockIsLoading=false;
  demoSiteMode=false;
  // Most filter journeys exercise the compact mobile drawer. Desktop keeps the
  // same controls directly in the sidebar and is covered explicitly below.
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  window.history.replaceState({}, '', '/');
  window.sessionStorage.clear();
  vi.clearAllMocks();
  window.localStorage.clear();
  overrideSettings = dealerConfigFixture;
  recentHandoversState.value = { schemaVersion: 1, handovers: [], isLoading: false, isError: false };
  stockFixture.cars = originalCars.map((car) => ({ ...car }));
});

describe('showroom data resilience', () => {
  it('matches automatic shortcut results to its count when supplied labels vary', () => {
    stockFixture.cars = [
      { ...originalCars[0], transmission: 'automatic' },
      { ...originalCars[1], transmission: 'Automatic (DCT)' },
      { ...originalCars[2], transmission: 'Manual' },
    ];
    renderHome(false);
    expect(screen.getByRole('link', { name: 'Automatic · 2 cars' })).toHaveAttribute('href', '/stock?transmission=Automatic');
    cleanup();
    window.history.replaceState({}, '', '/stock?transmission=Automatic');
    renderHome();
    expect(resultTitles()).toEqual(['BMW 1 Series', 'BMW 3 Series']);
    expect(screen.getByTestId('text-filtered-stock-count')).toHaveTextContent('2 cars match your search');
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    expect(screen.getByRole('combobox', { name: 'Transmission' })).toHaveValue('Automatic');
  });

  it('keeps browsing and view controls usable when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'QuotaExceededError'); });
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    expect(screen.getByTestId('card-vehicle-bmw-1-series')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-stock-view-compact'));
    expect(screen.getByTestId('compact-vehicle-bmw-1-series')).toBeInTheDocument();
  });

  it.each(['price-asc', 'price-desc', 'mileage-asc', 'mileage-desc'])('puts missing values last for %s', (sort) => {
    stockFixture.cars = [
      { ...originalCars[0], price: null, mileage: null },
      { ...originalCars[1], price: 10000, mileage: 20000 },
      { ...originalCars[2], price: 5000, mileage: 0 },
    ];
    renderHome();
    fireEvent.change(screen.getByLabelText('Sort results'), { target: { value: sort } });
    expect(resultTitles()).toEqual(sort.endsWith('asc')
      ? ['Ford Fiesta', 'BMW 3 Series', 'BMW 1 Series']
      : ['BMW 3 Series', 'Ford Fiesta', 'BMW 1 Series']);
  });

  it('normalises pasted search whitespace and finds compact plates and VRMs', () => {
    stockFixture.cars[0] = { ...originalCars[0], registration: null, plate: null, vrm: 'AB12 BMW' };
    renderHome();
    fireEvent.change(screen.getByTestId('input-showroom-search'), { target: { value: '  ab12bmw  ' } });
    expect(resultTitles()).toEqual(['BMW 1 Series']);
    fireEvent.change(screen.getByTestId('input-showroom-search'), { target: { value: '  fiesta  ' } });
    expect(resultTitles()).toEqual(['Ford Fiesta']);
  });

  it('does not offer insurance-history search filters', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    expect(screen.queryByText('Insurance history')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'No recorded write-off' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Category S' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Category N' })).not.toBeInTheDocument();
  });
});

describe('showroom search filters', () => {
  it('keeps quick preferences inside the mobile filters until Show cars is chosen', async () => {
    renderHome();
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show automatic cars' }));
    expect(resultTitles()).toEqual(['BMW 1 Series', 'Audi A3', 'VW Golf']);
    expect(dialog).toBeInTheDocument();
    expect(scrollToHomeTarget).not.toHaveBeenCalled();
    expect(focusHomeTarget).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show cars under £10k' }));
    expect(dialog).toBeInTheDocument();
    expect(scrollToHomeTarget).not.toHaveBeenCalled();
    expect(focusHomeTarget).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Show \d+ cars?$/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(scrollToHomeTarget).toHaveBeenCalledWith('vehicle-results');
      expect(focusHomeTarget).toHaveBeenCalledWith('vehicle-results');
    });
  });

  it('exposes make and model directly in the desktop sidebar without a modal', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    renderHome();
    const sidebar = screen.getByRole('complementary', { name: 'Filter cars' });
    const make = within(sidebar).getByRole('combobox', { name: 'Make' });
    const model = within(sidebar).getByRole('combobox', { name: 'Model' });
    expect(make).toBeVisible();
    expect(model).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Advanced search' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.change(make, { target: { value: 'BMW' } });
    fireEvent.change(model, { target: { value: '3 Series' } });
    expect(resultTitles()).toEqual(['BMW 3 Series']);
    expect(window.location.search).toBe('?make=BMW&model=3+Series');
    expect(scrollToHomeTarget).not.toHaveBeenCalled();
  });

  it('uses saved featured order for homepage and recommended stock while keeping reserved cars last', () => {
    overrideSettings = { ...dealerConfigFixture, featuredVehicleIds: ['bmw-1-series', 'audi-a3', 'bmw-3-series', 'removed-id'] };
    stockFixture.cars[0] = { ...originalCars[0], inventoryStatus: 'reserved' };
    renderHome(false);
    expect(screen.getAllByTestId(/^card-vehicle-/).map(card => card.getAttribute('data-testid'))).toEqual([
      'card-vehicle-audi-a3', 'card-vehicle-bmw-3-series', 'card-vehicle-bmw-1-series',
    ]);
    cleanup();
    renderHome();
    expect(resultTitles()).toEqual(['Audi A3', 'BMW 3 Series', 'Ford Fiesta', 'VW Golf', 'BMW 1 Series']);
    fireEvent.change(screen.getByLabelText('Sort results'), { target: { value: 'price-asc' } });
    expect(resultTitles()).toEqual(['VW Golf', 'Audi A3', 'BMW 1 Series', 'Ford Fiesta', 'BMW 3 Series']);
  });

  it('defaults the homepage to expensive photographed stock without changing the stock-page order', () => {
    stockFixture.cars = originalCars.map((car, index) => ({ ...car, heroImage: `https://cdn.example.com/car-${index}.jpg` }));
    renderHome(false);
    expect(screen.getAllByTestId(/^card-vehicle-/).map(card => card.getAttribute('data-testid'))).toEqual([
      'card-vehicle-bmw-3-series', 'card-vehicle-vw-golf', 'card-vehicle-ford-fiesta', 'card-vehicle-bmw-1-series', 'card-vehicle-audi-a3',
    ]);
    cleanup();
    renderHome();
    expect(resultTitles()).toEqual(['BMW 1 Series', 'BMW 3 Series', 'Ford Fiesta', 'Audi A3', 'VW Golf']);
  });

  it('keeps full-stock browsing available when no automatic feature has a photo', () => {
    stockFixture.cars = originalCars.map(car => ({ ...car, heroImage: null, images: [] }));
    renderHome(false);
    expect(screen.queryAllByTestId(/^card-vehicle-/)).toHaveLength(0);
    expect(screen.getByRole('link', { name: /^Browse \d+ cars?$/ })).toHaveAttribute('href', '/stock?all=1');
    expect(screen.queryByText('We have no cars online at the moment. Ask us about our stock.')).not.toBeInTheDocument();
    cleanup();
    renderHome();
    expect(resultTitles()).toHaveLength(originalCars.length);
  });

  it('uses the dealership service titles without showing disabled services', () => {
    overrideSettings = {
      ...dealerConfigFixture,
      warranty: { ...dealerConfigFixture.warranty, title: 'Our warranty cover' },
      delivery: { ...dealerConfigFixture.delivery, title: 'Delivery to your door' },
      partExchange: { ...dealerConfigFixture.partExchange, enabled: false, title: 'Value your current car' },
    };
    renderHome(false);
    expect(screen.getByRole('heading', { name: 'Our warranty cover' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delivery to your door' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Value your current car' })).not.toBeInTheDocument();
  });

  it('uses Luxxy brand artwork behind search without attaching a vehicle price', () => {
    overrideSettings = { ...dealerConfigFixture, identity: { ...dealerConfigFixture.identity, name: 'Luxxy Motors' } };
    renderHome(false);
    const hero = screen.getByTestId('showroom-hero-photo');
    expect(hero.textContent).toBe('');
    expect(hero).not.toHaveTextContent('£');
    expect(within(hero).getByRole('img')).toHaveAttribute('alt', expect.stringContaining('Illustrative Luxxy brand image'));
    const introduction = screen.getByRole('region', { name: 'Plan your visit' });
    expect(within(introduction).queryByRole('img')).not.toBeInTheDocument();
    expect(introduction).toHaveTextContent('Test City');
  });

  it('keeps other dealerships on their own photographed stock', () => {
    renderHome(false);
    const hero = screen.getByTestId('showroom-hero-photo');
    expect(hero).not.toHaveTextContent('BMW 1 Series');
    expect(hero).not.toHaveTextContent('£');
    expect(within(hero).getByRole('img')).toHaveAttribute('src', 'https://cdn.example.com/bmw-1.jpg');
    expect(within(screen.getByRole('region', { name: 'Plan your visit' })).queryByRole('img')).not.toBeInTheDocument();
  });

  it('keeps the bundled Luxxy artwork independent of featured stock', () => {
    overrideSettings = { ...dealerConfigFixture, identity: { ...dealerConfigFixture.identity, name: 'Luxxy Motors' }, featuredVehicleIds: ['bmw-3-series'] };
    renderHome(false);
    const hero = screen.getByTestId('showroom-hero-photo');
    expect(within(hero).getByRole('img')).toHaveAttribute('src', expect.stringContaining('luxxy-hero.jpg'));
    expect(hero).not.toHaveTextContent('BMW');
    expect(hero).not.toHaveTextContent('£');
  });

  it('respects a configured homepage image ahead of brand artwork and featured stock', () => {
    overrideSettings = {
      ...dealerConfigFixture,
      identity: { ...dealerConfigFixture.identity, name: 'Luxxy Motors' },
      featuredVehicleIds: ['bmw-3-series'],
      presentation: { heroImageUrl: 'https://example.com/showroom.jpg', heroImageAlt: 'Our dealership exterior' },
    };
    renderHome(false);
    const hero = screen.getByTestId('showroom-hero-photo');
    expect(within(hero).getByRole('img')).toHaveAttribute('src', 'https://example.com/showroom.jpg');
    expect(within(hero).getByRole('img')).toHaveAttribute('alt', 'Our dealership exterior');
    expect(hero).not.toHaveTextContent('£');
  });

  it('keeps the dealer points and booking link while replacing the introduction photo with visit information', () => {
    overrideSettings = {
      ...dealerConfigFixture,
      presentation: {
        heroImageUrl: 'https://example.com/hero.jpg',
        showroomImageUrl: 'https://example.com/team.jpg',
        showroomImageAlt: 'Our team outside the dealership',
      },
    };
    renderHome(false);
    const introduction = screen.getByRole('region', { name: 'Plan your visit' });
    expect(within(introduction).queryByRole('img')).not.toBeInTheDocument();
    expect(introduction).toHaveTextContent('Test City');
    expect(screen.getByRole('heading', { name: 'How we work' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Why choose us?' })).toBeInTheDocument();
    expect(within(introduction).getByRole('link', { name: dealerConfigFixture.bookViewing.ctaLabel })).toHaveAttribute('href', '/enquire?type=viewing');
  });

  it('keeps the homepage carousel separate from stock filters', () => {
    renderHome(false);
    expect(screen.getByRole('heading', { name: /Find your next car/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Explore our cars' })).toBeInTheDocument();
    expect(screen.queryByTestId('input-showroom-search')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Browse \d+ cars?$/ })).toHaveAttribute('href', '/stock?all=1');
    expect(screen.queryByRole('button', { name: 'Auto-scroll cars' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next featured cars' })).toBeInTheDocument();
    expect(screen.getAllByTestId(/^card-vehicle-/)).toHaveLength(2);
  });

  it('switches between full cards and the compact stock list', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));

    expect(screen.getByTestId('card-vehicle-bmw-1-series')).toBeInTheDocument();
    expect(screen.getByTestId('button-stock-view-cards')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('button-stock-view-compact'));

    expect(screen.getByTestId('compact-vehicle-bmw-1-series')).toBeInTheDocument();
    expect(screen.getByTestId('button-stock-view-compact')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('card-vehicle-bmw-1-series')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('luxxy.stock-view.v1')).toBe('compact');
    expect(screen.queryByTestId('button-compare-bmw-1-series')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /view/i }).length).toBeGreaterThan(0);
    expect(screen.getByTestId('compact-actions-bmw-1-series')).toHaveTextContent('View car');
  });

  it('restores the saved stock display preference', () => {
    window.localStorage.setItem('luxxy.stock-view.v1', 'compact');
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));

    expect(screen.getByTestId('button-stock-view-compact')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('compact-vehicle-bmw-1-series')).toBeInTheDocument();
  });

  it('filters by text and limits model choices to the selected make', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));

    const make = screen.getByLabelText('Make') as HTMLSelectElement;
    const model = screen.getByLabelText('Model') as HTMLSelectElement;
    expect(model).toBeDisabled();

    fireEvent.change(make, { target: { value: 'BMW' } });

    expect(model).not.toBeDisabled();
    expect(within(model).getByRole('option', { name: '1 Series' })).toBeInTheDocument();
    expect(within(model).getByRole('option', { name: '3 Series' })).toBeInTheDocument();
    expect(within(model).queryByRole('option', { name: 'Fiesta' })).not.toBeInTheDocument();

    fireEvent.change(model, { target: { value: '1 Series' } });
    expect(resultTitles()).toEqual(['BMW 1 Series']);

    fireEvent.change(screen.getByTestId('input-showroom-search'), {
      target: { value: 'AB12 BMW' },
    });
    expect(resultTitles()).toEqual(['BMW 1 Series']);
  });

  it('includes exact min and max budget boundaries and filters fuel and transmission', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));

    fireEvent.change(screen.getByLabelText('Min budget'), {
      target: { value: '5000' },
    });
    fireEvent.keyDown(screen.getByTestId('input-showroom-search'), { key: 'Enter' });
    expect(resultTitles()).toEqual(['BMW 1 Series', 'BMW 3 Series', 'Ford Fiesta', 'Audi A3']);

    fireEvent.change(screen.getByLabelText('Min budget'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Max budget'), {
      target: { value: '5000' },
    });
    expect(resultTitles()).toEqual(['BMW 1 Series', 'Audi A3', 'VW Golf']);

    fireEvent.change(screen.getByLabelText('Max budget'), { target: { value: '' } });
    fireEvent.click(screen.getByText('More filters', { selector: 'summary' }));
    fireEvent.change(screen.getByLabelText('Fuel'), { target: { value: 'Diesel' } });
    expect(resultTitles()).toEqual(['BMW 3 Series']);

    fireEvent.change(screen.getByLabelText('Fuel'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Transmission'), {
      target: { value: 'Manual' },
    });
    expect(resultTitles()).toEqual(['BMW 3 Series', 'Ford Fiesta']);
  });

  it('ignores retired insurance-history search parameters', () => {
    window.history.replaceState({}, '', '/stock?catS=true&catN=true&noWriteOff=true');
    renderHome();
    expect(resultTitles()).toHaveLength(5);
    expect(window.location.search).not.toMatch(/catS|catN|noWriteOff/);
  });

  it('sorts the live results and resets every shared filter value', () => {
    renderHome();

    fireEvent.change(screen.getByLabelText('Sort results'), {
      target: { value: 'price-asc' },
    });
    fireEvent.keyDown(screen.getByTestId('input-showroom-search'), { key: 'Enter' });
    expect(resultTitles()).toEqual([
      'VW Golf',
      'BMW 1 Series',
      'Audi A3',
      'Ford Fiesta',
      'BMW 3 Series',
    ]);

    fireEvent.change(screen.getByTestId('input-showroom-search'), {
      target: { value: 'BMW' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Reset all/i }));

    expect(resultTitles()).toHaveLength(5);
    expect(screen.getByText('5 cars in stock')).toBeInTheDocument();
    expect((screen.getByTestId('input-showroom-search') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    expect((screen.getByLabelText('Make') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Sort results') as HTMLSelectElement).value).toBe('');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('invokes the existing results-scroll callback when viewing matching cars', async () => {
    renderHome();

    fireEvent.keyDown(screen.getByTestId('input-showroom-search'), { key: 'Enter' });

    await waitFor(() => {
      expect(scrollToHomeTarget).toHaveBeenCalledWith('vehicle-results');
      expect(focusHomeTarget).toHaveBeenCalledWith('vehicle-results');
    });
  });

  it('shows the full stock without a second reveal action', () => {
    renderHome();
    expect(resultTitles()).toHaveLength(5);
    expect(screen.queryByTestId('button-view-all-vehicles')).not.toBeInTheDocument();
  });

  it('reveals all results and scrolls when pressing Enter in the search box', async () => {
    renderHome();
    const searchInput = screen.getByTestId('input-showroom-search');
    fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });
    expect(resultTitles()).toHaveLength(5); // assuming it also reveals all
    await waitFor(() => {
      expect(scrollToHomeTarget).toHaveBeenCalledWith('vehicle-results');
    });
  });
});

it('loads cars in batches and excludes sold stock while keeping reserved cars last', () => {
  stockFixture.cars = Array.from({length: 15}, (_,i) => ({...originalCars[0], id: `batch-${i}`, title:`Batch car ${i}`, inventoryStatus:i === 0 ? 'reserved' : i === 1 ? 'sold' : 'available'}));
  stockFixture.count = 15;
  renderHome();
  expect(resultTitles()).toHaveLength(12);
  expect(screen.getByText('Showing 12 of 14 cars')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Show more cars'}));
  expect(resultTitles()).toHaveLength(14);
  expect(resultTitles().at(-1)).toBe('Batch car 0');
  expect(resultTitles()).not.toContain('Batch car 1');
});

it("uses an illustrative car hero for demos and avoids a repeated demo announcement",()=>{demoSiteMode=true;overrideSettings={...dealerConfigFixture,hero:{...dealerConfigFixture.hero,announcement:"Demonstration website — sample activity, no real payments."}};renderHome(false);expect(screen.getByAltText("Illustrative stock photograph of a white BMW coupe")).toBeInTheDocument();expect(screen.queryByText("Demonstration website — sample activity, no real payments.")).not.toBeInTheDocument();});

it('refines the selected make and sort when a quick budget filter is applied', () => {
  renderHome();
  fireEvent.change(screen.getByLabelText('Sort results'), { target: { value: 'price-desc' } });
  fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Make' }), { target: { value: 'BMW' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show cars under £10k' }));
  expect(resultTitles()).toEqual(['BMW 3 Series', 'BMW 1 Series']);
  expect(window.location.search).toBe('?make=BMW&maxPrice=10000&sort=price-desc');
  fireEvent.click(screen.getByRole('button', { name: 'Show cars under £10k' }));
  expect(window.location.search).toBe('?make=BMW&sort=price-desc');
});

it('honours an explicit price sort including reserved cars', () => {
  stockFixture.cars = [
    { ...originalCars[0], price: 1000, inventoryStatus: 'reserved' },
    { ...originalCars[1], price: 10000 },
    { ...originalCars[2], price: 7500 },
  ];
  renderHome();
  expect(resultTitles()).toEqual(['BMW 3 Series', 'Ford Fiesta', 'BMW 1 Series']);
  fireEvent.change(screen.getByLabelText('Sort results'), { target: { value: 'price-asc' } });
  expect(resultTitles()).toEqual(['BMW 1 Series', 'Ford Fiesta', 'BMW 3 Series']);
});

it('shows the dealership introduction before the stock request finishes', () => {
  stockIsLoading = true;
  renderHome(false);
  expect(screen.getByRole('heading', { name: 'Find your next car' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Loading cars…' })).toBeDisabled();
  expect(screen.getByText('Loading cars…', { selector: 'p' })).toHaveAttribute('role', 'status');
});

it('retains supplied equipment when mileage is the only omitted card highlight', () => {
  stockFixture.cars = [{ ...originalCars[0], mileage: 12885, fuel: null, emissionClass: null, sourceExtras: { features: ['Heated seats'] } }];
  renderHome();
  const card = screen.getByTestId('card-vehicle-bmw-1-series');
  expect(card).toHaveTextContent('12,885 miles');
  expect(card).toHaveTextContent('Heated seats');
  expect(card).not.toHaveTextContent('low mileage');
});


describe('compact customer stock presentation', () => {
  it('keeps the result count by the title and preserves a bespoke stock introduction', () => {
    renderHome();
    expect(document.querySelector('.stock-title-group')).toContainElement(screen.getByTestId('text-filtered-stock-count'));
    expect(screen.queryByText('Find your next used car.')).not.toBeInTheDocument();
    cleanup();
    overrideSettings = { ...dealerConfigFixture, presentation: { websiteCopy: { stockIntroduction: 'Browse our hand-picked stock.' } } } as typeof overrideSettings;
    renderHome();
    expect(screen.getByText('Browse our hand-picked stock.')).toBeInTheDocument();
  });

  it('combines transmission, budget and fuel without duplicated shortcut controls', async () => {
    renderHome();
    expect(screen.getByLabelText('Search the showroom')).toHaveAccessibleDescription('Search by make, model or registration.');
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    fireEvent.click(screen.getByText('More filters', { selector: 'summary' }));
    fireEvent.change(screen.getByLabelText('Transmission'), { target: { value: 'Automatic' } });
    fireEvent.change(screen.getByLabelText('Max budget'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('Fuel'), { target: { value: 'Petrol' } });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('button-quick-automatic')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-quick-under-5000')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Transmission')).toHaveValue('Automatic');
    expect(resultTitles()).toEqual(['BMW 1 Series', 'VW Golf']);
    expect(scrollToHomeTarget).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 cars' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.search).toBe('?maxPrice=5000&fuel=Petrol&transmission=Automatic');
    expect(screen.getByLabelText('Sort results')).toBeInTheDocument();
  });
});

it('keeps explicit advert category wording visible without treating it as structured history', () => {
  stockFixture.cars = [{...originalCars[0], writeOffCategory: null, sourceExtras: {description: 'This car was recorded as Cat S. Ask us for repair records.'}}];
  renderHome();
  expect(screen.getByText('Advert states Category S')).toBeInTheDocument();
  expect(screen.getByTestId('card-vehicle-bmw-1-series')).toBeInTheDocument();
});


it('shows a supplied structured insurance category in stock without inferring it from prose', () => {
  stockFixture.cars = [
    { ...originalCars[0], writeOffCategory: null, sourceExtras: { writeOffCategory: 'Category S' } },
    { ...originalCars[1], writeOffCategory: 'Unknown', sourceExtras: { writeOffCategory: 'Category S', description: 'The seller mentions Cat N.' } },
  ];
  renderHome();
  expect(within(screen.getByTestId('card-vehicle-bmw-1-series')).getByText('Category S recorded')).toBeInTheDocument();
  expect(within(screen.getByTestId('card-vehicle-bmw-3-series')).queryByText(/Category N recorded/)).not.toBeInTheDocument();
  expect(within(screen.getByTestId('card-vehicle-bmw-3-series')).queryByText(/Category S recorded/)).not.toBeInTheDocument();
  expect(resultTitles()).toEqual(['BMW 1 Series', 'BMW 3 Series']);
});

describe('homepage browse buttons and body types', () => {
  it('uses the standard buttons, removes the tagline and counts only public body types', () => {
    stockFixture.cars = [
      {...originalCars[0],bodyType:'SUV'}, {...originalCars[1],bodyType:' suv '},
      {...originalCars[2],bodyType:'Hatchback'}, {...originalCars[3],bodyType:'Estate',inventoryStatus:'hidden'},
    ];
    renderHome(false);
    const section = screen.getByRole('region',{name:'Browse cars'});
    expect(within(section).queryByText('A few good places to start.')).not.toBeInTheDocument();
    expect(within(section).getByRole('link',{name:'Automatic · 1 car'})).toHaveClass('db-btn');
    const types = within(section).getByRole('navigation',{name:'Browse stock categories'});
    expect(within(types).getByRole('link',{name:'SUV · 2 cars'})).toHaveAttribute('href','/stock?bodyType=SUV');
    expect(within(types).getByRole('link',{name:'Hatchback · 1 car'})).toHaveAttribute('href','/stock?bodyType=Hatchback');
    expect(within(types).queryByRole('link',{name:/Estate/})).not.toBeInTheDocument();
  });
  it('applies a linked body type with budget, then allows changing and clearing it in stock filters', () => {
    stockFixture.cars = originalCars.map((car,index)=>({...car,bodyType:index<2?'SUV':'Hatchback'}));
    window.history.replaceState({},'', '/stock?bodyType=SUV&maxPrice=8000');
    renderHome();
    expect(resultTitles()).toEqual(['BMW 1 Series']);
    expect(screen.getByRole('button',{name:'Remove SUV filter'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Advanced search'}));
    expect(screen.getByLabelText('Body type')).toHaveValue('SUV');
    fireEvent.change(screen.getByLabelText('Body type'),{target:{value:'Hatchback'}});
    expect(resultTitles()).toEqual(['Ford Fiesta','Audi A3','VW Golf']);
    expect(new URLSearchParams(window.location.search).get('bodyType')).toBe('Hatchback');
    fireEvent.click(screen.getByRole('button',{name:'Reset filters'}));
    expect(resultTitles()).toHaveLength(5);expect(window.location.search).toBe('');
  });
  it('does not show a body-type row when no body types are supplied', () => {
    stockFixture.cars = originalCars.map(car=>({...car,bodyType:null}));
    renderHome(false);
    expect(screen.getByRole('navigation',{name:'Browse stock categories'}).querySelector('a[href*=bodyType]')).toBeNull();
  });
});

it('drops removed benefit parameters instead of preserving hidden filters', () => {
  window.history.replaceState({}, '', '/stock?lowMileage=true&lowAnnualTax=true&lowInsuranceGroup=true');
  renderHome(true);
  expect(window.location.search).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
  expect(screen.queryByText('Affordable Insurance')).not.toBeInTheDocument();
  expect(screen.queryByText('Road tax up to £35/year')).not.toBeInTheDocument();
});

it('shows supplied stock detail, exact mileage and an explicit car link while retaining photo/save controls', () => {
  const car = {...originalCars[0], variant:'1.5 TSI SE DSG Euro 6 (s/s) 5dr', trim:'SE', mileage:85342, engineSize:'1.5L', bodyType:'Hatchback', features:['No parking sensors', 'Cruise Control', 'Heated front seats', 'Bluetooth']};
  stockFixture.cars=[car];
  renderHome();
  const card=screen.getByTestId(`card-vehicle-${car.id}`);
  expect(within(card).getByText('1.5 TSI SE DSG')).toBeInTheDocument();
  expect(within(card).getByText('85,342 miles')).toBeInTheDocument();
  expect(within(card).getByText('1.5L')).toBeInTheDocument();
  const equipment=within(card).getByRole('list',{name:'Key features'});
  expect(within(equipment).getAllByRole('listitem')).toHaveLength(2);
  expect(equipment).not.toHaveTextContent('No parking sensors');
  expect(within(card).getByRole('link',{name:'View car'})).toHaveAttribute('href',`/vehicle/${car.id}`);
  expect(within(card).getByTestId(`button-save-${car.id}`)).toBeInTheDocument();
});

function stockPhotoTenant(origin: string) {
  const meta = document.createElement('meta');
  meta.name = 'luxxy-canonical-origin';
  meta.content = origin;
  meta.setAttribute('data-page-meta', '');
  meta.setAttribute('data-stock-photo-test', '');
  document.head.append(meta);
}

it.each(['card', 'compact'])('keeps Multi-Choice stock photos clean and linked in %s view', layout => {
  stockPhotoTenant('https://multichoicemotors.co.uk');
  const car = { ...originalCars[0], imageCount: 2, images: ['https://cdn.example.com/bmw-1.jpg', 'https://cdn.example.com/bmw-rear.jpg'] };
  stockFixture.cars = [car];
  renderHome();
  if (layout === 'compact') {
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    fireEvent.click(screen.getByTestId('button-stock-view-compact'));
  }
  const card = screen.getByTestId(`${layout}-vehicle-${car.id}`);
  expect(within(card).queryByRole('button', { name: `Previous photo of ${car.title}` })).not.toBeInTheDocument();
  expect(within(card).queryByRole('button', { name: `Next photo of ${car.title}` })).not.toBeInTheDocument();
  expect(within(card).queryByTestId(`button-save-${car.id}`)).not.toBeInTheDocument();
  expect(card.querySelector('.stock-photo-count')).toBeNull();
  const photograph = within(card).getByRole('link', { name: `View full details for ${car.title}` });
  expect(photograph).toHaveAttribute('href', `/vehicle/${car.id}`);
  expect(within(photograph).getByRole('img', { name: 'BMW 1 Series' })).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: 'View car' })).toHaveAttribute('href', `/vehicle/${car.id}`);
  fireEvent.click(photograph);
  expect(window.location.pathname).toBe(`/vehicle/${car.id}`);
});

it('preserves another dealership’s stock-photo browsing and Save even if its editable name matches Multi-Choice', () => {
  stockPhotoTenant('https://shoredrive.uk');
  overrideSettings = { ...dealerConfigFixture, identity: { ...dealerConfigFixture.identity, name: 'Multi Choice Motors' } };
  const car = { ...originalCars[0], imageCount: 2, images: ['https://cdn.example.com/bmw-1.jpg', 'https://cdn.example.com/bmw-rear.jpg'] };
  stockFixture.cars = [car];
  renderHome();
  const card = screen.getByTestId(`card-vehicle-${car.id}`);
  expect(within(card).getByRole('button', { name: `Previous photo of ${car.title}` })).toBeInTheDocument();
  fireEvent.click(within(card).getByRole('button', { name: `Next photo of ${car.title}` }));
  expect(within(card).getByRole('img', { name: 'BMW 1 Series' })).toHaveAttribute('src', 'https://cdn.example.com/bmw-rear.jpg');
  expect(within(card).getByTestId(`button-save-${car.id}`)).toBeInTheDocument();
  expect(card.querySelector('.stock-photo-count')).toHaveTextContent('2 / 2');
});

it('leaves Multi-Choice’s separate homepage featured photographs and vehicle links intact', () => {
  stockPhotoTenant('https://multichoicemotors.co.uk');
  overrideSettings = { ...dealerConfigFixture, presentation: { websiteCopy: { featuredHeading: 'Our selected stock' } } };
  const car = { ...originalCars[0], imageCount: 2, images: ['https://cdn.example.com/bmw-1.jpg', 'https://cdn.example.com/bmw-rear.jpg'] };
  stockFixture.cars = [car];
  renderHome(false);
  expect(document.getElementById('vehicle-results')).toBeNull();
  const featured = screen.getByRole('region', { name: 'Our selected stock' });
  const photograph = within(featured).getByRole('link', { name: `View ${car.title}` });
  expect(photograph).toHaveAttribute('href', `/vehicle/${car.id}`);
  expect(within(photograph).getByRole('img', { name: 'BMW 1 Series' })).toBeInTheDocument();
});

it('places Multi-Choice photos only on enabled homepage sections, never stock results', () => {
  overrideSettings = {...dealerConfigFixture, identity: {...dealerConfigFixture.identity, name: 'Multi Choice Motors'}, delivery: {...dealerConfigFixture.delivery, enabled: true}, partExchange: {...dealerConfigFixture.partExchange, enabled: true}};
  renderHome(false);
  expect(screen.getByAltText('Vehicle delivery to a UK home')).toBeInTheDocument();
  expect(screen.getByAltText('A customer handing over car keys for part exchange')).toBeInTheDocument();
  cleanup();
  renderHome(true);
  expect(screen.queryByAltText('Vehicle delivery to a UK home')).not.toBeInTheDocument();
  cleanup();
  overrideSettings = {...overrideSettings, delivery: {...overrideSettings.delivery, enabled: false}, partExchange: {...overrideSettings.partExchange, enabled: false}};
  renderHome(false);
  expect(screen.queryByAltText('Vehicle delivery to a UK home')).not.toBeInTheDocument();
  expect(screen.queryByAltText('A customer handing over car keys for part exchange')).not.toBeInTheDocument();
});

it('keeps hybrid/electric shortcuts consistent with their results and displays the complete stock count', () => {
 stockFixture.cars = [
  {...originalCars[0], fuel: 'Petrol Hybrid', price: 4000},
  {...originalCars[1], fuel: 'Electric', price: 8000},
  {...originalCars[2], fuel: 'Diesel', price: 6000},
 ];
 renderHome(false);
 expect(screen.getByRole('link', {name: 'Browse 3 cars'})).toHaveAttribute('href', '/stock?all=1');
 expect(screen.getByRole('link', {name: 'Hybrid & electric · 2 cars'})).toHaveAttribute('href', '/stock?fuel=Hybrid%20%26%20electric');
 expect(screen.getByRole('link', {name: 'Under £5,000 · 1 car'})).toHaveAttribute('href', '/stock?maxPrice=5000');
 cleanup();
 window.history.replaceState({}, '', '/stock?fuel=Hybrid%20%26%20electric');
 renderHome();
 expect(resultTitles()).toHaveLength(2);
 fireEvent.click(screen.getByRole('button', {name: 'Advanced search'}));
 expect(screen.getByRole('combobox', {name: 'Fuel'})).toHaveValue('Hybrid & electric');
});


it('uses the new Multi-Choice homepage search to create a shareable stock URL and matching existing results', () => {
  stockPhotoTenant('https://multichoicemotors.co.uk');
  renderHome(false);
  expect(screen.getByTestId('multi-choice-homepage')).toBeInTheDocument();
  const search = screen.getByRole('form', { name: 'Search used cars' });
  fireEvent.change(within(search).getByRole('combobox', { name: 'Make' }), { target: { value: 'BMW' } });
  fireEvent.change(within(search).getByRole('combobox', { name: 'Model' }), { target: { value: '1 Series' } });
  fireEvent.change(within(search).getByRole('combobox', { name: 'Maximum price' }), { target: { value: '5000' } });
  fireEvent.submit(search);
  expect(window.location.pathname).toBe('/stock');
  const query = new URLSearchParams(window.location.search);
  expect(query.get('make')).toBe('BMW'); expect(query.get('model')).toBe('1 Series'); expect(query.get('maxPrice')).toBe('5000');
  cleanup(); renderHome(true);
  expect(screen.queryByTestId('multi-choice-homepage')).not.toBeInTheDocument(); expect(resultTitles()).toEqual(['BMW 1 Series']);
});

it('does not activate the new homepage from an editable dealership name or another canonical domain', () => {
  stockPhotoTenant('https://shoredrive.uk');
  overrideSettings = { ...dealerConfigFixture, identity: { ...dealerConfigFixture.identity, name: 'Multi Choice Motors' } };
  renderHome(false);
  expect(screen.queryByTestId('multi-choice-homepage')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: 'Find your next car' })).toBeInTheDocument();
});

describe('Multi-Choice stock filter integration', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    stockFixture.count = originalCars.length;
    stockFixture.cars = originalCars.map((car, index) => ({
      ...car,
      colour: index === 0 || index === 4 ? 'Blue' : 'Silver',
      engineCC: index === 0 || index === 4 ? 1498 : 1998,
      engineSize: index === 0 || index === 4 ? '1.5L' : '2.0L',
    }));
  });

  function multiStock(href = '/stock') {
    stockPhotoTenant('https://multichoicemotors.co.uk');
    window.history.replaceState({}, '', href);
    return renderHome(true);
  }

  it('keeps the existing homepage search usable after a multi-make stock search', () => {
    multiStock('/stock?make=BMW,Volkswagen&model=1%20Series,Golf&maxPrice=10000&colour=Blue');
    expect(resultTitles()).toEqual(['BMW 1 Series', 'VW Golf']);
    cleanup();
    window.history.replaceState({}, '', '/');
    renderHome(false);
    const homepage = screen.getByRole('form', { name: 'Search used cars' });
    expect(within(homepage).getByRole('combobox', { name: 'Make' })).toHaveValue('');
    expect(within(homepage).getByRole('combobox', { name: 'Model' })).toHaveValue('');
    expect(within(homepage).getByRole('combobox', { name: 'Maximum price' })).toHaveValue('10000');
    expect(within(homepage).getByRole('button', { name: 'Search 5 cars' })).toBeEnabled();
    expect(within(homepage).queryByText(/BMW,Volkswagen/)).not.toBeInTheDocument();
  });

  function ReturnVehicle() {
    return <main><h1>Selected vehicle</h1><Link href={browseReturnHref()} onClick={() => requestBrowseRestore()}>Back to your results</Link></main>;
  }

  function routedStock() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => <QueryClientProvider client={queryClient}><SavedCarsProvider><RouteScrollReset /><Switch><Route path="/stock"><Home browseStock /></Route><Route path="/vehicle/:id"><ReturnVehicle /></Route></Switch></SavedCarsProvider></QueryClientProvider>;
    const view = render(tree());
    return { ...view, refresh: () => view.rerender(tree()) };
  }

  it('uses supplied SVG filter controls and combines multiple makes with a real advanced facet', () => {
    multiStock();
    expect(screen.getByTestId('multi-stock-toolbar')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Make' })).not.toBeInTheDocument();
    const sidebar = screen.getByRole('complementary', { name: 'Filter cars' });
    fireEvent.click(within(sidebar).getByRole('button', { name: /^Make/ }));
    fireEvent.click(within(sidebar).getByRole('checkbox', { name: 'BMW' }));
    fireEvent.click(within(sidebar).getByRole('checkbox', { name: 'Volkswagen' }));
    expect(resultTitles()).toEqual(['BMW 1 Series', 'BMW 3 Series', 'VW Golf']);
    fireEvent.click(within(sidebar).getByRole('button', { name: /^More filters/ }));
    fireEvent.click(within(sidebar).getByRole('button', { name: /^Colour(?:\s|$)/ }));
    fireEvent.click(within(sidebar).getByRole('checkbox', { name: 'Blue' }));
    expect(resultTitles()).toEqual(['BMW 1 Series', 'VW Golf']);
    expect(screen.getByTestId('text-filtered-stock-count')).toHaveTextContent('2 cars match your search');
    expect(new URLSearchParams(location.search).get('make')).toBe('BMW,Volkswagen');
    expect(new URLSearchParams(location.search).get('colour')).toBe('Blue');
    expect(screen.getByRole('button', { name: 'Remove colour Blue filter' })).toBeInTheDocument();
    const makeIcon = within(sidebar).getByRole('button', { name: /^Make/ }).querySelector<HTMLElement>('.multi-stock-icon');
    expect(makeIcon?.style.maskImage).toContain('/brand/multi-choice-motors/filters/02-filter-make-car.svg');
  });

  it('returns from the phone filter drawer with the stock controls in view and focus on results', async () => {
    // Earlier legacy journeys can leave a scheduled scroll behind after cleanup.
    // Settle it before observing the explicit action in this separate journey.
    await act(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    vi.mocked(scrollToHomeTarget).mockClear();
    vi.mocked(focusHomeTarget).mockClear();
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
    try {
      multiStock('/stock?make=BMW');
      fireEvent.click(screen.getByRole('button', { name: 'Filters, 1 active' }));
      const drawer = screen.getByRole('dialog', { name: 'Filter cars' });
      expect(scrollToHomeTarget).not.toHaveBeenCalled();
      expect(focusHomeTarget).not.toHaveBeenCalled();
      fireEvent.click(within(drawer).getByRole('button', { name: 'Show 2 cars' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => {
        expect(scrollToHomeTarget).toHaveBeenCalledExactlyOnceWith('stock');
        expect(focusHomeTarget).toHaveBeenCalledExactlyOnceWith('vehicle-results');
      });
      expect(scrollToHomeTarget).not.toHaveBeenCalledWith('vehicle-results');
      expect(resultTitles()).toEqual(['BMW 1 Series', 'BMW 3 Series']);
      expect(new URLSearchParams(location.search).get('make')).toBe('BMW');
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: previousWidth });
    }
  });

  it('updates results and chips for query-only navigation and clears an empty URL despite saved legacy filters', async () => {
    sessionStorage.setItem('luxxy.browse.v1', JSON.stringify({ filters: { make: 'Ford', model: 'Fiesta', maxPrice: '6000' }, visibleCount: 36 }));
    multiStock('/stock?make=BMW&colour=Blue');
    expect(resultTitles()).toEqual(['BMW 1 Series']);
    act(() => window.history.pushState({}, '', '/stock?make=Audi&colour=Silver'));
    await waitFor(() => expect(resultTitles()).toEqual(['Audi A3']));
    expect(screen.getByRole('button', { name: 'Remove make Audi filter' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove make BMW filter' })).not.toBeInTheDocument();

    act(() => window.history.replaceState({}, '', '/stock'));
    await waitFor(() => expect(resultTitles()).toHaveLength(originalCars.length));
    expect(window.location.search).toBe('');
    expect(screen.queryByLabelText('Applied stock filters')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search cars' })).toHaveValue('');
    expect(screen.getByTestId('text-filtered-stock-count')).toHaveTextContent('5 cars in stock');
  });

  it('uses the new URL state for empty-result alternatives and clears every advanced filter', async () => {
    multiStock('/stock?make=BMW&maxPrice=100&colour=Blue&engine=1.5&mileage=40000&page=3');
    expect(screen.getByRole('heading', { name: 'No matches' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove price limits' }));
    expect(resultTitles()).toEqual(['BMW 1 Series']);
    const current = new URLSearchParams(location.search);
    expect(current.has('maxPrice')).toBe(false);
    expect(current.has('page')).toBe(false);
    expect(current.get('colour')).toBe('Blue');
    expect(current.get('engine')).toBe('1.5');
    expect(screen.getByRole('button', { name: 'Remove engine size 1.5L filter' })).toBeInTheDocument();

    act(() => window.history.pushState({}, '', '/stock?make=Unavailable&colour=Blue'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'No matches' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Search all makes' }));
    expect(resultTitles()).toEqual(['BMW 1 Series', 'VW Golf']);
    expect(new URLSearchParams(location.search).get('colour')).toBe('Blue');

    act(() => window.history.pushState({}, '', '/stock?colour=Blue&engine=9.0&seats=7&mileage=100&page=2'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'No matches' })).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('button-clear-filters'));
    expect(window.location.search).toBe('');
    expect(screen.queryByLabelText('Applied stock filters')).not.toBeInTheDocument();
    expect(resultTitles()).toHaveLength(originalCars.length);
  });

  it('keeps advanced facets, the revealed batch and the selected car when returning from a vehicle', async () => {
    stockPhotoTenant('https://multichoicemotors.co.uk');
    stockFixture.cars = Array.from({ length: 16 }, (_, index) => ({
      ...originalCars[0], id: `return-car-${index}`, advertId: `return-car-${index}`, title: `Return car ${index}`,
      colour: index === 15 ? 'Red' : 'Blue', engineCC: 1498, seats: 5, mileage: 30000, price: 5000 + index,
    }));
    window.history.replaceState({}, '', '/stock?colour=Blue&engine=1.5&seats=5&mileage=50000&sort=price-asc');
    window.scrollTo = vi.fn();
    routedStock();
    expect(resultTitles()).toHaveLength(12);
    fireEvent.click(screen.getByRole('button', { name: 'Show more cars' }));
    expect(resultTitles()).toHaveLength(15);
    expect(new URLSearchParams(location.search).get('page')).toBe('2');
    const stockHref = '/stock' + window.location.search;
    expect(readBrowseSession().stockHref).toBe(stockHref);

    const last = screen.getByTestId('card-vehicle-return-car-14');
    fireEvent.click(within(last).getByRole('link', { name: 'View full details for Return car 14' }));
    expect(screen.getByRole('heading', { name: 'Selected vehicle' })).toBeInTheDocument();
    expect(readBrowseSession()).toMatchObject({ vehicleId: 'return-car-14', stockHref });
    expect(screen.getByRole('link', { name: 'Back to your results' })).toHaveAttribute('href', stockHref);

    fireEvent.click(screen.getByRole('link', { name: 'Back to your results' }));
    await waitFor(() => expect(resultTitles()).toHaveLength(15));
    expect('/stock' + window.location.search).toBe(stockHref);
    expect(screen.getByRole('button', { name: 'Remove colour Blue filter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove engine size 1.5L filter' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Sort cars' })).toHaveValue('price-asc');
    await waitFor(() => expect(document.querySelector('[data-stock-link="return-car-14"]')).toHaveFocus());
  });

  it('retains a linked batch during loading and resets it only after an explicit filter edit', () => {
    stockPhotoTenant('https://multichoicemotors.co.uk');
    stockFixture.cars = Array.from({ length: 30 }, (_, index) => ({ ...originalCars[0], id: `loading-car-${index}`, title: `Loading car ${index}` }));
    sessionStorage.setItem('luxxy.browse.v1', JSON.stringify({ visibleCount: 48 }));
    window.history.replaceState({}, '', '/stock?make=BMW&page=2');
    stockIsLoading = true;
    const view = routedStock();
    expect(screen.getByLabelText('Loading stock')).toBeInTheDocument();
    expect(new URLSearchParams(location.search).get('page')).toBe('2');
    stockIsLoading = false;
    view.refresh();
    expect(resultTitles()).toHaveLength(24);
    expect(screen.getByText('Showing 24 of 30 cars')).toBeInTheDocument();
    const sidebar = screen.getByRole('complementary', { name: 'Filter cars' });
    fireEvent.click(within(sidebar).getByRole('button', { name: /^Make/ }));
    fireEvent.click(within(sidebar).getByRole('checkbox', { name: 'BMW' }));
    expect(resultTitles()).toHaveLength(12);
    expect(new URLSearchParams(location.search).has('page')).toBe(false);
  });

  it('applies an explicit keyword search together with existing facets without altering the car display', () => {
    multiStock('/stock?colour=Blue');
    expect(resultTitles()).toEqual(['BMW 1 Series', 'VW Golf']);
    const input = screen.getByRole('searchbox', { name: 'Search cars' });
    fireEvent.change(input, { target: { value: 'BMW Petrol' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(resultTitles()).toEqual(['BMW 1 Series']);
    expect(new URLSearchParams(location.search).get('search')).toBe('BMW Petrol');
    expect(new URLSearchParams(location.search).get('colour')).toBe('Blue');
    expect(screen.getByRole('button', { name: 'Remove keyword filter' })).toBeInTheDocument();
  });

  it.each(['cards', 'compact'] as const)('preserves the existing %s grid, card facts and image geometry across dealership filter scopes', view => {
    stockPhotoTenant('https://shoredrive.uk');
    window.history.replaceState({}, '', '/stock');
    localStorage.setItem('luxxy.stock-view.v1', view);
    stockFixture.cars = [stockFixture.cars[0]];
    renderHome(true);
    const signature = () => {
      const card = screen.getByTestId(`${view === 'compact' ? 'compact' : 'card'}-vehicle-bmw-1-series`);
      const image = within(card).getByRole('img', { name: 'BMW 1 Series' });
      return {
        grid: card.parentElement?.className,
        card: card.className,
        image: Object.fromEntries(['src', 'alt', 'width', 'height', 'loading', 'sizes', 'srcset', 'class'].map(name => [name, image.getAttribute(name)])),
        price: card.querySelector('.vehicle-card-price')?.textContent,
        facts: card.querySelector('.vehicle-specs')?.textContent,
        href: within(card).getByRole('link', { name: 'View car' }).getAttribute('href'),
      };
    };
    const legacyDisplay = signature();
    expect(screen.queryByTestId('multi-stock-toolbar')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Make' })).toBeInTheDocument();
    cleanup();
    document.querySelectorAll('[data-stock-photo-test]').forEach(element => element.remove());
    stockPhotoTenant('https://multichoicemotors.co.uk');
    renderHome(true);
    expect(screen.getByTestId('multi-stock-toolbar')).toBeInTheDocument();
    expect(signature()).toEqual(legacyDisplay);
    // Multi-Choice's already-approved clean-photo treatment stays in place.
    expect(screen.queryByTestId('button-save-bmw-1-series')).not.toBeInTheDocument();
  });
});
