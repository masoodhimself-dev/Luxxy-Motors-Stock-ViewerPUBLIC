import { useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';

type Gesture = { id: number; x: number; y: number; axis: 'x' | 'y' | null };

/** One photo per deliberate horizontal gesture; the browser owns scrolling and zoom. */
export function usePhotoSwipe(enabled: boolean, changePhoto: (direction: -1 | 1) => void) {
  const gesture = useRef<Gesture | null>(null);
  const suppressClickUntil = useRef(0);

  const onPointerDown = (event: PointerEvent<HTMLAnchorElement>) => {
    if (!enabled || event.pointerType === 'mouse') return;
    if (!event.isPrimary) {
      gesture.current = null;
      suppressClickUntil.current = Date.now() + 800;
      return;
    }
    suppressClickUntil.current = 0;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: null };
  };
  const onPointerMove = (event: PointerEvent<HTMLAnchorElement>) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const x = Math.abs(event.clientX - current.x);
    const y = Math.abs(event.clientY - current.y);
    if (!current.axis && Math.max(x, y) > 10) current.axis = x > y * 1.2 ? 'x' : 'y';
  };
  const onPointerUp = (event: PointerEvent<HTMLAnchorElement>) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    const x = event.clientX - current.x;
    const y = event.clientY - current.y;
    if (Math.hypot(x, y) > 10) suppressClickUntil.current = Date.now() + 800;
    if (enabled && current.axis !== 'y' && Math.abs(x) >= 40 && Math.abs(x) > Math.abs(y) * 1.2) {
      changePhoto(x < 0 ? 1 : -1);
    }
  };
  const onPointerCancel = () => {
    // Scroll and pinch gestures cancel pointer events; neither should select a photo.
    gesture.current = null;
    suppressClickUntil.current = Date.now() + 800;
  };
  const onClickCapture = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.detail !== 0 && Date.now() < suppressClickUntil.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture };
}
