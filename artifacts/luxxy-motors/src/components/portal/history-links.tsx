import { Link } from 'wouter';

export function vehicleHistoryHref(vehicleId?: string | null, record?: string) {
  const params = new URLSearchParams({ section: 'history', view: 'vehicles' });
  if (vehicleId) params.set('vehicleId', vehicleId);
  else if (record) params.set('record', record);
  return `/portal?${params}`;
}

export function customerHistoryHref(recordType: 'enquiry' | 'reservation' | 'sale', recordId: string) {
  const params = new URLSearchParams({ section: 'history', view: 'customers', record: `${recordType}:${recordId}` });
  return `/portal?${params}`;
}

/** These links open a read-only profile, preserving the original source record. */
export function HistoryLinks({ vehicleId, recordType, recordId, vehicle = true, className = '' }: {
  vehicleId?: string | null;
  recordType?: 'enquiry' | 'reservation' | 'sale';
  recordId?: string;
  vehicle?: boolean;
  className?: string;
}) {
  const record = recordType && recordId ? `${recordType}:${recordId}` : undefined;
  const linkClass = 'inline-flex min-h-11 items-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-primary underline-offset-4 hover:bg-secondary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
  return <div className={`flex min-w-0 flex-wrap gap-2 ${className}`}>
    {vehicle && (vehicleId || record) && <Link className={linkClass} href={vehicleHistoryHref(vehicleId, record)}>Vehicle history</Link>}
    {recordType && recordId && <Link className={linkClass} href={customerHistoryHref(recordType, recordId)}>Customer history</Link>}
  </div>;
}
