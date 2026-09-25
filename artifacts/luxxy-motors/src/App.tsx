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
import Home from '@/pages/home';
const CarDetail = lazy(() => import("@/pages/car-detail"));
const Saved = lazy(() => import("@/pages/saved"));
const Compare = lazy(() => import("@/pages/compare"));
const Portal = lazy(() => import("@/pages/portal"));
const Enquire = lazy(() => import("@/pages/enquire"));
const Contact = lazy(() => import('@/pages/contact'));
const Warranty = lazy(() => import('@/pages/warranty'));
const Viewing = lazy(() => import("@/pages/viewing"));
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
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
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
  return (
    <Layout>
      <RoutedErrorBoundary>
        <Suspense fallback={<RouteLoading />}>
          <Switch>
          <Route path="/"><Home key="home" /></Route>
          <Route path="/stock"><Home key="stock" browseStock /></Route>
          <Route path="/vehicle/:id" component={CarDetail} />
          <Route path="/saved" component={Saved} />
          <Route path="/compare" component={Compare} />
          <Route path="/portal" component={Portal} />
          <Route path="/portal/leads/:id" component={Portal} />
          <Route path="/enquire" component={Enquire} />
          <Route path="/contact" component={Contact} />
          <Route path="/warranty" component={Warranty} />
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
    </Layout>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

/** Clears cached portal data when the signed-in staff member changes. */
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const cache = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        cache.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, cache]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

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
            subtitle: 'Staff access to the Luxxy Motors staff portal',
          },
        },
        signUp: {
          start: {
            title: 'Create your staff account',
            subtitle: 'Staff access to the Luxxy Motors staff portal',
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <StockProvider>
            <SavedCarsProvider>
              <Router />
            </SavedCarsProvider>
          </StockProvider>
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
