import { useEffect, useState } from 'react';

/** Background refreshes are useful only while someone can see an online page. */
export function canRefreshNow(): boolean {
  return (typeof document === 'undefined' || (!document.hidden && document.visibilityState !== 'hidden'))
    && (typeof navigator === 'undefined' || navigator.onLine !== false);
}

/** Resume immediately on returning to the page or reconnecting; owns no timers. */
export function useRefreshActive(): boolean {
  const [active, setActive] = useState(canRefreshNow);
  useEffect(() => {
    const update = () => setActive(canRefreshNow());
    const offline = () => setActive(false);
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', offline);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', offline);
    };
  }, []);
  return active;
}
