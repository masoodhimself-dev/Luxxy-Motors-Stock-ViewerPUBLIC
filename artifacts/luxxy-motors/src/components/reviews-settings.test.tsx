import { describe, expect, it } from 'vitest';
import { parseReviews } from './reviews-settings';
describe('review import', () => {
  const review = { rating: 5, review: 'Helpful team.', name: 'J.', date: 'September 2026', source: 'Google' };
  it('preserves original wording and allows clearing', () => {
    expect(parseReviews(JSON.stringify([review]))).toEqual([review]);
    expect(parseReviews('[]')).toEqual([]);
  });
  it('rejects malformed, incomplete or out-of-range reviews', () => {
    expect(() => parseReviews('{')).toThrow();
    expect(() => parseReviews('{}')).toThrow();
    expect(() => parseReviews(JSON.stringify([{ ...review, rating: 6 }]))).toThrow();
    expect(() => parseReviews(JSON.stringify([{ ...review, review: ' ' }]))).toThrow();
  });
});
