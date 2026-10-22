import { DemoNotice } from '@/components/demo-notice';
import RetiredSalesPage from '@/pages/retired-sales';
import { lazy, Suspense } from "react";
import { RouteLoading } from "@/components/route-loading";
import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, useClerk } from '@clerk/react';
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
import { clerkAppearance } from '@/lib/clerk-appearance';
import { Layout } from '@/components/layout';
import { RouteScrollReset } from '@/components/route-scroll-reset';
import { clearPortalPushSubscription } from '@/lib/portal-push';
import Home from '@/pages/home';
const JoinDealership = lazy(() => import('@/pages/join'));
const Platform = lazy(() => import('@/pages/platform'));
const CarDetail = lazy(() => import("@/pages/car-detail"));
const Saved = lazy(() => import("@/pages/saved"));
const Compare = lazy(() => import("@/pages/compare"));
const PhoneShare = lazy(() => import('@/pages/phone-share'));
const StaffUpload = lazy(() => import("@/pages/staff-upload"));
const EnquiryPhotoUpload = lazy(() => import("@/pages/enquiry-photo-upload"));
const Portal = lazy(() => import("@/pages/portal"));
const Enquire = lazy(() => import("@/pages/enquire"));
const Contact = lazy(() => import('@/pages/contact'));
const Warranty = lazy(() => import('@/pages/warranty'));
const ReservationPaymentReturn = lazy(() => import("@/pages/reservation-payment-return"));
const CustomerSale = lazy(() => import("@/pages/customer-sale"));
const InvoiceVerification = lazy(() => import('@/pages/invoice-verification'));
const Viewing = lazy(() => import("@/pages/viewing"));
const TestDriveDeclaration = lazy(() => import('@/pages/test-drive-declaration'));
import NotFound from '@/pages/not-found';
const StaffSignIn = lazy(() =>
  import('@/pages/staff-access').then((module) => ({
    default: module.StaffSignIn,
  })),
);
const StaffSignUp = lazy(() =>
  import('@/pages/staff-access').then((module) => ({
    default: module.StaffSignUp,
  })),
);

const queryClient = new QueryClient();

// Use the dealership’s own Clerk application; proxying is optional.
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || import.meta.env.CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

// Clerk passes full paths to routerPush/routerReplace, but wouter's
// setLocation prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

function Router() {
  const [location] = useLocation();
  if (location.startsWith('/verify-invoice/')) return <RoutedErrorBoundary><Suspense fallback={<RouteLoading/>}><Route path="/verify-invoice/:saleId/:documentId/:token" component={InvoiceVerification}/></Suspense></RoutedErrorBoundary>;
  // Platform administration has its own identity and no dealership navigation or chat.
  if (location === '/phone-share') return <RoutedErrorBoundary><Suspense fallback={<RouteLoading />}><PhoneShare /></Suspense></RoutedErrorBoundary>;
  if (location === '/staff-upload') return <RoutedErrorBoundary><Suspense fallback={<RouteLoading />}><StaffUpload /></Suspense></RoutedErrorBoundary>;
  if (location === '/enquiry-photo-upload') return <RoutedErrorBoundary><Suspense fallback={<RouteLoading />}><EnquiryPhotoUpload /></Suspense></RoutedErrorBoundary>;
  if (/^\/sign-in(?:\/|$)/.test(location)) return <RoutedErrorBoundary><Suspense fallback={<RouteLoading />}><StaffSignIn /></Suspense></RoutedErrorBoundary>;
  if (/^\/sign-up(?:\/|$)/.test(location)) return <RoutedErrorBoundary><Suspense fallback={<RouteLoading />}><StaffSignUp /></Suspense></RoutedErrorBoundary>;
  if (location === '/join') return <RoutedErrorBoundary><Suspense fallback={<RouteLoading />}><JoinDealership /></Suspense></RoutedErrorBoundary>;
  if (location === '/platform') return <RoutedErrorBoundary><Suspense fallback={<RouteLoading />}><Platform /></Suspense></RoutedErrorBoundary>;
  return (
    <><DemoNotice/><Layout>
      <RoutedErrorBoundary>
        <Suspense fallback={<RouteLoading />}>
          <Switch>
          <Route path="/"><Home key="home" /></Route>
          <Route path="/stock"><Home key="stock" browseStock /></Route>
          <Route path="/vehicle/:id" component={CarDetail} />
          <Route path="/saved" component={Saved} />
          <Route path="/compare" component={Compare} />
          <Route path="/platform" component={Platform} />
          <Route path="/portal" component={Portal} />
          <Route path="/portal/leads/:id" component={Portal} />
          <Route path="/enquire" component={Enquire} />
          <Route path="/contact" component={Contact} />
          <Route path="/warranty" component={Warranty} />
          <Route path="/reserve/payment-return" component={ReservationPaymentReturn} />
                  <Route path="/my-purchase/:token" component={CustomerSale} />
          <Route path="/viewing/:token" component={Viewing} />
          <Route path="/sign/:token" component={RetiredSalesPage} />
          <Route path="/customer-details/:token" component={RetiredSalesPage} />
          {/* REQUIRED — the /*? optional wildcard is the only wouter syntax
              matching both the bare URL and Clerk's OAuth sub-paths. */}
          <Route path="/sign-in/*?" component={StaffSignIn} />
          <Route path="/sign-up/*?" component={StaffSignUp} />
          <Route component={NotFound} />
        </Switch>
        </Suspense>
      </RoutedErrorBoundary>
    </Layout></>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location} showCustomerHelp={!['/join', '/platform', '/staff-upload', '/enquiry-photo-upload'].includes(location)}>{children}</ErrorBoundary>;
}

/** Clears cached portal data when the signed-in staff member changes. */
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const cache = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      const identityChanged =
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId;
      if (identityChanged) cache.clear();
      // A fresh signed-out tab can still have an old device subscription.
      if (identityChanged || userId === null) void clearPortalPushSubscription();
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, cache]);

  return null;
}

function DealerProviders({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return /^\/sign-(?:in|up)(?:\/|$)/.test(location) || location === '/join' || location === '/platform' || location === '/staff-upload' || location.startsWith('/verify-invoice/') ? <>{children}</> : <StockProvider><SavedCarsProvider>{children}</SavedCarsProvider></StockProvider>;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  const [location] = useLocation();

  if (location === '/phone-share') return <RoutedErrorBoundary><Suspense fallback={<RouteLoading/>}><PhoneShare/></Suspense></RoutedErrorBoundary>;
  if (location === '/enquiry-photo-upload') return <RoutedErrorBoundary><Suspense fallback={<RouteLoading/>}><EnquiryPhotoUpload/></Suspense></RoutedErrorBoundary>;

  if (location.startsWith('/test-drive-declaration/')) return <RoutedErrorBoundary><Suspense fallback={<RouteLoading/>}><TestDriveDeclaration/></Suspense></RoutedErrorBoundary>;

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: 'Sign in',
            subtitle: import.meta.env.VITE_MULTI_TENANT_ENABLED === 'true' ? 'Sign in to your staff account' : 'Staff access to the Luxxy Motors staff portal',
          },
        },
        signUp: {
          start: {
            title: 'Create your staff account',
            subtitle: import.meta.env.VITE_MULTI_TENANT_ENABLED === 'true' ? 'Sign in to your staff account' : 'Staff access to the Luxxy Motors staff portal',
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <DealerProviders><Router /></DealerProviders>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <RouteScrollReset />
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
