import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FindMyCar from '@/pages/find-my-car';

const { stockState, makeCar, makeStock } = vi.hoisted(() => {
  const baseCar = {
    id: '',
    advertId: '',
    title: '',
    variant: null,
    make: '',
    model: '',
    trim: null,
    year: 2022,
    price: 30000,
    priceType: 'fixed',
    currency: 'GBP',
    mileage: 60000,
    mileageText: null,
    registration: null,
    registrationBand: null,
    plate: null,
    vrm: null,
    vrmVerified: null,
    fuel: 'Diesel',
    transmission: 'Manual',
    bodyType: 'Saloon',
    engineSize: null,
    engineCC: null,
    doors: 4,
    seats: 4,
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

  const makeCar = (overrides: Record<string, unknown>) => ({ ...baseCar, ...overrides });
  const makeStock = (cars: ReturnType<typeof makeCar>[]) => ({
    schemaVersion: 1 as const,
    dealerName: 'Test Motors',
    dealerLocation: 'Test Town',
    count: cars.length,
    scrapedAt: null,
    cars,
  });

  return {
    makeCar,
    makeStock,
    stockState: {
      stock: makeStock([]),
    },
  };
});

vi.mock('@/lib/stock-context', () => ({
  useStock: () => ({ stock: stockState.stock, isLoading: false, error: null }),
}));

vi.mock('@/lib/dealer-settings-context', () => ({
  useDealerSettings: () => ({
    settings: {
      contact: { phone: '02084729917', whatsapp: '+447388831790' },
      identity: { name: 'Test Motors' },
      bookViewing: { ctaLabel: 'Book a Viewing' },
    },
  }),
}));

vi.mock('@/components/saved-car-controls', () => ({
  SaveCarButton: () => null,
  CompareCarButton: () => null,
}));

function renderFindMyCar() {
  return render(<FindMyCar />);
}

function choose(value: string) {
  fireEvent.click(screen.getByTestId(`option-${value}`));
}

function clickNext() {
  fireEvent.click(screen.getByTestId('button-next-question'));
}

function completeQuiz(answers: {
  budget: string;
  bodyType: string;
  fuel: string;
  transmission: string;
  use: string;
}) {
  choose(answers.budget);
  clickNext();
  choose(answers.bodyType);
  clickNext();
  choose(answers.fuel);
  clickNext();
  choose(answers.transmission);
  clickNext();
  choose(answers.use);
  fireEvent.click(screen.getByTestId('button-see-matches'));
}

function recommendationIds() {
  return screen
    .getByTestId('list-recommendations')
    .querySelectorAll('[data-testid^="recommendation-"]');
}

beforeEach(() => {
  stockState.stock = makeStock([]);
  window.scrollTo = vi.fn();
});

describe('Find My Car recommendation scoring', () => {
  it.each([
    {
      label: 'budget',
      target: { price: 9000 },
      other: {},
      answers: { budget: 'under-10000', bodyType: 'hatchback', fuel: 'petrol', transmission: 'automatic', use: 'city' },
      expectedScore: '4 points from your brief',
    },
    {
      label: 'body shape',
      target: { bodyType: 'SUV', price: 30000, mileage: 60000 },
      other: {},
      answers: { budget: 'under-10000', bodyType: 'suv', fuel: 'petrol', transmission: 'automatic', use: 'city' },
      expectedScore: '3 points from your brief',
    },
    {
      label: 'fuel',
      target: { fuel: 'Petrol' },
      other: {},
      answers: { budget: 'under-10000', bodyType: 'hatchback', fuel: 'petrol', transmission: 'automatic', use: 'city' },
      expectedScore: '2 points from your brief',
    },
    {
      label: 'gearbox',
      target: { transmission: 'Automatic' },
      other: {},
      answers: { budget: 'under-10000', bodyType: 'hatchback', fuel: 'petrol', transmission: 'automatic', use: 'city' },
      expectedScore: '2 points from your brief',
    },
    {
      label: 'use case',
      target: { bodyType: 'SUV', fuel: 'Diesel', transmission: 'Manual' },
      other: { bodyType: 'Saloon', fuel: 'Diesel', transmission: 'Manual', seats: 2 },
      answers: { budget: 'under-10000', bodyType: 'hatchback', fuel: 'petrol', transmission: 'automatic', use: 'leisure' },
      expectedScore: '2 points from your brief',
    },
  ])('scores a live-stock car for the $label answer', ({ target, other, answers, expectedScore }) => {
    const targetCar = makeCar({ id: 'target', advertId: 'target', title: 'Target car', ...target });
    const otherCar = makeCar({ id: 'other', advertId: 'other', title: 'Other car', ...other });
    stockState.stock = makeStock([otherCar, targetCar]);

    renderFindMyCar();
    completeQuiz(answers);

    expect(screen.getByTestId('recommendation-target')).toHaveTextContent(expectedScore);
    expect(recommendationIds()[0]).toHaveAttribute('data-testid', 'recommendation-target');
  });

  it('combines all five answers and keeps recommendations inside live stock', () => {
    const exactCar = makeCar({
      id: 'exact-fit',
      advertId: 'exact-fit',
      title: 'Exact fit',
      price: 18000,
      bodyType: 'SUV',
      fuel: 'Hybrid',
      transmission: 'Automatic',
      seats: 5,
      mileage: 32000,
    });
    const nearCar = makeCar({
      id: 'near-fit',
      advertId: 'near-fit',
      title: 'Near fit',
      price: 18000,
      bodyType: 'Hatchback',
      fuel: 'Petrol',
      transmission: 'Manual',
    });
    stockState.stock = makeStock([exactCar, nearCar]);

    renderFindMyCar();
    completeQuiz({
      budget: '15000-22000',
      bodyType: 'suv',
      fuel: 'hybrid',
      transmission: 'automatic',
      use: 'family',
    });

    const exactRecommendation = screen.getByTestId('recommendation-exact-fit');
    expect(exactRecommendation).toHaveTextContent('13 points from your brief');
    expect(recommendationIds()).toHaveLength(2);
    expect(screen.queryByTestId('recommendation-invented-car')).not.toBeInTheDocument();
    expect(within(exactRecommendation).getByRole('link', { name: 'Exact fit' })).toHaveAttribute('href', '/vehicle/exact-fit');
  });
});

describe('Find My Car quiz state', () => {
  it('moves forward and back while preserving the selected answer', () => {
    stockState.stock = makeStock([makeCar({ id: 'one', advertId: 'one', title: 'One' })]);
    renderFindMyCar();

    choose('under-10000');
    clickNext();
    expect(screen.getByRole('heading', { name: 'What shape suits your life?' })).toBeInTheDocument();
    expect(screen.getByText('1 of 5 answered')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('button-back-question'));
    expect(screen.getByRole('heading', { name: 'What would feel comfortable?' })).toBeInTheDocument();
    expect(screen.getByTestId('option-under-10000')).toHaveAttribute('aria-pressed', 'true');
  });

  it('restarts an in-progress quiz from the first unanswered state', () => {
    stockState.stock = makeStock([makeCar({ id: 'one', advertId: 'one', title: 'One' })]);
    renderFindMyCar();

    choose('under-10000');
    clickNext();
    choose('suv');
    fireEvent.click(screen.getByTestId('button-restart-quiz'));

    expect(screen.getByRole('heading', { name: 'What would feel comfortable?' })).toBeInTheDocument();
    expect(screen.getByText('0 of 5 answered')).toBeInTheDocument();
    expect(screen.getByTestId('option-under-10000')).toHaveAttribute('aria-pressed', 'false');
  });

  it('lets a buyer change answers after seeing the shortlist', () => {
    stockState.stock = makeStock([makeCar({ id: 'one', advertId: 'one', title: 'One' })]);
    renderFindMyCar();
    completeQuiz({
      budget: 'under-10000',
      bodyType: 'hatchback',
      fuel: 'petrol',
      transmission: 'manual',
      use: 'city',
    });

    fireEvent.click(screen.getByTestId('button-change-answers'));

    expect(screen.getByRole('heading', { name: 'What would feel comfortable?' })).toBeInTheDocument();
    expect(screen.getByTestId('option-under-10000')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('5 of 5 answered')).toBeInTheDocument();
  });

  it('explains when live stock is empty instead of inventing recommendations', () => {
    renderFindMyCar();

    expect(screen.getByText(/There are no cars available to match/)).toBeInTheDocument();
    expect(screen.queryByTestId('list-recommendations')).not.toBeInTheDocument();
  });

  it('shows the closest live cars when no perfect match exists', () => {
    stockState.stock = makeStock([
      makeCar({
        id: 'closest',
        advertId: 'closest',
        title: 'Closest live car',
        price: 25000,
        bodyType: 'Saloon',
        fuel: 'Diesel',
        transmission: 'Manual',
        mileage: 90000,
        seats: 4,
      }),
    ]);
    renderFindMyCar();
    completeQuiz({
      budget: 'under-10000',
      bodyType: 'coupe',
      fuel: 'hybrid',
      transmission: 'automatic',
      use: 'city',
    });

    expect(screen.getByTestId('state-no-perfect-match')).toBeInTheDocument();
    expect(screen.getByTestId('text-results-announcement')).toHaveTextContent(/not a perfect match/i);
    expect(screen.getByTestId('recommendation-closest')).toBeInTheDocument();
  });
});