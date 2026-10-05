import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { SignInButton, UserButton, useAuth, useUser } from '@clerk/react';
import {
  getGetPortalSessionQueryKey,
  useGetPortalSession,
} from '@workspace/api-client-react';
import {
  BookmarkCheck,
  CalendarClock,
  LoaderCircle,
  Lock,
  FileText,
  Plus,
  Settings2,
  LayoutDashboard,
  History,
  MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DealerDashboard, DealerSettingsHub, useStaffAccess } from '@/components/portal/dealer-administration';
import { EnquiriesPanel } from '@/components/portal/enquiries-panel';
import { TestDriveBookingsPanel } from '@/components/portal/test-drive-bookings-panel';
import { StripeReservationsPanel } from '@/components/portal/stripe-reservations-panel';
import { ReservationsPanel } from '@/components/portal/reservations-panel';
import { RelationshipsPanel } from '@/components/portal/relationships-panel';
import { ChatPanel } from '@/components/portal/chat-panel';
import { ChatUnreadBadge } from '@/components/portal/chat-notifications';
import { SalesWorkspace } from '@/pages/sales-demo';

type TabKey = 'overview' | 'enquiries' | 'chat' | 'sales' | 'test-drives' | 'reservations' | 'history' | 'settings';

const tabs: Array<{ key: TabKey; label: string; icon: typeof Settings2 }> = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'enquiries', label: 'Enquiries', icon: CalendarClock },
  { key: 'chat', label: 'Chat', icon: MessageSquare },
  { key: 'sales', label: 'Sales', icon: FileText },
  { key: 'test-drives', label: 'Test drives', icon: CalendarClock },
  { key: 'reservations', label: 'Reservations', icon: BookmarkCheck },
  { key: 'history', label: 'History', icon: History },
  { key: 'settings', label: 'Settings', icon: Settings2 },
];

function PortalFrame({
  children,
  kicker,
  title,
  blurb,
}: {
  children: React.ReactNode;
  kicker: string;
  title: string;
  blurb: string;
}) {
  return (
    <div className="portal-premium-workspace portal-access-screen luxxy-shell min-h-[calc(100dvh-var(--site-header-height))] bg-background px-4 py-16">
      <div className="portal-access-card luxxy-surface mx-auto max-w-xl rounded-lg border border-border p-10 text-center">
        <p className="luxxy-kicker mx-auto mb-4 justify-center text-[12px]">
          <Lock className="h-4 w-4" /> {kicker}
        </p>
        <h1 className="font-display text-4xl font-semibold tracking-[-.04em] text-primary">
          {title}
        </h1>
        <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground">{blurb}</p>
        <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:justify-center">{children}</div>
      </div>
    </div>
  );
}

function AccessDenied({ email }: { email: string | null }) {
  return (
    <PortalFrame
      kicker="Staff access"
      title="Access unavailable"
      blurb={
        email
          ? `${email} is signed in, but it is not on the staff list for this dealership.`
          : 'This account is not on the staff list for this dealership.'
      }
    >
        <div className="rounded-md border border-border bg-card p-1 shadow-none">
        <UserButton />
      </div>
      <Button asChild variant="outline">
        <Link href="/">Back to showroom</Link>
      </Button>
    </PortalFrame>
  );
}

function PortalDesk() {
  const [tab, setTab] = useState<TabKey>(() => {
    const section = new URLSearchParams(window.location.search).get('section');
    return tabs.some(item => item.key === section) ? section as TabKey : 'overview';
  });
  const { user } = useUser();
  const [salesOpened, setSalesOpened] = useState(tab === 'sales');
  const [newSaleRequest, setNewSaleRequest] = useState(0);
  const sectionNav = useRef<HTMLElement>(null);
  const search = useSearch();
  const [, navigate] = useLocation();

  const sessionQuery = useGetPortalSession({
    query: {
      queryKey: getGetPortalSessionQueryKey(),
      retry: false,
      staleTime: 60_000,
    },
  });
  const access = useStaffAccess(sessionQuery.data?.state === 'allowed');
  useEffect(() => { const section = new URLSearchParams(search).get('section'); if (tabs.some(item => item.key === section)) { setTab(section as TabKey); if (section === 'sales') setSalesOpened(true); } }, [search]);
  const canSell = access.data?.permissions.includes('sales.manage') ?? false;
  const visibleTabs = tabs.filter(item => item.key !== 'settings' || access.data?.permissions.includes('settings.publish'));

  useEffect(() => {
    const navigation = sectionNav.current;
    if (!navigation) return;
    const revealCurrent = () => {
      const current = navigation.querySelector<HTMLButtonElement>('[aria-current="page"]');
      if (!current) return;
      const item = current.getBoundingClientRect();
      const viewport = navigation.getBoundingClientRect();
      if (item.left < viewport.left) navigation.scrollLeft -= viewport.left - item.left;
      else if (item.right > viewport.right) navigation.scrollLeft += item.right - viewport.right;
    };
    revealCurrent();
    const observer = new ResizeObserver(revealCurrent);
    observer.observe(navigation);
    return () => observer.disconnect();
  }, [tab, sessionQuery.isLoading, sessionQuery.data?.state]);

  if (sessionQuery.isLoading) {
    return (
      <div className="portal-premium-workspace portal-loading-state flex min-h-[60vh] items-center justify-center bg-background text-primary" role="status">
        <LoaderCircle className="mr-3 h-6 w-6 animate-spin text-accent" />
        <span className="font-display text-[14px] font-semibold tracking-normal">Loading your workspace…</span>
      </div>
    );
  }

  const requestStatus = sessionQuery.error && 'status' in sessionQuery.error
    ? sessionQuery.error.status
    : undefined;

  if (sessionQuery.data?.state === 'forbidden' || requestStatus === 403) {
    return (
      <AccessDenied
        email={
          sessionQuery.data?.email ??
          user?.primaryEmailAddress?.emailAddress ??
          null
        }
      />
    );
  }

  if (sessionQuery.isError) {
    return (
      <PortalFrame
        kicker="Staff portal"
        title="Unable to load your workspace"
        blurb="We couldn’t check your staff access. Please try again in a moment."
      >
        <Button type="button" onClick={() => void sessionQuery.refetch()} disabled={sessionQuery.isFetching}>
          {sessionQuery.isFetching ? 'Checking access…' : 'Try again'}
        </Button>
        <Button asChild variant="outline"><Link href="/">Back to showroom</Link></Button>
      </PortalFrame>
    );
  }

  const staffName =
    sessionQuery.data?.name ?? user?.firstName ?? sessionQuery.data?.email ?? 'there';

  return (
    <div data-section={tab} className="portal-workspace portal-premium-workspace luxxy-shell min-h-[70vh] bg-background px-4 py-5 sm:py-6">
      <div className="portal-workspace-inner mx-auto">
        <header className="portal-workspace-heading mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <p className="portal-workspace-eyebrow luxxy-kicker mb-1 text-[11px]">
              <Settings2 className="h-4 w-4" /> Staff portal
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-primary">
              Dealership workspace
            </h1>
            <p className="portal-staff-name mt-1 text-sm text-muted-foreground">
              Signed in as {staffName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canSell && <Button type="button" className="portal-new-sale" onClick={() => { setSalesOpened(true); setTab('sales'); navigate('/portal?section=sales'); setNewSaleRequest(request => request + 1); }}><Plus className="h-4 w-4" aria-hidden="true" />New sale</Button>}
            <div className="rounded-md border border-border bg-card p-1 shadow-none">
              <UserButton />
            </div>
          </div>
        </header>

          <div className="min-w-0">
            <nav
              ref={sectionNav}
              className="portal-section-nav mb-5 flex max-w-full gap-0.5 overflow-x-auto border-b border-border"
              aria-label="Portal sections"
            >
              {visibleTabs.map(({ key, label, icon: Icon }) => {
                const active = tab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { if (key === 'sales') setSalesOpened(true); setTab(key); navigate(`/portal?section=${key}`); }}
                    id={`portal-section-${key}`}
                    aria-controls={`portal-content-${key}`}
                    aria-current={active ? 'page' : undefined}
                    data-testid={`tab-${key}`}
                    className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-sm border px-3 sm:px-5 py-3 font-display text-[11px] font-semibold tracking-normal transition-all ${
                      active
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:bg-secondary hover:text-primary'
                    }`}
                  >
                    <Icon className="hidden h-4 w-4 sm:block" />
                    {label}
                    {key === 'chat' && <ChatUnreadBadge />}
                  </button>
                );
              })}
            </nav>

            <div className="portal-section-content min-h-[50vh]">
              {tab !== 'sales' && <div role="region" id={`portal-content-${tab}`} aria-labelledby={`portal-section-${tab}`}>
              {tab === 'overview' && <DealerDashboard />}
              {tab === 'enquiries' && <EnquiriesPanel />}
              {tab === 'chat' && <ChatPanel />}
              {tab === 'test-drives' && <TestDriveBookingsPanel />}
              {tab === 'reservations' && <><ReservationsPanel /><StripeReservationsPanel /></>}
              {tab === 'history' && <RelationshipsPanel />}
              {tab === 'settings' && <DealerSettingsHub />}
              </div>}
              {salesOpened && <div hidden={tab !== 'sales'} role="region" id="portal-content-sales" aria-labelledby="portal-section-sales"><SalesWorkspace embedded newSaleRequest={newSaleRequest} onExit={() => setTab('enquiries')} /></div>}
            </div>
          </div>

        <div className="portal-workspace-footer mt-12 flex justify-between border-t border-primary/20 pt-6">
          <Link
            href="/"
            className="font-display text-[12px] font-semibold tracking-normal text-primary underline-offset-4 hover:text-accent hover:underline"
          >
            Back to showroom
          </Link>
        </div>
      </div>


    </div>
  );
}

export default function Portal() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="portal-premium-workspace portal-loading-state flex min-h-[60vh] items-center justify-center bg-background text-primary" role="status">
        <LoaderCircle className="mr-3 h-6 w-6 animate-spin text-accent" />
        <span className="font-display text-[14px] font-semibold tracking-normal">Checking staff access…</span>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <PortalFrame
        kicker="Staff portal"
        title="Sign in to your staff portal"
        blurb="Sign in with your dealership staff account to manage enquiries, sales drafts, appointments, reservations and dealership settings."
      >
        <SignInButton mode="redirect">
          <Button data-testid="button-portal-sign-in">
            Sign in
          </Button>
        </SignInButton>
        <Button asChild variant="outline">
          <Link href="/">Back to showroom</Link>
        </Button>
      </PortalFrame>
    );
  }

  return <PortalDesk />;
}
