import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { Pause, Play, ArrowRight } from 'lucide-react';
import { CarCard } from '@/components/car-card';
import type { Car } from '@/lib/stock-context';

export function RollingStock({ cars, unavailable = false }: { cars: Car[]; unavailable?: boolean }) {
  const [paused, setPaused] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = viewport.current;
    if (!element || paused || cars.length <= 1) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const timer = window.setInterval(() => {
      if (reducedMotion.matches || element.matches(':hover, :focus-within') || document.hidden) return;
      const group = element.querySelector<HTMLElement>('.rolling-stock-group');
      const card = group?.firstElementChild as HTMLElement | undefined;
      if (!group || !card) return;
      if (element.scrollLeft >= group.offsetWidth - 1) element.scrollLeft -= group.offsetWidth;
      element.scrollBy({ left: card.getBoundingClientRect().width, behavior: 'smooth' });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [paused, cars.length]);
  return <section className="rolling-stock homepage-stock" aria-labelledby="rolling-stock-heading">
    {cars.length ? <div ref={viewport} className="rolling-stock-window" tabIndex={0} aria-label="Latest vehicles; pause to browse" data-paused={paused || cars.length <= 1}>
      <div className="rolling-stock-track">
        <div className="rolling-stock-group">{cars.map(car => <CarCard key={car.id} car={car} photoControls={false} stretchedLink />)}</div>
        {cars.length > 1 && <div className="rolling-stock-group rolling-stock-copy" aria-hidden="true" ref={node => { node?.querySelectorAll<HTMLElement>('a, button, [tabindex]').forEach(element => { element.tabIndex = -1; }); }}>{cars.map(car => <CarCard key={car.id} car={car} photoControls={false} stretchedLink />)}</div>}
      </div>
    </div> : <p className="container mx-auto px-4 text-muted-foreground">{unavailable ? 'Stock is temporarily unavailable. Please contact the team for current availability.' : 'No vehicles currently listed. Contact the team about upcoming stock.'}</p>}
    <div className="container mx-auto py-4 flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
      <h2 id="rolling-stock-heading" className="section-heading">Latest arrivals</h2>
      <div className="flex items-center gap-4">
        {cars.length > 1 && <button className="rolling-stock-toggle text-link min-h-11 text-sm" type="button" onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}{paused ? 'Resume cars' : 'Pause cars'}</button>}
        <Link href="/stock" className="text-link min-h-11 text-sm">Browse Stock <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
      </div>
    </div>
  </section>;
}
