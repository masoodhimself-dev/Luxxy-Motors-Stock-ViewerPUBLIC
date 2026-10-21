import { describe, expect, it } from 'vitest';
import { parseReviews } from './reviews-settings';
describe('review import', () => {
  const review = { rating: 5, review: 'Helpful team.', name: 'J.', date: 'September 2026', source: 'Google', verified: true, invited: true };
  it('preserves original wording and allows clearing', () => {
    expect(parseReviews(JSON.stringify([review]))).toEqual([review]);
    expect(parseReviews('[]')).toEqual([]);
  });
  it('rejects malformed, incomplete or out-of-range reviews', () => {
    expect(() => parseReviews('{')).toThrow();
    expect(() => parseReviews('{}')).toThrow();
    expect(() => parseReviews(JSON.stringify([{ ...review, verified: 'yes' }]))).toThrow();
    expect(() => parseReviews(JSON.stringify([{ ...review, rating: 6 }]))).toThrow();
    expect(() => parseReviews(JSON.stringify([{ ...review, review: ' ' }]))).toThrow();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { DealerPresentation } from '@workspace/api-client-react';
import { ReviewsSettings } from './reviews-settings';
function ReviewEditor({ initial }: {initial: DealerPresentation}) {
  const [value, setValue] = useState(initial);
  return <><ReviewsSettings value={value} onChange={setValue} /><output data-testid="review-data">{JSON.stringify(value)}</output></>;
}
it('preserves sourced reviews until edited and does not verify the edited copy', () => {
  const initial = { reviews: [{rating:5 as const,review:'Helpful team.',name:'J.',date:'October 2026',source:'Google',verified:true,invited:true}],reviewsEnabled:true };
  render(<ReviewEditor initial={initial} />);
  expect(JSON.parse(screen.getByTestId('review-data').textContent!).reviews[0]).toEqual(initial.reviews[0]);
  fireEvent.click(screen.getByText('J.'));
  fireEvent.change(screen.getByLabelText('Review 1 text'),{target:{value:'Original wording with a corrected typo.'}});
  const value = JSON.parse(screen.getByTestId('review-data').textContent!);
  expect(value.reviews[0]).toEqual({...initial.reviews[0],review:'Original wording with a corrected typo.',verified:false,invited:false});
  expect(screen.queryByText(/Source markers:/)).not.toBeInTheDocument();
});
it('adds and removes reviews in the shared draft without marking new reviews verified', () => {
  render(<ReviewEditor initial={{reviews:[],reviewsEnabled:false}} />);
  fireEvent.click(screen.getByRole('button',{name:'Add review'}));
  fireEvent.change(screen.getByLabelText('Review 1 customer name'),{target:{value:'A. Customer'}});
  fireEvent.change(screen.getByLabelText('Review 1 source'),{target:{value:'Google'}});
  fireEvent.change(screen.getByLabelText('Review 1 text'),{target:{value:'Genuine original review.'}});
  const added = JSON.parse(screen.getByTestId('review-data').textContent!);
  expect(added.reviews[0]).toMatchObject({name:'A. Customer',source:'Google',review:'Genuine original review.'});
  expect(added.reviews[0].verified).toBeUndefined();
  fireEvent.click(screen.getByRole('button',{name:'Remove review 1'}));
  expect(JSON.parse(screen.getByTestId('review-data').textContent!).reviews).toEqual([]);
});
