import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/page-ui';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { usePageMeta } from '@/hooks/use-page-meta';

export default function RetiredSalesPage() {
  const { settings } = useDealerSettings();
  usePageMeta({ title: `Purchase link unavailable | ${settings.identity.name}`, description: 'Contact us for help with your purchase or paperwork.' });

  return <div className="luxxy-shell flex min-h-[60vh] items-center px-4 py-12 sm:px-6 lg:px-8">
    <section className="mx-auto w-full max-w-xl rounded-sm border border-border bg-card p-6 sm:p-10">
      <PageHeading eyebrow="Your purchase" title="This link is no longer available" description="Please get in touch if you need help with your purchase or paperwork. Keep your sales reference handy so we can find your records." />
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button asChild><Link href="/contact">Contact us</Link></Button>
        <Button asChild variant="outline"><Link href="/stock">Browse stock</Link></Button>
      </div>
    </section>
  </div>;
}
