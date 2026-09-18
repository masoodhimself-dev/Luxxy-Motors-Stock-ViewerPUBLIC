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
const FindMyCar = lazy(() => import('@/pages/find-my-car'));
const Enquire = lazy(() => import("@/pages/enquire"));
const Viewing = lazy(() => import("@/pages/viewing"));
const Signing = lazy(() => import("@/pages/signing"));
const CustomerDetails = lazy(() => import('@/pages/customer-details'));
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
                  <Route path="/find-my-car" component={FindMyCar} />
                  <Route path="/enquire" component={Enquire} />
                  <Route path="/viewing/:token" component={Viewing} />
                  <Route path="/sign/:token" component={Signing} />
                  <Route path="/customer-details/:token" component={CustomerDetails} />
                  <Route component={NotFound} />
                </Switch>
                </Suspense>
              </Layout>
              <aside className="pointer-events-none fixed right-3 top-[4.9rem] z-30 rounded-full bg-primary px-3 py-1 text-[10px] font-medium text-primary-foreground shadow-sm" aria-label="Preview mode">Preview · Archived stock · Writes disabled</aside>
            </SavedCarsProvider>
          </StockProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </Router>
  </ErrorBoundary>,
);
