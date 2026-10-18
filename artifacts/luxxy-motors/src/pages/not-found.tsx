import { ArrowRight } from '@/components/icons';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { usePageMeta } from '@/hooks/use-page-meta';
import { PageHeading } from '@/components/page-ui';

export default function NotFound() {
  const { settings } = useDealerSettings();
  usePageMeta({
    title: `Page not found | ${settings.identity.name}`,
    description: 'Browse our current used cars or contact us for help.',
  });

  return (
    <div className="luxxy-shell flex min-h-[60vh] items-center bg-background px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-xl rounded-sm border border-border bg-card p-6 sm:p-10">
        <PageHeading eyebrow="Page not found · 404" title="Let’s get you back on track." description="This page may have moved, or the link may be out of date. Browse our current cars or get in touch and we’ll help." />
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button asChild><Link href="/stock">Browse stock <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
          <Button asChild variant="outline"><Link href="/contact">Contact us</Link></Button>
        </div>
      </div>
    </div>
  );
}
