import { FileQuestion } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="luxxy-shell flex min-h-[70vh] items-center justify-center px-4 py-16 sm:px-6 lg:px-8">
      <div className="w-full max-w-lg border border-border/70 bg-card">
        <div className="flex items-center gap-3 border-b border-border/70 px-6 py-4">
          <FileQuestion className="h-4 w-4 shrink-0 text-accent" />
          <p className="luxxy-label text-muted-foreground">Error 404</p>
        </div>
        <div className="px-6 py-10 text-center sm:px-10 sm:py-12">
          <h1 className="font-display text-[2.25rem] font-semibold leading-[1.04] tracking-[-.03em] text-primary">
            Page not found
          </h1>
          <p className="mx-auto mt-5 max-w-sm text-sm leading-7 text-muted-foreground">
            We couldn&apos;t find the vehicle or page you were looking for. It may have been sold or removed.
          </p>
          <Button asChild size="lg" className="mt-9 h-12 w-full rounded-none text-sm font-bold shadow-none">
            <Link href="/">Back to Showroom</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
