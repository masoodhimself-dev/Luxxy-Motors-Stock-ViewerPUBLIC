import { websiteText } from "@/lib/website-content";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import { useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from '@/components/icons';
import type { PointerEvent, TouchEvent } from 'react';
import { CustomerSafeLink as Link } from '@/components/customer-safe-link';
import { CarCard } from '@/components/car-card';
import type { Car } from '@/lib/stock-context';

type BrowseGesture = { id: number; x: number; y: number; moved: boolean };
const DRAG_DISTANCE = 10;

export function RollingStock({ cars, unavailable = false, shortcuts, showVehicles = true }: { cars: Car[]; unavailable?: boolean; shortcuts?: ReactNode; showVehicles?: boolean }) {
  const { settings } = useDealerSettings();
  const viewport = useRef<HTMLDivElement>(null);
  const pointerGesture = useRef<BrowseGesture | null>(null);
  const touchGesture = useRef<BrowseGesture | null>(null);
  const suppressClickUntil = useRef(0);
  const finishGesture = (gesture: BrowseGesture | null) => {
    if (gesture?.moved) suppressClickUntil.current = Date.now() + 800;
  };
  const moveGesture = (gesture: BrowseGesture | null, x: number, y: number) => {
    if (gesture && Math.hypot(x - gesture.x, y - gesture.y) >= DRAG_DISTANCE) gesture.moved = true;
  };
  const startPointer = (event: PointerEvent<HTMLDivElement>) => {
    suppressClickUntil.current = 0;
    // Touch events continue through native scrolling after pointercancel, so they
    // take over when available. No pointer capture or preventDefault is needed.
    if (event.pointerType === 'touch') {
      if (touchGesture.current) return;
      if (pointerGesture.current) {
        pointerGesture.current.moved = true;
        return;
      }
    }
    pointerGesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  };
  const movePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerGesture.current?.id === event.pointerId) moveGesture(pointerGesture.current, event.clientX, event.clientY);
  };
  const finishPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerGesture.current?.id !== event.pointerId) return;
    moveGesture(pointerGesture.current, event.clientX, event.clientY);
    finishGesture(pointerGesture.current);
    pointerGesture.current = null;
  };
  const startTouch = (event: TouchEvent<HTMLDivElement>) => {
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

  const browse = (direction: -1 | 1) => {
    const element = viewport.current;
    if (!element) return;
    element.scrollBy({ left: direction * element.clientWidth * .85, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  return <section className="rolling-stock homepage-stock" aria-label="Browse cars">
    <div className="rolling-stock-footer container mx-auto flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
      <h2 id="rolling-stock-heading" className="section-heading">{websiteText(settings, "featuredHeading")}</h2>
      <div className="flex items-center gap-4">
        {showVehicles && cars.length > 1 && <div className="rolling-stock-arrows" aria-label="Browse featured cars">
          <button type="button" onClick={() => browse(-1)} aria-label="Previous featured cars"><ChevronLeft size={18} aria-hidden="true" /></button>
          <button type="button" onClick={() => browse(1)} aria-label="Next featured cars"><ChevronRight size={18} aria-hidden="true" /></button>
        </div>}
        <Link href="/stock?all=1" className="text-link min-h-11 text-sm">View all stock</Link>
      </div>
    </div>
    {shortcuts}
    {showVehicles && (cars.length ? <div
      ref={viewport}
      className="rolling-stock-window"
      tabIndex={0}
      aria-label="Featured vehicles; swipe or scroll to browse"
      data-paused="true"
      onPointerDownCapture={startPointer}
      onPointerMoveCapture={movePointer}
      onPointerUpCapture={finishPointer}
      onPointerCancelCapture={event => {
        if (pointerGesture.current?.id === event.pointerId) pointerGesture.current.moved = true;
        finishPointer(event);
      }}
      onTouchStartCapture={startTouch}
      onTouchMoveCapture={moveTouch}
      onTouchEndCapture={finishTouch}
      onTouchCancelCapture={event => {
        if (touchGesture.current) touchGesture.current.moved = true;
        finishTouch(event);
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
        <div className="rolling-stock-group">{cars.map(car => <CarCard key={car.id} car={car} photoControls={false} summaryOnly stretchedLink />)}</div>

      </div>
    </div> : <div className="rolling-stock-empty container mx-auto px-4 sm:px-6 lg:px-8">
      <p className="text-muted-foreground" role={unavailable ? 'status' : undefined}>{unavailable ? 'We can’t show our stock right now. Please contact us for current availability.' : 'We have no cars online at the moment. Ask us about our stock.'}</p>
      <Link href="/contact" className="text-link">Contact us</Link>
    </div>)}

  </section>;
}
