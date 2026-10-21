import { useEffect, useState } from 'react';
import type { DealerPresentation } from '@workspace/api-client-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { NativeSelect } from './ui/native-select';
import { Textarea } from './ui/textarea';
import { Plus, Trash2 } from '@/components/icons';

type Review = NonNullable<DealerPresentation['reviews']>[number];
export function parseReviews(text: string): Review[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data) || data.length > 100) throw new Error('Provide a JSON array with up to 100 reviews.');
  return data.map((item, index) => {
    if (!item || !Number.isInteger(item.rating) || item.rating < 1 || item.rating > 5 ||
      typeof item.review !== 'string' || !item.review.trim() || item.review.length > 5000 ||
      typeof item.name !== 'string' || !item.name.trim() || item.name.length > 150 ||
      typeof item.date !== 'string' || item.date.length > 100 ||
      typeof item.source !== 'string' || item.source.length > 100 ||
      (item.verified !== undefined && typeof item.verified !== 'boolean') || (item.invited !== undefined && typeof item.invited !== 'boolean')) throw new Error(`Review ${index + 1}: supply a rating from 1–5, review text, name, date and source.`);
    return { rating: item.rating, review: item.review, name: item.name, date: item.date, source: item.source, ...(item.verified !== undefined ? { verified: item.verified } : {}), ...(item.invited !== undefined ? { invited: item.invited } : {}) };
  });
}
export function ReviewsSettings({ value, onChange, allowImport = false }: { value?: DealerPresentation; onChange: (value: DealerPresentation) => void; allowImport?: boolean }) {
  const reviews = value?.reviews ?? [];
  const saved = JSON.stringify(reviews, null, 2);
  const [text, setText] = useState(saved);
  const [message, setMessage] = useState('');
  useEffect(() => { setText(saved); }, [saved]);
  const editReview = (index: number, patch: Partial<Review>) => onChange({ ...value, reviews: reviews.map((review, at) => {
    if (at !== index || Object.entries(patch).every(([key, next]) => review[key as keyof Review] === next)) return review;
    // A verification marker belongs to the original sourced review, not edited copy.
    return { ...review, ...patch, ...(review.verified || review.invited ? { verified: false, invited: false } : {}) };
  }) });
  return <div className="settings-reviews-import space-y-3 border-t border-border pt-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Customer reviews</h3><Button type="button" variant="outline" disabled={reviews.length >= 100} onClick={() => onChange({ ...value, reviews: [...reviews, { rating: 5, review: '', name: '', date: '', source: '' }] })}><Plus className="mr-2 h-4 w-4" />Add review</Button></div>
    <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={value?.reviewsEnabled === true} onChange={event => onChange({ ...value, reviewsEnabled: event.target.checked })} />Show customer reviews on the homepage</label>
    <p className="text-sm text-muted-foreground">Use genuine reviews and keep their original wording and source. Changes join the shared draft and stay private until published.</p>
    {!reviews.length && <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">No reviews added. The review section will stay hidden.</p>}
    <div className="space-y-4">{reviews.map((review, index) => <details key={index} className="settings-review-editor rounded-md border border-border bg-background p-4" open={!review.name || !review.review ? true : undefined}>
      <summary className="cursor-pointer py-2 font-medium">{review.name || `New review ${index + 1}`}<span className="ml-2 text-xs font-normal text-muted-foreground">{review.rating}/5{review.source ? ` · ${review.source}` : ''}</span></summary>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">Customer name<Input className="mt-2" aria-label={`Review ${index + 1} customer name`} maxLength={150} value={review.name} onChange={event => editReview(index, { name: event.target.value })} /></label>
        <label className="text-sm font-medium">Rating<NativeSelect className="mt-2" aria-label={`Review ${index + 1} rating`} value={review.rating} onChange={event => editReview(index, { rating: +event.target.value as Review['rating'] })}>{[5, 4, 3, 2, 1].map(rating => <option key={rating} value={rating}>{rating} {rating === 1 ? 'star' : 'stars'}</option>)}</NativeSelect></label>
        <label className="text-sm font-medium">Original source<Input className="mt-2" aria-label={`Review ${index + 1} source`} maxLength={100} placeholder="For example: Google" value={review.source} onChange={event => editReview(index, { source: event.target.value })} /></label>
        <label className="text-sm font-medium">Date as shown on source<Input className="mt-2" aria-label={`Review ${index + 1} date`} maxLength={100} placeholder="For example: October 2026" value={review.date} onChange={event => editReview(index, { date: event.target.value })} /></label>
        <label className="text-sm font-medium sm:col-span-2">Original review<Textarea className="mt-2" aria-label={`Review ${index + 1} text`} maxLength={5000} rows={4} value={review.review} onChange={event => editReview(index, { review: event.target.value })} /></label>
      </div>
      {(review.verified || review.invited) && <p className="mt-3 text-xs text-muted-foreground">Source markers: {[review.verified ? 'verified' : '', review.invited ? 'invited' : ''].filter(Boolean).join(', ')}. Editing this review removes these markers; check the original source before publishing.</p>}
      <div className="mt-4 rounded-md border-l-2 border-border bg-secondary/10 p-3"><p aria-label={`${review.rating} stars`} className="text-primary">{'★'.repeat(review.rating)}</p><blockquote className="mt-2 text-sm leading-6">{review.review || 'Your review preview will appear here.'}</blockquote><p className="mt-2 text-xs text-muted-foreground">{[review.name, review.date, review.source].filter(Boolean).join(' · ')}</p></div>
      <Button type="button" variant="ghost" className="mt-3" onClick={() => onChange({ ...value, reviews: reviews.filter((_, at) => at !== index) })} aria-label={`Remove review ${index + 1}`}><Trash2 className="mr-2 h-4 w-4" />Remove review</Button>
    </details>)}</div>
    {allowImport && <details className="border-t border-border pt-3"><summary className="cursor-pointer py-3 text-sm font-medium">Advanced: import reviews JSON</summary>
      <label htmlFor="customer-reviews-json" className="mt-3 block text-sm font-medium">Reviews JSON</label>
      <p id="reviews-json-help" className="settings-import-help mt-2 text-sm text-muted-foreground">Replaces the review list in this draft. Provide rating, review, name, date and source. Preserve verified and invited flags only when confirmed by the source. Apply the import, then review and publish. Use [] to remove all reviews.</p>
      <Textarea id="customer-reviews-json" aria-describedby="reviews-json-help" rows={8} value={text} onChange={event => { setText(event.target.value); setMessage(''); }} className="mt-3 font-mono text-xs" />
      <div className="settings-import-actions mt-3"><Button type="button" variant="outline" onClick={() => { try { const next = parseReviews(text); onChange({ ...value, reviews: next }); setMessage(`${next.length} reviews applied to draft. Review and publish when ready.`); } catch (error) { setMessage(error instanceof SyntaxError ? 'Invalid JSON. Check quotation marks and commas.' : (error as Error).message); } }}>Apply reviews JSON</Button>{message && <p role="status" className="settings-import-status text-sm">{message}</p>}</div>
    </details>}
  </div>;
}
