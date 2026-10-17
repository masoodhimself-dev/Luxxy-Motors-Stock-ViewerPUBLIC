import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig, type DealerConfig } from '@/config/dealer';
import Contact from './contact';

const state = vi.hoisted(() => ({ settings: {} as DealerConfig }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: state.settings, isLoading: false, isError: false }) }));
vi.mock('@/hooks/use-page-meta', () => ({ usePageMeta: vi.fn() }));

beforeEach(() => {
  state.settings = structuredClone(dealerConfig);
  state.settings.identity.name = 'Fictional Motors';
  state.settings.presentation = { visitInstructions: '', parkingInstructions: '' };
});

it('opens the enquiry page directly without a duplicate form at the foot of contact', () => {
  render(<Contact />);
  expect(screen.getByRole('link', { name: 'Send an enquiry' })).toHaveAttribute('href', '/enquire?type=general');
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Before your visit' })).not.toBeInTheDocument();
});

it('only shows the visit instructions actually supplied by the dealership', () => {
  state.settings.presentation!.parkingInstructions = 'Visitor parking is beside the blue gate.';
  render(<Contact />);
  const instructions = screen.getByRole('region', { name: 'Before your visit' });
  expect(instructions).toHaveTextContent('Visitor parking is beside the blue gate.');
  expect(instructions).not.toHaveTextContent('Contact us to confirm the car is available');
  expect(screen.queryByText('Ask us about parking, the entrance and any access requirements when arranging your visit.')).not.toBeInTheDocument();
});
