import { CheckCircle2, CircleAlert, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useStock } from '@/lib/stock-context';

export default function Portal() {
  const { stock, isLoading, error } = useStock();
  const vehicleCount = stock?.cars.length ?? 0;

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <section className="w-full max-w-2xl rounded-2xl border bg-card p-8 shadow-sm sm:p-10">
        <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <ShieldCheck className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Stock operations</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">
          Showroom stock is managed through secure automated synchronization. This page is provided for operational visibility only.
        </p>

        <div className="mt-8 rounded-xl border bg-muted/30 p-5">
          {isLoading ? (
            <div className="flex items-center gap-3 text-muted-foreground">
              <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
              <span>Loading current showroom status…</span>
            </div>
          ) : error ? (
            <div className="flex items-start gap-3 text-destructive">
              <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
              <div><p className="font-semibold">Current stock status is unavailable</p><p className="mt-1 text-sm">{error}</p></div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
              <div>
                <p className="font-semibold">Public showroom is synchronized</p>
                <p className="text-sm text-muted-foreground">{vehicleCount} {vehicleCount === 1 ? 'vehicle' : 'vehicles'} currently visible to customers.</p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
