import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { customFetch } from '@workspace/api-client-react';
import { vehicleDetailPath, type MotHistory } from '@workspace/vehicle-meta';
import type { Car } from '@/lib/stock-context';
import { comparisonRows, comparisonRowDiffers } from '@/lib/car-comparison';
import { getThumbnailUrl, vehicleDisplayTitle } from '@/lib/utils';
import { Check, Share2 } from './icons';
import { ShowroomPhoto } from './showroom-photo';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import './car-comparison.css';

export function CarComparison({ cars, open, onOpenChange, onShare, shareStatus, copyLink }: {
  cars: Car[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShare: (ids: string[]) => void;
  shareStatus?: string;
  copyLink?: string;
}) {
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const [allFeatures, setAllFeatures] = useState(false);
  const [histories, setHistories] = useState<Record<string, MotHistory | null>>({});
  const [checkingMot, setCheckingMot] = useState(false);
  const idsKey = JSON.stringify(cars.map(car => car.id));

  useEffect(() => {
    if (!open) return;
    const ids = JSON.parse(idsKey) as string[];
    const controller = new AbortController();
    setHistories({});
    setCheckingMot(true);
    // Only read existing records for the selected cars. Comparing a shortlist
    // must never start paid lookups or check every vehicle in the dealership.
    void Promise.all(ids.map(async id => {
      try {
        const reply = await customFetch<{ status: string; history?: MotHistory }>(
          `/api/vehicles/${encodeURIComponent(id)}/mot-history?cacheOnly=true`, { signal: controller.signal },
        );
        return [id, reply.status === 'available' ? reply.history ?? null : null] as const;
      } catch { return [id, null] as const; }
    })).then(records => {
      if (controller.signal.aborted) return;
      setHistories(Object.fromEntries(records));
      setCheckingMot(false);
    });
    return () => controller.abort();
  }, [open, idsKey]);

  const rows = comparisonRows(cars, histories);
  const visibleRows = differencesOnly ? rows.filter(comparisonRowDiffers) : rows;
  const facts = visibleRows.filter(row => !row.feature);
  const features = visibleRows.filter(row => row.feature);
  const displayedFeatures = allFeatures ? features : features.slice(0, 6);
  const row = (item: typeof rows[number]) => <tr key={item.key}>
    <th scope="row">{item.label}</th>
    {item.values.map((value, index) => <td key={cars[index].id}>
      {value ? item.feature ? <span className="car-comparison-listed"><Check aria-hidden="true" />Listed</span> : value
        : <span className="car-comparison-missing">{item.feature ? 'Not listed' : item.key === 'mot' && checkingMot ? 'Checking…' : '—'}<span className="sr-only">{item.feature || item.key === 'mot' && checkingMot ? '' : 'Not listed'}</span></span>}
    </td>)}
  </tr>;

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="car-comparison-dialog">
      <DialogHeader>
        <DialogTitle>Compare your cars</DialogTitle>
        <DialogDescription>The details that help you choose, side by side.</DialogDescription>
      </DialogHeader>
      <div className="car-comparison-controls">
        <label><input type="checkbox" checked={differencesOnly} onChange={event => setDifferencesOnly(event.target.checked)} />Show differences</label>
        <Button variant="outline" onClick={() => onShare(cars.map(car => car.id))}><Share2 aria-hidden="true" />Share these cars</Button>
      </div>
      {shareStatus && <p role="status" className="car-comparison-note">{shareStatus}</p>}
      {copyLink && <label className="car-comparison-copy">Shortlist link<input readOnly value={copyLink} onFocus={event => event.target.select()} /></label>}
      <p className="car-comparison-swipe">Swipe sideways to see each car.</p>
      <div className="car-comparison-scroll" tabIndex={0} role="region" aria-label="Car comparison table, scroll sideways to see all cars">
        <table className="car-comparison-table">
          <caption className="sr-only">Comparison of {cars.map(vehicleDisplayTitle).join(', ')}</caption>
          <thead><tr><th scope="col"><span className="sr-only">Vehicle detail</span></th>{cars.map(car => <th scope="col" key={car.id}>
            <ShowroomPhoto src={getThumbnailUrl(car)} alt="" className="car-comparison-photo" fit="cover" />
            <Link href={vehicleDetailPath(car)}>{vehicleDisplayTitle(car)}</Link>
            {car.variant && <span className="car-comparison-variant">{car.variant}</span>}
          </th>)}</tr></thead>
          <tbody>{facts.map(row)}
            {displayedFeatures.length > 0 && <tr className="car-comparison-section"><th colSpan={cars.length + 1}>Listed features</th></tr>}
            {displayedFeatures.map(row)}
            {visibleRows.length === 0 && <tr><td colSpan={cars.length + 1} className="car-comparison-no-differences">The listed details are the same. Turn off “Show differences” to see them.</td></tr>}
          </tbody>
        </table>
      </div>
      {features.length > 6 && <button type="button" className="car-comparison-more" onClick={() => setAllFeatures(value => !value)}>{allFeatures ? 'Show fewer features' : `Show all ${features.length} listed features`}</button>}
      <p className="car-comparison-note">A dash or “Not listed” means we don’t have that detail. It doesn’t mean the car is without it.</p>
      <Button variant="outline" className="car-comparison-back" onClick={() => onOpenChange(false)}>Back to shortlist</Button>
    </DialogContent>
  </Dialog>;
}
