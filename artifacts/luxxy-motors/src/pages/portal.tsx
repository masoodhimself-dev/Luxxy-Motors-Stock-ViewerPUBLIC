import { useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { SignInButton, UserButton, useAuth, useUser } from '@clerk/react';
import {
  getGetPortalSessionQueryKey,
  useGetPortalSession,
} from '@workspace/api-client-react';
import {
  BarChart3,
  ClipboardCheck,
  LoaderCircle,
  Lock,
  Plus,
  Settings2,
  Sun,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DealerSettingsPanel } from '@/components/dealer-settings-panel';
import { DealsPanel } from '@/components/portal/deals-panel';
import { ChannelSummary } from '@/components/portal/channel-summary';
import { LeadCapture } from '@/components/portal/lead-capture';
import { LeadDetail } from '@/components/portal/lead-detail';
import { LeadList } from '@/components/portal/lead-list';
import { WorkQueue } from '@/components/portal/work-queue';

type TabKey = 'today' | 'leads' | 'deals' | 'channels' | 'settings';

const tabs: Array<{ key: TabKey; label: string; icon: typeof Sun }> = [
  { key: 'today', label: 'Today', icon: Sun },
  { key: 'leads', label: 'Leads', icon: Users },
  { key: 'deals', label: 'Deals', icon: ClipboardCheck },
  { key: 'channels', label: 'Channels', icon: BarChart3 },
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
    <div className="luxxy-grain min-h-[calc(100dvh-var(--site-header-height))] bg-background px-4 py-16">
      <div className="mx-auto max-w-xl text-center">
        <p className="luxxy-kicker justify-center text-accent">
          <Lock className="h-3.5 w-3.5" /> {kicker}
        </p>
        <h1 className="mt-4 font-display text-3xl font-semibold tracking-[-.02em] text-primary sm:text-4xl">
          {title}
        </h1>
        <p className="luxxy-leader mx-auto mt-3">{blurb}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">{children}</div>
      </div>
    </div>
  );
}

/** Signed in, but this account is not on the staff list. */
function AccessDenied({ email }: { email: string | null }) {
  return (
    <PortalFrame
      kicker="No entry"
      title="This account cannot open the portal"
      blurb={
        email
          ? `${email} is signed in, but it is not on the staff list for this dealership.`
          : 'This account is not on the staff list for this dealership.'
      }
    >
      <UserButton />
      <Button asChild variant="outline" className="rounded-none">
        <Link href="/">Back to the showroom</Link>
      </Button>
    </PortalFrame>
  );
}

function PortalDesk() {
  const [, setLocation] = useLocation();
  const [matchesLead, leadParams] = useRoute('/portal/leads/:id');
  const [tab, setTab] = useState<TabKey>('today');
  const [capturing, setCapturing] = useState(false);
  const { user } = useUser();

  const sessionQuery = useGetPortalSession({
    query: {
      queryKey: getGetPortalSessionQueryKey(),
      retry: false,
      staleTime: 60_000,
    },
  });

  const openLead = (id: string) => setLocation(`/portal/leads/${id}`);
  const closeLead = () => setLocation('/portal');

  if (sessionQuery.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-background text-muted-foreground">
        <LoaderCircle className="mr-2 h-5 w-5 animate-spin text-accent" />
        Unlocking the desk…
      </div>
    );
  }

  if (sessionQuery.isError || sessionQuery.data?.state === 'forbidden') {
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

  const staffName =
    sessionQuery.data?.name ?? user?.firstName ?? sessionQuery.data?.email ?? 'there';

  return (
    <div className="luxxy-grain min-h-[70vh] bg-background px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="luxxy-kicker text-accent">Sales desk</p>
            <h1 className="mt-3 font-display text-4xl font-semibold tracking-[-.02em] text-primary sm:text-5xl">
              Morning, {staffName}.
            </h1>
            <p className="luxxy-leader mt-3 max-w-2xl">
              Everything waiting on you, in the order it needs doing.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              className="rounded-none text-[12px] font-bold uppercase tracking-[.1em]"
              onClick={() => setCapturing(true)}
              data-testid="button-new-lead"
            >
              <Plus className="mr-2 h-4 w-4" /> New lead
            </Button>
            <UserButton />
          </div>
        </header>

        <div className="luxxy-rule my-8" />

        {matchesLead && leadParams?.id ? (
          <LeadDetail id={leadParams.id} onBack={closeLead} />
        ) : (
          <>
            <nav
              className="mb-8 flex flex-wrap gap-px border border-border bg-border"
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
                    className={`inline-flex flex-1 items-center justify-center gap-2 px-4 py-3 text-[12px] font-bold uppercase tracking-[.1em] transition-colors ${
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-card text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                );
              })}
            </nav>

            {tab === 'today' && <WorkQueue onOpenLead={openLead} />}
            {tab === 'leads' && <LeadList onOpenLead={openLead} />}
            {tab === 'deals' && <DealsPanel />}
            {tab === 'channels' && <ChannelSummary />}
            {tab === 'settings' && <DealerSettingsPanel />}
          </>
        )}

        <div className="mt-12 flex justify-between border-t border-border pt-6">
          <Link
            href="/"
            className="text-[13px] font-semibold text-primary underline-offset-4 hover:text-accent hover:underline"
          >
            Back to the showroom
          </Link>
        </div>
      </div>

      {capturing && (
        <LeadCapture
          onClose={() => setCapturing(false)}
          onCreated={(id) => {
            setCapturing(false);
            openLead(id);
          }}
        />
      )}
    </div>
  );
}

export default function Portal() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-background text-muted-foreground">
        <LoaderCircle className="mr-2 h-5 w-5 animate-spin text-accent" />
        Checking the keys…
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <PortalFrame
        kicker="Staff only"
        title="The sales desk is locked"
        blurb="Sign in with your Luxxy Motors staff account to see enquiries, viewings and deals."
      >
        <SignInButton mode="redirect">
          <Button
            className="rounded-none text-[12px] font-bold uppercase tracking-[.1em]"
            data-testid="button-portal-sign-in"
          >
            Sign in
          </Button>
        </SignInButton>
        <Button asChild variant="outline" className="rounded-none">
          <Link href="/">Back to the showroom</Link>
        </Button>
      </PortalFrame>
    );
  }

  return <PortalDesk />;
}
