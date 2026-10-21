import RetiredSalesPage from '@/pages/retired-sales';
import { lazy, Suspense } from "react";
import { RouteLoading } from "@/components/route-loading";
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Router, Switch, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Layout } from '@/components/layout';
import { RouteScrollReset } from '@/components/route-scroll-reset';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { StockProvider } from '@/lib/stock-context';
import { SavedCarsProvider } from '@/lib/saved-cars-context';
const SalesDemo = lazy(() => import("@/pages/sales-demo"));
const Platform = lazy(() => import("@/pages/platform"));
const PhoneShare = lazy(() => import("@/pages/phone-share"));
const StaffUpload = lazy(() => import("@/pages/staff-upload"));
const EnquiryPhotoUpload = lazy(() => import("@/pages/enquiry-photo-upload"));
const Portal = lazy(() => import("@/pages/portal"));
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
const CarDetail = lazy(() => import("@/pages/car-detail"));
const Saved = lazy(() => import("@/pages/saved"));
const Compare = lazy(() => import("@/pages/compare"));
const Enquire = lazy(() => import("@/pages/enquire"));
const Contact = lazy(() => import('@/pages/contact'));
const Warranty = lazy(() => import('@/pages/warranty'));
const ReservationPaymentReturn = lazy(() => import("@/pages/reservation-payment-return"));
const CustomerSale = lazy(() => import("@/pages/customer-sale"));
const InvoiceVerification = lazy(() => import('@/pages/invoice-verification'));
const Viewing = lazy(() => import("@/pages/viewing"));
const TestDriveDeclaration = lazy(() => import('@/pages/test-drive-declaration'));
import './index.css';

// This entry point is selected only by vite.preview.config.ts during development.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function PreviewLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return location === '/phone-share' || location === '/platform' || location === '/staff-upload' || location === '/enquiry-photo-upload' || location.startsWith('/verify-invoice/') || location.startsWith('/test-drive-declaration/') ? <>{children}</> : <Layout>{children}</Layout>;
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Router>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <StockProvider>
            <SavedCarsProvider>
              <RouteScrollReset />
              <PreviewLayout>
                <Suspense fallback={<RouteLoading />}>
                  <Switch>
                  <Route path="/portal/sales-demo" component={SalesDemo} />
                  <Route path="/platform"><div role="note" className="mx-6 mt-5 rounded-lg bg-secondary p-4 text-sm">Example dealerships · Domain activation and import credentials require the real backend.</div><Platform /></Route>
                  <Route path="/phone-share" component={PhoneShare} />
                  <Route path="/staff-upload" component={StaffUpload} />
                  <Route path="/enquiry-photo-upload" component={EnquiryPhotoUpload} />
                  <Route path="/portal" component={Portal} />
                  <Route path="/portal/leads/:id" component={Portal} />
                  <Route path="/"><Home key="home" /></Route>
                  <Route path="/stock"><Home key="stock" browseStock /></Route>
                  <Route path="/vehicle/:id" component={CarDetail} />
                  <Route path="/saved" component={Saved} />
                  <Route path="/compare" component={Compare} />
                  <Route path="/enquire" component={Enquire} />
                  <Route path="/contact" component={Contact} />
                  <Route path="/warranty" component={Warranty} />
                  <Route path="/reserve/payment-return" component={ReservationPaymentReturn} />
                  <Route path="/my-purchase/:token" component={CustomerSale} />
                  <Route path="/verify-invoice/:saleId/:documentId/:token" component={InvoiceVerification}/>
                  <Route path="/viewing/:token" component={Viewing} />
                  <Route path="/test-drive-declaration/:token" component={TestDriveDeclaration}/>
                  <Route path="/sign/:token" component={RetiredSalesPage} />
                  <Route path="/customer-details/:token" component={RetiredSalesPage} />
                  <Route component={NotFound} />
                </Switch>
                </Suspense>
              </PreviewLayout>
            </SavedCarsProvider>
          </StockProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </Router>
  </ErrorBoundary>,
);
