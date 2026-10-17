import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { SignInButton, UserButton, useAuth, useUser } from '@clerk/react';
import {
  getGetPortalSessionQueryKey,
  useGetPortalSession,
} from '@workspace/api-client-react';
import {
  BookmarkCheck,
  LoaderCircle,
  Lock,
  FileText,
  Plus,
  Settings2,
  House,
  CarFront,
  ExternalLink,
  History,
  MessageSquare,
  CalendarDays,
  Mail,
  UserRoundPlus,
  ChevronDown,
  CheckCircle2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DealerWordmark } from '@/components/brand/wordmark';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { DealerSettingsHub, useStaffAccess } from '@/components/portal/dealer-administration';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { QuickEnquiryDialog } from '@/components/portal/quick-enquiry';
import { StripeReservationsPanel } from '@/components/portal/stripe-reservations-panel';
import { ReservationsPanel } from '@/components/portal/reservations-panel';
import { RelationshipsPanel } from '@/components/portal/relationships-panel';
import { ChatPanel } from '@/components/portal/chat-panel';
import { ChatUnreadBadge } from '@/components/portal/chat-notifications';
import { SalesWorkspace } from '@/pages/sales-demo';
import { customerFeaturePolicy } from '@workspace/vehicle-meta';

import { NotificationsWorkspace } from '@/components/portal/notifications-workspace';
import { PortalInstallMetadata } from '@/components/portal/device-notifications';
import { isNotificationsSection, notificationHref } from '@/lib/notifications-navigation';
import { StaffInventory } from '@/components/portal/staff-inventory';

type TabKey = 'notifications' | 'inventory' | 'chat' | 'sales' | 'reservations' | 'history' | 'settings';

const tabs: Array<{ key: TabKey; label: string; icon: typeof Settings2 }> = [
  { key: 'notifications', label: 'Home', icon: House },
  { key: 'inventory', label: 'Cars', icon: CarFront },
  { key: 'chat', label: 'Chat', icon: MessageSquare },
  { key: 'sales', label: 'Sales', icon: FileText },
  { key: 'reservations', label: 'Reservations', icon: BookmarkCheck },
  { key: 'history', label: 'History', icon: History },
  { key: 'settings', label: 'Settings', icon: Settings2 },
];

function requestedSection(search: string): TabKey {
  const section = new URLSearchParams(search).get('section');
  if (isNotificationsSection(section) || section === 'chat' && !customerFeaturePolicy.websiteChat) return 'notifications';
  return tabs.some(item => item.key === section) ? section as TabKey : 'notifications';
}

/** One staff bar replaces the separate showroom header and workspace welcome. */
function PortalToolbar({ children, staffName, account }: { children?: React.ReactNode; staffName?: string; account?: React.ReactNode }) {
  const { settings } = useDealerSettings();
  return <header className="portal-toolbar" aria-label="Staff workspace">
    <div className="portal-toolbar-inner">
      <div className="portal-toolbar-identity">
        <Link href="/portal" className="portal-workspace-brand" aria-label={`${settings.identity.name || 'Dealership'} workspace`}>
          <DealerWordmark {...settings.identity} />
        </Link>
        <span className="portal-toolbar-label">Workspace</span>
      </div>
      <div className="portal-toolbar-actions">
        {children}
        <a href="/" target="_blank" rel="noopener noreferrer" className="portal-showroom-link" aria-label="View showroom (opens in a new tab)" title="View showroom in a new tab">
          <ExternalLink size={16} aria-hidden="true" /><span>View showroom</span>
        </a>
        {staffName && <span className="portal-account-name" title={`Signed in as ${staffName}`}>{staffName}</span>}
        {account && <div className="portal-account" aria-label="Staff account" title={staffName ? `Signed in as ${staffName}` : 'Staff account'}>{account}</div>}
      </div>
    </div>
  </header>;
}

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
    <><PortalToolbar /><div className="portal-premium-workspace portal-access-screen luxxy-shell min-h-[calc(100dvh-var(--site-header-height))] bg-background px-4 py-16">
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
    </div></>
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
  const [tab, setTab] = useState<TabKey>(() => requestedSection(window.location.search));
  const { user } = useUser();
  const [salesOpened, setSalesOpened] = useState(tab === 'sales');
  const [newSaleRequest, setNewSaleRequest] = useState(0);
  const [quickEnquiryOpen, setQuickEnquiryOpen] = useState(false);
  const [quickEnquiryVehicleId, setQuickEnquiryVehicleId] = useState<string | null>(null);
  const [quickCreated, setQuickCreated] = useState<{ id: string; reference: string } | null>(null);
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
  useEffect(() => {
    const requested = requestedSection(search);
    // Do not discard an owner's Settings bookmark while permissions are loading.
    const next = requested === 'settings' && access.data && !access.data.permissions.includes('settings.publish') ? 'notifications' : requested;
    setTab(next);
    if (next === 'sales') setSalesOpened(true);
  }, [search, access.data]);
  const canSell = access.data?.permissions.includes('sales.manage') ?? false;
  const visibleTabs = tabs.filter(item => (item.key !== 'chat' || customerFeaturePolicy.websiteChat)
    && (item.key !== 'settings' || access.data?.permissions.includes('settings.publish')));

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
  }, [tab, sessionQuery.isLoading, sessionQuery.data?.state, visibleTabs.length]);

  if (sessionQuery.isLoading) {
    return (
      <><PortalToolbar /><div className="portal-premium-workspace portal-loading-state flex min-h-[60vh] items-center justify-center bg-background text-primary" role="status">
        <LoaderCircle className="mr-3 h-6 w-6 animate-spin text-accent" />
        <span className="font-display text-[14px] font-semibold tracking-normal">Loading your workspace…</span>
      </div></>
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
  function newSale() {
    setSalesOpened(true);
    setTab('sales');
    navigate('/portal?section=sales');
    setNewSaleRequest(request => request + 1);
  }
  function quickEnquiry(vehicleId?: string) {
    setQuickEnquiryVehicleId(vehicleId || null);
    setQuickEnquiryOpen(true);
  }

  return (
    <div data-section={tab} className="portal-workspace portal-premium-workspace luxxy-shell min-h-[70vh] bg-background">
      <PortalInstallMetadata />
      <PortalToolbar staffName={staffName} account={<UserButton />}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button type="button" className="portal-quick-trigger" aria-label="Quick actions"><Plus size={16} aria-hidden="true" /><span className="portal-quick-full-label">Quick add</span><span className="portal-quick-short-label">Add</span><ChevronDown size={14} aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="portal-quick-menu">
            {canSell && <><DropdownMenuItem onSelect={() => quickEnquiry()}><UserRoundPlus aria-hidden="true" />Quick enquiry</DropdownMenuItem><DropdownMenuItem onSelect={newSale}><FileText aria-hidden="true" />New sale</DropdownMenuItem><DropdownMenuSeparator /></>}
            <DropdownMenuItem onSelect={() => navigate('/portal?section=notifications&workView=test-drives&deskView=calendar')}><CalendarDays aria-hidden="true" />Calendar</DropdownMenuItem>
            {canSell && <DropdownMenuItem onSelect={() => navigate('/portal?section=notifications&workView=email&view=drafts')}><Mail aria-hidden="true" />Saved email drafts</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </PortalToolbar>
      <h1 className="sr-only">Dealership workspace</h1>
      <div className="portal-workspace-inner mx-auto">
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

            {quickCreated && <div className="portal-quick-confirmation" role="status"><CheckCircle2 size={18} aria-hidden="true" /><span>Enquiry {quickCreated.reference} saved.</span><Link href={`/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(quickCreated.id)}`}>Open enquiry</Link><button type="button" aria-label="Dismiss confirmation" onClick={() => setQuickCreated(null)}><X size={16} aria-hidden="true" /></button></div>}

            <div className="portal-section-content min-h-[50vh]">
              {tab !== 'sales' && <div role="region" id={`portal-content-${tab}`} aria-labelledby={`portal-section-${tab}`}>
              {tab === 'notifications' && <NotificationsWorkspace canEmail={canSell} onQuickEnquiry={() => quickEnquiry()} onNewSale={newSale} />}
              {tab === 'inventory' && <StaffInventory onQuickEnquiry={canSell ? quickEnquiry : undefined} />}
              {tab === 'chat' && <ChatPanel />}
              {tab === 'reservations' && <><ReservationsPanel /><StripeReservationsPanel /></>}
              {tab === 'history' && <RelationshipsPanel />}
              {tab === 'settings' && <DealerSettingsHub />}
              </div>}
              {salesOpened && <div hidden={tab !== 'sales'} role="region" id="portal-content-sales" aria-labelledby="portal-section-sales"><SalesWorkspace embedded newSaleRequest={newSaleRequest} onExit={() => { setTab('notifications'); navigate(notificationHref('customers')); }} /></div>}
            </div>
          </div>


      </div>
      {canSell && <QuickEnquiryDialog open={quickEnquiryOpen} initialVehicleId={quickEnquiryVehicleId} onOpenChange={setQuickEnquiryOpen} onCreated={enquiry => { setQuickEnquiryOpen(false); setQuickCreated({ id: enquiry.id, reference: enquiry.reference }); }} />}
    </div>
  );
}

export default function Portal() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <><PortalToolbar /><div className="portal-premium-workspace portal-loading-state flex min-h-[60vh] items-center justify-center bg-background text-primary" role="status">
        <LoaderCircle className="mr-3 h-6 w-6 animate-spin text-accent" />
        <span className="font-display text-[14px] font-semibold tracking-normal">Checking staff access…</span>
      </div></>
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
