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
import Home from '@/pages/home';
import CarDetail from '@/pages/car-detail';
import Saved from '@/pages/saved';
import Compare from '@/pages/compare';
import FindMyCar from '@/pages/find-my-car';
import Enquire from '@/pages/enquire';
import Viewing from '@/pages/viewing';
import Signing from '@/pages/signing';
import CustomerDetails from '@/pages/customer-details';
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
                <Switch>
                  <Route path="/" component={Home} />
                  <Route path="/vehicle/:id" component={CarDetail} />
                  <Route path="/saved" component={Saved} />
                  <Route path="/compare" component={Compare} />
                  <Route path="/find-my-car" component={FindMyCar} />
                  <Route path="/enquire" component={Enquire} />
                  <Route path="/viewing/:token" component={Viewing} />
                  <Route path="/sign/:token" component={Signing} />
                  <Route path="/customer-details/:token" component={CustomerDetails} />
                  <Route><p className="mx-auto max-w-xl px-6 py-20">Staff sign-in needs your Clerk and database settings. This local preview covers the customer showroom.</p></Route>
                </Switch>
              </Layout>
              <aside className="pointer-events-none fixed right-3 top-[4.9rem] z-[60] rounded-full bg-primary px-3 py-1 text-[10px] font-medium text-primary-foreground shadow-sm" aria-label="Preview mode">Local preview · Sample stock</aside>
            </SavedCarsProvider>
          </StockProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </Router>
  </ErrorBoundary>,
);
