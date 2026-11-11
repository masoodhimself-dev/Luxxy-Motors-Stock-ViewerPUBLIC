import { usePageMeta } from "@/hooks/use-page-meta";
import { StaffMotLookupDialog } from "@/components/mot-history";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { SignInButton, UserButton, useAuth, useUser } from "@clerk/react";
import { staffReturnUrl } from "@/lib/staff-return-url";
import {
  getGetPortalSessionQueryKey,
  useGetPortalSession,
} from "@workspace/api-client-react";
import {
  LoaderCircle,
  Lock,
  ExternalLink,
  CheckCircle2,
  X,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DealerWordmark } from "@/components/brand/wordmark";
import { isMultiChoiceWebsite } from "@/lib/multi-home-scope";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import {
  DealerSettingsHub,
  useStaffAccess,
} from "@/components/portal/dealer-administration";
import { PortalQuickActions } from "@/components/portal/portal-quick-actions";
import { PortalShell, portalSections, type PortalSection } from "@/components/portal/portal-shell";
import { TodayWorkspace, useTodayNotifications } from "@/components/portal/today-workspace";
import { LetterComposer } from "@/components/portal/letter-composer";
import { DirectEmailComposer } from "@/components/portal/direct-email-composer";
import { useStaffCars } from "@/components/portal/staff-cars-query";
import { workspaceStatus } from "@/components/portal/cars-workspace-model";
import { vehicleDisplayTitle, vehicleRegistration } from "@/lib/utils";
import {
  QuickEnquiryDialog,
  type QuickEnquiryResult,
} from "@/components/portal/quick-enquiry";
import {
  appointmentLabel,
  defaultBookingSettings,
} from "@/lib/test-drive-dates";
import { useDealerFeatures } from "@/lib/dealer-features";
import { CarsWorkspace } from "@/components/portal/cars-workspace";
import { BuyerDemandWorkspace } from "@/components/portal/stock-alerts";
import { SalesWorkspace } from "@/pages/sales-demo";

import { NotificationsWorkspace } from "@/components/portal/notifications-workspace";
import { PortalInstallMetadata } from "@/components/portal/device-notifications";
import { calendarHref, notificationHref, notificationView } from "@/lib/notifications-navigation";
import { ContextHistoryDialog } from "@/components/portal/history-links";
import {
  confirmSettingsNavigation,
  installSettingsNavigationGuard,
} from "@/lib/settings-navigation";

import "@/components/portal/portal-workspace.css";
import "@/components/portal/portal-redesign.css";
import "@/components/portal/dealer-portal-theme.css";
type Correspondence = "letter" | "email";

function requestedSection(search: string): PortalSection {
  const params = new URLSearchParams(search);
  const section = params.get("section");
  if (section === "cars" || section === "inventory") return "cars";
  if (section === "today" || section === "sales" || section === "settings") return section;
  if (notificationView(search) === "test-drives" && params.get("deskView") === "calendar") return "calendar";
  if (section || ["workView", "enquiryId", "enquiryAction", "enquiryReplyId", "compose", "draft", "deskView"].some(key => params.has(key))) return "notifications";
  return "today";
}

function PortalCars({
  canManage,
  onEnquiry,
  onSale,
  onOpenEnquiry,
}: {
  canManage: boolean;
  onEnquiry: (vehicleId: string, bookTestDrive?: boolean) => void;
  onSale: (vehicleId: string) => void;
  onOpenEnquiry: (id: string) => void;
}) {
  const { settings, isLoading, isError } = useDealerSettings();
  const features = useDealerFeatures();
  const bookingEnabled =
    !isLoading &&
    !isError &&
    !features.isLoading &&
    !features.isError &&
    features.enabled("testDriveBookings") &&
    (settings.testDriveBooking ?? defaultBookingSettings).enabled;
  return (
    <CarsWorkspace
      canManage={canManage}
      bookingEnabled={bookingEnabled}
      onEnquiry={onEnquiry}
      onSale={onSale}
      onOpenEnquiry={onOpenEnquiry}
    />
  );
}

function PortalToolbar() {
  const { settings } = useDealerSettings();
  return (
    <header className="portal-toolbar" aria-label="Staff workspace">
      <div className="portal-toolbar-inner">
        <div className="portal-toolbar-identity">
          <Link
            href="/portal"
            onClick={(event) => {
              if (
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey &&
                !event.altKey &&
                !confirmSettingsNavigation()
              )
                event.preventDefault();
            }}
            className="portal-workspace-brand"
            aria-label={`${settings.identity.name || "Dealership"} workspace`}
          >
            <DealerWordmark {...settings.identity} logoAsset={isMultiChoiceWebsite() ? '/brand/multi-choice-motors/multi-choice-wordmark.svg' : settings.identity.logoAsset} />
          </Link>
          <span className="portal-toolbar-label">Workspace</span>
        </div>
        <div className="portal-toolbar-actions">
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="portal-showroom-link"
            aria-label="View showroom (opens in a new tab)"
            title="View showroom in a new tab"
          >
            <ExternalLink size={16} aria-hidden="true" />
            <span>View showroom</span>
          </a>
        </div>
      </div>
    </header>
  );
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
    <>
      <PortalToolbar />
      <div className="portal-premium-workspace portal-access-screen luxxy-shell min-h-[calc(100dvh-var(--site-header-height))] bg-background px-4 py-16">
        <div className="portal-access-card luxxy-surface mx-auto max-w-xl rounded-lg border border-border p-10 text-center">
          <p className="luxxy-kicker mx-auto mb-4 justify-center text-[12px]">
            <Lock className="h-4 w-4" /> {kicker}
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-[-.04em] text-primary">
            {title}
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground">
            {blurb}
          </p>
          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:justify-center">
            {children}
          </div>
        </div>
      </div>
    </>
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
          : "This account is not on the staff list for this dealership."
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
  const {
    settings,
    isLoading: settingsLoading,
    isError: settingsError,
  } = useDealerSettings();
  const features = useDealerFeatures();
  // Observe stock already loaded by the Cars workspace without another request.
  const staffCars = useStaffCars(false);
  const [tab, setTab] = useState<PortalSection>(() =>
    requestedSection(window.location.search),
  );
  const { user } = useUser();
  const [salesOpened, setSalesOpened] = useState(tab === "sales");
  const [newSaleRequest, setNewSaleRequest] = useState(0);
  const [practiceSaleRequest, setPracticeSaleRequest] = useState(0);
  const [newSaleVehicleId, setNewSaleVehicleId] = useState<string | null>(null);
  const [quickEnquiryOpen, setQuickEnquiryOpen] = useState(false);
  const [quickBookTestDrive, setQuickBookTestDrive] = useState(false);
  const [motLookupOpen, setMotLookupOpen] = useState(false);
  const [correspondence, setCorrespondence] = useState<Correspondence | null>(null);
  const quickActionsTrigger = useRef<HTMLButtonElement>(null);
  const salesQuickActionsTrigger = useRef<HTMLButtonElement>(null);
  const motLookupTrigger = useRef<HTMLButtonElement | null>(null);
  const quickEnquiryTrigger = useRef<HTMLElement | null>(null);
  const correspondenceTrigger = useRef<HTMLElement | null>(null);
  const [quickEnquiryVehicleId, setQuickEnquiryVehicleId] = useState<
    string | null
  >(null);
  const [quickCreated, setQuickCreated] = useState<QuickEnquiryResult | null>(
    null,
  );
  const search = useSearch();
  const [, navigate] = useLocation();

  const sessionQuery = useGetPortalSession({
    query: {
      queryKey: getGetPortalSessionQueryKey(),
      retry: false,
      staleTime: 60_000,
    },
  });
  const access = useStaffAccess(sessionQuery.data?.state === "allowed");
  const todayNotifications = useTodayNotifications(tab === "today" && sessionQuery.data?.state === "allowed");
  useEffect(() => {
    const requested = requestedSection(search);
    // Do not discard an owner's Settings bookmark while permissions are loading.
    const next =
      requested === "settings" &&
      access.data &&
      !access.data.permissions.includes("settings.publish")
        ? "today"
        : requested;
    setTab(next);
    if (next === "sales") setSalesOpened(true);
  }, [search, access.data]);
  usePageMeta({
    title: `${portalSections[tab].label} | ${settings.identity.name || "Dealership"}`,
    description: "Private dealership staff workspace.",
    indexable: false,
  });
  const canSell = access.data?.permissions.includes("sales.manage") ?? false;
  const canRecordPayments = access.data?.permissions.includes("payments.record") ?? false;
  const canHandover = access.data?.permissions.includes("sales.handover") ?? false;
  const canWriteEmail = canSell && features.enabled("customerEmails");
  const bookingEnabled =
    !settingsLoading &&
    !settingsError &&
    !features.isLoading &&
    !features.isError &&
    features.enabled("testDriveBookings") &&
    (settings.testDriveBooking ?? defaultBookingSettings).enabled;
  const params = new URLSearchParams(search);
  const showBuyerDemand = tab === "cars" && params.get("carsView") === "buyer-demand";
  const selectedCarId = tab === "cars" && !showBuyerDemand ? params.get("carId") : null;
  const selectedCar = !staffCars.isError
    ? staffCars.data?.cars.find((car) => car.id === selectedCarId)
    : undefined;
  const actionVehicle = selectedCar
    ? {
        id: selectedCar.id,
        title: vehicleDisplayTitle(selectedCar),
        registration: vehicleRegistration(selectedCar),
        canBook: workspaceStatus(selectedCar) === "available",
        canStartSale:
          workspaceStatus(selectedCar) === "available" && !selectedCar.staff.sale,
      }
    : undefined;
  function go(href: string) {
    if (confirmSettingsNavigation()) navigate(href);
  }

  function openSection(section: PortalSection) {
    const href = section === "today" ? "/portal"
      : section === "calendar" ? calendarHref
      : section === "notifications" ? notificationHref("customers")
      : `/portal?section=${section}`;
    go(href);
  }

  if (sessionQuery.isLoading) {
    return (
      <>
        <PortalToolbar />
        <div
          className="portal-premium-workspace portal-loading-state flex min-h-[60vh] items-center justify-center bg-background text-primary"
          role="status"
        >
          <LoaderCircle className="mr-3 h-6 w-6 animate-spin text-accent" />
          <span className="font-display text-[14px] font-semibold tracking-normal">
            Loading your workspace…
          </span>
        </div>
      </>
    );
  }

  const requestStatus =
    sessionQuery.error && "status" in sessionQuery.error
      ? sessionQuery.error.status
      : undefined;

  if (sessionQuery.data?.state === "forbidden" || requestStatus === 403) {
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
        <Button
          type="button"
          onClick={() => void sessionQuery.refetch()}
          disabled={sessionQuery.isFetching}
        >
          {sessionQuery.isFetching ? "Checking access…" : "Try again"}
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Back to showroom</Link>
        </Button>
      </PortalFrame>
    );
  }

  const staffName =
    sessionQuery.data?.name ??
    user?.firstName ??
    sessionQuery.data?.email ??
    "there";
  function newSale(vehicleId?: string) {
    if (!canSell || !confirmSettingsNavigation()) return;
    setNewSaleVehicleId(vehicleId || null);
    setSalesOpened(true);
    setTab("sales");
    navigate("/portal?section=sales");
    setNewSaleRequest((request) => request + 1);
  }
  function practiceSale() {
    if (!canSell || !confirmSettingsNavigation()) return;
    if (tab !== "sales") {
      setSalesOpened(true);
      setTab("sales");
      navigate("/portal?section=sales");
    }
    setPracticeSaleRequest(request => request + 1);
  }
  function quickEnquiry(vehicleId?: string, bookTestDrive = false) {
    if (!canSell) return;
    quickEnquiryTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setQuickEnquiryVehicleId(vehicleId || null);
    setQuickBookTestDrive(bookTestDrive);
    setQuickEnquiryOpen(true);
  }
  function openCorrespondence(kind: Correspondence, trigger: HTMLElement | null) {
    correspondenceTrigger.current = trigger;
    setCorrespondence(kind);
  }

  return (
    <div
      data-section={tab}
      className="portal-workspace portal-premium-workspace portal-redesign luxxy-shell min-h-[70vh] bg-background"
    >
      <PortalInstallMetadata />
      {motLookupOpen && canSell && (
        <StaffMotLookupDialog
          returnFocusRef={motLookupTrigger}
          initialRegistration={actionVehicle?.registration}
          onClose={() => setMotLookupOpen(false)}
        />
      )}
      <PortalShell
        section={tab}
        staffName={staffName}
        staffRole={access.data?.role === "owner" ? "Owner" : access.data?.role === "accounts" ? "Accounts" : "Staff workspace"}
        inboxCount={todayNotifications.data?.counts?.enquiries}
        canOpenSettings={access.data?.permissions.includes("settings.publish") ?? false}
        onNavigate={openSection}
        account={<UserButton />}
        actions={
          <PortalQuickActions
            variant="new"
            canManage={canSell}
            bookingEnabled={bookingEnabled}
            vehicle={actionVehicle}
            triggerRef={quickActionsTrigger}
            onEnquiry={(vehicleId, bookTestDrive) => {
              quickEnquiry(vehicleId, bookTestDrive);
              quickEnquiryTrigger.current = quickActionsTrigger.current;
            }}
            onSale={newSale}
            onPracticeSale={practiceSale}
            onWriteLetter={() =>
              openCorrespondence("letter", quickActionsTrigger.current)
            }
            onWriteEmail={canWriteEmail
              ? () => openCorrespondence("email", quickActionsTrigger.current)
              : undefined}
            onMot={() => { motLookupTrigger.current = quickActionsTrigger.current; setMotLookupOpen(true); }}
            onCalendar={() => go(calendarHref)}
            onDrafts={() =>
              go("/portal?section=notifications&workView=email&view=drafts")
            }
          />
        }
      >
          {quickCreated && (
            <div className="portal-quick-confirmation" role="status">
              <CheckCircle2 size={18} aria-hidden="true" />
              <span>
                {quickCreated.appointmentAt ? (
                  <>
                    {quickCreated.appointmentStatus === "pending"
                      ? "Test-drive request saved"
                      : "Test drive booked"}{" "}
                    · {appointmentLabel(quickCreated.appointmentAt)}
                    {quickCreated.appointmentStatus === "pending"
                      ? " · Awaiting approval."
                      : "."}
                    {["failed", "unknown"].includes(
                      quickCreated.customerNotificationStatus || "",
                    ) && (
                      <small className="portal-quick-email-warning">
                        Booking saved. Confirmation email needs attention.
                      </small>
                    )}
                  </>
                ) : (
                  <>Enquiry saved.</>
                )}
              </span>
              <Link
                onClick={() => setQuickCreated(null)}
                href={`/portal?section=notifications&workView=${quickCreated.appointmentAt ? "test-drives" : "customers"}&enquiryId=${encodeURIComponent(quickCreated.id)}`}
              >
                {quickCreated.appointmentAt ? "Open booking" : "Open enquiry"}
              </Link>
              <button
                type="button"
                aria-label="Dismiss confirmation"
                onClick={() => setQuickCreated(null)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}

          <div className="portal-section-content min-h-[50vh]">
            {tab !== "sales" && (
              <div
                role="region"
                id={`portal-content-${tab}`}
                aria-label={portalSections[tab].label}
              >
                {tab === "today" && <TodayWorkspace
                  notifications={todayNotifications}
                  canManage={canSell}
                  canRecordPayments={canRecordPayments}
                  canHandover={canHandover}
                  accessLoading={access.isLoading}
                  retryAccess={access.isError ? access.refetch : undefined}
                />}
                {(tab === "notifications" || tab === "calendar") && (
                  <NotificationsWorkspace
                    canEmail={canSell}
                    onQuickEnquiry={() => quickEnquiry()}
                    onNewSale={() => newSale()}
                  />
                )}
                {tab === "cars" && (showBuyerDemand ? (
                  <BuyerDemandWorkspace canChangeSettings={access.data?.permissions.includes("settings.publish") ?? false} />
                ) : (
                  <PortalCars
                    canManage={canSell}
                    onEnquiry={quickEnquiry}
                    onSale={newSale}
                    onOpenEnquiry={(id) =>
                      go(
                        `/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(id)}`,
                      )
                    }
                  />
                ))}
                {tab === "settings" && <DealerSettingsHub />}
              </div>
            )}
            {salesOpened && (
              <div
                hidden={tab !== "sales"}
                role="region"
                id="portal-content-sales"
                aria-label="Sales"
              >
                <SalesWorkspace
                  embedded
                  quickActions={<PortalQuickActions canManage={canSell} bookingEnabled={bookingEnabled} vehicle={actionVehicle} triggerRef={salesQuickActionsTrigger}
                    onEnquiry={(vehicleId,bookTestDrive)=>{quickEnquiry(vehicleId,bookTestDrive);quickEnquiryTrigger.current=salesQuickActionsTrigger.current;}}
                    onSale={newSale} onPracticeSale={practiceSale}
                    onMot={() => { motLookupTrigger.current = salesQuickActionsTrigger.current; setMotLookupOpen(true); }}
                    onWriteLetter={()=>openCorrespondence("letter", salesQuickActionsTrigger.current)}
                    onWriteEmail={canWriteEmail
                      ? () => openCorrespondence("email", salesQuickActionsTrigger.current)
                      : undefined}
                    onCalendar={()=>go(calendarHref)}
                    onDrafts={()=>go('/portal?section=notifications&workView=email&view=drafts')}/>}
                  newSaleRequest={newSaleRequest}
                  practiceSaleRequest={practiceSaleRequest}
                  newSaleVehicleId={newSaleVehicleId}
                  onExit={() => {
                    setTab("notifications");
                    navigate(notificationHref("customers"));
                  }}
                />
              </div>
            )}
          </div>
      </PortalShell>
      <ContextHistoryDialog />
      {correspondence === "letter" && canSell && (
        <LetterComposer canEmail={canSell} returnFocusRef={correspondenceTrigger} onClose={() => setCorrespondence(null)} />
      )}
      {correspondence === "email" && canSell && (
        <DirectEmailComposer
          returnFocusRef={correspondenceTrigger}
          onClose={() => setCorrespondence(null)}
        />
      )}
      {canSell && (
        <QuickEnquiryDialog
          open={quickEnquiryOpen}
          returnFocusRef={quickEnquiryTrigger}
          initialVehicleId={quickEnquiryVehicleId}
          initialBookTestDrive={quickBookTestDrive}
          onOpenChange={setQuickEnquiryOpen}
          onContinueEnquiry={(id) => {
            setQuickEnquiryOpen(false);
            setQuickCreated(null);
            go(
              `/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(id)}`,
            );
          }}
          onCreated={(enquiry) => {
            setQuickEnquiryOpen(false);
            setQuickCreated(enquiry);
          }}
        />
      )}
    </div>
  );
}

export default function Portal() {
  useEffect(() => installSettingsNavigationGuard(), []);
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <>
        <PortalToolbar />
        <div
          className="portal-premium-workspace portal-loading-state flex min-h-[60vh] items-center justify-center bg-background text-primary"
          role="status"
        >
          <LoaderCircle className="mr-3 h-6 w-6 animate-spin text-accent" />
          <span className="font-display text-[14px] font-semibold tracking-normal">
            Checking staff access…
          </span>
        </div>
      </>
    );
  }

  if (!isSignedIn) {
    return (
      <PortalFrame
        kicker="Staff portal"
        title="Sign in to your staff portal"
        blurb="Sign in with your dealership staff account to manage customer enquiries, test drives, sales and dealership settings."
      >
        <SignInButton
          mode="redirect"
          forceRedirectUrl={staffReturnUrl(window.location.href)}
          signUpForceRedirectUrl={staffReturnUrl(window.location.href)}
        >
          <Button data-testid="button-portal-sign-in">Sign in</Button>
        </SignInButton>
        <Button asChild variant="outline">
          <Link href="/">Back to showroom</Link>
        </Button>
      </PortalFrame>
    );
  }

  return <PortalDesk />;
}
