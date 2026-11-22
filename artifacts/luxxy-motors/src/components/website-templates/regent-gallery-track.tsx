import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from '@/components/icons';

type Companion = { key: string; index: number; label: string };

const desktopGalleryMedia = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';
const desktopLayout = () => typeof window.matchMedia === 'function' && window.matchMedia(desktopGalleryMedia).matches;
const inactiveLayout = () => false;
const noSubscription = () => () => {};
function subscribeToDesktopLayout(change: () => void) {
  if (typeof window.matchMedia !== 'function') return noSubscription();
  const media = window.matchMedia(desktopGalleryMedia);
  if (media.addEventListener) {
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }
  media.addListener?.(change);
  return () => media.removeListener?.(change);
}

export function useRegentDesktopGallery(enabled: boolean) {
  return useSyncExternalStore(enabled ? subscribeToDesktopLayout : noSubscription,
    enabled ? desktopLayout : inactiveLayout, inactiveLayout);
}

export function RegentGalleryTrack({ lead, photos, activeIndex, reduceMotion, renderPhoto, onOpenPhoto }: {
  lead: ReactNode;
  photos: Companion[];
  activeIndex: number;
  reduceMotion: boolean;
  renderPhoto: (index: number) => ReactNode;
  onOpenPhoto: (index: number, trigger: HTMLButtonElement) => void;
}) {
  const id = useId();
  const strip = useRef<HTMLDivElement>(null);
  const photoButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const [focused, setFocused] = useState(0);
  const [ends, setEnds] = useState({ start: true, end: true });
  const rows = photos.length < 2 ? 1 : 2;

  function updateEnds() {
    const element = strip.current;
    if (!element) return;
    const start = element.scrollLeft <= 1;
    const end = element.scrollLeft + element.clientWidth >= element.scrollWidth - 1;
    setEnds(prev => prev.start === start && prev.end === end ? prev : { start, end });
  }

  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    updateEnds();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateEnds);
    observer.observe(element);
    return () => observer.disconnect();
  }, [photos.length]);

  function scroll(direction: -1 | 1) {
    const element = strip.current;
    if (!element) return;
    element.scrollBy({ left: direction * element.clientWidth * .78, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  return <>
    <div className="regent-gallery-track" id={id} ref={strip} onScroll={updateEnds}
      role="group" aria-label="Vehicle photographs" data-rows={rows} data-count={photos.length}
      tabIndex={!ends.start || !ends.end ? 0 : undefined}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          scroll(event.key === 'ArrowRight' ? 1 : -1);
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          event.currentTarget.scrollLeft = event.key === 'Home' ? 0 : event.currentTarget.scrollWidth;
        }
      }}>
      <div className="regent-gallery-lead">{lead}</div>
      {photos.map((photo, slot) => <button type="button" key={photo.key} className="regent-gallery-strip-photo"
        aria-label={photo.label} aria-current={activeIndex === photo.index || undefined}
        tabIndex={slot === Math.min(focused, photos.length - 1) ? 0 : -1}
        ref={element => { photoButtons.current[slot] = element; }} onFocus={() => setFocused(slot)}
        onClick={event => onOpenPhoto(photo.index, event.currentTarget)}
        onKeyDown={event => {
          const row = slot % rows;
          const moves: Record<string, number> = {
            ArrowLeft: slot - rows, ArrowRight: slot + rows,
            ArrowUp: row > 0 ? slot - 1 : slot, ArrowDown: row < rows - 1 ? slot + 1 : slot,
            Home: 0, End: photos.length - 1,
          };
          const target = moves[event.key];
          if (target === undefined) return;
          event.preventDefault();
          const button = photoButtons.current[Math.min(photos.length - 1, Math.max(0, target))];
          const element = strip.current;
          if (!button || !element) return;
          button.focus({ preventScroll: true });
          const photoBounds = button.getBoundingClientRect(), viewport = element.getBoundingClientRect();
          if (photoBounds.left < viewport.left) element.scrollLeft += photoBounds.left - viewport.left;
          else if (photoBounds.right > viewport.right) element.scrollLeft += photoBounds.right - viewport.right;
        }}>{renderPhoto(photo.index)}</button>)}
    </div>
    {(!ends.start || !ends.end) && <div className="regent-gallery-strip-arrows" aria-label="Scroll vehicle photographs">
      <button type="button" disabled={ends.start} aria-controls={id} aria-label="Previous gallery photos" onClick={() => scroll(-1)}>
        <span className="vehicle-gallery-arrow-face" aria-hidden="true"><ChevronLeft size={18} /></span>
      </button>
      <button type="button" disabled={ends.end} aria-controls={id} aria-label="Next gallery photos" onClick={() => scroll(1)}>
        <span className="vehicle-gallery-arrow-face" aria-hidden="true"><ChevronRight size={18} /></span>
      </button>
    </div>}
  </>;
}
