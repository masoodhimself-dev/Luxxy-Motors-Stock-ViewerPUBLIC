import { useLayoutEffect, useState, type RefObject } from 'react';

export const stockHeaderMedia = '(max-width: 1023px), (hover: none) and (pointer: coarse) and (max-width: 1366px)';

/** Give touch browsing the full viewport; a deliberate upward scroll restores navigation. */
export function useStockHeader(enabled: boolean, menuOpen: boolean, header: RefObject<HTMLElement | null>, routeKey?: string) {
  const [hidden, setHidden] = useState(false);
  useLayoutEffect(() => {
    setHidden(false);
    if (!enabled || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(stockHeaderMedia);
    const scrollPosition = () => Math.max(0, Math.min(window.scrollY, Math.max(0, document.documentElement.scrollHeight - window.innerHeight)));
    let previous = scrollPosition();
    let movement = 0;
    let direction = 0;
    const reset = () => {
      previous = scrollPosition();
      movement = 0;
      direction = 0;
      setHidden(false);
    };
    const onScroll = () => {
      const current = scrollPosition();
      const focused = document.activeElement;
      if (!media.matches || menuOpen || current <= 40 || (focused && header.current?.contains(focused) && focused.matches(':focus-visible'))) {
        reset();
        return;
      }
      const delta = current - previous;
      previous = current;
      if (Math.abs(delta) < 1) return;
      const nextDirection = Math.sign(delta);
      movement = nextDirection === direction ? movement + Math.abs(delta) : Math.abs(delta);
      direction = nextDirection;
      if (movement < 12) return;
      if (direction < 0) setHidden(false);
      else if (current > (header.current?.offsetHeight || 76) + 24) setHidden(true);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', reset, { passive: true });
    media.addEventListener?.('change', reset);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', reset);
      media.removeEventListener?.('change', reset);
    };
  }, [enabled, menuOpen, header, routeKey]);
  return { hidden: enabled && !menuOpen && hidden, reveal: () => setHidden(false) };
}
