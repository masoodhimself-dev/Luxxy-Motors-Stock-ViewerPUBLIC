import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronDown, X } from '@/components/icons';
import { currentComparisonIds, MAX_COMPARISON_CARS } from '@/lib/car-comparison';
import { shortlistUrl } from '@/lib/customer-convenience';
import type { Car } from '@/lib/stock-context';
import { vehicleDisplayTitle } from '@/lib/utils';
import './car-comparison.css';

const stockComparisonKey = 'luxxy.stock-comparison.v1';

function readStockSelection(): string[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(stockComparisonKey) ?? '[]');
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string').slice(0, MAX_COMPARISON_CARS)
      : [];
  } catch {
    return [];
  }
}

/** A stock selection survives opening a vehicle and returning within the same tab. */
export function useComparisonSelection(cars: Car[], rememberStock = false) {
  const [ids, setIds] = useState<string[]>(() => rememberStock ? readStockSelection() : []);
  const [open, setOpen] = useState(false);
  const selectedIds = currentComparisonIds(ids, cars);
  const comparedCars = selectedIds.map(id => cars.find(car => car.id === id)!);
  useEffect(() => {
    if (selectedIds.length < 2) setOpen(false);
  }, [selectedIds.length]);
  useEffect(() => {
    if (!rememberStock) return;
    try {
      sessionStorage.setItem(stockComparisonKey, JSON.stringify(ids));
    } catch {
      // Comparison is still usable when storage is disabled.
    }
  }, [ids, rememberStock]);

  function toggle(id: string) {
    setIds(current => {
      const available = currentComparisonIds(current, cars);
      if (available.includes(id)) return available.filter(item => item !== id);
      return available.length < MAX_COMPARISON_CARS && cars.some(car => car.id === id)
        ? [...available, id]
        : available;
    });
  }

  return { selectedIds, comparedCars, toggle, clear: () => setIds([]), open, setOpen };
}

export function useShortlistShare() {
  const [shareStatus, setShareStatus] = useState('');
  const [copyLink, setCopyLink] = useState('');
  function reset() {
    setShareStatus('');
    setCopyLink('');
  }
  async function share(ids: string[]) {
    const url = shortlistUrl(ids);
    reset();
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Cars to take a look at', url });
      } else {
        await navigator.clipboard.writeText(url);
        setShareStatus('Shortlist link copied');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setCopyLink(url);
      setShareStatus('Copy the link below to share these cars.');
    }
  }
  return { share, shareStatus, copyLink, reset };
}

export function CarComparisonTray({ cars, onRemove, onClear, onCompare }: {
  cars: Car[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onCompare: () => void;
}) {
  const selectionId = useId();
  const [expanded, setExpanded] = useState(false);
  if (cars.length === 0) return null;
  const count = `${cars.length} ${cars.length === 1 ? 'car' : 'cars'} selected`;
  return (
    <section className="saved-comparison-tray" aria-label="Car comparison selection">
      <span role="status" className="sr-only">{count}</span>
      <button type="button" className="comparison-tray-toggle" aria-controls={selectionId}
        aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        {count}<ChevronDown size={16} aria-hidden />
      </button>
      <Button type="button" size="sm" disabled={cars.length < 2} onClick={onCompare}>
        {cars.length < 2 ? 'Choose one more car' : `Compare ${cars.length} cars`}
      </Button>
      <div className="comparison-tray-selection" id={selectionId} hidden={!expanded}>
        <ul className="comparison-tray-cars" aria-label="Selected cars">
          {cars.map(car => {
            const title = vehicleDisplayTitle(car);
            return <li key={car.id}><button type="button" onClick={() => {
              if (cars.length === 1) setExpanded(false);
              onRemove(car.id);
            }} aria-label={`Remove ${title} from comparison`}>
              <span>{title}</span><X size={14} aria-hidden />
            </button></li>;
          })}
        </ul>
        <button type="button" className="comparison-tray-clear" onClick={() => { setExpanded(false); onClear(); }}>Clear selection</button>
      </div>
    </section>
  );
}
