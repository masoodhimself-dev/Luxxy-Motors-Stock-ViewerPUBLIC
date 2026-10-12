import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch, useGetStaffDirectory } from "@workspace/api-client-react";
import { useSearch, useLocation, Link } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useStaffAccess } from "./dealer-administration";
import "./staff-inventory.css";
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
  photo?: string | null;
  service_photo_count: number;
  tasks: Tasks | null;
};
type Prep = {
  revision: number;
  tasks: Tasks;
  assigned_to_id: string | null;
  due_date: string | null;
  notes: string;
};
type Details = {
  car: Car;
  preparation: Prep;
  photos: { id: string; byte_size: number; created_at: string }[];
};
type Grant = { id: string; url: string; expiresAt: string };
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
function PrivatePhoto({
  carId,
  id,
  index,
}: {
  carId: string;
  id: string;
  index: number;
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
      <img src={url} alt={`Private service-book page ${index + 1}`} />
    </a>
  ) : (
    <p>Loading photo…</p>
  );
}
export function StaffInventory() {
  const search = useSearch(),
    [, navigate] = useLocation();
  const selected = new URLSearchParams(search).get("vehicleId");
  const [term, setTerm] = useState(""),
    [filter, setFilter] = useState("all"),
    [draft, setDraft] = useState<Prep>(),
    [grant, setGrant] = useState<Grant>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const access = useStaffAccess(),
    directory = useGetStaffDirectory();
  const writable = access.data?.permissions.includes("sales.manage");
  const list = useQuery({
    queryKey: ["staff-inventory"],
    queryFn: () => send<{ cars: Car[] }>("/api/staff/inventory"),
  });
  const details = useQuery({
    queryKey: ["staff-inventory", selected],
    enabled: !!selected,
    queryFn: () => send<Details>(`/api/staff/inventory/${selected}`),
    refetchInterval: () =>
      grant && Date.parse(grant.expiresAt) > Date.now() ? 5000 : false,
  });
  useEffect(() => {
    setDraft(undefined);
    setGrant(undefined);
    setError("");
    setNotice("");
  }, [selected]);
  useEffect(() => {
    if (details.data && !draft) setDraft(details.data.preparation);
  }, [details.data, draft]);
  async function act(work: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await work();
      setNotice(message);
      await Promise.all([list.refetch(), details.refetch()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!draft) return;
    await act(async () => {
      await send(`/api/staff/inventory/${selected}/preparation`, "PUT", {
        revision: draft.revision,
        tasks: draft.tasks,
        assignedToId: draft.assigned_to_id,
        dueDate: draft.due_date,
        notes: draft.notes,
      });
      const fresh = await details.refetch();
      if (fresh.data) setDraft(fresh.data.preparation);
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
  const cars = (list.data?.cars ?? []).filter(
    (c) =>
      (filter === "all" || c.inventory_status === filter) &&
      (c.title + " " + (c.plate ?? c.vrm ?? c.registration ?? ""))
        .toLowerCase()
        .includes(term.toLowerCase()),
  );
  const car = details.data?.car;
  return (
    <section className="staff-inventory">
      <header className="inventory-heading">
        <div>
          <p className="inventory-kicker">Your showroom</p>
          <h2>{selected ? "Vehicle workspace" : "All cars"}</h2>
          <p>Private service records, preparation and customer activity.</p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            void list.refetch();
            if (selected) void details.refetch();
          }}
        >
          Refresh
        </Button>
      </header>
      {selected ? (
        <>
          <Button variant="outline" onClick={() => open(null)}>
            Back to all cars
          </Button>
          {details.isLoading && <p role="status">Loading vehicle…</p>}
          {details.isError && (
            <p role="alert" className="inventory-error">
              Could not load this car. Refresh to retry.
            </p>
          )}
          {car && (
            <>
              <div className="inventory-vehicle-heading">
                <h3>{car.display_title ?? car.title}</h3>
                <p>
                  {car.plate ??
                    car.vrm ??
                    car.registration ??
                    "Registration not supplied"}{" "}
                  · {price(car.price)}
                </p>
                <span className="inventory-status">{car.inventory_status}</span>
                {car.source_status === "missing" && (
                  <p className="inventory-muted">
                    No longer advertised by the source. This does not mean sold.
                  </p>
                )}
              </div>
              <div className="inventory-workspace-grid">
                <section className="inventory-card">
                  <h3>Service-book photos</h3>
                  <p>
                    Up to three private photos. Imported stock updates do not
                    replace these.
                  </p>
                  <div className="inventory-photo-grid">
                    {details.data!.photos.map((p, i) => (
                      <figure key={p.id}>
                        <PrivatePhoto carId={car.id} id={p.id} index={i} />
                        <figcaption>
                          {Math.ceil(p.byte_size / 1024)} KB
                          {writable && (
                            <button
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Remove this service-book photo?",
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
                  {!details.data!.photos.length && (
                    <p className="inventory-muted">
                      No service-book photos yet.
                    </p>
                  )}
                  {writable && details.data!.photos.length < 3 && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          setGrant(
                            await send<Grant>(
                              `/api/staff/inventory/${car.id}/upload-session`,
                              "POST",
                            ),
                          );
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
                        title="Service-book upload QR code"
                      />
                      <p>
                        For this car only · Expires{" "}
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
                            setGrant(undefined);
                          }, "Upload link cancelled.")
                        }
                      >
                        Cancel upload link
                      </Button>
                    </div>
                  )}
                </section>
                <section className="inventory-card">
                  <h3>Preparation checklist</h3>
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
              </div>
              <section className="inventory-card">
                <h3>Vehicle activity</h3>
                <p>
                  See this car’s enquiries, appointments, reservations and sales
                  together.
                </p>
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
          <p className="inventory-muted">
            Includes retained sold and no longer advertised cars; the overview
            counts current showroom stock.
          </p>
          <div className="inventory-filters">
            <label>
              Search cars
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Make, model or registration"
              />
            </label>
            <label>
              Availability
              <NativeSelect
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                {[
                  "all",
                  "available",
                  "reserved",
                  "sold",
                  "hidden",
                  "archived",
                ].map((s) => (
                  <option key={s} value={s}>
                    {s === "all" ? "All cars" : s[0].toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>
          {list.isLoading && <p role="status">Loading cars…</p>}
          {list.isError && (
            <p role="alert" className="inventory-error">
              Inventory unavailable. Refresh to retry.
            </p>
          )}
          <div className="inventory-car-list">
            {cars.map((c) => (
              <button
                className="inventory-car"
                key={c.id}
                onClick={() => open(c.id)}
              >
                {c.photo ? (
                  <img src={c.photo} alt={c.title} />
                ) : (
                  <div className="inventory-no-photo">No stock photo</div>
                )}
                <div>
                  <h3>{c.title}</h3>
                  <p>
                    {c.plate ??
                      c.vrm ??
                      c.registration ??
                      "Registration not supplied"}
                  </p>
                  <strong>{price(c.price)}</strong>
                  <p className="inventory-muted">
                    {c.service_photo_count}/3 service-book photos ·{" "}
                    {c.tasks
                      ? `${Object.values(c.tasks).filter((t) => t !== "pending").length}/4 preparation tasks cleared`
                      : "Preparation not started"}
                  </p>
                  {c.source_status === "missing" && (
                    <p className="inventory-muted">Absent from stock source</p>
                  )}
                </div>
                <span className="inventory-status">{c.inventory_status}</span>
              </button>
            ))}
          </div>
          {!list.isLoading && !list.isError && !cars.length && (
            <p>No cars match this search.</p>
          )}
        </>
      )}
    </section>
  );
}
