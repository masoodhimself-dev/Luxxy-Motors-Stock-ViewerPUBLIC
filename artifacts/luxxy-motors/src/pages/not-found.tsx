import { ArrowRight, FileQuestion } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="luxxy-shell flex min-h-[70vh] items-center justify-center bg-muted/30 px-4 py-16 sm:px-6 lg:px-8">
      <div className="w-full max-w-xl border border-border/70 bg-card">
        <div className="flex items-center gap-3 border-b border-border/70 px-6 py-4">
          <span className="h-1.5 w-1.5 rotate-45 bg-accent" aria-hidden="true" />
          <p className="luxxy-label text-muted-foreground">Error 404</p>
        </div>
        <div className="px-6 py-12 text-center sm:px-10 sm:py-14">
          <span className="mx-auto mb-6 grid h-14 w-14 place-items-center border border-border bg-secondary text-accent">
            <FileQuestion className="h-6 w-6" />
          </span>
          <h1 className="font-display text-[2.25rem] font-semibold leading-[1.04] tracking-[-.03em] text-primary">
            Page not found
          </h1>
          <p className="mx-auto mt-5 max-w-sm text-sm leading-7 text-muted-foreground">
            We couldn&apos;t find the vehicle or page you were looking for. It may have been sold or removed.
          </p>
          <Button asChild size="lg" className="mt-9 h-12 rounded-none px-7 text-sm font-bold shadow-none">
            <Link href="/">
              Back to Showroom
              <ArrowRight className="ml-3 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
