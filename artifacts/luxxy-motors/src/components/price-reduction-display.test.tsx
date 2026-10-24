import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Car } from '@/lib/stock-context';
import { PriceReduction } from './price-reduction';

const detectedAt = '2026-10-01T23:30:00Z';
const car = {
  price: 3975, currency: 'GBP',
  sourceExtras: { websitePriceReduction: { previousPrice: 4175, currentPrice: 3975, detectedAt } },
} satisfies Pick<Car, 'price' | 'currency' | 'sourceExtras'>;

afterEach(() => vi.useRealTimers());

it('keeps the previous price and saving readable without adding a date to stock cards', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
  render(<PriceReduction car={car} />);
  expect(screen.getByLabelText('Recorded price reduction')).toHaveTextContent('Price reducedWas £4,175Save £200');
  expect(screen.getByText('£4,175').tagName).toBe('S');
  expect(screen.queryByText(/Price change recorded/)).not.toBeInTheDocument();
});

it('shows the recorded date in UK time on the vehicle detail without inventing a reason for the reduction', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
  render(<PriceReduction car={car} showRecordedDate />);
  expect(screen.getByText(/Price change recorded/)).toHaveTextContent('Price change recorded 2 Oct 2026');
  expect(screen.getByText('2 Oct 2026')).toHaveAttribute('dateTime', detectedAt);
});

it('hides expired or superseded reductions completely', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
  const { rerender } = render(<PriceReduction car={car} showRecordedDate />);
  expect(screen.queryByLabelText('Recorded price reduction')).not.toBeInTheDocument();
  vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
  rerender(<PriceReduction car={{...car, price: 3900}} />);
  expect(screen.queryByLabelText('Recorded price reduction')).not.toBeInTheDocument();
});
