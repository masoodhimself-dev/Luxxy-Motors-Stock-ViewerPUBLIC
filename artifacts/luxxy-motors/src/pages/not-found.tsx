import { ArrowRight } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { usePageMeta } from '@/hooks/use-page-meta';

export default function NotFound() {
  const { settings } = useDealerSettings();
  usePageMeta({
    title: `Page not found | ${settings.identity.name}`,
    description: 'Find our current used cars or contact the dealership for help.',
  });

  return (
    <div className="luxxy-shell flex min-h-[60vh] items-center bg-background px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-xl rounded-sm border border-border bg-card p-6 sm:p-10">
        <p className="luxxy-kicker">Page not found · 404</p>
        <h1 className="heading-2 mt-3">Let’s get you back on track.</h1>
        <p className="mt-4 max-w-md text-base leading-7 text-muted-foreground">
          This page may have moved, or the link may be out of date. Browse our current cars or contact the showroom for help.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild><Link href="/stock">Browse Stock <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
          <Button asChild variant="outline"><Link href="/contact">Contact us</Link></Button>
        </div>
      </div>
    </div>
  );
}
