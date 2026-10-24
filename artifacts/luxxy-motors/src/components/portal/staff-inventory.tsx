import { ShareQr } from '@/components/share-qr';
import { VehicleVideoEditor } from './vehicle-video';
import { VehicleDescriptionEditor } from './vehicle-description-editor';
import { UKNumberPlate } from '@/components/uk-number-plate';
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useSearch, useLocation, Link } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  Camera,
  CarFront,
  Copy,
  ExternalLink,
  History,
  Mail,
  MessageSquarePlus,
  MoreHorizontal,
  RefreshCw,
  Search,
  ScanLine,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useStaffAccess } from "./dealer-administration";
import "./staff-inventory.css";
import { EnquiryEmailComposer } from "./enquiry-email-composer";
import { workspaceError } from "./enquiry-workspace-tools";
import { BulkPlateEntry, type PlateEntryCar } from "./bulk-plate-entry";
import { vehicleDisplayTitle } from "@/lib/utils";
type Tasks = Record<
  "cleaning" | "inspection" | "mot" | "servicing",
  "pending" | "done" | "not_required"
>;
type Car = {
  id: string;
  title: string;
  make?: string | null;
  model?: string | null;
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
  variant?: string | null;
  trim?: string | null;
  body_type?: string | null;
  engine_size?: string | null;
  engine_cc?: number | null;
  colour?: string | null;
  doors?: number | null;
  seats?: number | null;
};
type Prep = {
  revision: number;
  tasks: Tasks;
  assigned_to_id: string | null;
  due_date: string | null;
  notes: string;
};
type Details = {
  descriptionPreview?: boolean;
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
const carRegistration = (car: Car) =>
  car.plate?.trim() ||
  car.vrm?.trim() ||
  car.registration?.trim() ||
  "Registration not supplied";
// Marketplace registrations such as “2019 (68 reg)” identify an age, not a plate.
const hasNumberPlate = (car: Car) => {
  if (car.plate?.trim() || car.vrm?.trim()) return true;
  const registration = car.registration?.replace(/\s/g, "").toUpperCase() ?? "";
  return (
    !/^\d{2,4}REG$/.test(registration) &&
    /^[A-Z0-9]{2,8}$/.test(registration) &&
    /[A-Z]/.test(registration) &&
    /\d/.test(registration)
  );
};
type AttentionFilter = "all" | "missing-plate" | "missing-service";
const attentionLabels: Record<Exclude<AttentionFilter, "all">, string> = {
  "missing-plate": "Missing number plate",
  "missing-service": "No service-book photos",
};
function InventorySpecs({ car }: { car: Car }) {
  const facts = [
    ['Year', car.year],
    ['Mileage', car.mileage != null ? `${car.mileage.toLocaleString('en-GB')} miles` : null],
    ['Fuel', car.fuel],
    ['Gearbox', car.transmission],
    ['Body', car.body_type],
    ['Colour', car.colour],
    ['Engine', car.engine_size?.trim() || (car.engine_cc && car.engine_cc > 0 ? `${car.engine_cc.toLocaleString('en-GB')} cc` : null)],
    ['Doors / seats', [car.doors && car.doors > 0 ? `${car.doors} doors` : null, car.seats && car.seats > 0 ? `${car.seats} seats` : null].filter(Boolean).join(' / ')],
  ].filter(([,value]) => value !== null && value !== undefined && value !== '');
  if (!facts.length) return null;
  return <dl className="inventory-specs" aria-label="Vehicle specifications">{facts.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
function carVariant(car: Car) {
  const variant = car.variant?.trim() || '', trim = car.trim?.trim() || '';
  return variant && trim && !variant.toLowerCase().includes(trim.toLowerCase()) ? `${variant} / ${trim}` : variant || trim;
}
const isAdvertisedCar = (car: Car) =>
  !car.archived_at &&
  ["available", "reserved"].includes(car.inventory_status) &&
  car.source_status !== "missing";
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
export function StaffInventory({
  onQuickEnquiry,
}: { onQuickEnquiry?: (vehicleId: string) => void } = {}) {
  const search = useSearch(),
    [, navigate] = useLocation();
  const selected = new URLSearchParams(search).get("vehicleId");
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [term, setTerm] = useState(""),
    [filter, setFilter] = useState("all"),
    [grant, setGrant] = useState<Grant>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [attentionFilter, setAttentionFilter] =
    useState<AttentionFilter>("all");
  const [customerLink, setCustomerLink] = useState("");
  const [sort, setSort] = useState("latest");
  const [detailSection, setDetailSection] = useState("media");
  const [searchTerm, setSearchTerm] = useState("");
  const [plateQueue, setPlateQueue] = useState<PlateEntryCar[] | null>(null);
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
  const access = useStaffAccess();
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
    access.data?.permissions.includes("sales.manage") && !access.isError && !previewReadOnly;
  useEffect(() => {
    setPlateDraft(null);
    setEmailCustomer(null);
    setPhotoCategory("service_book");
    setDetailSection("media");
    setGrant(undefined);
    setError("");
    setNotice("");
    setCustomerLink("");
  }, [selected]);
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
  function open(id: string | null) {
    navigate(`/portal?section=inventory${id ? `&vehicleId=${id}` : ""}`);
  }
  function openActivity(id: string) {
    navigate(`/portal?section=history&view=vehicles&vehicleId=${id}`);
  }
  async function copyCustomerLink(id: string) {
    const url = new URL(
      `/vehicle/${encodeURIComponent(id)}`,
      window.location.origin,
    ).href;
    setCustomerLink(url);
    setError("");
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setNotice("Customer link copied.");
    } catch {
      setNotice(
        "Copy the customer link below, or open it and share the address.",
      );
    }
  }
  function carActions(vehicle: Car) {
    const isPublic = isAdvertisedCar(vehicle);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="inventory-car-actions"
            aria-label={`Actions for ${vehicle.title}, ${carRegistration(vehicle)}`}
          >
            <MoreHorizontal aria-hidden size={19} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="inventory-action-menu">
          {writable && isPublic && onQuickEnquiry && (
            <DropdownMenuItem onSelect={() => onQuickEnquiry(vehicle.id)}>
              <MessageSquarePlus aria-hidden /> Quick enquiry
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => openActivity(vehicle.id)}>
            <History aria-hidden /> Customer activity
          </DropdownMenuItem>
          {isPublic && (
            <>
              <DropdownMenuItem asChild>
                <a
                  href={`/vehicle/${vehicle.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink aria-hidden /> View customer page
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => void copyCustomerLink(vehicle.id)}
              >
                <Copy aria-hidden /> Copy customer link
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  const loadedCars = (list.data?.pages.flatMap((page) => page.cars) ?? []).map(vehicle => ({ ...vehicle, title: vehicleDisplayTitle(vehicle) }));
  const counts = list.data?.pages[0].counts;
  const needsAttention = (vehicle: Car, attention: AttentionFilter) => attention === "all" || (attention === "missing-plate" && !hasNumberPlate(vehicle)) || (attention === "missing-service" && (vehicle.service_photo_count ?? 0) === 0);
  const currentCars = loadedCars.filter(
    (vehicle) =>
      !vehicle.archived_at &&
      vehicle.inventory_status !== "archived" &&
      (filter === "all" || vehicle.inventory_status === filter),
  );
  const cars =
    scope === "archived"
      ? loadedCars.filter(
          (c) => Boolean(c.archived_at) || c.inventory_status === "archived",
        )
      : currentCars.filter((c) => needsAttention(c, attentionFilter));
  if (scope !== "archived" && sort !== "latest")
    cars.sort((a, b) =>
      sort === "name"
        ? a.title.localeCompare(b.title)
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
  const rawCar = details.data?.car;
  const car = rawCar ? { ...rawCar, display_title: vehicleDisplayTitle({ ...rawCar, title: rawCar.display_title ?? rawCar.title }) } : undefined;
  const selectedPhotos = (details.data?.photos ?? []).filter(
    (p) => (p.category ?? "service_book") === photoCategory,
  );
  if (new URLSearchParams(search).get("recordVideo") === "1") return (
    <section className="phone-recording-page" aria-label="Car recording workspace">
      <header className="recording-page-bar"><Button variant="ghost" onClick={() => navigate(`/portal?section=inventory${selected ? `&vehicleId=${encodeURIComponent(selected)}` : ""}`)}><ArrowLeft size={16} aria-hidden="true"/>Car details</Button><span>Staff only</span></header>
      {car ? <><div className="recording-car-context">{car.photo && <img src={car.photo} alt="" loading="lazy"/>}<div><p>Car video</p><h1>{car.display_title || car.title}</h1><span>{car.plate || car.vrm || "Registration not recorded"}</span></div></div>
      <VehicleVideoEditor key={`video-${car.id}`} vehicleId={car.id} vehicleTitle={vehicleDisplayTitle(car)} writable={Boolean(writable)} recordingPage /></> : <div className="inventory-card" role="status">{details.isError ? <><h1>Car could not be loaded</h1><p>Check your staff access or return to Car details and try again.</p><Button variant="outline" onClick={()=>void details.refetch()}>Retry car details</Button></> : <p>Loading this car’s recording page…</p>}</div>}
    </section>
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
        <div className="inventory-heading-actions">
        {!selected && scope === "current" && writable && <Button type="button" variant="outline" disabled={list.isLoading || list.isError || !cars.some(vehicle => !hasNumberPlate(vehicle))} onClick={() => setPlateQueue(cars.filter(vehicle => !hasNumberPlate(vehicle)))}><ScanLine size={17} aria-hidden />Add number plates</Button>}
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
        </div>
      </header>
      {plateQueue && writable && <BulkPlateEntry cars={plateQueue} onClose={() => setPlateQueue(null)} />}
      {previewReadOnly && (
        <p className="inventory-preview-note">
          {details.data?.descriptionPreview ? "Local preview · Only description changes are simulated. Uploads and emails are disabled." : "Read-only preview · Changes, uploads and emails are disabled."}
        </p>
      )}
      {error && (
        <p role="alert" className="inventory-error">
          {error}
        </p>
      )}
      {notice && (
        <div role="status" className="inventory-feedback">
          <p>{notice}</p>
          {customerLink && (
            <div><a href={customerLink} target="_blank" rel="noopener noreferrer">{customerLink}</a><ShareQr url={customerLink} label="Car link QR" /></div>
          )}
        </div>
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
                    {carVariant(car) && <p className="inventory-row-variant">{carVariant(car)}</p>}
                    <InventorySpecs car={car} />
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
                <div className="inventory-detail-actions">
                  {writable && isAdvertisedCar(car) && onQuickEnquiry && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onQuickEnquiry(car.id)}
                    >
                      <MessageSquarePlus aria-hidden size={16} /> Quick enquiry
                    </Button>
                  )}
                  {carActions(car)}
                </div>
                {writable && (
                  <div className="inventory-vehicle-controls">
                    <label>
                      Number plate
                      <UKNumberPlate editable required={false} variant="front" inputLabel="Number plate"
                        value={plateDraft ?? car.plate ?? car.vrm ?? ""} onChange={setPlateDraft} />
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
                          if (selectedRef.current === car.id)
                            setPlateDraft(null);
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
              <div className="inventory-detail-sections" role="group" aria-label="Car detail sections">
                {([['media','Photos & video'],['description','Description'],['customers','Customers']] as const).map(([value,label]) => <Button key={value} variant="ghost" aria-pressed={detailSection === value} onClick={() => setDetailSection(value)}>{label}</Button>)}
              </div>
              <div className="inventory-workspace-grid" data-section={detailSection}>
                <div className="inventory-detail-editor" hidden={detailSection !== 'description'}><VehicleDescriptionEditor key={car.id} vehicleId={car.id} writable={Boolean(writable || (details.data?.descriptionPreview && access.data?.permissions.includes("sales.manage")))} /></div>
                <section className="inventory-card inventory-private-photos" hidden={detailSection !== "media"}>
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
                            if (selectedRef.current === car.id)
                              setGrant(undefined);
                          }, "Upload link cancelled.")
                        }
                      >
                        Cancel upload link
                      </Button>
                    </div>
                  )}
                </section>
                <div className="inventory-detail-editor" hidden={detailSection !== 'media'}><VehicleVideoEditor key={`video-${car.id}`} vehicleId={car.id} vehicleTitle={vehicleDisplayTitle(car)} writable={Boolean(writable)} /></div>
                <section className="inventory-card inventory-customer-email" hidden={detailSection !== "customers"}>
                  <h3>
                    <Mail aria-hidden size={18} />
                    Message a customer
                  </h3>
                  <p>
                    Choose a linked enquiry and any photos, then review your
                    message. Send by email or scan a WhatsApp QR to send from
                    your own phone.
                  </p>
                  <NativeSelect
                    aria-label="Choose customer to email"
                    value=""
                    disabled={busy || previewReadOnly || customers.isLoading || customers.isError}
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
                        {c.customerName}
                      </option>
                    ))}
                  </NativeSelect>
                  {customers.isError && <div role="alert"><p>Customer enquiries could not be loaded.</p><Button variant="outline" onClick={() => void customers.refetch()}>Retry customer enquiries</Button></div>}
                  {!previewReadOnly &&
                    !customers.isLoading && !customers.isError &&
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
                {isAdvertisedCar(car) && <Button asChild variant="ghost">
                  <Link href={`/vehicle/${car.id}`}>Customer vehicle page</Link>
                </Button>}
              </section>
            </>
          )}
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
                  placeholder="Search make, model or number plate…"
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

            </div>
            {scope === "current" && (
              <div className="inventory-work-filters">
                <label>
                  <span>Sort</span>
                  <NativeSelect
                    aria-label="Sort cars"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="latest">Newest in stock</option>
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
                      data-status={status}
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
                : `${cars.length} ${cars.length === 1 ? "car" : "cars"}${term.trim() || attentionFilter !== "all" || (filter !== "all" && scope !== "archived") ? " shown" : ""}`}
            </p>
          </div>
          {scope === "current" && !list.isLoading && !list.isError && (
            <div
              className="inventory-attention-filters"
              role="group"
              aria-label="Cars to check"
            >
              {(
                [
                  ["missing-plate", ScanLine],
                  ["missing-service", Camera],
                ] as const
              ).map(([value, Icon]) => {
                const count = currentCars.filter((vehicle) =>
                  needsAttention(vehicle, value),
                ).length;
                return (
                  <button
                    type="button"
                    key={value}
                    data-tone={
                      count === 0
                        ? "neutral"
                        : value === "missing-service"
                          ? "info"
                          : "warning"
                    }
                    aria-pressed={attentionFilter === value}
                    onClick={() =>
                      setAttentionFilter(
                        attentionFilter === value ? "all" : value,
                      )
                    }
                  >
                    <Icon aria-hidden size={14} />
                    {attentionLabels[value]} <span>{count}</span>
                  </button>
                );
              })}
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
              <article className="inventory-car" data-status={c.inventory_status} key={c.id}>
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
                      {carVariant(c) && <p className="inventory-row-variant">{carVariant(c)}</p>}
                      <p className="inventory-row-registration">
                        {hasNumberPlate(c) ? <UKNumberPlate value={carRegistration(c)} variant="front" size="sm" testId={`inventory-plate-${c.id}`} /> : carRegistration(c)}
                        {!hasNumberPlate(c) && (
                          <span className="inventory-plate-needed">
                            Plate needed
                          </span>
                        )}
                      </p>
                    </div>
                    <InventorySpecs car={c} />
                    <div className="inventory-row-price">
                      <strong>{price(c.price)}</strong>
                      <InventoryStatus car={c} />
                    </div>
                  </div>
                  <div className="inventory-row-work">
                    {(c.service_photo_count ?? 0) > 0 && <span
                      className="inventory-service-photos"
                      data-has-photos={(c.service_photo_count ?? 0) > 0}
                      title="Private service-book photos"
                    >
                      <Camera aria-hidden size={14} />
                      {c.service_photo_count} service photos
                    </span>}
                    {c.source_status === "missing" && (
                      <span className="inventory-source-missing">
                        Absent from source
                      </span>
                    )}
                  </div>
                </button>
                {carActions(c)}
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
                attentionFilter !== "all" ||
                (filter !== "all" && scope !== "archived")) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setTerm("");
                    setAttentionFilter("all");
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
