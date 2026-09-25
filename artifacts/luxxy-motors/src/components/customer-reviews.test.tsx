import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ presentation: {} as Record<string, unknown> }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: state }) }));
import { CustomerReviews } from './customer-reviews';
beforeEach(() => { state.presentation = {}; });
it('does not show an empty or disabled reviews section', () => {
  const { rerender } = render(<CustomerReviews />);
  expect(screen.queryByRole('region')).toBeNull();
  state.presentation = { reviewsEnabled: true, reviews: [] };
  rerender(<CustomerReviews />);
  expect(screen.queryByRole('region')).toBeNull();
});
it('preserves long reviews with expansion and no fabricated aggregate or link', () => {
  const review = 'Excellent service. '.repeat(20);
  state.presentation = { reviewsEnabled: true, reviews: [{ rating: 4, review, name: 'Customer', date: 'September 2026', source: 'Google', verified: true, invited: true }] };
  render(<CustomerReviews />);
  expect(screen.getByRole('img', { name: '4 out of 5 stars' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Read full review' }));
  expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.getByText('Verified review')).toBeInTheDocument();
  expect(screen.getByText('Invited')).toBeInTheDocument();
  expect(screen.getByText(review.trim())).toBeInTheDocument();
});
