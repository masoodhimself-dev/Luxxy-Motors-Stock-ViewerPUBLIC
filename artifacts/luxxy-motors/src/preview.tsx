import { captureInvitationToken } from '@/lib/account-invitation-token';
import { captureStockAlertToken } from '@/lib/stock-alert-token';
import { setBaseUrl } from '@workspace/api-client-react';
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
import { privateWebsitePreviewBase } from '@/lib/private-website-preview';
import { SharedStaffPortal } from '@/components/portal/shared-staff-portal';
import { exampleStaffDealerships } from '../preview/shared-staff-fixture';
const SalesDemo = lazy(() => import("@/pages/sales-demo"));
const JoinDealership = lazy(() => import('@/pages/join'));
const Platform = lazy(() => import("@/pages/platform"));
const PlatformWebsitePreview = lazy(() => import('@/pages/platform-website-preview'));
const Portal = lazy(() => import("@/pages/portal"));
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
const CarDetail = lazy(() => import("@/pages/car-detail"));
const Saved = lazy(() => import("@/pages/saved"));
const StockAlertAction = lazy(() => import('@/pages/stock-alert-action'));
const Enquire = lazy(() => import("@/pages/enquire"));
const Contact = lazy(() => import('@/pages/contact'));
const Warranty = lazy(() => import('@/pages/warranty'));
const InvoiceVerification = lazy(() => import('@/pages/invoice-verification'));
const Viewing = lazy(() => import("@/pages/viewing"));
const TestDriveDeclaration = lazy(() => import('@/pages/test-drive-declaration'));
const DeliveryEvidence = lazy(() => import('@/pages/delivery-evidence'));
const CustomerChecksPage = lazy(() => import('../preview/customer-checks-page'));
const PaymentRequest = lazy(() => import('@/pages/payment-request'));
const ReservationTestCheckout = lazy(() => import('../preview/reservation-test-checkout'));
import './index.css';

// This entry point is selected only by vite.preview.config.ts during development.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function PreviewLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return location === '/__preview/staff-login' || location === '/join' || location === '/platform' || location === '/verify-invoice' || location.startsWith('/verify-invoice/') || location.startsWith('/test-drive-declaration/') || location.startsWith('/delivery-evidence/') || location.startsWith('/payment-request/') || location === '/reservation-test-checkout' ? <>{children}</> : <Layout>{children}</Layout>;
}

const previewBase = privateWebsitePreviewBase();
const staffExample = exampleStaffDealerships.find(dealer => window.location.pathname.startsWith(`/dealers/${dealer.dealerId}/portal`));
const staffPreviewBase = staffExample ? `/dealers/${staffExample.dealerId}` : undefined;
if (staffPreviewBase) {
  const marker = document.createElement('meta');
  marker.name = 'dealeros-staff-portal';
  marker.content = 'local-preview';
  document.head.append(marker);
  setBaseUrl(staffPreviewBase);
} else if (previewBase) setBaseUrl(previewBase);
else {
  captureInvitationToken();
  captureStockAlertToken();
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    {previewBase ? <Suspense fallback={<RouteLoading />}><PlatformWebsitePreview base={previewBase} /></Suspense> : <Router base={staffPreviewBase}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <StockProvider>
            <SavedCarsProvider>
              <RouteScrollReset />
              <PreviewLayout>
                <Suspense fallback={<RouteLoading />}>
                  <Switch>
                  <Route path="/__preview/staff-login"><div role="note" className="bg-secondary px-6 py-3 text-sm">Local preview. This uses an example staff account.</div><SharedStaffPortal dealerId={null}>{null}</SharedStaffPortal></Route>
                  <Route path="/__preview/vehicle-checks" component={CustomerChecksPage} />
                  <Route path="/portal/sales-demo" component={SalesDemo} />
                  <Route path="/platform"><div role="note" className="mx-6 mt-5 rounded-lg bg-secondary p-4 text-sm">Local preview. Launch actions use example data.</div><Platform /></Route>
                  <Route path="/join" component={JoinDealership} />
                  <Route path="/portal">{staffExample
                    ? <SharedStaffPortal dealerId={staffExample.dealerId}><Portal /></SharedStaffPortal>
                    : <Portal />}</Route>
                  <Route path="/portal/leads/:id" component={Portal} />
                  <Route path="/"><Home key="home" /></Route>
                  <Route path="/stock"><Home key="stock" browseStock /></Route>
                  <Route path="/vehicle/:id" component={CarDetail} />
                  <Route path="/cars/:slug" component={CarDetail} />
                  <Route path="/s/:code" component={CarDetail} />
                  <Route path="/saved" component={Saved} />
                  <Route path="/stock-alerts/:action" component={StockAlertAction} />
                  <Route path="/enquire" component={Enquire} />
                  <Route path="/contact" component={Contact} />
                  <Route path="/warranty" component={Warranty} />
                  <Route path="/verify-invoice/*?" component={InvoiceVerification}/>
                  <Route path="/viewing/:token" component={Viewing} />
                  <Route path="/test-drive-declaration/:token" component={TestDriveDeclaration}/>
                  <Route path="/delivery-evidence/:token" component={DeliveryEvidence}/>
                  <Route path="/payment-request/:token" component={PaymentRequest}/>
                  <Route path="/reservation-test-checkout" component={ReservationTestCheckout} />
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
    </Router>}
  </ErrorBoundary>,
);
