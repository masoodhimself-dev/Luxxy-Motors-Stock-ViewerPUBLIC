import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, getGetStockQueryKey } from "@workspace/api-client-react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  ScanLine,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { vehicleDisplayTitle } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isFrontPhoto, plateEntryPhotos } from "./plate-entry-photo";
import "./bulk-plate-entry.css";

export type PlateEntryCar = {
  id: string;
  title: string;
  display_title?: string;
  make?: string | null;
  model?: string | null;
  plate?: string | null;
  vrm?: string | null;
  year?: number | null;
  photo?: string | null;
};
type Details = {
  car: PlateEntryCar;
  vehiclePhotos?: unknown;
  previewReadOnly?: boolean;
};
const normalise = (value: string) => value.replace(/\s/g, "").toUpperCase();

/** One explicit correction at a time, using the existing optimistic-locking endpoint. */
export function BulkPlateEntry({
  cars,
  onClose,
}: {
  cars: PlateEntryCar[];
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const [queue, setQueue] = useState(cars);
  const [index, setIndex] = useState(0);
  const [saved, setSaved] = useState(0);
  const [skipped, setSkipped] = useState<PlateEntryCar[]>([]);
  const [draft, setDraft] = useState("");
  const [photoIndex, setPhotoIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [baseline, setBaseline] = useState<{
    carId: string;
    plate: string | null;
  } | null>(null);
  const saving = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const current = queue[index];
  const details = useQuery({
    queryKey: ["staff-inventory", "plate-entry", current?.id],
    enabled: Boolean(current),
    queryFn: ({ signal }) =>
      customFetch<Details>(`/api/staff/inventory/${current!.id}`, { signal }),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const car = details.data?.car;
  const title = car ? vehicleDisplayTitle({ ...car, title: car.display_title ?? car.title }) : vehicleDisplayTitle(current);
  const original =
    baseline?.carId === current?.id ? (baseline?.plate ?? "") : "";
  const photos = plateEntryPhotos(
    details.data?.vehiclePhotos,
    car?.photo || current?.photo,
  );
  const photo = photos[photoIndex] ?? photos[0];
  const complete = !current;
  useEffect(() => {
    setDraft("");
    setBaseline(null);
    setPhotoIndex(0);
    setZoom(false);
    setError("");
    setNeedsRefresh(false);
  }, [current?.id]);
  useEffect(() => {
    // Keep the expected value paired with what staff actually reviewed, even on a background refetch.
    if (car && car.id === current?.id) {
      const plate = car.plate ?? car.vrm ?? null;
      setBaseline({ carId: car.id, plate });
      setDraft(plate ?? "");
      input.current?.focus();
    }
  }, [car?.id, current?.id]);
  useEffect(() => {
    if (
      car &&
      baseline?.carId === car.id &&
      car.id === current?.id &&
      !busy &&
      (car.plate ?? car.vrm ?? null) !== baseline.plate
    ) {
      setNeedsRefresh(true);
      setError(
        "The plate changed elsewhere. Check the latest plate before continuing.",
      );
    }
  }, [car?.plate, car?.vrm, car?.id, baseline, current?.id, busy]);
  useEffect(() => {
    setPhotoFailed(false);
  }, [photo?.url]);
  const dirty = Boolean(car && normalise(draft) !== normalise(original));
  function close() {
    if (saving.current || busy) return;
    if (
      dirty &&
      !window.confirm(
        "Leave this number plate unsaved? Saved plates will be kept.",
      )
    )
      return;
    onClose();
  }
  function advance(skip = false) {
    if (saving.current || busy || !current) return;
    if (skip) setSkipped((old) => [...old, current]);
    setIndex((old) => old + 1);
  }
  async function refresh() {
    if (saving.current || busy) return;
    const result = await details.refetch();
    if (result.data?.car.id === current?.id && !result.isError) {
      setDraft(result.data.car.plate ?? result.data.car.vrm ?? "");
      setBaseline({
        carId: result.data.car.id,
        plate: result.data.car.plate ?? result.data.car.vrm ?? null,
      });
      setNeedsRefresh(false);
      setError("");
      input.current?.focus();
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (
      saving.current ||
      busy ||
      needsRefresh ||
      !car ||
      car.id !== current?.id ||
      baseline?.carId !== car.id ||
      details.isError ||
      details.isLoading ||
      details.data?.previewReadOnly
    )
      return;
    const plate = normalise(draft);
    if (!/^[A-Z0-9]{2,8}$/.test(plate)) {
      setError(
        "Enter 2–8 letters and numbers from the photo, or skip this car.",
      );
      input.current?.focus();
      return;
    }
    if (plate === normalise(original)) {
      advance();
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await customFetch(`/api/staff/inventory/${car.id}/plate`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plate, expectedPlate: baseline.plate }),
      });
      setSaved((old) => old + 1);
      void cache.invalidateQueries({ queryKey: ["staff-inventory"] });
      void cache.invalidateQueries({ queryKey: getGetStockQueryKey() });
      void cache.invalidateQueries({ queryKey: ["dealer-operations"] });
      setIndex((old) => old + 1);
    } catch (cause) {
      const failure = cause as { status?: number; data?: { error?: string } };
      if (failure.status === 400)
        setError(
          failure.data?.error || "Check the number plate before saving.",
        );
      else {
        setNeedsRefresh(true);
        setError(
          failure.status === 409
            ? "The plate changed elsewhere. Check the latest plate before continuing."
            : failure.status === 404
              ? "This car is no longer available. Skip it or check the latest record."
              : "We could not confirm the save. Check the latest plate before trying again; it may already have saved.",
        );
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        className="portal-action-dialog plate-entry-dialog"
        data-saving={busy}
        onEscapeKeyDown={(event) => {
          if (busy || saving.current) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy || saving.current) event.preventDefault();
        }}
      >
        <DialogHeader className="plate-entry-heading">
          <DialogTitle>
            <ScanLine size={21} aria-hidden /> Add number plates
          </DialogTitle>
          <DialogDescription>
            {complete
              ? "Your plate checks are finished."
              : `Car ${index + 1} of ${queue.length} · ${saved} saved · ${skipped.length} skipped`}
          </DialogDescription>
          <progress
            aria-label="Plate entry progress"
            value={index}
            max={Math.max(queue.length, 1)}
          />
        </DialogHeader>
        {complete ? (
          <div className="plate-entry-complete" role="status">
            <CheckCircle2 size={40} aria-hidden />
            <h3>
              {saved} {saved === 1 ? "number plate" : "number plates"} saved
            </h3>
            <p>
              {skipped.length
                ? `${skipped.length} ${skipped.length === 1 ? "car was" : "cars were"} skipped. No plate was guessed.`
                : "Your saved plates are kept when stock imports run."}
            </p>
            <div>
              {skipped.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQueue(skipped);
                    setSkipped([]);
                    setIndex(0);
                  }}
                >
                  Review skipped cars
                </Button>
              )}
              <Button onClick={onClose}>Back to Cars</Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(event) => void save(event)}
            className="plate-entry-form"
          >
            <div className="plate-entry-body">
              <div className="plate-entry-car">
              <h3>{title}</h3>
                <span>{car?.year ?? current.year}</span>
              </div>
              {details.isLoading ? (
                <p role="status">Loading this car’s photos…</p>
              ) : details.isError ? (
                <div role="alert">
                  <p>This car could not load. Your queue is still here.</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void refresh()}
                  >
                    Retry car
                  </Button>
                </div>
              ) : (
                <>
                  <div className="plate-entry-gallery">
                    <div className="plate-entry-photo" data-zoom={zoom}>
                      {photo && !photoFailed ? (
                        <img
                          src={photo.url}
                    alt={`${title} — ${photo.caption || "stock photo"}`}
                          onError={() => setPhotoFailed(true)}
                        />
                      ) : (
                        <p>
                          {photoFailed
                            ? "This photo could not load. Try another photo, or skip this car."
                            : "No photos are available. Skip this car if you cannot check its plate."}
                        </p>
                      )}
                    </div>
                    <div className="plate-entry-photo-tools">
                      <span>
                        {photo?.caption || "Stock photo"}
                        {photos.length > 1
                          ? ` · ${photoIndex + 1} / ${photos.length}`
                          : ""}
                      </span>
                      <div>
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label="Previous photo"
                          disabled={busy || photos.length < 2}
                          onClick={() => {
                            setPhotoIndex(
                              (old) =>
                                (old - 1 + photos.length) % photos.length,
                            );
                            setZoom(false);
                          }}
                        >
                          <ArrowLeft size={18} aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label="Next photo"
                          disabled={busy || photos.length < 2}
                          onClick={() => {
                            setPhotoIndex((old) => (old + 1) % photos.length);
                            setZoom(false);
                          }}
                        >
                          <ArrowRight size={18} aria-hidden />
                        </Button>
                        {photo && !photoFailed && (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              aria-label={
                                zoom ? "Zoom out photo" : "Zoom in photo"
                              }
                              onClick={() => setZoom((old) => !old)}
                            >
                              {zoom ? (
                                <ZoomOut size={19} aria-hidden />
                              ) : (
                                <ZoomIn size={19} aria-hidden />
                              )}
                            </Button>
                            <a
                              href={photo.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label="Open full-size car photo"
                            >
                              <ExternalLink size={18} aria-hidden />
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                    {photo && !isFrontPhoto(photo) && (
                      <p className="plate-entry-hint">
                        No front view is labelled for this photo. Use the arrows
                        to find a clear view of the plate.
                      </p>
                    )}
                  </div>
                  <div className="plate-entry-input-panel">
                    <label className="plate-entry-label">
                      Number plate
                      <Input
                        className="uk-number-plate-input"
                        ref={input}
                        aria-label="Number plate from photo"
                        value={draft}
                        maxLength={12}
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        disabled={
                          busy || needsRefresh || details.data?.previewReadOnly
                        }
                        placeholder="AB12 CDE"
                        onChange={(event) => {
                          setDraft(event.target.value.toUpperCase());
                          setError("");
                        }}
                      />
                    </label>
                    <p className="plate-entry-hint">
                      Read it from the photo. If it is covered or unclear, skip
                      this car.
                    </p>
                  </div>
                </>
              )}
              {error && (
                <div className="plate-entry-error" role="alert">
                  <p>{error}</p>
                  {needsRefresh && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={details.isFetching || busy}
                      onClick={() => void refresh()}
                    >
                      Check latest plate
                    </Button>
                  )}
                </div>
              )}
            </div>
            <footer className="plate-entry-footer">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => advance(true)}
              >
                Skip car
              </Button>
              <Button
                type="submit"
                disabled={
                  busy ||
                  !car ||
                  details.isLoading ||
                  details.isError ||
                  needsRefresh ||
                  !normalise(draft) ||
                  details.data?.previewReadOnly
                }
              >
                {busy ? (
                  <>
                    <LoaderCircle
                      size={16}
                      className="animate-spin"
                      aria-hidden
                    />{" "}
                    Saving…
                  </>
                ) : draft && normalise(draft) === normalise(original) ? (
                  "Keep & next"
                ) : (
                  "Save & next"
                )}
                <ArrowRight size={17} aria-hidden />
              </Button>
            </footer>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
