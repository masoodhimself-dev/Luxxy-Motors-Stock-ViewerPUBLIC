import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import Contact from './contact';
const state = vi.hoisted(() => ({ sample: false, loading: false, error: false }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: { ...dealerConfig, address: { street: state.sample ? '12 Example Road' : 'Rear of 176 Rayners Lane', city: 'London', postcode: 'HA2 8LY' } }, isLoading: state.loading, isError: state.error }) }));
vi.mock('@/hooks/use-page-meta', () => ({ usePageMeta: vi.fn() }));
beforeEach(() => { state.sample = false; state.loading = false; state.error = false; });
it('offers directions and copy address from the saved real address even with no map link', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<Contact />);
  expect(screen.getByRole('link', { name: 'Get directions' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=Rear%20of%20176%20Rayners%20Lane%2C%20London%2C%20HA2%208LY');
  fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Address copied');
  expect(writeText).toHaveBeenCalledWith('Rear of 176 Rayners Lane, London, HA2 8LY');
});
it.each(['sample', 'loading', 'error'] as const)('does not offer navigation to unconfirmed address (%s)', key => {
  state[key] = true;
  render(<Contact />);
  expect(screen.queryByRole('link', { name: 'Get directions' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Copy address' })).not.toBeInTheDocument();
});
