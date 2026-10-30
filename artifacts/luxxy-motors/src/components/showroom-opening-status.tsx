import { useEffect, useState } from 'react';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { showroomHours } from '@/lib/showroom-hours';
/** Client-side clock only. Never polls stock or makes API requests. */
export function ShowroomOpeningStatus() {
 const { settings, isLoading, isError } = useDealerSettings();
 const [now, setNow] = useState(() => new Date());
 useEffect(() => {
  const refresh = () => setNow(new Date());
  const timer = window.setInterval(refresh, 60_000);
  window.addEventListener('focus', refresh);
  return () => {window.clearInterval(timer); window.removeEventListener('focus', refresh);};
 }, []);
 if (isLoading || isError) return null;
 const hours = showroomHours(settings.hours ?? [], now);
 if (hours.state === 'unknown') return null;
 return <p className="home-opening-status">{hours.state === 'open' ? `Open today until ${hours.closingTime}` : hours.next ? `Opens ${hours.next}` : hours.statusLabel}</p>;
}
