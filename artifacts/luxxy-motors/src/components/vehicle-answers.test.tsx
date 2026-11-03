import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Car } from '@/lib/stock-context';

const state = vi.hoisted(() => ({
  aiHook: vi.fn(),
  dealerAnswers: [] as { id: string; question: string; answer: string; source: string }[],
}));
vi.mock('@/lib/ai-assistance', () => ({ useAiAssistance: state.aiHook }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: {}, isLoading: false, isError: false }) }));
vi.mock('@/lib/dealer-answers', () => ({ withDealerAnswers: (answers: unknown[]) => [...answers, ...state.dealerAnswers] }));
import { VehicleAnswers } from './vehicle-answers';

const vehicle: Car = {
  id: 'volvo', make: 'Volvo', model: 'V90', year: 2021, mileage: 92000, price: 15500, currency: 'GBP',
  advertId: 'volvo', title: null, variant: null, trim: null, priceType: null, mileageText: null,
  registration: null, registrationBand: null, plate: null, vrm: null, vrmVerified: null,
  fuel: null, transmission: null, bodyType: null, engineSize: null, engineCC: null, doors: null, seats: null, colour: null,
  emissionClass: null, drivetrain: null, owners: null, writeOffCategory: null, advertUrl: null,
  dealerName: null, dealerLocation: null, imageCount: null, heroImage: null, images: [], specifications: null, sourceExtras: null,
  description: 'One owner from new. Full service history. Two keys. Heated seats. MOT until July 2027. Six months warranty included. Nationwide delivery available.',
};
const askTeam = vi.fn();
beforeEach(() => { state.aiHook.mockReset(); state.dealerAnswers = []; askTeam.mockReset(); });

it('shows a short inline section with collapsed distinct questions and no public AI controls', () => {
  render(<VehicleAnswers car={vehicle} onAskTeam={askTeam} />);
  const region = screen.getByRole('region', { name: 'Questions about this car' });
  expect(region).toBeVisible();
  const triggers = region.querySelectorAll('[aria-expanded]');
  expect(triggers.length).toBeLessThanOrEqual(5);
  expect(triggers.length).toBeGreaterThan(0);
  for (const trigger of triggers) expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByText(/Ask AI|requests left/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'What is the ownership history?' })).not.toBeInTheDocument();
  expect(state.aiHook).not.toHaveBeenCalled();
});

it('answers from the supplied car and only opens the enquiry when the customer chooses to', () => {
  render(<VehicleAnswers car={vehicle} onAskTeam={askTeam} />);
  fireEvent.click(screen.getByRole('button', { name: 'How many keys come with this car?' }));
  expect(screen.getByText('It comes with two keys.')).toBeVisible();
  expect(askTeam).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Message the showroom' }));
  expect(askTeam).toHaveBeenCalledOnce();
  expect(askTeam).toHaveBeenCalledWith();
  expect(state.aiHook).not.toHaveBeenCalled();
});

it('does not repeat warranty when the configured inclusions already cover it', () => {
  state.dealerAnswers = [{ id: 'included', question: 'What’s included with this car?', answer: '6-month warranty included', source: 'dealer' }];
  render(<VehicleAnswers car={vehicle} onAskTeam={askTeam} />);
  expect(screen.getByRole('button', { name: 'What’s included with this car?' })).toBeVisible();
  expect(screen.queryByRole('button', { name: /warranty/i })).not.toBeInTheDocument();
});

it('resets an open answer and replaces the facts when the selected car changes', () => {
  const view = render(<VehicleAnswers car={vehicle} onAskTeam={askTeam} />);
  fireEvent.click(screen.getByRole('button', { name: 'How many keys come with this car?' }));
  view.rerender(<VehicleAnswers car={{ ...vehicle, id: 'ford', make: 'Ford', model: 'Focus', description: 'One remote key is supplied.' }} onAskTeam={askTeam} />);
  expect(screen.getByRole('button', { name: 'How many keys come with this car?' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('It comes with two keys.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'How many keys come with this car?' }));
  expect(screen.getByText('It comes with one remote key.')).toBeVisible();
});
