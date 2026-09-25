import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { SavedCarsProvider } from '@/lib/saved-cars-context';
import CarDetail from '@/pages/car-detail';
import { DEFAULT_PAGE_META } from '@/lib/page-meta';

const { stockFixture, stockStatus } = vi.hoisted(() => {
  const baseCar = {
    id: '',
    advertId: '',
    title: '',
    variant: null,
    make: '',
    model: '',
    trim: null,
    year: 2009,
    price: 4995,
    priceType: 'fixed',
    currency: 'GBP',
    mileage: 90000,
    mileageText: null,
    registration: null,
    registrationBand: null,
    plate: null,
    vrm: null,
    vrmVerified: null,
    fuel: 'Petrol',
    transmission: 'Manual',
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

  const car = (overrides: Record<string, unknown>) => ({ ...baseCar, ...overrides });

  return {
    stockStatus: { error: null as string | null },
    stockFixture: {
      schemaVersion: 1,
      dealerName: 'Test Motors',
      dealerLocation: 'Test Town',
      count: 2,
      scrapedAt: null,
      cars: [
        car({
          id: 'band-only',
          advertId: 'band-only',
          title: 'Ford Fiesta',
          make: 'Ford',
          model: 'Fiesta',
          // The feed copies the registration band into the registration column.
          registration: '2009 (59 REG)',
          registrationBand: '2009 (59 REG)',
        }),
        car({
          id: 'with-plate',
          advertId: 'with-plate',
          title: 'BMW 3 Series',
          make: 'BMW',
          model: '3 Series',
          year: 2024,
          plate: 'NV24 LNZ',
          registration: '2024 (24 REG)',
          registrationBand: '2024 (24 REG)',
          heroImage: 'https://cdn.example.com/bmw-front.jpg',
        }),
      ],
    },
  };
});

vi.mock('@/lib/stock-context', () => ({
  useStock: () => ({ stock: stockFixture, isLoading: false, error: stockStatus.error }),
}));

vi.mock('@/components/car-card', () => ({
  CarCard: () => null,
}));

function renderVehicle(id: string) {
  window.history.pushState({}, '', `/vehicle/${id}`);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SavedCarsProvider><CarDetail /></SavedCarsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => { stockStatus.error = null; });
afterEach(() => vi.unstubAllGlobals());

it('reports a temporary stock error instead of calling the vehicle missing', () => {
  stockStatus.error = 'Network unavailable';
  renderVehicle('with-plate');
  expect(screen.getByRole('heading', { name: 'Vehicle details could not be loaded' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /not found/i })).not.toBeInTheDocument();
});

it('shares the server-rendered vehicle preview link', async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', Object.create(window.navigator, { share: { value: share } }));
  renderVehicle('with-plate');
  fireEvent.click(screen.getByRole('button', { name: 'Share this vehicle' }));
  await waitFor(() => expect(share).toHaveBeenCalledWith({
    title: 'BMW 3 Series', url: `${window.location.origin}/share/vehicle/with-plate`,
  }));
});

describe('vehicle detail registration', () => {
  it('shows the registration band as ordinary metadata rather than a plate', () => {
    renderVehicle('band-only');

    expect(screen.getByTestId('text-registration-year')).toHaveTextContent('2009 (59 REG)');
    expect(screen.queryByTestId('plate-vehicle-band-only')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^UK registration/)).not.toBeInTheDocument();
  });

  it('shows plate styling only for a vehicle with a real plate', () => {
    renderVehicle('with-plate');

    const plate = screen.getByTestId('plate-vehicle-with-plate');
    expect(plate).toHaveTextContent('NV24 LNZ');
    expect(screen.getByTestId('text-registration-year')).toHaveTextContent('2024 (24 REG)');
  });
});

describe('vehicle detail link preview', () => {
  const tag = (selector: string) => document.head.querySelector(selector)?.getAttribute('content') ?? null;

  it('titles the page after the vehicle and previews its photograph', () => {
    renderVehicle('with-plate');

    expect(document.title).toBe('2024 BMW 3 Series — £4,995 | Luxxy Motors');
    expect(tag('meta[property="og:title"]')).toBe('2024 BMW 3 Series — £4,995 | Luxxy Motors');
    expect(tag('meta[property="og:image"]')).toBe('https://cdn.example.com/bmw-front.jpg');
    expect(tag('meta[name="description"]')).toContain('90,000 miles');
  });

  it('restores the showroom title and drops the car photo on leaving the page', () => {
    const view = renderVehicle('with-plate');
    view.unmount();

    expect(document.title).toBe(DEFAULT_PAGE_META.title);
    expect(tag('meta[property="og:image"]')).toBeNull();
  });
});

it('offers printing beneath the selected vehicle description', () => {
  renderVehicle('with-plate');
  const link = screen.getByRole('button', { name: 'Print vehicle details for BMW 3 Series' });
  expect(link).toHaveAttribute('type', 'button');
  expect(link.closest('section')).toHaveAttribute('aria-labelledby', 'vehicle-description-heading');
});
