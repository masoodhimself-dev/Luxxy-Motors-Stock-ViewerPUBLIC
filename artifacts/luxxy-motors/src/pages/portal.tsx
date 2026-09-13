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
    <div className="luxxy-shell min-h-[calc(100dvh-var(--site-header-height))] bg-background px-4 py-16">
      <div className="luxxy-surface mx-auto max-w-xl rounded-[1.25rem] border border-primary/10 p-10 text-center">
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
      kicker="NO ENTRY"
      title="ACCESS DENIED"
      blurb={
        email
          ? `${email} is signed in, but it is not on the staff list for this dealership.`
          : 'This account is not on the staff list for this dealership.'
      }
    >
        <div className="rounded-xl border border-primary/10 bg-card p-1 shadow-none">
        <UserButton />
      </div>
      <Button asChild variant="outline">
        <Link href="/">Back to showroom</Link>
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
      <div className="flex min-h-[60vh] items-center justify-center bg-background text-primary">
        <LoaderCircle className="mr-3 h-6 w-6 animate-spin text-accent" />
        <span className="font-display text-[14px] font-black uppercase tracking-widest">Unlocking the desk…</span>
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
    <div className="portal-workspace luxxy-shell min-h-[70vh] bg-background px-4 py-10 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-col gap-6 border-b border-primary/10 pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="luxxy-kicker mb-2 text-[12px]">
              <Settings2 className="h-4 w-4" /> Sales desk
            </p>
            <h1 className="font-display text-4xl font-semibold tracking-[-.05em] text-primary sm:text-5xl">
              MORNING, {staffName}.
            </h1>
            <p className="mt-4 max-w-2xl border-l-2 border-accent/60 pl-4 text-sm leading-relaxed text-muted-foreground">
              Everything waiting on you, in the order it needs doing.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Button
              type="button"
              onClick={() => setCapturing(true)}
              data-testid="button-new-lead"
            >
              <Plus className="mr-2 h-4 w-4" /> New lead
            </Button>
            <div className="rounded-xl border border-primary/10 bg-card p-1 shadow-none">
              <UserButton />
            </div>
          </div>
        </header>

        {matchesLead && leadParams?.id ? (
          <LeadDetail id={leadParams.id} onBack={closeLead} />
        ) : (
          <div className="luxxy-surface rounded-[1.25rem] border border-primary/10 p-4 sm:p-6 lg:p-8">
            <nav
              className="mb-8 flex flex-wrap gap-2 border-b border-primary/10 pb-6"
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
                    className={`inline-flex items-center justify-center gap-2 rounded-full border px-5 py-3 font-display text-[11px] font-semibold tracking-[0.06em] transition-all ${
                      active
                        ? 'border-primary bg-primary text-primary-foreground shadow-[0_6px_18px_hsl(var(--primary)/.16)]'
                        : 'border-primary/10 bg-background/60 text-primary/70 hover:border-accent/40 hover:bg-accent/10 hover:text-primary'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                );
              })}
            </nav>

            <div className="min-h-[50vh]">
              {tab === 'today' && <WorkQueue onOpenLead={openLead} />}
              {tab === 'leads' && <LeadList onOpenLead={openLead} />}
              {tab === 'deals' && <DealsPanel />}
              {tab === 'channels' && <ChannelSummary />}
              {tab === 'settings' && <DealerSettingsPanel />}
            </div>
          </div>
        )}

        <div className="mt-12 flex justify-between border-t-2 border-primary/20 pt-6">
          <Link
            href="/"
            className="font-display text-[12px] font-black uppercase tracking-[0.2em] text-primary underline-offset-4 hover:text-accent hover:underline"
          >
            Back to showroom
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
      <div className="flex min-h-[60vh] items-center justify-center bg-background text-primary">
        <LoaderCircle className="mr-3 h-6 w-6 animate-spin text-accent" />
        <span className="font-display text-[14px] font-black uppercase tracking-widest">Checking keys…</span>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <PortalFrame
        kicker="STAFF ONLY"
        title="THE DESK IS LOCKED"
        blurb="Sign in with your Luxxy Motors staff account to see enquiries, viewings and deals."
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