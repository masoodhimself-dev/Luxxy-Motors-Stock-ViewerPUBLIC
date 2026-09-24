import RetiredSalesPage from '@/pages/retired-sales';
import { lazy, Suspense } from "react";
import { RouteLoading } from "@/components/route-loading";
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Router, Switch } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Layout } from '@/components/layout';
import { RouteScrollReset } from '@/components/route-scroll-reset';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { StockProvider } from '@/lib/stock-context';
import { SavedCarsProvider } from '@/lib/saved-cars-context';
const Portal = lazy(() => import("@/pages/portal"));
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
const CarDetail = lazy(() => import("@/pages/car-detail"));
const Saved = lazy(() => import("@/pages/saved"));
const Compare = lazy(() => import("@/pages/compare"));
const Enquire = lazy(() => import("@/pages/enquire"));
const Contact = lazy(() => import('@/pages/contact'));
const Warranty = lazy(() => import('@/pages/warranty'));
const Viewing = lazy(() => import("@/pages/viewing"));
import './index.css';

// This entry point is selected only by vite.preview.config.ts during development.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Router>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <StockProvider>
            <SavedCarsProvider>
              <RouteScrollReset />
              <Layout>
                <Suspense fallback={<RouteLoading />}>
                  <Switch>
                  <Route path="/portal" component={Portal} />
                  <Route path="/portal/leads/:id" component={Portal} />
                  <Route path="/" component={Home} />
                  <Route path="/vehicle/:id" component={CarDetail} />
                  <Route path="/saved" component={Saved} />
                  <Route path="/compare" component={Compare} />
                  <Route path="/enquire" component={Enquire} />
                  <Route path="/contact" component={Contact} />
                  <Route path="/warranty" component={Warranty} />
                  <Route path="/viewing/:token" component={Viewing} />
                  <Route path="/sign/:token" component={RetiredSalesPage} />
                  <Route path="/customer-details/:token" component={RetiredSalesPage} />
                  <Route component={NotFound} />
                </Switch>
                </Suspense>
              </Layout>
              <aside className="pointer-events-none fixed right-3 top-[4.9rem] z-30 rounded-full bg-primary px-3 py-1 text-[10px] font-medium text-primary-foreground shadow-sm" aria-label="Preview mode">Local preview · Reservations saved locally · Payments simulated</aside>
            </SavedCarsProvider>
          </StockProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </Router>
  </ErrorBoundary>,
);
