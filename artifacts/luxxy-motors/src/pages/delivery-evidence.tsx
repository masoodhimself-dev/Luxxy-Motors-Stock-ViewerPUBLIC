import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { Camera, Check, MapPin, LoaderCircle, Truck } from "@/components/icons";
import { CustomerDocumentTheme } from "@/components/multi-customer-theme";
import { Button } from "@/components/ui/button";
import { requestUuid } from "@/lib/request-uuid";
import {
  clearDeliveryLocalDraft,
  deliveryLocalDraft,
  deliveryLocalKey,
  deliveryPhotoData,
  deliveryPhotoSlots,
  saveDeliveryLocalDraft,
  type DeliveryReport,
  type PublicDeliveryJob,
  type QueuedDeliveryPhoto,
  type DeliveryPhotoSlot,
} from "@/lib/delivery-evidence";
import "./delivery-evidence.css";
const initialReport = (): DeliveryReport => ({
  requestId: requestUuid(),
  driverName: "",
  recipientName: "",
  handoverAt: "",
  mileage: 0,
  outcome: "delivered",
  notes: "",
  keys: 1,
  documentsProvided: false,
  acknowledged: false,
  location: null,
  locationReason: "",
});
export default function DeliveryEvidencePage() {
  return (
    <CustomerDocumentTheme>
      <DeliveryEvidenceContent />
    </CustomerDocumentTheme>
  );
}
function DeliveryEvidenceContent() {
  const [, params] = useRoute("/delivery-evidence/:token"),
    token = params?.token ?? "";
  const [record, setRecord] = useState<PublicDeliveryJob>(),
    [report, setReport] = useState(initialReport),
    [photos, setPhotos] = useState<QueuedDeliveryPhoto[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [local, setLocal] = useState(""),
    [notice, setNotice] = useState(""),
    [online, setOnline] = useState(navigator.onLine),
    [received, setReceived] = useState(""),
    [findingLocation, setFindingLocation] = useState(false);
  const key = useRef(""),
    version = useRef(0),
    saveSequence = useRef(0),
    current = useRef({ record, report, photos });
  current.current = { record, report, photos };
  async function call(path = "", body?: unknown) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(
        `/api/delivery-evidence/${encodeURIComponent(token)}${path}`,
        {
          method: body ? "POST" : "GET",
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
          ...(body
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }
            : {}),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error ||
            "Could not connect to the showroom. Keep this page open and retry.",
        );
      return data;
    } catch (cause) {
      if (controller.signal.aborted)
        throw new Error(
          "The connection timed out. Keep this page open and retry when reception returns.",
        );
      throw cause;
    } finally {
      clearTimeout(timer);
    }
  }
  useEffect(() => {
    let stopped = false;
    const generation = ++version.current;
    setLoading(true);
    setError("");
    setRecord(undefined);
    setPhotos([]);
    setReport(initialReport());
    setReceived("");
    setBusy(false);
    setFindingLocation(false);
    setLocal("");
    setNotice("");
    key.current = "";
    document.title = "Delivery evidence";
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    void (async () => {
      if (!/^[a-f0-9]{64}$/.test(token))
        throw new Error(
          "This link is incomplete. Ask the showroom for a new driver link.",
        );
      let cached;
      try {
        const localKey = await deliveryLocalKey(token);
        if (stopped || generation !== version.current) return;
        key.current = localKey;
        cached = await deliveryLocalDraft(localKey);
      } catch {
        if (!stopped)
          setLocal(
            "Device storage is unavailable. Keep this page open and use a printed declaration as backup.",
          );
      }
      if (cached && !stopped) {
        setRecord(cached.record);
        setReport(cached.report);
        setPhotos(cached.photos);
        setLocal("Draft restored from this device.");
      }
      try {
        const fresh = (await call()) as PublicDeliveryJob;
        if (stopped || generation !== version.current) return;
        setRecord(fresh);
        if (cached?.record.id === fresh.id) {
          setPhotos(
            cached.photos.map((p) => ({
              ...p,
              saved:
                p.saved ||
                fresh.photos.some((f) => f.requestId === p.requestId),
            })),
          );
        } else {
          setReport({
            ...initialReport(),
            driverName: fresh.snapshot.driver,
            recipientName: fresh.snapshot.recipient,
          });
        }
        if (fresh.status === "received") {
          setReceived(fresh.submittedAt || "Received");
          if (key.current) await clearDeliveryLocalDraft(key.current);
        }
      } catch (cause) {
        if (!stopped) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load the delivery job.",
          );
          if (cached)
            setNotice(
              "Your unsent draft is still on this device. Confirm the job is current with the showroom before continuing.",
            );
        }
      }
    })()
      .catch((cause) => {
        if (!stopped) setError(cause.message);
      })
      .finally(() => {
        if (!stopped) setLoading(false);
      });
    return () => {
      stopped = true;
      version.current++;
      meta.remove();
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
    };
  }, [token]);
  useEffect(() => {
    if (!record || received || !key.current || loading) return;
    const sequence = ++saveSequence.current;
    const localKey = key.current,
      generation = version.current;
    const timer = window.setTimeout(() => {
      void saveDeliveryLocalDraft({
        key: localKey,
        savedAt: Date.now(),
        record,
        report,
        photos,
      })
        .then(() => {
          if (
            sequence === saveSequence.current &&
            generation === version.current
          )
            setLocal(
              "Saved on this device. Waiting for upload until you submit.",
            );
        })
        .catch(() => {
          if (generation === version.current)
            setLocal(
              "Could not save on this device. Keep the page open; use the printed declaration as backup.",
            );
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [record, report, photos, received, loading]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (
        record &&
        !received &&
        (photos.length > 0 ||
          report.handoverAt ||
          report.mileage ||
          report.notes ||
          report.location ||
          report.acknowledged ||
          report.documentsProvided ||
          report.outcome === "not-delivered")
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [record, received, photos, report]);
  const edit = (patch: Partial<DeliveryReport>) => {
    setReport((r) => ({ ...r, ...patch, requestId: requestUuid() }));
    setError("");
  };
  async function addPhoto(
    slot: DeliveryPhotoSlot,
    file: File | undefined,
    phase: "arrival" | "departure",
  ) {
    if (!file) return;
    const generation = version.current;
    setBusy(true);
    setError("");
    try {
      const dataUrl = await deliveryPhotoData(file);
      if (generation !== version.current) return;
      const previous = current.current.photos,
        same = previous.find((p) => p.slot === slot && p.phase === phase);
      if (same?.saved)
        throw new Error(
          "This photo is already uploaded. Ask the showroom to retain any additional pictures.",
        );
      const next = previous.filter(
        (p) => !(p.slot === slot && p.phase === phase && !p.saved),
      );
      if (next.length >= 16)
        throw new Error("This delivery supports up to 16 photos.");
      setPhotos([
        ...next,
        {
          requestId: requestUuid(),
          phase,
          slot,
          capturedAt: new Date().toISOString(),
          dataUrl,
        },
      ]);
    } catch (cause) {
      if (generation === version.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not prepare the photo.",
        );
    } finally {
      if (generation === version.current) setBusy(false);
    }
  }
  function locate() {
    const generation = version.current;
    setFindingLocation(true);
    setError("");
    if (!navigator.geolocation) {
      setFindingLocation(false);
      edit({ location: null, locationReason: "Device location unavailable" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (generation !== version.current) return;
        edit({
          location: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            capturedAt: new Date(position.timestamp).toISOString(),
          },
          locationReason: "",
        });
        setFindingLocation(false);
      },
      () => {
        if (generation !== version.current) return;
        edit({
          location: null,
          locationReason: "Location unavailable or permission declined",
        });
        setFindingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !record || received) return;
    setBusy(true);
    setError("");
    setNotice("");
    const generation = version.current;
    const submission = current.current;
    try {
      if (!navigator.onLine)
        throw new Error(
          "You are offline. Keep this page open and retry when reception returns.",
        );
      const fresh = (await call()) as PublicDeliveryJob;
      if (generation !== version.current) return;
      if (fresh.id !== record.id)
        throw new Error(
          "This job changed. Ask the showroom to recover your draft.",
        );
      for (const photo of submission.photos) {
        if (
          photo.saved ||
          fresh.photos.some((p) => p.requestId === photo.requestId)
        )
          continue;
        setNotice(`Uploading ${photo.phase} ${photo.slot} photo…`);
        await call("/photos", {
          requestId: photo.requestId,
          phase: photo.phase,
          slot: photo.slot,
          capturedAt: photo.capturedAt,
          dataUrl: photo.dataUrl,
        });
        if (generation !== version.current) return;
        setPhotos((previous) =>
          previous.map((p) =>
            p.requestId === photo.requestId ? { ...p, saved: true } : p,
          ),
        );
      }
      setNotice("Saving delivery report…");
      const result = await call("/submit", submission.report);
      if (generation !== version.current) return;
      setReceived(result.receivedAt);
      setNotice("");
      if (key.current) await clearDeliveryLocalDraft(key.current);
    } catch (cause) {
      if (generation !== version.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Upload incomplete. Keep your photos and retry.",
      );
      setNotice(
        "Uploaded photos stay in the delivery file. Retry continues with the remaining photos.",
      );
    } finally {
      if (generation === version.current) setBusy(false);
    }
  }
  const dateInput = (value: string) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
  };
  const photoTile = (
    slot: (typeof deliveryPhotoSlots)[number],
    phase: "arrival" | "departure",
  ) => {
    const photo = photos.find((p) => p.slot === slot.id && p.phase === phase);
    return (
      <label
        key={`${phase}-${slot.id}`}
        className={`delivery-photo ${photo ? "has-photo" : ""}`}
      >
        <span>
          {photo ? (
            <img src={photo.dataUrl} alt={`${phase} ${slot.label}`} />
          ) : (
            <Camera aria-hidden="true" />
          )}
        </span>
        <strong>
          {slot.label}
          {phase === "arrival" && slot.id !== "damage" ? " *" : ""}
        </strong>
        <small>
          {photo?.saved
            ? "Uploaded"
            : photo
              ? "Ready to upload"
              : "Take / choose photo"}
        </small>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          disabled={busy || !!photo?.saved}
          onChange={(e) => {
            void addPhoto(slot.id, e.target.files?.[0], phase);
            e.target.value = "";
          }}
        />
      </label>
    );
  };
  return (
    <main className="delivery-page">
      <div className="delivery-shell">
        <header className="delivery-heading">
          <Truck aria-hidden="true" />
          <strong>{record?.snapshot.dealerName || "Delivery evidence"}</strong>
          <span>Private delivery link</span>
        </header>
        {loading ? (
          <div role="status" className="delivery-card">
            <LoaderCircle className="animate-spin" />
            Loading delivery…
          </div>
        ) : !record ? (
          <div className="delivery-card" role="alert">
            {error}
          </div>
        ) : received ? (
          <section className="delivery-card">
            <div className="delivery-success">
              <Check />
            </div>
            <h1>Evidence received</h1>
            <p>The showroom has your delivery report and photos.</p>
            <p className="delivery-muted">
              Staff will review the report and confirm handover separately.
            </p>
            <strong>
              {record.snapshot.vehicle} · {record.snapshot.registration}
            </strong>
          </section>
        ) : (
          <form className="delivery-card" onSubmit={submit}>
            <p className="delivery-kicker">
              {record.snapshot.saleReference} ·{" "}
              {online ? "Connected" : "Offline"}
            </p>
            <h1>Record the delivery</h1>
            <section className="delivery-job">
              <strong>{record.snapshot.vehicle}</strong>
              <span className="delivery-plate">
                {record.snapshot.registration}
              </span>
              <p>
                {record.snapshot.recipient}
                <br />
                {record.snapshot.address}
              </p>
              <p>
                {new Date(
                  `${record.snapshot.scheduledDate}T12:00:00Z`,
                ).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}{" "}
                {record.snapshot.timeWindow}
              </p>
              {record.snapshot.phone && (
                <a href={`tel:${record.snapshot.phone.replace(/[^+\d]/g, "")}`}>
                  Call recipient
                </a>
              )}
              {record.snapshot.instructions && (
                <p>{record.snapshot.instructions}</p>
              )}
            </section>
            <p className="delivery-local" role="status">
              {local ||
                "Keep this page open if reception is limited. Carry the printed declaration as backup."}
            </p>
            <h2>
              <Camera aria-hidden="true" />
              Arrival photos
            </h2>
            <p className="delivery-muted">
              Show the car’s condition and dashboard before handover.
            </p>
            <div className="delivery-photos">
              {deliveryPhotoSlots.map((slot) => photoTile(slot, "arrival"))}
            </div>
            <details>
              <summary>Departure photos · optional</summary>
              <div className="delivery-photos">
                {deliveryPhotoSlots.map((slot) => photoTile(slot, "departure"))}
              </div>
            </details>
            <h2>Handover details</h2>
            <div className="delivery-fields">
              <label>
                Driver name
                <input
                  value={report.driverName}
                  required
                  minLength={2}
                  maxLength={120}
                  disabled={busy}
                  onChange={(e) => edit({ driverName: e.target.value })}
                />
              </label>
              <label>
                Mileage
                <input
                  type="number"
                  min="0"
                  max="5000000"
                  required
                  value={report.mileage || ""}
                  disabled={busy}
                  onChange={(e) => edit({ mileage: Number(e.target.value) })}
                />
              </label>
              <label>
                Outcome
                <select
                  value={report.outcome}
                  disabled={busy}
                  onChange={(e) =>
                    edit({
                      outcome: e.target.value as DeliveryReport["outcome"],
                    })
                  }
                >
                  <option value="delivered">Delivered</option>
                  <option value="not-delivered">Delivery not completed</option>
                </select>
              </label>
              <label>
                <span>Actual date and time</span>
                <input
                  aria-label="Actual date and time"
                  type="datetime-local"
                  required
                  value={dateInput(report.handoverAt)}
                  disabled={busy}
                  onChange={(e) =>
                    e.target.value &&
                    edit({ handoverAt: new Date(e.target.value).toISOString() })
                  }
                />
                <button
                  className="delivery-time-now"
                  type="button"
                  disabled={busy}
                  onClick={() => edit({ handoverAt: new Date().toISOString() })}
                >
                  Use current time
                </button>
              </label>
              <label>
                Recipient name
                <input
                  value={report.recipientName}
                  required={report.outcome === "delivered"}
                  maxLength={120}
                  disabled={busy}
                  onChange={(e) => edit({ recipientName: e.target.value })}
                />
              </label>
              <label>
                Number of keys
                <input
                  type="number"
                  min="0"
                  max="20"
                  value={report.keys}
                  required
                  disabled={busy}
                  onChange={(e) => edit({ keys: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="delivery-check">
              <input
                type="checkbox"
                checked={report.documentsProvided}
                disabled={busy}
                onChange={(e) => edit({ documentsProvided: e.target.checked })}
              />
              Agreed documents supplied
            </label>
            <label>
              Condition notes / missing items
              {report.outcome === "not-delivered" ? " · reason required" : ""}
              <textarea
                value={report.notes}
                maxLength={3000}
                required={report.outcome === "not-delivered"}
                disabled={busy}
                onChange={(e) => edit({ notes: e.target.value })}
              />
            </label>
            <h2>
              <MapPin aria-hidden="true" />
              Location
            </h2>
            <Button
              type="button"
              variant="outline"
              disabled={findingLocation || busy}
              onClick={locate}
            >
              {findingLocation
                ? "Getting location…"
                : report.location
                  ? "Update current location"
                  : "Use current location"}
            </Button>
            {report.location ? (
              <p className="delivery-muted">
                Location recorded · accuracy approximately{" "}
                {Math.round(report.location.accuracy)} metres.
              </p>
            ) : (
              <label>
                Reason if unavailable
                <input
                  value={report.locationReason}
                  maxLength={200}
                  disabled={busy}
                  required
                  onChange={(e) => edit({ locationReason: e.target.value })}
                />
              </label>
            )}
            {report.outcome === "delivered" && (
              <label className="delivery-check">
                <input
                  type="checkbox"
                  checked={report.acknowledged}
                  disabled={busy}
                  required
                  onChange={(e) => edit({ acknowledged: e.target.checked })}
                />
                The named recipient acknowledged receipt and the condition notes
                above.
              </label>
            )}
            <p className="delivery-muted">
              This records the delivery. It does not confirm payment or waive
              the customer’s rights.
            </p>
            {error && (
              <p className="delivery-error" role="alert">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            <Button type="submit" className="delivery-submit" disabled={busy}>
              {busy ? (
                <>
                  <LoaderCircle className="animate-spin" />
                  Saving…
                </>
              ) : online ? (
                "Submit delivery evidence"
              ) : (
                "Save and retry when online"
              )}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
