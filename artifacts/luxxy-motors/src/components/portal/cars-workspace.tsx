import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getGetEnquiriesQueryKey,
  type Enquiry,
} from "@workspace/api-client-react";
import {
  staffMotSummary,
  type MotHistory,
  type StaffMotSummary,
} from "@workspace/vehicle-meta";
import { useEnquirySummaries } from "@/lib/enquiry-summary-query";
import {
  applyReplyAttention,
  type ReplyAttention,
} from "@/lib/enquiry-reply-attention";
import {
  formatMileage,
  formatPrice,
  getSafeImageUrl,
  vehicleDisplayTitle,
  vehicleRegistration,
} from "@/lib/utils";
import {
  CarFront,
  MoreHorizontal,
  RefreshCw,
  Search,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EnquiryVehicleInformation,
  VehicleInformationBody,
} from "./enquiry-vehicle-information";
import { MotHistoryPanel } from "@/components/mot-history";
import {
  carInTab,
  carIssues,
  carNextStep,
  filterStaffCars,
  workspaceStatus,
  vehicleActivityById,
  type StaffCarsTab,
  type StaffCarsAttention,
  type CarsSort,
  type VehicleActivity,
  type VehicleCustomerActivity,
} from "./cars-workspace-model";
import { useStaffCars, staffCarsKey, type StaffCar } from "./staff-cars-query";
import { formatDateTime } from "./portal-ui";
import "./cars-workspace.css";
type CarsWorkspaceProps = {
  canManage: boolean;
  bookingEnabled: boolean;
  onEnquiry: (vehicleId: string, bookTestDrive?: boolean) => void;
  onSale: (vehicleId: string) => void;
  onOpenEnquiry?: (id: string) => void;
};
const inboxHref = (e: Enquiry) =>
  `/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(e.id)}`;
const date = (v: string) =>
  new Date(v.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  });
function CarPhoto({ car }: { car: StaffCar }) {
  const [failed, setFailed] = useState(false);
  const url = getSafeImageUrl(car.heroImage || car.images?.[0] || "");
  return (
    <span className="portal-car-photo">
      {url && !failed ? (
        <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <CarFront size={26} aria-hidden="true" />
      )}
    </span>
  );
}
export function StaffMotBadge({ summary }: { summary: StaffMotSummary }) {
  return (
    <span className="staff-mot-badge" data-tone={summary.tone}>
      <span className="staff-mot-dot" aria-hidden="true" />
      <span>
        {summary.label}
        {summary.date && <> · {date(summary.date)}</>}
      </span>
    </span>
  );
}
export function CustomerActivity({
  activity,
  onOpenEnquiry,
  replyStatus,
}: {
  activity?: VehicleActivity;
  onOpenEnquiry?: (enquiryId: string) => void;
  replyStatus?: "loading" | "unavailable";
}) {
  const cases = activity?.cases ?? [];
  const customers = activity?.customers ?? [];
  const followLink = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (
      !onOpenEnquiry ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    )
      return;
    event.preventDefault();
    onOpenEnquiry(id);
  };
  const customerLink = ({
    customer,
    task,
    presentation,
  }: VehicleCustomerActivity) => (
    <li key={customer.id}>
      <Link
        className="portal-car-customer"
        href={inboxHref(task)}
        onClick={(event) => followLink(event, task.id)}
      >
        <strong>{customer.customerName}</strong>{" "}
        <span data-tone={presentation.tone}>
          {presentation.state}
          {presentation.dueAt && (
            <> · {formatDateTime(presentation.dueAt)} (UK)</>
          )}
        </span>{" "}
        {(task.pendingEmailReplies ?? 0) > 1 && (
          <small>{task.pendingEmailReplies} customer replies to review</small>
        )}
      </Link>
    </li>
  );
  return (
    <div className="portal-car-activity">
      {cases.length ? (
        <>
          <p className="portal-car-activity-title">
            {cases.length} {cases.length === 1 ? "enquiry" : "enquiries"}
          </p>
          <ul
            className="portal-car-customer-list"
            aria-label="Customer enquiries"
          >
            {customers.slice(0, 2).map(customerLink)}
          </ul>
          {customers.length > 2 && (
            <details className="portal-car-cases">
              <summary>
                {customers.length - 2} more{" "}
                {customers.length - 2 === 1 ? "customer" : "customers"}
              </summary>
              <ul className="portal-car-customer-list">
                {customers.slice(2).map(customerLink)}
              </ul>
            </details>
          )}
        </>
      ) : (
        <span className="portal-car-muted">No enquiries yet</span>
      )}
      {replyStatus && cases.length > 0 && (
        <small className="portal-car-muted">
          {replyStatus === "loading"
            ? "Checking email reply status…"
            : "Email reply status unavailable"}
        </small>
      )}
      {activity?.nextFollowUp && (
        <Link
          className="portal-car-next-booking portal-car-next-followup"
          href={inboxHref(activity.nextFollowUp)}
          onClick={(event) => followLink(event, activity.nextFollowUp!.id)}
        >
          <span>Follow-up · {activity.nextFollowUp.customerName}</span>
          <strong>
            {formatDateTime(activity.nextFollowUp.followUpAt!)}{" "}
            <small>(UK)</small>
          </strong>
        </Link>
      )}
      {activity?.nextAppointment ? (
        <Link
          className="portal-car-next-booking"
          href={inboxHref(activity.nextAppointment)}
          onClick={(event) => followLink(event, activity.nextAppointment!.id)}
        >
          <span>Next test drive · {activity.nextAppointment.customerName}</span>
          <strong>
            {formatDateTime(activity.nextAppointment.appointmentAt!)}{" "}
            <small>(UK)</small>
          </strong>
        </Link>
      ) : (
        <span className="portal-car-muted">No upcoming test drive</span>
      )}
      {!!activity?.pendingAppointments.length && (
        <Link
          className="portal-car-pending"
          href={`/portal?section=notifications&workView=test-drives&enquiryId=${encodeURIComponent(activity.pendingAppointments[0].id)}`}
          onClick={(event) =>
            followLink(event, activity.pendingAppointments[0].id)
          }
        >
          {activity.pendingAppointments.length}{" "}
          {activity.pendingAppointments.length === 1 ? "request" : "requests"}{" "}
          awaiting approval
        </Link>
      )}
    </div>
  );
}

export function CarsWorkspace(props: CarsWorkspaceProps) {
  const { canManage, bookingEnabled, onEnquiry, onSale, onOpenEnquiry } = props;
  const query = useStaffCars(),
    client = useQueryClient(),
    searchParams = useSearch(),
    [, navigate] = useLocation();
  const params = new URLSearchParams(searchParams),
    carId = params.get("carId");
  const search = params.get("carsSearch") ?? "",
    tab = (
      ["all", "available", "reserved", "sold", "missing"].includes(
        params.get("carsTab") ?? "",
      )
        ? params.get("carsTab")
        : "all"
    ) as StaffCarsTab;
  const sort = (
    ["stock", "price-asc", "price-desc", "make"].includes(
      params.get("carsSort") ?? "",
    )
      ? params.get("carsSort")
      : "stock"
  ) as CarsSort;
  const attention = (
    ["all", "changed", "attention", "no-photos", "no-price", "reply"].includes(
      params.get("carsFilter") ?? "",
    )
      ? params.get("carsFilter")
      : "all"
  ) as StaffCarsAttention;
  const [panelId, setPanelId] = useState<string | null>(null),
    [mot, setMot] = useState<Record<string, MotHistory>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [viewOptions, setViewOptions] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null),
    lastCarId = useRef<string | null>(carId),
    opener = useRef<HTMLElement | null>(null),
    customersSection = useRef<HTMLElement | null>(null),
    moreTriggers = useRef(new Map<string, HTMLButtonElement>());
  const scrollKey = `staff-cars-scroll:${window.location.host}`;
  const setFilter = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams);
    p.set("section", "cars");
    p.delete("carId");
    if (value && value !== "all" && value !== "stock") p.set(key, value);
    else p.delete(key);
    navigate(`/portal?${p}`, { replace: true });
  };
  const carHref = (id?: string) => {
    const p = new URLSearchParams(searchParams);
    p.set("section", "cars");
    p.delete("contextHistory");
    p.delete("historyVehicle");
    p.delete("carView");
    if (id) p.set("carId", id);
    else p.delete("carId");
    return `/portal?${p}`;
  };
  const rememberScroll = () => {
    try {
      sessionStorage.setItem(scrollKey, String(window.scrollY));
    } catch {}
  };
  useEffect(() => {
    if (carId) {
      heading.current?.focus({ preventScroll: true });
      if (carId !== lastCarId.current) window.scrollTo(0, 0);
    } else if (lastCarId.current) {
      try {
        const saved = Number(sessionStorage.getItem(scrollKey));
        requestAnimationFrame(() => window.scrollTo(0, saved || 0));
      } catch {}
    }
    lastCarId.current = carId;
    setPanelId(null);
  }, [carId]);
  const activity = useEnquirySummaries(undefined, {
    query: {
      queryKey: getGetEnquiriesQueryKey(),
      enabled: canManage,
      staleTime: 60000,
      retry: false,
      refetchInterval: false,
    },
  });
  const replies = useQuery({
    queryKey: ["reply-attention"],
    queryFn: ({ signal }) =>
      customFetch<{ enquiries: ReplyAttention[] }>(
        "/api/staff/email/reply-attention",
        { signal },
      ),
    enabled: canManage,
    staleTime: 60000,
    retry: false,
    refetchInterval: false,
  });
  const now = Date.now();
  const activities = useMemo(
    () =>
      vehicleActivityById(
        canManage
          ? applyReplyAttention(
              activity.data ?? [],
              replies.data?.enquiries ?? [],
            )
          : [],
        now,
      ),
    [activity.data, replies.data, canManage, now],
  );
  const cars = query.data?.cars ?? [];
  const matches = filterStaffCars(
      cars,
      search,
      tab,
      sort,
      attention,
      activities,
    ),
    selected = cars.find((c) => c.id === carId),
    panel = cars.find((c) => c.id === panelId);
  const customerView = params.get("carView") === "customers";
  useEffect(() => {
    if (selected && customerView && canManage) {
      customersSection.current?.scrollIntoView({ block: "start" });
      customersSection.current?.focus({ preventScroll: true });
    }
  }, [selected?.id, customerView, canManage]);
  const adjacent = (id: string) => {
    const list = matches.some((c) => c.id === id)
      ? matches
      : cars.filter((c) => workspaceStatus(c) !== "hidden");
    const i = list.findIndex((c) => c.id === id);
    return {
      previous: list[i - 1],
      next: list[i + 1],
      index: i + 1,
      total: list.length,
    };
  };
  const onMot = useCallback(
    (history: MotHistory) => {
      const id = carId ?? panelId;
      if (id) setMot((old) => ({ ...old, [id]: history }));
      void client.invalidateQueries({ queryKey: staffCarsKey });
    },
    [carId, panelId, client],
  );
  const summary = (car: StaffCar) =>
    mot[car.id] ? staffMotSummary(mot[car.id]) : car.staff.mot;
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        query.refetch(),
        ...(canManage ? [activity.refetch(), replies.refetch()] : []),
      ]);
    } finally {
      setRefreshing(false);
    }
  };
  const openEnquiry = (id: string, booking = false) => {
    setPanelId(null);
    onEnquiry(id, booking);
  };
  const openSale = (id: string) => {
    setPanelId(null);
    onSale(id);
  };
  const safeActivity = (car: StaffCar) =>
    canManage ? activities.get(car.id) : undefined;
  const nextAction = (car: StaffCar, inFile = false) => {
    const action = carNextStep(car, safeActivity(car));
    if (inFile && (!canManage || action.kind === "details")) return null;
    if (!canManage)
      return (
        <Link
          className="cars-primary-action"
          href={carHref(car.id)}
          onClick={rememberScroll}
        >
          Open car
        </Link>
      );
    if (action.kind === "sale")
      return (
        <Link
          className="cars-primary-action"
          href={`/portal?section=sales&saleId=${encodeURIComponent(action.id)}`}
        >
          {action.label}
        </Link>
      );
    if (action.kind === "enquiry")
      return (
        <Link
          className="cars-primary-action"
          href={`/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(action.id)}`}
          onClick={(e) => {
            if (onOpenEnquiry && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              setPanelId(null);
              onOpenEnquiry(action.id);
            }
          }}
        >
          {action.label}
        </Link>
      );
    return action.kind === "new" ? (
      <Button size="sm" onClick={() => openEnquiry(car.id)}>
        New enquiry
      </Button>
    ) : (
      <Link className="cars-primary-action" href={carHref(car.id)}>
        Open car
      </Link>
    );
  };
  function moreMenu(car: StaffCar) {
    const available = workspaceStatus(car) === "available";
    return (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="portal-car-more"
            ref={(node) => {
              if (node) moreTriggers.current.set(car.id, node);
              else moreTriggers.current.delete(car.id);
            }}
            aria-label={`More options for ${vehicleDisplayTitle(car)}`}
          >
            <MoreHorizontal size={18} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="portal-car-menu" align="end">
          <DropdownMenuItem
            onSelect={() => {
              opener.current = moreTriggers.current.get(car.id) ?? null;
              setPanelId(car.id);
            }}
          >
            Quick view
          </DropdownMenuItem>
          {canManage && available && bookingEnabled && (
            <DropdownMenuItem onSelect={() => openEnquiry(car.id, true)}>
              Book test drive
            </DropdownMenuItem>
          )}
          {canManage && available && !car.staff.sale && (
            <DropdownMenuItem onSelect={() => openSale(car.id)}>
              Start sale
            </DropdownMenuItem>
          )}
          {car.staff.published && (
            <>
              <DropdownMenuItem asChild>
                <a
                  href={`/vehicle/${car.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View customer advert
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href={`/api/vehicles/${car.id}/brochure.pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Print vehicle sheet
                </a>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  function changeList(car: StaffCar) {
    return (
      <div className="cars-change-list">
        {car.staff.changes.map((change, i) => (
          <span key={i} title={`Changed ${formatDateTime(change.at)} (UK)`}>
            {change.label}
            {change.kind === "price" &&
              change.before != null &&
              change.after != null && (
                <>
                  {" "}
                  · {formatPrice(Math.abs(change.before - change.after), "GBP")}
                </>
              )}
          </span>
        ))}
      </div>
    );
  }
  function interest(car: StaffCar, expanded = false) {
    if (!canManage) return null;
    if (activity.isPending)
      return (
        <span className="portal-car-muted">Loading customer activity…</span>
      );
    if (activity.isError)
      return (
        <span className="portal-car-muted">Customer activity unavailable</span>
      );
    const a = activities.get(car.id),
      waiting =
        a?.customers.filter((c) => (c.task.pendingEmailReplies ?? 0) > 0)
          .length ?? 0;
    if (expanded)
      return (
        <CustomerActivity
          activity={a}
          onOpenEnquiry={onOpenEnquiry}
          replyStatus={
            replies.isError
              ? "unavailable"
              : replies.isPending
                ? "loading"
                : undefined
          }
        />
      );
    return (
      <div className="cars-interest">
        <Link
          href={carHref(car.id) + "&carView=customers"}
          onClick={rememberScroll}
        >
          {a?.cases.length ?? 0}{" "}
          {a?.cases.length === 1 ? "enquiry" : "enquiries"}
        </Link>
        {waiting > 0 && (
          <span className="cars-waiting">{waiting} awaiting reply</span>
        )}
        {a?.nextAppointment && (
          <Link href={inboxHref(a.nextAppointment)}>
            Test drive · {formatDateTime(a.nextAppointment.appointmentAt!)} (UK)
          </Link>
        )}
        {replies.isError && <small>Reply status unavailable</small>}
      </div>
    );
  }
  const listTabs = [
    ["all", "Current"],
    ["available", "Available"],
    ["reserved", "Reserved"],
    ["sold", "Sold"],
    ["missing", "Missing from feed"],
  ] as const;
  return (
    <section
      className="portal-cars-workspace"
      aria-labelledby="portal-cars-title"
      data-activity={canManage ? "visible" : "hidden"}
      data-options={viewOptions ? "open" : "closed"}
    >
      <header className="portal-cars-heading">
        <div>
          <p className="cars-eyebrow">Your dealership</p>
          <h2 id="portal-cars-title">{carId ? "Vehicle file" : "Cars"}</h2>
          <p>
            {carId
              ? "Vehicle information and customer work in one place."
              : "Find a car, view customer activity or continue a sale."}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void refresh()}
          disabled={refreshing || query.isPending}
        >
          <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Refreshing…" : "Refresh screen"}
        </Button>
      </header>
      {query.isError && (
        <div className="portal-cars-notice" role="alert">
          <strong>Cars could not be refreshed</strong>
          <p>
            {query.data
              ? "Showing saved information. Refresh before arranging a booking or sale."
              : "Please try again to load your dealership’s cars."}
          </p>
          <Button variant="outline" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      )}
      {canManage && (activity.isError || replies.isError) && (
        <div className="portal-cars-activity-notice" role="status">
          {activity.isError
            ? "Customer activity could not load."
            : "Email reply status unavailable; enquiries and bookings are still shown."}{" "}
          <button onClick={() => void refresh()}>
            Retry customer activity
          </button>
        </div>
      )}
      {query.isError && !query.data ? null : query.isPending && !query.data ? (
        <div className="portal-cars-loading" aria-label="Loading cars">
          {[1, 2, 3].map((n) => (
            <div key={n}>
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : carId ? (
        selected ? (
          <>
            <div className="cars-file-navigation">
              <Link href={carHref()} className="cars-back">
                <ArrowLeft size={16} /> Back to Cars
              </Link>
              <nav aria-label="Browse vehicle files">
                {adjacent(selected.id).previous && (
                  <Link
                    aria-label="Previous car"
                    href={carHref(adjacent(selected.id).previous.id)}
                  >
                    <ChevronLeft size={18} />
                  </Link>
                )}
                <span>
                  {adjacent(selected.id).index} of {adjacent(selected.id).total}
                </span>
                {adjacent(selected.id).next && (
                  <Link
                    aria-label="Next car"
                    href={carHref(adjacent(selected.id).next.id)}
                  >
                    <ChevronRight size={18} />
                  </Link>
                )}
              </nav>
            </div>
            <article className="cars-vehicle-file">
              <header className="cars-file-heading">
                <div>
                  <p className="portal-car-registration">
                    {vehicleRegistration(selected) ||
                      "Registration not supplied"}
                  </p>
                  <h3 ref={heading} tabIndex={-1}>
                    {vehicleDisplayTitle(selected)}
                  </h3>
                  <p>{selected.variant}</p>
                  <div className="cars-file-status">
                    <span
                      className="portal-car-status"
                      data-status={workspaceStatus(selected)}
                    >
                      {listTabs.find(
                        ([s]) => s === workspaceStatus(selected),
                      )?.[1] ?? "Not advertised"}
                    </span>
                    {selected.inventoryStatus === "reserved" &&
                      workspaceStatus(selected) === "missing" && (
                        <span
                          className="portal-car-status"
                          data-status="reserved"
                        >
                          Reserved
                        </span>
                      )}
                    <StaffMotBadge summary={summary(selected)} />
                  </div>
                </div>
                <strong className="cars-file-price">
                  {selected.price != null
                    ? formatPrice(selected.price, selected.currency)
                    : "Price not supplied"}
                </strong>
              </header>
              <div className="cars-file-actions">
                {nextAction(selected, true)}
                {canManage &&
                  workspaceStatus(selected) === "available" &&
                  bookingEnabled && (
                    <Button
                      variant="outline"
                      onClick={() => openEnquiry(selected.id, true)}
                    >
                      Book test drive
                    </Button>
                  )}
                {canManage &&
                  workspaceStatus(selected) === "available" &&
                  !selected.staff.sale && (
                    <Button
                      variant="outline"
                      onClick={() => openSale(selected.id)}
                    >
                      Start sale
                    </Button>
                  )}
                {selected.staff.published && (
                  <a
                    href={`/vehicle/${selected.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View customer advert ↗
                  </a>
                )}
              </div>
              <div className="cars-file-layout">
                <div className="cars-file-main">
                  <VehicleInformationBody
                    car={selected}
                    canManage={canManage}
                    includeMot={false}
                    published={selected.staff.published}
                  />
                </div>
                <aside className="cars-file-sidebar">
                  {canManage && (
                    <section
                      id="car-customers"
                      ref={customersSection}
                      tabIndex={-1}
                    >
                      <h4>Customers & appointments</h4>
                      {interest(selected, true)}
                    </section>
                  )}
                  <section>
                    <h4>MOT status</h4>
                    {selected.inventoryStatus === "reserved" &&
                      workspaceStatus(selected) === "missing" && (
                        <span
                          className="portal-car-status"
                          data-status="reserved"
                        >
                          Reserved
                        </span>
                      )}
                    <StaffMotBadge summary={summary(selected)} />
                    {summary(selected).lastMileage && (
                      <p>Last recorded: {summary(selected).lastMileage}</p>
                    )}
                    {summary(selected).checkedAt && (
                      <p>
                        Checked {formatDateTime(summary(selected).checkedAt!)}{" "}
                        (UK)
                      </p>
                    )}
                    {canManage && (
                      <MotHistoryPanel
                        key={selected.id}
                        vehicleId={selected.id}
                        staff
                        onHistory={onMot}
                      />
                    )}
                  </section>
                  <section>
                    <h4>Stock information</h4>
                    <p>
                      {selected.staff.source === "cazoo"
                        ? "Cazoo"
                        : "Auto Trader"}{" "}
                      · Feed-controlled details
                    </p>
                    <p>
                      Added to this website {date(selected.staff.firstSeenAt)}
                    </p>
                    <p>
                      Last seen in feed{" "}
                      {formatDateTime(selected.staff.lastSeenAt)} (UK)
                    </p>
                    {workspaceStatus(selected) === "missing" && (
                      <p>
                        Not included in the latest feed. This does not confirm a
                        sale.
                      </p>
                    )}
                    {changeList(selected)}
                    {selected.staff.changes
                      .filter((c) => c.kind === "price")
                      .map((c, i) => (
                        <p key={i}>
                          {c.before != null && formatPrice(c.before, "GBP")} →{" "}
                          {c.after != null && formatPrice(c.after, "GBP")} ·{" "}
                          {date(c.at)}
                        </p>
                      ))}
                    {carIssues(selected, safeActivity(selected)).map(
                      (issue) => (
                        <p className="cars-issue" key={issue}>
                          {issue}
                          {["No photos", "Missing price"].includes(issue)
                            ? ` · Update in ${selected.staff.source === "cazoo" ? "Cazoo" : "Auto Trader"}; the next feed supplies this information.`
                            : ""}
                        </p>
                      ),
                    )}
                  </section>
                </aside>
              </div>
            </article>
          </>
        ) : (
          !query.isError && (
            <div className="portal-cars-empty">
              <h3>Car not found</h3>
              <p>
                This vehicle may have been removed, or belongs to another
                dealership.
              </p>
              <Link className="cars-primary-action" href={carHref()}>
                Back to Cars
              </Link>
            </div>
          )
        )
      ) : (
        <>
          <div className="cars-sticky-controls">
            <div className="portal-cars-toolbar">
              <label className="portal-cars-search">
                <Search size={18} />
                <span className="sr-only">Search current cars</span>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setFilter("carsSearch", e.target.value)}
                  placeholder="Search make, model or registration"
                />
              </label>
              <label className="portal-cars-sort">
                <span className="sr-only">Sort cars</span>
                <NativeSelect
                  value={sort}
                  onChange={(e) => setFilter("carsSort", e.target.value)}
                >
                  <option value="stock">Stock order</option>
                  <option value="price-asc">Price: low to high</option>
                  <option value="price-desc">Price: high to low</option>
                  <option value="make">Make and model A–Z</option>
                </NativeSelect>
              </label>
            </div>
            <div className="portal-cars-filterbar">
              <div
                className="portal-cars-tabs"
                role="group"
                aria-label="Availability"
              >
                {listTabs.map(([value, label]) => (
                  <button
                    key={value}
                    aria-pressed={tab === value}
                    onClick={() => setFilter("carsTab", value)}
                  >
                    {label}{" "}
                    <span>{cars.filter((c) => carInTab(c, value)).length}</span>
                  </button>
                ))}
              </div>
              <label className="cars-attention">
                <span className="sr-only">Focus cars</span>
                <NativeSelect
                  value={attention}
                  onChange={(e) => setFilter("carsFilter", e.target.value)}
                >
                  <option value="all">All cars in this view</option>
                  <option value="changed">Changed in last update</option>
                  <option value="attention">Needs attention</option>
                  <option value="no-photos">No photos</option>
                  <option value="no-price">Missing price</option>
                  {canManage && (
                    <option value="reply">Awaiting customer reply</option>
                  )}
                </NativeSelect>
              </label>
            </div>
          </div>
          <div className="cars-result-line">
            <button
              className="cars-mobile-options"
              aria-expanded={viewOptions}
              onClick={() => setViewOptions((open) => !open)}
            >
              Filter & sort
            </button>
            <p role="status">
              {matches.length} {matches.length === 1 ? "car" : "cars"}
              {search && <> matching “{search}”</>}
            </p>
            {(search ||
              tab !== "all" ||
              attention !== "all" ||
              sort !== "stock") && (
              <button
                onClick={() =>
                  navigate("/portal?section=cars", { replace: true })
                }
              >
                Clear search and filters
              </button>
            )}
          </div>
          {matches.length ? (
            <>
              <div className="cars-column-headings" aria-hidden="true">
                <span>Vehicle</span>
                <span>Price & availability</span>
                {canManage && <span>Customer activity</span>}
                <span>Next step</span>
              </div>
              <ul className="portal-cars-list" aria-label="Current cars">
                {matches.map((car) => (
                  <li
                    key={car.id}
                    className="portal-car-row"
                    data-testid={`portal-car-${car.id}`}
                  >
                    <div className="cars-identity-cell">
                      <Link
                        className="portal-car-identity"
                        aria-label={`Open vehicle file for ${vehicleDisplayTitle(car)}`}
                        href={carHref(car.id)}
                        onClick={rememberScroll}
                      >
                        <CarPhoto car={car} />
                        <span>
                          <strong>{vehicleDisplayTitle(car)}</strong>
                          <span className="portal-car-variant">
                            {car.variant || car.trim || "Variant not supplied"}
                          </span>
                          <span className="portal-car-registration">
                            {vehicleRegistration(car) ||
                              "Registration not supplied"}
                          </span>
                        </span>
                      </Link>
                      <p className="portal-car-facts">
                        {[
                          car.year,
                          car.mileage != null
                            ? formatMileage(car.mileage)
                            : car.mileageText,
                          car.transmission,
                          car.fuel,
                        ]
                          .filter(Boolean)
                          .map((v, i) => (
                            <span key={i}>{v}</span>
                          ))}
                      </p>
                      {changeList(car)}
                    </div>
                    <div className="portal-car-price">
                      <strong>
                        {car.price != null
                          ? formatPrice(car.price, car.currency)
                          : "Price not supplied"}
                      </strong>
                      <span
                        className="portal-car-status"
                        data-status={workspaceStatus(car)}
                      >
                        {listTabs.find(
                          ([value]) => value === workspaceStatus(car),
                        )?.[1] ?? "Not advertised"}
                      </span>
                      {car.inventoryStatus === "reserved" &&
                        workspaceStatus(car) === "missing" && (
                          <span
                            className="portal-car-status"
                            data-status="reserved"
                          >
                            Reserved
                          </span>
                        )}
                      <StaffMotBadge summary={summary(car)} />
                      {carIssues(car, safeActivity(car))
                        .filter((issue) => issue !== "Customer awaiting reply")
                        .slice(0, 2)
                        .map((issue) => (
                          <small key={issue}>{issue}</small>
                        ))}
                    </div>
                    {canManage && interest(car)}
                    <div className="portal-car-actions">
                      {nextAction(car)}
                      {canManage && workspaceStatus(car) === "available" && !car.staff.sale && (
                        <Button size="sm" variant="outline" className="cars-start-sale" onClick={() => openSale(car.id)}>
                          Start sale
                        </Button>
                      )}
                      {moreMenu(car)}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            !query.isError && (
              <div className="portal-cars-empty">
                <CarFront size={30} />
                <h3>
                  {search || tab !== "all" || attention !== "all"
                    ? "No matching cars"
                    : "No current cars"}
                </h3>
                <p>
                  Try another view or clear your filters. Sold cars and missing
                  stock have their own tabs.
                </p>
              </div>
            )
          )}
        </>
      )}
      {panel && (
        <EnquiryVehicleInformation
          key={panel.id}
          car={panel}
          published={panel.staff.published}
          onMotHistory={onMot}
          canManage={canManage}
          presentation="panel"
          returnFocusRef={opener}
          onClose={() => setPanelId(null)}
          actions={
            <div className="cars-panel-navigation">
              <div>
                <Button
                  variant="outline"
                  disabled={!adjacent(panel.id).previous}
                  aria-label="Previous car in quick view"
                  onClick={() => setPanelId(adjacent(panel.id).previous.id)}
                >
                  <ChevronLeft size={18} />
                </Button>
                <Button
                  variant="outline"
                  disabled={!adjacent(panel.id).next}
                  aria-label="Next car in quick view"
                  onClick={() => setPanelId(adjacent(panel.id).next.id)}
                >
                  <ChevronRight size={18} />
                </Button>
              </div>
              <Link
                className="cars-primary-action"
                href={carHref(panel.id)}
                onClick={() => {
                  rememberScroll();
                  setPanelId(null);
                }}
              >
                Open vehicle file
              </Link>
            </div>
          }
        />
      )}
    </section>
  );
}
