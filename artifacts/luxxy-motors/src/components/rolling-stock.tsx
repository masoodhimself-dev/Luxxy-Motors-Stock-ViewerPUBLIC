import { websiteText } from "@/lib/website-content";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent, TouchEvent } from 'react';
import { Link } from 'wouter';
import { Pause, Play, ArrowRight } from 'lucide-react';
import { CarCard } from '@/components/car-card';
import type { Car } from '@/lib/stock-context';

type BrowseGesture = { id: number; x: number; y: number; moved: boolean };
const DRAG_DISTANCE = 10;

export function RollingStock({ cars, unavailable = false }: { cars: Car[]; unavailable?: boolean }) {
  const { settings } = useDealerSettings();
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const viewport = useRef<HTMLDivElement>(null);
  const pointerGesture = useRef<BrowseGesture | null>(null);
  const touchGesture = useRef<BrowseGesture | null>(null);
  const suppressClickUntil = useRef(0);
  const hovering = useRef(false);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    update();
    if (preference.addEventListener) {
      preference.addEventListener('change', update);
      return () => preference.removeEventListener('change', update);
    }
    preference.addListener?.(update);
    return () => preference.removeListener?.(update);
  }, []);

  const finishGesture = (gesture: BrowseGesture | null) => {
    if (gesture?.moved) suppressClickUntil.current = Date.now() + 800;
  };
  const moveGesture = (gesture: BrowseGesture | null, x: number, y: number) => {
    if (gesture && Math.hypot(x - gesture.x, y - gesture.y) >= DRAG_DISTANCE) gesture.moved = true;
  };
  const startPointer = (event: PointerEvent<HTMLDivElement>) => {
    setPaused(true);
    suppressClickUntil.current = 0;
    // Touch events continue through native scrolling after pointercancel, so they
    // take over when available. No pointer capture or preventDefault is needed.
    if (event.pointerType === 'touch') {
      hovering.current = false;
      if (touchGesture.current) return;
      if (pointerGesture.current) {
        pointerGesture.current.moved = true;
        return;
      }
    }
    pointerGesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  };
  const movePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' || event.pointerType === 'pen') hovering.current = event.buttons === 0 && window.matchMedia('(any-hover: hover)').matches;
    if (pointerGesture.current?.id === event.pointerId) moveGesture(pointerGesture.current, event.clientX, event.clientY);
  };
  const finishPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerGesture.current?.id !== event.pointerId) return;
    moveGesture(pointerGesture.current, event.clientX, event.clientY);
    finishGesture(pointerGesture.current);
    pointerGesture.current = null;
  };
  const startTouch = (event: TouchEvent<HTMLDivElement>) => {
    setPaused(true);
    hovering.current = false;
    suppressClickUntil.current = 0;
    pointerGesture.current = null;
    if (event.touches.length > 1 && touchGesture.current) {
      touchGesture.current.moved = true;
      return;
    }
    const touch = event.touches[0];
    if (touch) touchGesture.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY, moved: event.touches.length > 1 };
  };
  const moveTouch = (event: TouchEvent<HTMLDivElement>) => {
    const gesture = touchGesture.current;
    if (!gesture) return;
    if (event.touches.length !== 1) gesture.moved = true;
    const touch = Array.from(event.touches).find(touch => touch.identifier === gesture.id);
    if (touch) moveGesture(gesture, touch.clientX, touch.clientY);
  };
  const finishTouch = (event: TouchEvent<HTMLDivElement>) => {
    const gesture = touchGesture.current;
    const touch = Array.from(event.changedTouches).find(touch => touch.identifier === gesture?.id);
    if (touch) moveGesture(gesture, touch.clientX, touch.clientY);
    if (event.touches.length) return;
    finishGesture(gesture);
    touchGesture.current = null;
  };

  useEffect(() => {
    const element = viewport.current;
    if (!element || paused || reducedMotion || cars.length <= 1) return;
    const timer = window.setInterval(() => {
      if (hovering.current || element.matches(':focus-within') || document.hidden) return;
      const group = element.querySelector<HTMLElement>('.rolling-stock-group');
      const card = group?.firstElementChild as HTMLElement | undefined;
      if (!group || !card || group.offsetWidth === 0) return;
      // Rebase only during autoplay; changing scrollLeft during a swipe would
      // interrupt native momentum and scroll snapping.
      if (element.scrollLeft >= group.offsetWidth - 1) element.scrollLeft %= group.offsetWidth;
      element.scrollBy({ left: card.getBoundingClientRect().width, behavior: 'smooth' });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [paused, reducedMotion, cars.length]);
  return <section className="rolling-stock homepage-stock" aria-labelledby="rolling-stock-heading">
    {cars.length ? <div
      ref={viewport}
      className="rolling-stock-window"
      tabIndex={0}
      aria-label="Featured vehicles; swipe or scroll to browse"
      data-paused={paused || reducedMotion || cars.length <= 1}
      onPointerDownCapture={startPointer}
      onPointerMoveCapture={movePointer}
      onPointerUpCapture={finishPointer}
      onPointerCancelCapture={event => {
        if (pointerGesture.current?.id === event.pointerId) pointerGesture.current.moved = true;
        finishPointer(event);
      }}
      onPointerEnter={event => { hovering.current = (event.pointerType === 'mouse' || event.pointerType === 'pen') && event.buttons === 0 && window.matchMedia('(any-hover: hover)').matches; }}
      onPointerLeave={() => { hovering.current = false; }}
      onTouchStartCapture={startTouch}
      onTouchMoveCapture={moveTouch}
      onTouchEndCapture={finishTouch}
      onTouchCancelCapture={event => {
        if (touchGesture.current) touchGesture.current.moved = true;
        finishTouch(event);
      }}
      onWheelCapture={() => setPaused(true)}
      onKeyDownCapture={event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) setPaused(true);
      }}
      onClickCapture={event => {
        // Capture also covers the card's stretched link. A fresh tap resets this
        // guard; keyboard activation (detail === 0) remains available immediately.
        if (event.detail !== 0 && Date.now() < suppressClickUntil.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <div className="rolling-stock-track">
        <div className="rolling-stock-group">{cars.map(car => <CarCard key={car.id} car={car} photoControls={false} stretchedLink />)}</div>
        {cars.length > 1 && <div className="rolling-stock-group rolling-stock-copy" aria-hidden="true" ref={node => { node?.querySelectorAll<HTMLElement>('a, button, [tabindex]').forEach(element => { element.tabIndex = -1; }); }}>{cars.map(car => <CarCard key={car.id} car={car} photoControls={false} stretchedLink />)}</div>}
      </div>
    </div> : <p className="container mx-auto px-4 text-muted-foreground">{unavailable ? 'Stock is temporarily unavailable. Please contact the team for current availability.' : 'No vehicles currently listed. Contact the team about upcoming stock.'}</p>}
    <div className="container mx-auto py-4 flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
      <h2 id="rolling-stock-heading" className="section-heading">{websiteText(settings, "featuredHeading")}</h2>
      <div className="flex items-center gap-4">
        {cars.length > 1 && <button className="rolling-stock-toggle text-link min-h-11 text-sm" type="button" onClick={() => setPaused(value => !value)} aria-pressed={paused}>{paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}{paused ? 'Resume cars' : 'Pause cars'}</button>}
        <Link href="/stock" className="text-link min-h-11 text-sm">Browse Stock <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
      </div>
    </div>
  </section>;
}
