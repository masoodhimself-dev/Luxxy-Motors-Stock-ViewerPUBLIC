import { useState } from 'react';
import { Link } from 'wouter';
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
  Settings2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DealerSettingsPanel } from '@/components/dealer-settings-panel';
import { EnquiriesPanel } from '@/components/portal/enquiries-panel';
import { TestDriveBookingsPanel } from '@/components/portal/test-drive-bookings-panel';
import { ReservationsPanel } from '@/components/portal/reservations-panel';

type TabKey = 'enquiries' | 'test-drives' | 'reservations' | 'settings';

const tabs: Array<{ key: TabKey; label: string; icon: typeof Settings2 }> = [
  { key: 'enquiries', label: 'Enquiries', icon: CalendarClock },
  { key: 'test-drives', label: 'Test drives', icon: CalendarClock },
  { key: 'reservations', label: 'Reservations', icon: BookmarkCheck },
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
    <div className="luxxy-shell min-h-[calc(100dvh-var(--site-header-height))] bg-background px-4 py-16">
      <div className="luxxy-surface mx-auto max-w-xl rounded-lg border border-border p-10 text-center">
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
  const [tab, setTab] = useState<TabKey>(() => new URLSearchParams(window.location.search).get('section') === 'enquiries' ? 'enquiries' : 'settings');
  const { user } = useUser();

  const sessionQuery = useGetPortalSession({
    query: {
      queryKey: getGetPortalSessionQueryKey(),
      retry: false,
      staleTime: 60_000,
    },
  });


  if (sessionQuery.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-background text-primary">
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
    <div className="portal-workspace luxxy-shell min-h-[70vh] bg-background px-4 py-5 sm:py-6">
      <div className="mx-auto max-w-[1216px]">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <p className="luxxy-kicker mb-1 text-[11px]">
              <Settings2 className="h-4 w-4" /> Staff portal
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-primary">
              Dealership workspace
            </h1>
            <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
              Signed in as {staffName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-md border border-border bg-card p-1 shadow-none">
              <UserButton />
            </div>
          </div>
        </header>

          <div className="min-w-0">
            <nav
              className="mb-5 flex max-w-full gap-0.5 overflow-x-auto border-b border-border"
              aria-label="Portal sections"
            >
              {tabs.map(({ key, label, icon: Icon }) => {
                const active = tab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
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
                  </button>
                );
              })}
            </nav>

            <div className="min-h-[50vh]">
              {tab === 'enquiries' && <EnquiriesPanel />}
              {tab === 'test-drives' && <TestDriveBookingsPanel />}
              {tab === 'reservations' && <ReservationsPanel />}
              {tab === 'settings' && <DealerSettingsPanel />}
            </div>
          </div>

        <div className="mt-12 flex justify-between border-t border-primary/20 pt-6">
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
      <div className="flex min-h-[60vh] items-center justify-center bg-background text-primary">
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
        blurb="Sign in with your dealership staff account to manage test drives, reservations and dealership settings."
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
