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
  customFetch: async () => ({ status: 'unavailable' }),
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


function stockPhotoTenant(origin: string) {
  document.querySelectorAll('[data-stock-photo-test]').forEach(element => element.remove());
  const meta = document.createElement('meta');
  meta.name = 'luxxy-canonical-origin'; meta.content = origin;
  meta.setAttribute('data-page-meta', ''); meta.setAttribute('data-stock-photo-test', '');
  document.head.append(meta);
}

function searchStock(value: string) {
  const input = screen.getByRole('searchbox', { name: 'Search cars' });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

function featuredTitles() {
  return within(screen.getByRole('region', { name: 'Explore our cars' })).queryAllByRole('article').map(card => card.getAttribute('aria-label'));
}

describe('shared showroom data and controls', () => {
  it('matches automatic URL filters when supplied labels vary', () => {
    stockFixture.cars = [{ ...originalCars[0], transmission: 'automatic' }, { ...originalCars[1], transmission: 'Automatic (DCT)' }, { ...originalCars[2], transmission: 'Manual' }];
    window.history.replaceState({}, '', '/stock?transmission=Automatic');
    renderHome();
    expect(resultTitles()).toEqual(['BMW 1 Series', 'BMW 3 Series']);
    expect(screen.getByTestId('text-filtered-stock-count')).toHaveTextContent('2 cars');
  });

  it('keeps browsing and view controls usable when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'QuotaExceededError'); });
    renderHome(); fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    expect(screen.getByTestId('card-vehicle-bmw-1-series')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-stock-view-compact'));
    expect(screen.getByTestId('compact-vehicle-bmw-1-series')).toBeInTheDocument();
  });

  it.each(['price-asc', 'price-desc', 'mileage-asc', 'mileage-desc'])('puts missing values last for %s', sort => {
    stockFixture.cars = [{ ...originalCars[0], price: null, mileage: null }, { ...originalCars[1], price: 10000, mileage: 20000 }, { ...originalCars[2], price: 5000, mileage: 0 }];
    renderHome(); fireEvent.change(screen.getByRole('combobox', { name: 'Sort cars' }), { target: { value: sort } });
    expect(resultTitles()).toEqual(sort.endsWith('asc') ? ['Ford Fiesta', 'BMW 3 Series', 'BMW 1 Series'] : ['BMW 3 Series', 'Ford Fiesta', 'BMW 1 Series']);
  });

  it('normalises pasted keyword whitespace and finds compact registrations', () => {
    stockFixture.cars[0] = { ...originalCars[0], registration: null, plate: null, vrm: 'AB12 BMW' };
    renderHome(); searchStock('  ab12bmw  '); expect(resultTitles()).toEqual(['BMW 1 Series']);
    searchStock('  fiesta  '); expect(resultTitles()).toEqual(['Ford Fiesta']);
  });

  it('ignores removed history and benefit parameters without offering those filters', () => {
    window.history.replaceState({}, '', '/stock?catS=true&catN=true&noWriteOff=true&lowMileage=true&lowAnnualTax=true&lowInsuranceGroup=true');
    renderHome(); expect(resultTitles()).toHaveLength(5); expect(window.location.search).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.queryByText('Insurance history')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'No recorded write-off' })).not.toBeInTheDocument();
    expect(screen.queryByText('Affordable Insurance')).not.toBeInTheDocument();
    expect(screen.queryByText('Road tax up to £35/year')).not.toBeInTheDocument();
  });

  it('uses the desktop checkbox make/model facets across all dealerships', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    stockPhotoTenant('https://shoredrive.uk'); renderHome();
    const sidebar = within(screen.getByRole('complementary', { name: 'Filter cars' }));
    fireEvent.click(sidebar.getByRole('button', { name: /^Make/ }));
    fireEvent.click(sidebar.getByRole('checkbox', { name: 'BMW' }));
    fireEvent.click(sidebar.getByRole('button', { name: /^Model/ }));
    expect(sidebar.queryByRole('checkbox', { name: 'Fiesta' })).not.toBeInTheDocument();
    fireEvent.click(sidebar.getByRole('checkbox', { name: '3 Series' }));
    expect(resultTitles()).toEqual(['BMW 3 Series']);
    expect(new URLSearchParams(location.search).get('make')).toBe('BMW');
    expect(new URLSearchParams(location.search).get('model')).toBe('3 Series');
  });

  it('includes exact budget boundaries and combines fuel and transmission from a shared URL', () => {
    window.history.replaceState({}, '', '/stock?minPrice=5000'); renderHome();
    expect(resultTitles()).toEqual(['BMW 1 Series', 'BMW 3 Series', 'Ford Fiesta', 'Audi A3']); cleanup();
    window.history.replaceState({}, '', '/stock?maxPrice=5000&fuel=Petrol&transmission=Automatic'); renderHome();
    expect(resultTitles()).toEqual(['BMW 1 Series', 'VW Golf']);
    expect(screen.getByRole('button', { name: 'Remove gearbox Automatic filter' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(resultTitles()).toHaveLength(5); expect(window.location.search).toBe('');
  });

  it.each(['cards', 'compact'])('restores the saved %s stock display preference', view => {
    localStorage.setItem('luxxy.stock-view.v1', view); renderHome();
    expect(screen.getByTestId(`${view === 'compact' ? 'compact' : 'card'}-vehicle-bmw-1-series`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    expect(screen.getByTestId(`button-stock-view-${view}`)).toHaveAttribute('aria-pressed', 'true');
  });

  it('loads cars in batches and excludes sold stock while keeping reserved cars last', () => {
    stockFixture.cars = Array.from({length: 15}, (_,i) => ({...originalCars[0], id: `batch-${i}`, title:`Batch car ${i}`, inventoryStatus:i === 0 ? 'reserved' : i === 1 ? 'sold' : 'available'}));
    stockFixture.count = 15; renderHome();
    expect(resultTitles()).toHaveLength(12); expect(screen.getByText('Showing 12 of 14 cars')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Show more cars'})); expect(resultTitles()).toHaveLength(14);
    expect(resultTitles().at(-1)).toBe('Batch car 0'); expect(resultTitles()).not.toContain('Batch car 1');
  });

  it('honours an explicit price sort including reserved cars', () => {
    stockFixture.cars = [{ ...originalCars[0], price: 1000, inventoryStatus: 'reserved' }, { ...originalCars[1], price: 10000 }, { ...originalCars[2], price: 7500 }];
    renderHome(); expect(resultTitles()).toEqual(['BMW 3 Series', 'Ford Fiesta', 'BMW 1 Series']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort cars' }), { target: { value: 'price-asc' } });
    expect(resultTitles()).toEqual(['BMW 1 Series', 'Ford Fiesta', 'BMW 3 Series']);
  });

  it('shows one result count and preserves a bespoke stock introduction', () => {
    overrideSettings = { ...dealerConfigFixture, presentation: { websiteCopy: { stockIntroduction: 'Browse our hand-picked stock.' } } };
    renderHome(); expect(screen.getByTestId('multi-stock-toolbar')).toContainElement(screen.getByTestId('text-filtered-stock-count'));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByText('Browse our hand-picked stock.')).toBeInTheDocument();
  });
});

describe('shared homepage and dealer content', () => {
  it.each(['https://multichoicemotors.co.uk', 'https://shoredrive.uk', 'https://new-dealer.example'])('uses the approved homepage and search on %s', origin => {
    stockPhotoTenant(origin); renderHome(false);
    expect(screen.getByTestId('multi-choice-homepage')).toBeInTheDocument();
    const search = screen.getByRole('form', { name: 'Search used cars' });
    fireEvent.change(within(search).getByRole('combobox', { name: 'Make' }), { target: { value: 'BMW' } });
    fireEvent.change(within(search).getByRole('combobox', { name: 'Model' }), { target: { value: '1 Series' } });
    fireEvent.change(within(search).getByRole('combobox', { name: 'Maximum price' }), { target: { value: '5000' } });
    fireEvent.submit(search); expect(window.location.pathname).toBe('/stock');
    const query = new URLSearchParams(location.search);
    expect(query.get('make')).toBe('BMW'); expect(query.get('model')).toBe('1 Series'); expect(query.get('maxPrice')).toBe('5000');
    cleanup(); renderHome(); expect(resultTitles()).toEqual(['BMW 1 Series']);
  });

  it('uses configured featured choices and reserved ordering on the homepage and stock page', () => {
    overrideSettings = { ...dealerConfigFixture, featuredVehicleIds: ['bmw-1-series', 'audi-a3', 'bmw-3-series', 'removed-id'] };
    stockFixture.cars[0] = { ...originalCars[0], inventoryStatus: 'reserved' };
    renderHome(false); expect(featuredTitles()).toEqual(['Audi A3', 'BMW 3 Series', 'BMW 1 Series']);
    cleanup(); renderHome(); expect(resultTitles()).toEqual(['Audi A3', 'BMW 3 Series', 'Ford Fiesta', 'VW Golf', 'BMW 1 Series']);
  });

  it('defaults featured cars to photographed stock while retaining stock-page order', () => {
    stockFixture.cars = originalCars.map((car, index) => ({ ...car, heroImage: `https://cdn.example.com/car-${index}.jpg` }));
    renderHome(false); expect(featuredTitles()).toEqual(['BMW 3 Series', 'VW Golf', 'Ford Fiesta', 'BMW 1 Series', 'Audi A3']);
    cleanup(); renderHome(); expect(resultTitles()).toEqual(['BMW 1 Series', 'BMW 3 Series', 'Ford Fiesta', 'Audi A3', 'VW Golf']);
  });

  it('keeps search and stock links available when no cars have photographs', () => {
    stockFixture.cars = originalCars.map(car => ({ ...car, heroImage: null, images: [] })); renderHome(false);
    expect(document.querySelector('.mh-hero-photo')).toBeNull();
    expect(screen.getByRole('link', { name: 'More search options' })).toHaveAttribute('href', '/stock');
    expect(screen.getByRole('button', { name: 'Search 5 cars' })).toBeInTheDocument();
    cleanup(); renderHome(); expect(resultTitles()).toHaveLength(5);
  });

  it('keeps each dealership’s configured hero, introduction and service visibility', () => {
    stockPhotoTenant('https://shoredrive.uk');
    overrideSettings = { ...dealerConfigFixture, presentation: { heroImageUrl: 'https://shoredrive.uk/showroom.jpg', heroImageAlt: 'Our dealership exterior' }, partExchange: { ...dealerConfigFixture.partExchange, enabled: false } };
    renderHome(false);
    expect(screen.getByRole('img', { name: 'Our dealership exterior' })).toHaveAttribute('src', 'https://shoredrive.uk/showroom.jpg');
    expect(screen.getByText('A clear buying process.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Warranty information' })).toHaveAttribute('href', '/warranty');
    expect(screen.getByRole('link', { name: 'Ask about delivery' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Part exchange' })).not.toBeInTheDocument();
    expect(screen.queryByText(/6.month warranty|36 months|price.checked daily/i)).not.toBeInTheDocument();
    expect(document.querySelector('img[src*="luxxy-hero"], img[src*="hero-cars-1200"], .dealer-service-photo')).toBeNull();
  });

  it('shows the dealership introduction while stock loads', () => {
    stockIsLoading = true; renderHome(false);
    expect(screen.getByRole('heading', { name: 'Find your next car' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Loading cars…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Loading featured cars…');
  });

  it('shows public body types and links each to shared stock filters', () => {
    stockFixture.cars = [{...originalCars[0],bodyType:'SUV'}, {...originalCars[1],bodyType:' suv '}, {...originalCars[2],bodyType:'Hatchback'}, {...originalCars[3],bodyType:'Estate',inventoryStatus:'hidden'}];
    renderHome(false); const section = within(screen.getByRole('region', { name: 'Browse by body type' }));
    expect(section.getByRole('link',{name:'SUV'})).toHaveAttribute('href','/stock?bodyType=SUV');
    expect(section.getByRole('link',{name:'Hatchback'})).toHaveAttribute('href','/stock?bodyType=Hatchback');
    expect(section.queryByRole('link',{name:/Estate/})).not.toBeInTheDocument();
  });

  it('omits the body type section when no types are supplied', () => {
    stockFixture.cars = originalCars.map(car=>({...car,bodyType:null})); renderHome(false);
    expect(screen.queryByRole('region', { name: 'Browse by body type' })).not.toBeInTheDocument();
  });

  it('applies a linked body type and budget then clears the shared filters', () => {
    stockFixture.cars = originalCars.map((car,index)=>({...car,bodyType:index<2?'SUV':'Hatchback'}));
    window.history.replaceState({},'', '/stock?bodyType=SUV&maxPrice=8000'); renderHome();
    expect(resultTitles()).toEqual(['BMW 1 Series']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove body type SUV filter' }));
    expect(resultTitles()).toEqual(['BMW 1 Series', 'Ford Fiesta', 'Audi A3', 'VW Golf']);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' })); expect(resultTitles()).toHaveLength(5);
  });
});

describe('shared stock cards', () => {
  it('retains exact mileage, equipment, advert history and a clear vehicle link', () => {
    stockFixture.cars = [{ ...originalCars[0], mileage: 12885, fuel: null, emissionClass: null, sourceExtras: { features: ['Heated seats'], description: 'This car was recorded as Cat S. Ask us for repair records.' } }];
    renderHome(); const card = screen.getByTestId('card-vehicle-bmw-1-series');
    expect(card).toHaveTextContent('12,885 miles'); expect(card).toHaveTextContent('Heated seats');
    expect(card).toHaveTextContent('Advert states Category S'); expect(card).not.toHaveTextContent('low mileage');
    expect(within(card).getByRole('link', { name: 'View car' })).toHaveAttribute('href', '/vehicle/bmw-1-series?from=stock');
  });

  it('shows only a supplied structured insurance category', () => {
    stockFixture.cars = [{ ...originalCars[0], writeOffCategory: null, sourceExtras: { writeOffCategory: 'Category S' } }, { ...originalCars[1], writeOffCategory: 'Unknown', sourceExtras: { writeOffCategory: 'Category S', description: 'The seller mentions Cat N.' } }];
    renderHome(); expect(within(screen.getByTestId('card-vehicle-bmw-1-series')).getByText('Category S recorded')).toBeInTheDocument();
    expect(within(screen.getByTestId('card-vehicle-bmw-3-series')).queryByText(/Category [NS] recorded/)).not.toBeInTheDocument();
  });

  it.each(['https://multichoicemotors.co.uk', 'https://shoredrive.uk', 'https://new-dealer.example'])('keeps photos clean, linked and separate from manufacturer marks on %s', origin => {
    stockPhotoTenant(origin);
    const car = { ...originalCars[0], imageCount: 2, images: ['https://cdn.example.com/bmw-1.jpg', 'https://cdn.example.com/bmw-rear.jpg'] };
    stockFixture.cars = [car]; renderHome(); const card = screen.getByTestId(`card-vehicle-${car.id}`);
    expect(within(card).queryByRole('button', { name: `Previous photo of ${car.title}` })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: `Next photo of ${car.title}` })).not.toBeInTheDocument();
    expect(card.querySelector('.vehicle-card-photo button')).toBeNull(); expect(card.querySelector('.stock-photo-count')).toBeNull();
    expect(within(card).getByTestId(`button-save-${car.id}`)).toBeInTheDocument();
    const logo = within(card).getByRole('heading', { name: 'BMW 1 Series' }).querySelector('img');
    expect(logo).toHaveAttribute('src', '/brand/car-makes/bmw.svg'); expect(logo).toHaveAttribute('alt', ''); expect(logo).toHaveAttribute('aria-hidden', 'true');
    expect(card.querySelector('.vehicle-card-photo img[src*="car-makes"]')).toBeNull();
    const photograph = within(card).getByRole('link', { name: `View full details for ${car.title}` });
    expect(photograph).toHaveAttribute('href', `/vehicle/${car.id}?from=stock`);
    fireEvent.click(photograph); expect(window.location.pathname).toBe(`/vehicle/${car.id}`);
  });

  it('does not leave space for an unsupported manufacturer mark', () => {
    stockFixture.cars = [{ ...originalCars[0], make: 'Unknown make' }]; renderHome();
    const title = within(screen.getByTestId('card-vehicle-bmw-1-series')).getByRole('heading');
    expect(title.querySelector('img')).toBeNull(); expect(title).not.toHaveClass('make-logo-card-heading');
  });

  it('saves and compares directly in stock and keeps the comparison on return', async () => {
    window.history.replaceState({}, '', '/stock');
    const view = renderHome();
    const first = within(screen.getByTestId('card-vehicle-bmw-1-series'));
    fireEvent.click(first.getByRole('button', { name: 'Save BMW 1 Series to your saved cars' }));
    expect(screen.getByRole('link', { name: 'Saved (1)' })).toHaveAttribute('href', '/saved');
    expect(window.location.pathname).toBe('/stock');
    fireEvent.click(first.getByRole('button', { name: 'Compare BMW 1 Series' }));
    const selection = screen.getByRole('region', { name: 'Car comparison selection' });
    expect(within(selection).getByRole('button', { name: 'Choose one more car' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Compare BMW 3 Series' }));
    fireEvent.click(within(selection).getByRole('button', { name: 'Compare 2 cars' }));
    const dialog = await screen.findByRole('dialog', { name: 'Compare your cars' });
    expect(within(dialog).getByRole('link', { name: 'BMW 1 Series' })).toHaveAttribute('href', '/vehicle/bmw-1-series?from=stock');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to stock' }));
    view.unmount();
    renderHome();
    expect(screen.getByRole('button', { name: 'Compare BMW 1 Series' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '2 cars selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove BMW 1 Series from comparison' }));
    expect(screen.getByRole('button', { name: 'Compare BMW 1 Series' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('shared stock filter integration', () => {
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
    fireEvent.click(within(sidebar).getByRole('button', { name: /^Colour(?:\s|$)/ }));
    fireEvent.click(within(sidebar).getByRole('checkbox', { name: 'Blue' }));
    expect(resultTitles()).toEqual(['BMW 1 Series', 'VW Golf']);
    expect(within(screen.getByTestId('multi-stock-toolbar')).getByRole('status')).toHaveTextContent('2 cars');
    expect(new URLSearchParams(location.search).get('make')).toBe('BMW,Volkswagen');
    expect(new URLSearchParams(location.search).get('colour')).toBe('Blue');
    expect(screen.getByRole('button', { name: 'Remove colour Blue filter' })).toBeInTheDocument();
    const makeIcon = within(sidebar).getByRole('button', { name: /^Make/ }).querySelector<HTMLImageElement>('img[data-filter-icon="make"]');
    expect(makeIcon).toHaveAttribute('src', '/brand/multi-choice-motors/filters/02-filter-make-car.svg');
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
    expect(within(screen.getByTestId('multi-stock-toolbar')).getByRole('status')).toHaveTextContent('5 cars');
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
    const sharedDisplay = signature();
    expect(screen.getByTestId('multi-stock-toolbar')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Make' })).not.toBeInTheDocument();
    cleanup();
    document.querySelectorAll('[data-stock-photo-test]').forEach(element => element.remove());
    stockPhotoTenant('https://multichoicemotors.co.uk');
    renderHome(true);
    expect(screen.getByTestId('multi-stock-toolbar')).toBeInTheDocument();
    expect(signature()).toEqual(sharedDisplay);
    // Every dealer retains the approved stock image and card geometry.
    expect(document.querySelector('.vehicle-card-photo [data-testid="button-save-bmw-1-series"]')).toBeNull();
  });
});
