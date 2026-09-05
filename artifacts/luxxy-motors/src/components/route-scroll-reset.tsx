import { useLayoutEffect } from 'react';
import { useLocation } from 'wouter';

export function RouteScrollReset() {
  const [location] = useLocation();

  useLayoutEffect(() => {
    window.history.scrollRestoration = 'manual';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location]);

  return null;
}