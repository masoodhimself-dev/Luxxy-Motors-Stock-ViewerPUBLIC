import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Home from '@/pages/home';
import { SavedCarsProvider } from '@/lib/saved-cars-context';
import type { Car } from '@/lib/stock-context';

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
  presentation?: { websiteTemplate?: 'existing' | 'classic' | 'premium' | 'focused'; showHeroDescription?: boolean; websiteCopy?: { stockIntroduction?: string }; heroImageUrl?: string; heroImageAlt?: string; heroImagePosition?: 'center' | 'left' | 'right' | 'top' | 'bottom'; showroomImageUrl?: string; showroomImageAlt?: string };
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

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  stockIsLoading=false;
  demoSiteMode=false;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
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
    expect(screen.getByRole('link', { name: 'View all stock' })).toHaveAttribute('href', '/stock?all=1');
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
    expect(screen.getByRole('link', { name: 'View all stock' })).toHaveAttribute('href', '/stock?all=1');
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
    expect(screen.queryByTestId('compact-actions-bmw-1-series')).not.toBeInTheDocument();
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
      expect(focusHomeTarget).toHaveBeenCalledWith('vehicle-results-heading');
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
  fireEvent.change(screen.getByLabelText('Quick filter by make'), { target: { value: 'BMW' } });
  fireEvent.change(screen.getByLabelText('Sort results'), { target: { value: 'price-desc' } });
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
  expect(card).toHaveTextContent('12.9k miles');
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
    const types = within(section).getByRole('navigation',{name:'Browse by body type'});
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
    expect(screen.queryByRole('navigation',{name:'Browse by body type'})).not.toBeInTheDocument();
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
