import { lazy, Suspense, useState, type MouseEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArrowLeft, LockKeyhole } from 'lucide-react';
import { Route, Router, Switch, useLocation } from 'wouter';
import { Layout } from '@/components/layout';
import { RouteLoading } from '@/components/route-loading';
import { RouteScrollReset } from '@/components/route-scroll-reset';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { SavedCarsProvider } from '@/lib/saved-cars-context';
import { StockProvider } from '@/lib/stock-context';
import Home from '@/pages/home';
import './platform-website-preview.css';

const CarDetail = lazy(() => import('@/pages/car-detail'));
const Contact = lazy(() => import('@/pages/contact'));
const Warranty = lazy(() => import('@/pages/warranty'));
const Saved = lazy(() => import('@/pages/saved'));

function PreviewWebsite({ base }: { base: string }) {
  const [location, setLocation] = useLocation();
  const { settings } = useDealerSettings();
  const dealerId = base.slice(base.lastIndexOf('/') + 1);
  const adminPath = `/platform?dealer=${encodeURIComponent(dealerId)}`;

  function keepWebsiteLinksInPreview(event: MouseEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!target) return;
    const href = target.getAttribute('href') ?? '';
    if (/^(?:tel:|mailto:|whatsapp:|https:\/\/(?:api\.whatsapp\.com|wa\.me)\/)/i.test(href)) {
      event.preventDefault();
      setLocation('/enquire');
      return;
    }
    if (!/^\/(?:(?:stock|contact|warranty|saved|enquire)(?:[/?#]|$)|(?:vehicle|cars|s)\/)/i.test(href)) return;
    event.preventDefault();
    setLocation(href);
  }

  return <>
    <aside aria-label="Website preview controls" className="relative z-40 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 bg-[#182b36] px-4 py-2 text-white sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <LockKeyhole size={17} aria-hidden="true" className="shrink-0" />
        <p className="text-sm font-semibold">Private website preview{settings.identity.name && ` · ${settings.identity.name}`}</p>
      </div>
      <a href={adminPath} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-white underline underline-offset-4">
        <ArrowLeft size={16} aria-hidden="true" /> Back to dealership setup
      </a>
    </aside>
    <div className="private-website-preview" onClickCapture={keepWebsiteLinksInPreview} onSubmitCapture={event => {
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
              <h1 className="text-3xl font-bold">{location === '/enquire' ? 'Customer enquiries' : 'This page is unavailable in the preview'}</h1>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">This preview is read only. Return to Platform Admin to manage the dealership.</p>
            </section></Route>
          </Switch>
        </Suspense>
      </Layout></SavedCarsProvider></StockProvider>
    </div>
  </>;
}

export default function PlatformWebsitePreview({ base }: { base: string }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <Router base={base}><QueryClientProvider client={queryClient}><TooltipProvider>
    <PreviewWebsite base={base} />
  </TooltipProvider></QueryClientProvider></Router>;
}
