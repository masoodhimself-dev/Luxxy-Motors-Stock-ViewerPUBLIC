import { ArrowRight, FileQuestion } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="luxxy-shell flex min-h-[70vh] items-center justify-center bg-background px-4 py-16 sm:px-6 lg:px-8">
      <div className="w-full max-w-xl border-4 border-primary bg-background shadow-[8px_8px_0px_hsl(var(--primary))]">
        <div className="flex items-center gap-3 border-b-4 border-primary px-8 py-6 bg-primary/5">
          <span className="h-2 w-2 rotate-45 bg-accent" aria-hidden="true" />
          <p className="font-display text-[12px] font-black uppercase tracking-[0.2em] text-primary">Error 404</p>
        </div>
        <div className="px-8 py-12 text-center sm:px-12 sm:py-16">
          <span className="mx-auto mb-6 grid h-16 w-16 place-items-center border-4 border-primary bg-background text-accent shadow-[4px_4px_0px_hsl(var(--primary))]">
            <FileQuestion className="h-8 w-8" />
          </span>
          <h1 className="font-display text-4xl sm:text-5xl font-black uppercase tracking-tighter text-primary">
            PAGE NOT FOUND
          </h1>
          <p className="mx-auto mt-6 max-w-sm text-[13px] font-bold uppercase tracking-widest leading-relaxed text-primary/70">
            We couldn&apos;t find the vehicle or page you were looking for. It may have been sold or removed.
          </p>
          <Button asChild size="lg" className="mt-10 h-14 rounded-none px-8 font-display text-[13px] font-black uppercase tracking-[0.2em] shadow-[4px_4px_0px_hsl(var(--accent))] hover:-translate-y-1 hover:shadow-[6px_6px_0px_hsl(var(--accent))] transition-all">
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