import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import CarDetail from '@/pages/car-detail';
import { DEFAULT_PAGE_META } from '@/lib/page-meta';

const { stockFixture } = vi.hoisted(() => {
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
  useStock: () => ({ stock: stockFixture, isLoading: false, error: null }),
}));

vi.mock('@/components/car-card', () => ({
  CarCard: () => null,
}));

function renderVehicle(id: string) {
  window.history.pushState({}, '', `/vehicle/${id}`);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CarDetail />
    </QueryClientProvider>,
  );
}

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
