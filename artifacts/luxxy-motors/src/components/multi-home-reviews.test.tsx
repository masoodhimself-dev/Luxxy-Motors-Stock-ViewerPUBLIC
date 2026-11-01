import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MultiHomeReviews } from './multi-home-reviews';
import type { multiChoiceReviews } from '@/lib/multi-choice-home-sections';

type Review = ReturnType<typeof multiChoiceReviews>[number];
const review = (name: string, extra: Partial<Review> = {}): Review => ({ name, rating: 4, review: 'Helpful answers and a straightforward visit.', date: 'October 2026', source: 'Published feedback', ...extra });
const reviews = [review('Alex'), review('Sam'), review('Jo')];
const longText = 'A customer’s own detailed account of their visit. '.repeat(70);
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.tagName === 'BLOCKQUOTE' ? 100 : 0; });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.tagName === 'BLOCKQUOTE' ? (this.textContent!.length > 160 ? 250 : 60) : 0; });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Model a one-card viewport so actual scroll position drives arrows and dots. */
function carousel() {
  const rail = screen.getByRole('group', { name: 'Customer reviews; scroll for more' });
  const cards = within(rail).getAllByRole('figure');
  Object.defineProperties(rail, {
    clientWidth: { configurable: true, value: 250 },
    scrollWidth: { configurable: true, value: cards.length * 266 - 16 },
  });
  vi.spyOn(rail, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, width: 250 } as DOMRect));
  cards.forEach((card, index) => vi.spyOn(card, 'getBoundingClientRect').mockImplementation(() => ({ left: index * 266 - rail.scrollLeft, width: 250 } as DOMRect)));
  const scroll = vi.fn((options: ScrollToOptions) => {
    rail.scrollLeft = Math.max(0, Math.min(rail.scrollWidth - rail.clientWidth, options.left ?? 0));
    fireEvent.scroll(rail);
  });
  Object.defineProperty(rail, 'scrollTo', { configurable: true, value: scroll });
  fireEvent.resize(window);
  return { rail, scroll };
}

it('shows the supplied heading, author, source and actual rating without an invented aggregate or provider branding', () => {
  render(<MultiHomeReviews heading="Feedback from our customers" reviews={[review('Alex', { rating: 3 })]} />);
  expect(screen.getByRole('region', { name: 'Feedback from our customers' })).toHaveAttribute('id', 'reviews');
  expect(screen.getByRole('heading', { level: 2, name: 'Feedback from our customers' })).toHaveAttribute('id', 'mh-reviews-heading');
  const card = screen.getByRole('figure', { name: 'Review by Alex' });
  const rating = within(card).getByRole('img', { name: '3 out of 5 stars' });
  expect(rating.querySelectorAll('svg[fill="currentColor"]')).toHaveLength(3);
  expect(rating.querySelectorAll('svg[fill="none"]')).toHaveLength(2);
  expect(within(card).getByText('Published feedback · October 2026')).toBeInTheDocument();
  expect(screen.queryByText(/Trustpilot|Google verified|average|out of 5 based/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Read more' })).not.toBeInTheDocument();
});

it('keeps the entire long review and lets a reader expand and collapse its five-line preview explicitly', () => {
  render(<MultiHomeReviews heading="Customer reviews" reviews={[review('Alex', { review: longText })]} />);
  const card = screen.getByRole('figure', { name: 'Review by Alex' }), quote = card.querySelector('blockquote')!;
  expect(quote.textContent).toBe(longText);
  const more = within(card).getByRole('button', { name: 'Read more' });
  expect(more).toHaveAttribute('aria-expanded', 'false'); expect(more).toHaveAttribute('aria-controls', quote.id);
  expect(quote).not.toHaveAttribute('data-expanded');
  fireEvent.click(more);
  expect(quote).toHaveAttribute('data-expanded', 'true');
  const less = within(card).getByRole('button', { name: 'Show less' }); expect(less).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(less); expect(quote).not.toHaveAttribute('data-expanded'); expect(quote.textContent).toBe(longText);
});

it('rechecks the preview after a review changes rather than retaining an earlier expanded account', () => {
  const view = render(<MultiHomeReviews heading="Customer reviews" reviews={[review('Alex', { review: longText })]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Read more' }));
  view.rerender(<MultiHomeReviews heading="Customer reviews" reviews={[review('Alex', { review: 'The customer updated their account.' })]} />);
  expect(screen.queryByRole('button', { name: 'Show less' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Read more' })).not.toBeInTheDocument();
  expect(screen.getByText('The customer updated their account.')).not.toHaveAttribute('data-expanded');
});

it('moves through real reviews with arrows, dots and keyboard while keeping controls tied to the viewport', () => {
  render(<MultiHomeReviews heading="Customer reviews" reviews={reviews} />);
  const { rail, scroll } = carousel();
  const previous = screen.getByRole('button', { name: 'Previous customer reviews' }), next = screen.getByRole('button', { name: 'Next customer reviews' });
  expect(previous).toBeDisabled(); expect(next).not.toBeDisabled(); expect(next).toHaveAttribute('aria-controls', rail.id);
  fireEvent.click(next); expect(scroll).toHaveBeenLastCalledWith({ left: 266, behavior: 'smooth' });
  expect(screen.getByRole('button', { name: 'Show review 2 by Sam' })).toHaveAttribute('aria-pressed', 'true');
  expect(previous).not.toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Show review 3 by Jo' })); expect(next).toBeDisabled();
  fireEvent.keyDown(rail, { key: 'Home' }); expect(previous).toBeDisabled();
  fireEvent.keyDown(rail, { key: 'End' }); expect(next).toBeDisabled();
  fireEvent.keyDown(rail, { key: 'ArrowLeft' }); expect(screen.getByRole('button', { name: 'Show review 2 by Sam' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.keyDown(rail, { key: 'ArrowRight' }); expect(next).toBeDisabled();
});

it('uses immediate scrolling when reduced motion is preferred and does not intercept a review button’s keys', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  render(<MultiHomeReviews heading="Customer reviews" reviews={[review('Alex', { review: longText }), ...reviews.slice(1)]} />);
  const { scroll } = carousel();
  fireEvent.click(screen.getByRole('button', { name: 'Next customer reviews' }));
  expect(scroll).toHaveBeenLastCalledWith({ left: 266, behavior: 'auto' });
  const before = scroll.mock.calls.length;
  fireEvent.keyDown(screen.getByRole('button', { name: 'Read more' }), { key: 'End' });
  expect(scroll).toHaveBeenCalledTimes(before);
});

it('can show only a safe existing reviews link when the dealership has not supplied individual reviews', () => {
  render(<MultiHomeReviews heading="Read our customer feedback" reviews={[]} reviewsUrl="https://reviews.example.test/dealer" />);
  expect(screen.getByRole('link', { name: 'Read customer reviews' })).toHaveAttribute('href', 'https://reviews.example.test/dealer');
  expect(screen.queryByRole('figure')).not.toBeInTheDocument(); expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it.each(['javascript:alert(1)', 'data:text/html,example', 'https://user:secret@example.test/reviews', '/unconfigured-review-page'])('never exposes the unsafe source URL %s', (reviewsUrl) => {
  render(<MultiHomeReviews heading="Customer reviews" reviews={[]} reviewsUrl={reviewsUrl} />);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it('renders customer text as text and supports the maximum review inventory without fabricating reviews', () => {
  const text = '<img src=x onerror=alert(1)> A customer’s exact wording.';
  render(<MultiHomeReviews heading="Customer reviews" reviews={Array.from({ length: 100 }, (_, index) => review(`Customer ${index + 1}`, { review: text }))} />);
  expect(screen.getAllByRole('figure')).toHaveLength(100);
  expect(screen.getAllByText(text)).toHaveLength(100);
  expect(document.querySelector('figure img')).toBeNull();
  expect(screen.getByRole('button', { name: 'Show review 100 by Customer 100' })).toBeInTheDocument();
});
