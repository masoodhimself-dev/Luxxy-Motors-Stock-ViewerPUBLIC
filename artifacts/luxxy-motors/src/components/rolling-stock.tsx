import { useState } from 'react';
import { Link } from 'wouter';
import { Pause, Play, ArrowRight } from 'lucide-react';
import { CarCard } from '@/components/car-card';
import type { Car } from '@/lib/stock-context';

export function RollingStock({ cars, unavailable = false }: { cars: Car[]; unavailable?: boolean }) {
  const [paused, setPaused] = useState(false);
  return <section className="rolling-stock homepage-stock py-6" aria-labelledby="rolling-stock-heading">
    <div className="container mx-auto mb-4 flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
      <h2 id="rolling-stock-heading" className="section-heading">Latest arrivals</h2>
      <div className="flex items-center gap-4">
        {cars.length > 1 && <button className="rolling-stock-toggle text-link min-h-11 text-sm" type="button" onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}{paused ? 'Resume cars' : 'Pause cars'}</button>}
        <Link href="/stock" className="text-link min-h-11 text-sm">Browse Stock <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
      </div>
    </div>
    {cars.length ? <div className="rolling-stock-window" tabIndex={0} aria-label="Latest vehicles; pause to browse" data-paused={paused || cars.length <= 1}>
      <div className="rolling-stock-track">
        <div className="rolling-stock-group">{cars.map(car => <CarCard key={car.id} car={car} stretchedLink />)}</div>
        {cars.length > 1 && <div className="rolling-stock-group rolling-stock-copy" aria-hidden="true" ref={node => { node?.querySelectorAll<HTMLElement>('a, button, [tabindex]').forEach(element => { element.tabIndex = -1; }); }}>{cars.map(car => <CarCard key={car.id} car={car} stretchedLink />)}</div>}
      </div>
    </div> : <p className="container mx-auto px-4 text-muted-foreground">{unavailable ? 'Stock is temporarily unavailable. Please contact the team for current availability.' : 'No vehicles currently listed. Contact the team about upcoming stock.'}</p>}
  </section>;
}
