import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

import { StockProvider } from '@/lib/stock-context';
import { SavedCarsProvider } from '@/lib/saved-cars-context';
import { Layout } from '@/components/layout';
import Home from '@/pages/home';
import CarDetail from '@/pages/car-detail';
import Saved from '@/pages/saved';
import Compare from '@/pages/compare';
import Portal from '@/pages/portal';
import Enquire from '@/pages/enquire';
import Signing from '@/pages/signing';
import CustomerDetails from '@/pages/customer-details';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/vehicle/:id" component={CarDetail} />
          <Route path="/saved" component={Saved} />
          <Route path="/compare" component={Compare} />
          <Route path="/portal" component={Portal} />
          <Route path="/enquire" component={Enquire} />
          <Route path="/sign/:token" component={Signing} />
          <Route path="/customer-details/:token" component={CustomerDetails} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Layout>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <StockProvider>
          <SavedCarsProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <Router />
            </WouterRouter>
          </SavedCarsProvider>
        </StockProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
