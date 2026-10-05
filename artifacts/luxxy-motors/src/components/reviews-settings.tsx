import { useEffect, useState } from 'react';
import type { DealerPresentation } from '@workspace/api-client-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

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
export function ReviewsSettings({ value, onChange }: { value?: DealerPresentation; onChange: (value: DealerPresentation) => void }) {
  const saved = JSON.stringify(value?.reviews || [], null, 2);
  const [text, setText] = useState(saved);
  const [message, setMessage] = useState('');
  useEffect(() => { setText(saved); }, [saved]);
  return <div className="settings-reviews-import space-y-3 border-t border-border pt-5">
    <h3 className="font-semibold">Customer reviews</h3>
    <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={value?.reviewsEnabled === true} onChange={event => onChange({ ...value, reviewsEnabled: event.target.checked })} />Show customer reviews on the homepage</label>
    <label htmlFor="customer-reviews-json" className="block text-sm font-medium">Reviews JSON</label>
    <p id="reviews-json-help" className="settings-import-help text-sm text-muted-foreground">Paste an array containing rating, review, name, date and source. Reviews display in this order. Optional verified and invited fields accept true or false. Only mark verified when confirmed. Apply the JSON, then save settings. Use [] to clear them.</p>
    <Textarea id="customer-reviews-json" aria-describedby="reviews-json-help" rows={8} value={text} onChange={event => { setText(event.target.value); setMessage(''); }} className="font-mono text-xs" />
    <div className="settings-import-actions">
      <Button type="button" variant="outline" onClick={() => { try { const reviews = parseReviews(text); onChange({ ...value, reviews }); setMessage(`${reviews.length} reviews applied. Save settings to keep your changes.`); } catch (error) { setMessage(error instanceof SyntaxError ? 'Invalid JSON. Check quotation marks and commas.' : (error as Error).message); } }}>Apply reviews JSON</Button>
      {message && <p role="status" className="settings-import-status text-sm">{message}</p>}
    </div>
  </div>;
}
