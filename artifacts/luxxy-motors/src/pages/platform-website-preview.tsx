import { lazy, Suspense, useState, type MouseEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Link, Route, Router, Switch, useLocation } from 'wouter';
import { Layout } from '@/components/layout';
import { RouteLoading } from '@/components/route-loading';
import { RouteScrollReset } from '@/components/route-scroll-reset';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { privateWebsitePreviewDetails } from '@/lib/private-website-preview';
import { SavedCarsProvider } from '@/lib/saved-cars-context';
import { StockProvider } from '@/lib/stock-context';
import Home from '@/pages/home';

const CarDetail = lazy(() => import('@/pages/car-detail'));
const Contact = lazy(() => import('@/pages/contact'));
const Warranty = lazy(() => import('@/pages/warranty'));
const Saved = lazy(() => import('@/pages/saved'));

function PreviewWebsite({ base }: { base: string }) {
  const [location, setLocation] = useLocation();
  const { isError } = useDealerSettings();
  const preview = privateWebsitePreviewDetails(base);
  const dealerId = preview?.dealerId ?? '';
  const adminPath = `/platform?dealer=${encodeURIComponent(dealerId)}${preview?.template ? `&tab=Website&previewTemplate=${encodeURIComponent(preview.template)}&previewRevision=${preview.revision}` : ''}`;

  if (isError) return <main className="mx-auto max-w-xl px-6 py-16"><h1 className="text-3xl font-bold">This preview could not be opened</h1><p className="my-5 leading-relaxed">The website settings may have changed. Return to Platform Admin and open a fresh preview.</p><a className="inline-flex min-h-11 items-center gap-2 underline" href={adminPath}><ArrowLeft size={16} aria-hidden="true"/> Back to website designs</a></main>;

  function keepWebsiteLinksInPreview(event: MouseEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!target) return;
    const href = target.getAttribute('href') ?? '';
    if (/^(?:tel:|mailto:|whatsapp:|https:\/\/(?:api\.whatsapp\.com|wa\.me)\/)/i.test(href)) {
      event.preventDefault();
      setLocation('/enquire');
      return;
    }
    if (/^\/(?:[?#].*)?$/.test(href)) {
      event.preventDefault();
      setLocation(href);
      return;
    }
    if (!/^\/(?:(?:stock|contact|warranty|saved|enquire)(?:[/?#]|$)|(?:vehicle|cars|s)\/)/i.test(href)) return;
    event.preventDefault();
    setLocation(href);
  }

  return (
    <div onClickCapture={keepWebsiteLinksInPreview} onSubmitCapture={event => {
      if (!(event.target instanceof HTMLFormElement) || !event.target.querySelector('input[type="email"], input[type="tel"]')) return;
      event.preventDefault();
      event.stopPropagation();
      setLocation('/enquire');
    }}>
      <RouteScrollReset />
      <StockProvider><SavedCarsProvider persistent={false}><Layout>
        <Suspense fallback={<RouteLoading />}>
          <Switch>
            <Route path="/"><Home key="home" /></Route>
            <Route path="/stock"><Home key="stock" browseStock /></Route>
            <Route path="/vehicle/:id" component={CarDetail} />
            <Route path="/cars/:slug" component={CarDetail} />
            <Route path="/s/:code" component={CarDetail} />
            <Route path="/contact" component={Contact} />
            <Route path="/warranty" component={Warranty} />
            <Route path="/saved" component={Saved} />
            <Route><section className="mx-auto max-w-xl px-6 py-16">
              <h1 className="text-3xl font-bold">{location === '/enquire' ? 'Contact the dealership' : 'Page unavailable'}</h1>
              {location === '/enquire' && <p className="mt-3 text-base leading-relaxed text-muted-foreground">Online enquiries are unavailable on this page.</p>}
              <Link href="/stock" className="mt-5 inline-flex min-h-11 items-center gap-2 underline"><ArrowLeft size={16} aria-hidden="true" /> Browse cars</Link>
            </section></Route>
          </Switch>
        </Suspense>
      </Layout></SavedCarsProvider></StockProvider>
    </div>
  );
}

export default function PlatformWebsitePreview({ base }: { base: string }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <Router base={base}><QueryClientProvider client={queryClient}><TooltipProvider>
    <PreviewWebsite base={base} />
  </TooltipProvider></QueryClientProvider></Router>;
}
