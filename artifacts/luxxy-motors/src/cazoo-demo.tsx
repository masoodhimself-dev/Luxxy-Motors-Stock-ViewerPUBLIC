/** Public read-only showroom entry. No Clerk, portal or development authentication. */
import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Router, Switch, Link } from 'wouter';
import { Layout } from './components/layout';
import { ErrorBoundary } from './components/error-boundary';
import { TooltipProvider } from './components/ui/tooltip';
import { Toaster } from './components/ui/toaster';
import { RouteScrollReset } from './components/route-scroll-reset';
import { RouteLoading } from './components/route-loading';
import { StockProvider } from './lib/stock-context';
import { SavedCarsProvider } from './lib/saved-cars-context';
import Home from './pages/home';
import './index.css';
const CarDetail = lazy(() => import('./pages/car-detail'));
const Saved = lazy(() => import('./pages/saved'));
const Compare = lazy(() => import('./pages/compare'));
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function ReadOnlyPage() { return <div className="mx-auto max-w-xl px-6 py-16"><h1 className="text-3xl font-semibold">Cazoo display test</h1><p className="my-5 text-base leading-7">This is a separate read-only example. Enquiries, bookings, staff access and payments are disabled. No request has been sent.</p><Link href="/stock" className="text-link">Return to the example stock</Link></div>; }
createRoot(document.getElementById('root')!).render(<ErrorBoundary><Router><QueryClientProvider client={client}><TooltipProvider><StockProvider><SavedCarsProvider>
  <div role="note" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1000, background: '#244c69', color: '#fff', padding: '10px 16px', textAlign: 'center', fontSize: 13 }}>Cazoo display test · Snapshot from 8 October 2026 · Enquiries, bookings and payments disabled</div>
  <RouteScrollReset /><div style={{ paddingBottom: 64 }}><Layout><Suspense fallback={<RouteLoading />}><Switch>
    <Route path="/"><Home browseStock /></Route><Route path="/stock"><Home browseStock /></Route><Route path="/vehicle/:id" component={CarDetail} /><Route path="/saved" component={Saved} /><Route path="/compare" component={Compare} /><Route component={ReadOnlyPage} />
  </Switch></Suspense></Layout></div><Toaster />
</SavedCarsProvider></StockProvider></TooltipProvider></QueryClientProvider></Router></ErrorBoundary>);
