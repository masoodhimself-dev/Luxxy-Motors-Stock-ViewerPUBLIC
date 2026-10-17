import { useEffect, useId, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { customFetch, useGetStaffDirectory } from "@workspace/api-client-react";
import { useSearch, useLocation, Link } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  Camera,
  CarFront,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  Mail,
  RefreshCw,
  Search,
  ScanLine,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useStaffAccess } from "./dealer-administration";
import "./staff-inventory.css";
import { EnquiryEmailComposer } from "./enquiry-email-composer";
import { workspaceError } from "./enquiry-workspace-tools";
type Tasks = Record<
  "cleaning" | "inspection" | "mot" | "servicing",
  "pending" | "done" | "not_required"
>;
type Car = {
  id: string;
  title: string;
  display_title?: string;
  price: number | null;
  plate: string | null;
  vrm: string | null;
  registration: string | null;
  inventory_status: string;
  source_status: string;
  missing_count: number;
  archived_at?: string | null;
  photo?: string | null;
  service_photo_count: number;
  tasks: Tasks | null;
  assigned_to_id?: string | null;
  due_date?: string | null;
  year?: number | null;
  mileage?: number | null;
  fuel?: string | null;
  transmission?: string | null;
};
type Prep = {
  revision: number;
  tasks: Tasks;
  assigned_to_id: string | null;
  due_date: string | null;
  notes: string;
};
type Details = {
  previewReadOnly?: boolean;
  car: Car;
  preparation: Prep;
  photos: {
    id: string;
    category?: string;
    byte_size: number;
    created_at: string;
  }[];
};
type Customer = {
  id: string;
  customerName: string;
  reference: string;
  email: string | null;
};
type Grant = { id: string; url: string; expiresAt: string; category?: string };
const taskLabels = {
  cleaning: "Cleaning & presentation",
  inspection: "Vehicle inspection",
  mot: "MOT paperwork check",
  servicing: "Service preparation",
};
const send = <T,>(path: string, method = "GET", body?: unknown) =>
  customFetch<T>(path, {
    method,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
const price = (v: number | null) =>
  v == null
    ? "Price not supplied"
    : new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 0,
      }).format(v);
const clearedTasks = (tasks: Tasks | null | undefined) =>
  (Object.keys(taskLabels) as (keyof Tasks)[]).filter(
    (key) => tasks?.[key] === "done" || tasks?.[key] === "not_required",
  ).length;
const carRegistration = (car: Car) =>
  car.plate?.trim() ||
  car.vrm?.trim() ||
  car.registration?.trim() ||
  "Registration not supplied";
const carFacts = (car: Car) =>
  [
    car.year,
    car.mileage != null ? `${car.mileage.toLocaleString("en-GB")} miles` : null,
    car.fuel,
    car.transmission,
  ]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .join(" · ");
function InventoryStatus({ car }: { car: Car }) {
  return (
    <span
      className="inventory-status"
      data-status={
        car.archived_at || car.inventory_status === "archived"
          ? "archived"
          : car.inventory_status
      }
    >
      {car.archived_at && car.inventory_status !== "archived"
        ? `Archived · ${car.inventory_status}`
        : car.inventory_status || "Status not supplied"}
    </span>
  );
}
function StockPhoto({
  car,
  onOpen,
  disabled = false,
}: {
  car: Car;
  onOpen: () => void;
  disabled?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [car.photo]);
  return car.photo && !failed ? (
    <button
      type="button"
      className="inventory-hover-photo"
      onClick={onOpen}
      disabled={disabled}
      aria-label={`Open ${car.title} photo and vehicle details`}
    >
      <img
        src={car.photo}
        alt={car.title}
        loading="lazy"
        onError={() => setFailed(true)}
      />
      <span className="inventory-photo-hint">
        <ScanLine aria-hidden size={14} />
      </span>
      <span className="inventory-photo-enlarged" aria-hidden="true">
        <img src={car.photo} alt="" loading="lazy" />
        <span>
          Photo preview · Open car to check or correct the number plate
        </span>
      </span>
    </button>
  ) : (
    <span className="inventory-no-photo">
      <CarFront aria-hidden size={26} />
      <span>No photo</span>
    </span>
  );
}
function PrivatePhoto({
  carId,
  id,
  index,
  category,
}: {
  carId: string;
  id: string;
  index: number;
  category?: string;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false,
      object = "";
    void customFetch<Blob>(`/api/staff/inventory/${carId}/photos/${id}`, {
      responseType: "blob",
    })
      .then((blob) => {
        if (cancelled) return;
        object = URL.createObjectURL(blob);
        setUrl(object);
      })
      .catch(() => setError(true));
    return () => {
      cancelled = true;
      if (object) URL.revokeObjectURL(object);
    };
  }, [carId, id]);
  return error ? (
    <p>Photo unavailable. Refresh to retry.</p>
  ) : url ? (
    <a href={url} target="_blank" rel="noreferrer">
      <img
        src={url}
        alt={`${category === "pre_accident" ? "Private pre-accident photo" : "Private service-book page"} ${index + 1}`}
      />
    </a>
  ) : (
    <p>Loading photo…</p>
  );
}
export function StaffInventory() {
  const search = useSearch(),
    [, navigate] = useLocation();
  const selected = new URLSearchParams(search).get("vehicleId");
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [term, setTerm] = useState(""),
    [filter, setFilter] = useState("all"),
    [draft, setDraft] = useState<Prep>(),
    [grant, setGrant] = useState<Grant>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const filterPanelId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [preparationFilter, setPreparationFilter] = useState("all");
  const [sort, setSort] = useState("latest");
  const [searchTerm, setSearchTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);
  const [plateDraft, setPlateDraft] = useState<string | null>(null),
    [photoCategory, setPhotoCategory] = useState("service_book"),
    [emailCustomer, setEmailCustomer] = useState<Customer | null>(null);
  const customers = useQuery({
    queryKey: ["inventory-customers", selected],
    enabled: !!selected,
    queryFn: () =>
      send<{ customers: Customer[] }>(
        `/api/staff/inventory/${selected}/customers`,
      ),
  });
  const access = useStaffAccess(),
    directory = useGetStaffDirectory();
  const scope = filter === "archived" ? "archived" : "current";
  const list = useInfiniteQuery({
    queryKey: ["staff-inventory", "list", scope, searchTerm],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (scope === "archived") params.set("scope", scope);
      if (searchTerm) params.set("q", searchTerm);
      if (pageParam) params.set("cursor", pageParam);
      return customFetch<{
        cars: Car[];
        counts?: { current: number; archived: number };
        matchedCount?: number;
        nextCursor?: string | null;
        previewReadOnly?: boolean;
      }>(`/api/staff/inventory${params.size ? `?${params}` : ""}`, {
        signal,
        responseType: "json",
      });
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const details = useQuery({
    queryKey: ["staff-inventory", selected],
    enabled: !!selected,
    queryFn: () => send<Details>(`/api/staff/inventory/${selected}`),
    refetchInterval: () =>
      grant && Date.parse(grant.expiresAt) > Date.now() ? 5000 : false,
  });
  const previewReadOnly = Boolean(
    list.data?.pages[0].previewReadOnly || details.data?.previewReadOnly,
  );
  const writable =
    access.data?.permissions.includes("sales.manage") && !previewReadOnly;
  useEffect(() => {
    setPlateDraft(null);
    setEmailCustomer(null);
    setPhotoCategory("service_book");
    setDraft(undefined);
    setGrant(undefined);
    setError("");
    setNotice("");
  }, [selected]);
  useEffect(() => {
    if (details.data && !draft) setDraft(details.data.preparation);
  }, [details.data, draft]);
  async function act(work: () => Promise<unknown>, message: string) {
    const vehicleId = selected;
    setBusy(true);
    setError("");
    try {
      await work();
      if (selectedRef.current !== vehicleId) return;
      setNotice(message);
      await Promise.all([list.refetch(), details.refetch()]);
    } catch (e) {
      if (selectedRef.current === vehicleId) setError(workspaceError(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!draft || !selected) return;
    const vehicleId = selected;
    await act(async () => {
      await send(`/api/staff/inventory/${vehicleId}/preparation`, "PUT", {
        revision: draft.revision,
        tasks: draft.tasks,
        assignedToId: draft.assigned_to_id,
        dueDate: draft.due_date,
        notes: draft.notes,
      });
      if (selectedRef.current !== vehicleId) return;
      const fresh = await details.refetch();
      if (selectedRef.current === vehicleId && fresh.data?.car.id === vehicleId)
        setDraft(fresh.data.preparation);
    }, "Preparation saved.");
  }
  function open(id: string | null) {
    if (
      draft &&
      details.data &&
      JSON.stringify(draft) !== JSON.stringify(details.data.preparation) &&
      !window.confirm("Leave unsaved preparation changes?")
    )
      return;
    navigate(`/portal?section=inventory${id ? `&vehicleId=${id}` : ""}`);
  }
  const loadedCars = list.data?.pages.flatMap((page) => page.cars) ?? [];
  const counts = list.data?.pages[0].counts;
  const cars = loadedCars.filter((c) =>
    scope === "archived"
      ? Boolean(c.archived_at) || c.inventory_status === "archived"
      : !c.archived_at &&
        c.inventory_status !== "archived" &&
        (filter === "all" || c.inventory_status === filter) &&
        (preparationFilter === "all" ||
          (preparationFilter === "pending" && clearedTasks(c.tasks) < 4) ||
          (preparationFilter === "cleared" && clearedTasks(c.tasks) === 4) ||
          (preparationFilter === "unassigned" && !c.assigned_to_id)),
  );
  if (scope !== "archived" && sort !== "latest")
    cars.sort((a, b) =>
      sort === "name"
        ? a.title.localeCompare(b.title)
        : sort === "preparation"
          ? clearedTasks(a.tasks) - clearedTasks(b.tasks)
          : a.price == null
            ? b.price == null
              ? 0
              : 1
            : b.price == null
              ? -1
              : sort === "price-low"
                ? a.price - b.price
                : b.price - a.price,
    );
  const car = details.data?.car;
  const selectedPhotos = (details.data?.photos ?? []).filter(
    (p) => (p.category ?? "service_book") === photoCategory,
  );
  return (
    <section className="staff-inventory">
      <header className="inventory-heading">
        <div className="inventory-heading-main">
          {selected && (
            <Button
              variant="ghost"
              className="inventory-back"
              onClick={() => open(null)}
            >
              <ArrowLeft aria-hidden size={16} />
              Back to cars
            </Button>
          )}
          <h2>{selected ? "Car details" : "Cars"}</h2>
          {!selected && (
            <div
              className="inventory-scopes"
              role="group"
              aria-label="Inventory records"
            >
              <button
                type="button"
                aria-pressed={scope === "current"}
                onClick={() => setFilter("all")}
              >
                Current
                {counts && (
                  <>
                    {" "}
                    <span>{counts.current}</span>
                  </>
                )}
              </button>
              <button
                type="button"
                aria-pressed={scope === "archived"}
                onClick={() => setFilter("archived")}
              >
                Archived
                {counts && (
                  <>
                    {" "}
                    <span>{counts.archived}</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          className="inventory-refresh"
          aria-label="Refresh cars"
          disabled={list.isFetching || Boolean(selected && details.isFetching)}
          onClick={() => {
            void list.refetch();
            if (selected) void details.refetch();
          }}
        >
          <RefreshCw
            aria-hidden
            size={16}
            className={
              list.isFetching || details.isFetching ? "animate-spin" : ""
            }
          />
          <span>Refresh</span>
        </Button>
      </header>
      {previewReadOnly && (
        <p className="inventory-preview-note">
          Read-only preview · Changes, uploads and emails are disabled.
        </p>
      )}
      {selected ? (
        <>
          {details.isLoading && <p role="status">Loading vehicle…</p>}
          {details.isError && (
            <p role="alert" className="inventory-error">
              Could not load this car. Refresh to retry.
            </p>
          )}
          {car && (
            <>
              <div className="inventory-vehicle-heading">
                <div className="inventory-selected-summary">
                  <StockPhoto
                    car={car}
                    onOpen={() =>
                      window.open(car.photo!, "_blank", "noopener,noreferrer")
                    }
                  />
                  <div className="inventory-selected-copy">
                    <div className="inventory-selected-title">
                      <h3>{car.display_title ?? car.title}</h3>
                      <InventoryStatus car={car} />
                    </div>
                    <p className="inventory-plate">{carRegistration(car)}</p>
                    {carFacts(car) && (
                      <p className="inventory-muted">{carFacts(car)}</p>
                    )}
                    <strong className="inventory-price">
                      {price(car.price)}
                    </strong>
                    {car.photo && (
                      <a
                        className="inventory-photo-original"
                        href={car.photo}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open full-size photo
                        <ExternalLink aria-hidden size={13} />
                      </a>
                    )}
                  </div>
                </div>
                {writable && (
                  <div className="inventory-vehicle-controls">
                    <label>
                      Number plate
                      <Input
                        aria-label="Number plate"
                        value={plateDraft ?? car.plate ?? car.vrm ?? ""}
                        maxLength={12}
                        onChange={(e) =>
                          setPlateDraft(e.target.value.toUpperCase())
                        }
                        placeholder="Enter plate from photo"
                      />
                    </label>
                    <Button
                      disabled={
                        busy || plateDraft === null || !plateDraft.trim()
                      }
                      onClick={() =>
                        void act(async () => {
                          await send(
                            `/api/staff/inventory/${car.id}/plate`,
                            "PUT",
                            {
                              plate: plateDraft,
                              expectedPlate: car.plate ?? car.vrm ?? null,
                            },
                          );
                          if (selectedRef.current === car.id) setPlateDraft(null);
                        }, "Number plate corrected. Future stock imports will keep this correction.")
                      }
                    >
                      Save number plate
                    </Button>
                    {car.inventory_status === "reserved" && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Release this reservation and return the car to available? Appointments remain booked. Outstanding payments must be resolved first.",
                            )
                          )
                            void act(
                              () =>
                                send(
                                  `/api/staff/inventory/${car.id}/unreserve`,
                                  "POST",
                                  { confirm: true },
                                ),
                              "Reservation released. Car is available again.",
                            );
                        }}
                      >
                        Unreserve car
                      </Button>
                    )}
                  </div>
                )}
                {car.source_status === "missing" && (
                  <p className="inventory-muted">
                    No longer advertised by the source. This does not mean sold.
                  </p>
                )}
              </div>
              <div className="inventory-workspace-grid">
                <section className="inventory-card inventory-preparation-card">
                  <h3>
                    <ClipboardCheck aria-hidden size={18} />
                    Preparation
                  </h3>
                  <p>
                    Internal work tracking; these checks do not certify
                    condition or change public vehicle facts.
                  </p>
                  {draft && (
                    <>
                      <fieldset disabled={!writable || busy}>
                        {(Object.keys(taskLabels) as (keyof Tasks)[]).map(
                          (key) => (
                            <label key={key}>
                              {taskLabels[key]}
                              <NativeSelect
                                value={draft.tasks[key]}
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    tasks: {
                                      ...draft.tasks,
                                      [key]: e.target
                                        .value as Tasks[typeof key],
                                    },
                                  })
                                }
                              >
                                <option value="pending">To do</option>
                                <option value="done">Done</option>
                                <option value="not_required">
                                  Not required
                                </option>
                              </NativeSelect>
                            </label>
                          ),
                        )}
                        <label>
                          Assigned to
                          <NativeSelect
                            value={draft.assigned_to_id ?? ""}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                assigned_to_id: e.target.value || null,
                              })
                            }
                          >
                            <option value="">Unassigned</option>
                            {draft.assigned_to_id &&
                              !directory.data?.members.some(
                                (m) => m.id === draft.assigned_to_id,
                              ) && (
                                <option value={draft.assigned_to_id}>
                                  Previously assigned staff member
                                </option>
                              )}
                            {directory.data?.members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </NativeSelect>
                        </label>
                        <label>
                          Target date
                          <Input
                            type="date"
                            value={draft.due_date ?? ""}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                due_date: e.target.value || null,
                              })
                            }
                          />
                        </label>
                        <label>
                          Internal notes
                          <textarea
                            maxLength={2000}
                            rows={3}
                            value={draft.notes}
                            onChange={(e) =>
                              setDraft({ ...draft, notes: e.target.value })
                            }
                          />
                        </label>
                      </fieldset>
                      {directory.isError && (
                        <p role="alert">
                          Staff list unavailable. Refresh before assigning work.
                        </p>
                      )}
                      {writable && (
                        <Button disabled={busy} onClick={() => void save()}>
                          {busy ? "Saving…" : "Save preparation"}
                        </Button>
                      )}
                    </>
                  )}
                </section>
                <section className="inventory-card inventory-private-photos">
                  <h3>
                    <Camera aria-hidden size={18} />
                    Private photos
                  </h3>
                  <div
                    className="inventory-photo-tabs"
                    role="group"
                    aria-label="Photo category"
                  >
                    <Button
                      variant={
                        photoCategory === "service_book" ? "default" : "outline"
                      }
                      onClick={() => setPhotoCategory("service_book")}
                    >
                      Service book
                    </Button>
                    <Button
                      variant={
                        photoCategory === "pre_accident" ? "default" : "outline"
                      }
                      onClick={() => setPhotoCategory("pre_accident")}
                    >
                      Pre-accident photos
                    </Button>
                  </div>
                  <p>
                    Up to three private photos per category. Imported stock
                    updates do not replace these.
                  </p>
                  <div className="inventory-photo-grid">
                    {selectedPhotos.map((p, i) => (
                      <figure key={p.id}>
                        <PrivatePhoto
                          carId={car.id}
                          id={p.id}
                          index={i}
                          category={p.category}
                        />
                        <figcaption>
                          {Math.ceil(p.byte_size / 1024)} KB
                          {writable && (
                            <button
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Remove this private vehicle photo?",
                                  )
                                )
                                  void act(
                                    () =>
                                      send(
                                        `/api/staff/inventory/${car.id}/photos/${p.id}`,
                                        "DELETE",
                                      ),
                                    "Photo removed.",
                                  );
                              }}
                            >
                              Remove
                            </button>
                          )}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                  {!selectedPhotos.length && (
                    <p className="inventory-muted">
                      No photos in this category yet.
                    </p>
                  )}
                  {writable && selectedPhotos.length < 3 && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const created = await send<Grant>(
                            `/api/staff/inventory/${car.id}/upload-session`,
                            "POST",
                            { category: photoCategory },
                          );
                          if (selectedRef.current === car.id) setGrant(created);
                        }, "Scan the QR code using your phone camera.")
                      }
                    >
                      Upload from phone
                    </Button>
                  )}
                  {grant && (
                    <div className="inventory-qr">
                      <QRCodeSVG
                        value={grant.url}
                        size={190}
                        marginSize={2}
                        title="Private vehicle-photo upload QR code"
                      />
                      <p>
                        {grant.category === "pre_accident"
                          ? "Pre-accident photos"
                          : "Service-book photos"}{" "}
                        · For this car only · Expires{" "}
                        {new Date(grant.expiresAt).toLocaleTimeString("en-GB", {
                          timeZone: "Europe/London",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        .
                      </p>
                      <a href={grant.url} target="_blank" rel="noreferrer">
                        Open upload page on this device
                      </a>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await send(
                              `/api/staff/inventory/${car.id}/upload-session/${grant.id}`,
                              "DELETE",
                            );
                            if (selectedRef.current === car.id) setGrant(undefined);
                          }, "Upload link cancelled.")
                        }
                      >
                        Cancel upload link
                      </Button>
                    </div>
                  )}
                </section>
                <section className="inventory-card inventory-customer-email">
                  <h3>
                    <Mail aria-hidden size={18} />
                    Email a customer
                  </h3>
                  <p>
                    Choose a linked enquiry, then select photos and review the
                    email before sending. The recipient can be changed in the
                    email window.
                  </p>
                  <NativeSelect
                    aria-label="Choose customer to email"
                    value=""
                    disabled={busy || previewReadOnly}
                    onChange={(e) =>
                      setEmailCustomer(
                        customers.data?.customers.find(
                          (c) => c.id === e.target.value,
                        ) ?? null,
                      )
                    }
                  >
                    <option value="">Choose customer / enquiry</option>
                    {(customers.data?.customers ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.customerName} · {c.reference}
                      </option>
                    ))}
                  </NativeSelect>
                  {!previewReadOnly &&
                    !customers.isLoading &&
                    !customers.data?.customers.length && (
                      <p className="inventory-muted">
                        Log a customer enquiry for this car first.{" "}
                        <Link
                          href={`/portal?section=enquiries&vehicleId=${car.id}`}
                        >
                          Open enquiries
                        </Link>
                      </p>
                    )}
                  {!previewReadOnly && emailCustomer && (
                    <EnquiryEmailComposer
                      entry={emailCustomer}
                      onClose={() => setEmailCustomer(null)}
                    />
                  )}
                </section>
              </div>
              <section className="inventory-card inventory-activity-card">
                <div>
                  <h3>Vehicle activity</h3>
                  <p>
                    See this car’s enquiries, appointments, reservations and
                    sales together.
                  </p>
                </div>
                <Button asChild variant="outline">
                  <Link
                    href={`/portal?section=history&view=vehicles&vehicleId=${car.id}`}
                  >
                    Open vehicle activity
                  </Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href={`/vehicle/${car.id}`}>Customer vehicle page</Link>
                </Button>
              </section>
            </>
          )}
          {error && (
            <p role="alert" className="inventory-error">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
        </>
      ) : (
        <>
          <div className="inventory-toolbar">
            <div className="inventory-search-row">
              <label
                className="inventory-search"
                data-has-value={Boolean(term)}
              >
                <span className="sr-only">Search cars</span>
                <Search aria-hidden size={18} />
                <Input
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="Find a car…"
                />
                {term && (
                  <button
                    type="button"
                    onClick={() => setTerm("")}
                    aria-label="Clear car search"
                  >
                    Clear
                  </button>
                )}
              </label>
              {scope === "current" && (
                <Button
                  type="button"
                  variant="outline"
                  className="inventory-filter-toggle"
                  aria-label="Filters"
                  aria-expanded={filtersOpen}
                  aria-controls={filterPanelId}
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  <SlidersHorizontal aria-hidden size={16} />
                  Filters
                  {preparationFilter !== "all" && (
                    <span className="inventory-filter-count">1</span>
                  )}
                </Button>
              )}
            </div>
            {scope === "current" && (
              <div
                className="inventory-work-filters"
                id={filterPanelId}
                data-collapsed={!filtersOpen}
              >
                <label>
                  <span>Preparation</span>
                  <NativeSelect
                    aria-label="Preparation"
                    value={preparationFilter}
                    onChange={(e) => setPreparationFilter(e.target.value)}
                  >
                    <option value="all">All preparation</option>
                    <option value="pending">Work to do</option>
                    <option value="cleared">Checks cleared</option>
                    <option value="unassigned">Unassigned</option>
                  </NativeSelect>
                </label>
                <label>
                  <span>Sort</span>
                  <NativeSelect
                    aria-label="Sort cars"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="latest">Newest in stock</option>
                    <option value="preparation">Preparation remaining</option>
                    <option value="price-low">Price: low to high</option>
                    <option value="price-high">Price: high to low</option>
                    <option value="name">Make / model</option>
                  </NativeSelect>
                </label>
              </div>
            )}
          </div>
          <div className="inventory-list-tools">
            {scope === "current" ? (
              <div
                className="inventory-status-filters"
                role="group"
                aria-label="Availability"
              >
                {["all", "available", "reserved", "sold", "hidden"].map(
                  (status) => (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={filter === status}
                      onClick={() => setFilter(status)}
                    >
                      {status === "all"
                        ? "All current"
                        : status[0].toUpperCase() + status.slice(1)}
                    </button>
                  ),
                )}
              </div>
            ) : (
              <p className="inventory-muted">
                Retained vehicle records · newest first
              </p>
            )}
            <p className="inventory-result-count" aria-live="polite">
              {list.isFetching && !list.isFetchingNextPage
                ? "Searching…"
                : `${cars.length} ${cars.length === 1 ? "car" : "cars"}${term.trim() || preparationFilter !== "all" || (filter !== "all" && scope !== "archived") ? " shown" : ""}`}
            </p>
          </div>
          {scope === "current" && preparationFilter !== "all" && (
            <div className="inventory-active-filters">
              <button
                type="button"
                onClick={() => setPreparationFilter("all")}
                aria-label="Clear preparation filter"
              >
                Preparation:{" "}
                {preparationFilter === "pending"
                  ? "Work to do"
                  : preparationFilter === "cleared"
                    ? "Checks cleared"
                    : "Unassigned"}
                <X aria-hidden size={13} />
              </button>
            </div>
          )}
          {list.isLoading && <p role="status">Loading cars…</p>}
          {list.isError && (
            <p role="alert" className="inventory-error">
              Inventory unavailable. Refresh to retry.
            </p>
          )}
          <div className="inventory-car-list">
            {cars.map((c) => (
              <article className="inventory-car" key={c.id}>
                <StockPhoto car={c} onOpen={() => open(c.id)} />
                <button
                  type="button"
                  className="inventory-car-open"
                  onClick={() => open(c.id)}
                  aria-label={`Open ${c.title}, ${carRegistration(c)}`}
                >
                  <div className="inventory-row-main">
                    <div className="inventory-row-identity">
                      <h3>{c.title}</h3>
                      <p className="inventory-row-registration">
                        {carRegistration(c)}
                      </p>
                      {carFacts(c) && (
                        <p className="inventory-row-facts">{carFacts(c)}</p>
                      )}
                    </div>
                    <div className="inventory-row-price">
                      <strong>{price(c.price)}</strong>
                      <InventoryStatus car={c} />
                    </div>
                    <ChevronRight
                      aria-hidden
                      className="inventory-row-chevron"
                      size={18}
                    />
                  </div>
                  <div className="inventory-row-work">
                    <span className="inventory-prep-summary">
                      <ClipboardCheck aria-hidden size={14} />
                      <span>
                        {c.tasks
                          ? `${clearedTasks(c.tasks)}/4 preparation checks`
                          : "Preparation not started"}
                      </span>
                      <span
                        className="inventory-prep-track"
                        role="progressbar"
                        aria-label={`${c.title} preparation checks cleared`}
                        aria-valuemin={0}
                        aria-valuemax={4}
                        aria-valuenow={clearedTasks(c.tasks)}
                      >
                        <span
                          style={{ width: `${clearedTasks(c.tasks) * 25}%` }}
                        />
                      </span>
                    </span>
                    <span title="Private service-book photos">
                      <Camera aria-hidden size={14} />
                      {c.service_photo_count ?? 0}/3 service photos
                    </span>
                    {c.due_date && (
                      <span>
                        Due{" "}
                        {new Date(`${c.due_date}T12:00:00`).toLocaleDateString(
                          "en-GB",
                          { day: "numeric", month: "short" },
                        )}
                      </span>
                    )}
                    {c.source_status === "missing" && (
                      <span className="inventory-source-missing">
                        Absent from source
                      </span>
                    )}
                  </div>
                </button>
              </article>
            ))}
          </div>
          {scope === "archived" && list.data?.pages[0].matchedCount != null && (
            <p className="inventory-muted">
              Showing {cars.length} of {list.data.pages[0].matchedCount}{" "}
              matching archived cars.
            </p>
          )}
          {list.hasNextPage && (
            <Button
              type="button"
              variant="outline"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage
                ? "Loading older cars…"
                : "Load older archived cars"}
            </Button>
          )}
          {!list.isLoading && !list.isError && !cars.length && (
            <div className="inventory-empty">
              <CarFront aria-hidden size={28} />
              <p>
                {scope === "archived" && !term.trim()
                  ? "No archived cars yet."
                  : "No cars match these filters."}
              </p>
              {(term ||
                preparationFilter !== "all" ||
                (filter !== "all" && scope !== "archived")) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setTerm("");
                    setPreparationFilter("all");
                    if (scope === "current") setFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
