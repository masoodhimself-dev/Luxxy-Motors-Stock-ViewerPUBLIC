import {
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getGetEnquiriesQueryKey,
  getGetStockQueryKey,
  type Enquiry,
} from "@workspace/api-client-react";
import { useStock, type Car } from "@/lib/stock-context";
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
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EnquiryVehicleInformation } from "./enquiry-vehicle-information";
import {
  currentStockCars,
  findWorkspaceCars,
  vehicleActivityById,
  type CarsAvailability,
  type CarsSort,
  type VehicleActivity,
  type VehicleCustomerActivity,
} from "./cars-workspace-model";
import { formatDateTime } from "./portal-ui";
import "./cars-workspace.css";

type CarsWorkspaceProps = {
  canManage: boolean;
  bookingEnabled: boolean;
  onEnquiry: (vehicleId: string, bookTestDrive?: boolean) => void;
  onSale: (vehicleId: string) => void;
  onOpenEnquiry?: (enquiryId: string) => void;
};

const inboxHref = (entry: Enquiry) =>
  `/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(entry.id)}`;
const photo = (car: Car) =>
  getSafeImageUrl(car.heroImage || car.images?.[0] || "");

function CarPhoto({ car }: { car: Car }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="portal-car-photo">
      {photo(car) && !failed ? (
        <img
          src={photo(car)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <CarFront size={28} aria-hidden="true" />
      )}
    </span>
  );
}

function CustomerActivity({
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

function CarActions({
  car,
  canManage,
  bookingEnabled,
  onEnquiry,
  onSale,
  onDetails,
  panel = false,
}: CarsWorkspaceProps & {
  car: Car;
  onDetails?: (opener?: HTMLElement | null) => void;
  panel?: boolean;
}) {
  const available = car.inventoryStatus === "available";
  const moreTrigger = useRef<HTMLButtonElement | null>(null);
  const secondary: ReactNode = (
    <>
      {!panel && (
        <DropdownMenuItem onSelect={() => onDetails?.(moreTrigger.current)}>
          Vehicle details
        </DropdownMenuItem>
      )}
      {!panel && canManage && available && bookingEnabled && (
        <DropdownMenuItem onSelect={() => onEnquiry(car.id, true)}>
          Book test drive
        </DropdownMenuItem>
      )}
      {!panel && canManage && available && (
        <DropdownMenuItem onSelect={() => onSale(car.id)}>
          Start sale
        </DropdownMenuItem>
      )}
      <DropdownMenuItem asChild>
        <a
          href={`/vehicle/${encodeURIComponent(car.id)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          View website
        </a>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <a
          href={`/api/vehicles/${encodeURIComponent(car.id)}/brochure.pdf`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Print vehicle sheet
        </a>
      </DropdownMenuItem>
    </>
  );
  return (
    <div className="portal-car-actions">
      {canManage && (
        <Button type="button" size="sm" onClick={() => onEnquiry(car.id)}>
          New enquiry
        </Button>
      )}
      {panel && canManage && available && bookingEnabled && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onEnquiry(car.id, true)}
        >
          Book test drive
        </Button>
      )}
      {panel && canManage && available && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onSale(car.id)}
        >
          Start sale
        </Button>
      )}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="portal-car-more"
            ref={moreTrigger}
            aria-label={`More options for ${vehicleDisplayTitle(car)}`}
          >
            <MoreHorizontal size={18} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="portal-car-menu" align="end">
          {secondary}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function CarsWorkspace({
  canManage,
  bookingEnabled,
  onEnquiry,
  onSale,
  onOpenEnquiry,
}: CarsWorkspaceProps) {
  const { stock, isLoading, error } = useStock();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState<CarsAvailability>("all");
  const [sort, setSort] = useState<CarsSort>("stock");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const activity = useEnquirySummaries(undefined, {
    query: {
      queryKey: getGetEnquiriesQueryKey(),
      enabled: canManage,
      staleTime: 60_000,
      retry: false,
      refetchInterval: false,
    },
  });
  // Reuse the Inbox aggregate without starting another interval or per-car requests.
  const replies = useQuery({
    queryKey: ["reply-attention"],
    queryFn: () =>
      customFetch<{ enquiries: ReplyAttention[] }>(
        "/api/staff/email/reply-attention",
      ),
    enabled: canManage,
    staleTime: 60_000,
    retry: false,
    refetchInterval: false,
  });
  const activityEntries = useMemo(
    () =>
      applyReplyAttention(
        activity.data ?? [],
        canManage ? (replies.data?.enquiries ?? []) : [],
      ),
    [activity.data, replies.data, canManage],
  );
  const cars = stock?.cars ?? [];
  const current = useMemo(() => currentStockCars(cars), [cars]);
  const matches = useMemo(
    () => findWorkspaceCars(cars, search, availability, sort),
    [cars, search, availability, sort],
  );
  const now = Date.now();
  const activities = useMemo(
    () => vehicleActivityById(activityEntries, now),
    [activityEntries, now],
  );
  const selected = current.find((car) => car.id === selectedId);
  const reset = () => {
    setSearch("");
    setAvailability("all");
    setSort("stock");
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      await client.invalidateQueries({ queryKey: getGetStockQueryKey() });
      if (canManage) await Promise.all([activity.refetch(), replies.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };
  const openEnquiry = (id: string, booking?: boolean) => {
    flushSync(() => setSelectedId(null));
    onEnquiry(id, booking);
  };
  const openSale = (id: string) => {
    flushSync(() => setSelectedId(null));
    onSale(id);
  };
  return (
    <section
      className="portal-cars-workspace"
      aria-labelledby="portal-cars-title"
      data-activity={canManage ? "visible" : "hidden"}
    >
      <header className="portal-cars-heading">
        <div>
          <h2 id="portal-cars-title">Cars</h2>
          <p>Find a car, check the details and take the next step.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={refreshing || isLoading}
          onClick={() => void refresh()}
        >
          <RefreshCw
            size={16}
            aria-hidden="true"
            className={refreshing ? "animate-spin" : ""}
          />
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </header>
      <div className="portal-cars-toolbar">
        <label className="portal-cars-search">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Search current cars</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search make, model, colour or registration"
          />
        </label>
        <label className="portal-cars-sort">
          <span className="sr-only">Sort cars</span>
          <NativeSelect
            value={sort}
            onChange={(event) => setSort(event.target.value as CarsSort)}
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
          {(
            [
              ["all", "All current"],
              ["available", "Available"],
              ["reserved", "Reserved"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={availability === value}
              onClick={() => setAvailability(value)}
            >
              {label}{" "}
              <span>
                {
                  current.filter(
                    (car) => value === "all" || car.inventoryStatus === value,
                  ).length
                }
              </span>
            </button>
          ))}
        </div>
        <p role="status">
          {isLoading
            ? "Loading cars…"
            : `${matches.length} ${matches.length === 1 ? "car" : "cars"}`}
        </p>
      </div>
      {error ? (
        <div className="portal-cars-notice" role="alert">
          <h3>Stock could not be refreshed</h3>
          <p>
            {stock
              ? "The cars below may be out of date. Refresh before arranging a booking or sale."
              : "Please try again to load current cars."}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {canManage && activity.isError && (
        <div className="portal-cars-activity-notice" role="status">
          Customer activity could not load.{" "}
          <button type="button" onClick={() => void activity.refetch()}>
            Try again
          </button>
        </div>
      )}
      {canManage && !activity.isError && replies.isError && (
        <div className="portal-cars-activity-notice" role="status">
          Email reply status could not load. Customer enquiries and appointments
          are still shown.{" "}
          <button type="button" onClick={() => void replies.refetch()}>
            Retry reply status
          </button>
        </div>
      )}
      {isLoading && !stock ? (
        <div className="portal-cars-loading" aria-label="Loading cars">
          {[1, 2, 3].map((value) => (
            <div key={value}>
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : matches.length ? (
        <ul className="portal-cars-list" aria-label="Current cars">
          {matches.map((car) => (
            <li
              key={car.id}
              className="portal-car-row"
              data-testid={`portal-car-${car.id}`}
            >
              <button
                type="button"
                className="portal-car-identity"
                aria-label={`View details for ${vehicleDisplayTitle(car)}`}
                onClick={(event) => {
                  returnFocusRef.current = event.currentTarget;
                  setSelectedId(car.id);
                }}
              >
                <CarPhoto car={car} />
                <span>
                  <strong>{vehicleDisplayTitle(car)}</strong>
                  <span className="portal-car-variant">
                    {car.variant || car.trim || "Variant not supplied"}
                  </span>
                  <span className="portal-car-registration">
                    {vehicleRegistration(car) || "Registration not supplied"}
                  </span>
                </span>
              </button>
              <div className="portal-car-facts">
                <span>{car.year ?? "Year not supplied"}</span>
                <span>
                  {car.mileage != null
                    ? formatMileage(car.mileage)
                    : car.mileageText || "Mileage not supplied"}
                </span>
                <span>{car.fuel || "Fuel not supplied"}</span>
                <span>{car.transmission || "Gearbox not supplied"}</span>
                {car.colour && <span>{car.colour}</span>}
                {car.bodyType && <span>{car.bodyType}</span>}
              </div>
              <div className="portal-car-price">
                <strong>
                  {car.price != null
                    ? formatPrice(car.price, car.currency)
                    : "Price not supplied"}
                </strong>
                <span
                  className="portal-car-status"
                  data-status={car.inventoryStatus}
                >
                  {car.inventoryStatus === "reserved"
                    ? "Reserved"
                    : "Available"}
                </span>
                {(car.price == null || !photo(car)) && (
                  <small>
                    {[
                      car.price == null && "Missing price",
                      !photo(car) && "No photos",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                )}
              </div>
              {canManage &&
                (activity.isPending ? (
                  <p className="portal-car-muted">Loading customer activity…</p>
                ) : activity.isError ? (
                  <p className="portal-car-muted">Activity unavailable</p>
                ) : (
                  <CustomerActivity
                    activity={activities.get(car.id)}
                    onOpenEnquiry={onOpenEnquiry}
                    replyStatus={
                      replies.isError
                        ? "unavailable"
                        : replies.isPending
                          ? "loading"
                          : undefined
                    }
                  />
                ))}
              <CarActions
                car={car}
                canManage={canManage}
                bookingEnabled={bookingEnabled}
                onEnquiry={onEnquiry}
                onSale={onSale}
                onDetails={(opener) => {
                  returnFocusRef.current = opener ?? null;
                  setSelectedId(car.id);
                }}
              />
            </li>
          ))}
        </ul>
      ) : (
        !error && (
          <div className="portal-cars-empty">
            <CarFront size={32} aria-hidden="true" />
            <h3>
              {search || availability !== "all"
                ? "No matching cars"
                : "No current cars"}
            </h3>
            <p>
              {search || availability !== "all"
                ? "Try fewer search words or another availability filter."
                : "Available and reserved stock will appear here."}
            </p>
            {(search || availability !== "all") && (
              <Button type="button" variant="outline" onClick={reset}>
                Clear search and filters
              </Button>
            )}
          </div>
        )
      )}
      {selected && (
        <EnquiryVehicleInformation
          car={selected}
          onClose={() => setSelectedId(null)}
          presentation="panel"
          canManage={canManage}
          returnFocusRef={returnFocusRef}
          actions={
            <CarActions
              panel
              car={selected}
              canManage={canManage}
              bookingEnabled={bookingEnabled}
              onEnquiry={openEnquiry}
              onSale={openSale}
            />
          }
        />
      )}
    </section>
  );
}
