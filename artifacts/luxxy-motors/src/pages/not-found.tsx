import { ArrowRight, FileQuestion } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="luxxy-shell flex min-h-[70vh] items-center justify-center bg-background px-4 py-16 sm:px-6 lg:px-8">
      <div className="w-full max-w-xl border border-primary bg-background shadow-none">
        <div className="flex items-center gap-3 border-b border-primary px-8 py-6 bg-primary/5">
          <span className="h-2 w-2 rotate-45 bg-accent" aria-hidden="true" />
          <p className="font-display text-[12px] font-semibold tracking-normal text-primary">Error 404</p>
        </div>
        <div className="px-8 py-12 text-center sm:px-12 sm:py-16">
          <span className="mx-auto mb-6 grid h-16 w-16 place-items-center border border-primary bg-background text-accent shadow-none">
            <FileQuestion className="h-8 w-8" />
          </span>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-primary">
            PAGE NOT FOUND
          </h1>
          <p className="mx-auto mt-6 max-w-sm text-[13px] font-bold tracking-normal leading-relaxed text-primary/70">
            We couldn&apos;t find the vehicle or page you were looking for. It may have been sold or removed.
          </p>
          <Button asChild size="lg" className="mt-10 h-14 rounded-md px-8 font-display text-[13px] font-semibold tracking-normal shadow-none transition-all">
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