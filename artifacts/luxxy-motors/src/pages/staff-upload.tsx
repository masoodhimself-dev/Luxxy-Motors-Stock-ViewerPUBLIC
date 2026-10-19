import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { requestUuid } from "@/lib/request-uuid";
import {
  prepareServicePhoto,
  type PreparedPhoto,
} from "@/lib/service-book-photo";
import "@/components/portal/staff-inventory.css";
type Session = {
  category?: string;
  title: string;
  registration: string | null;
  remaining: number;
  expiresAt: string;
  completed: boolean;
};
export default function StaffUpload() {
  const [token] = useState(() => window.location.hash.slice(1));
  useEffect(() => {
    // Scanning a fresh QR in an already-open tab must start a fresh car-bound page.
    const rescan = () => {
      if (window.location.hash.length > 1) window.location.reload();
    };
    window.addEventListener("hashchange", rescan);
    return () => window.removeEventListener("hashchange", rescan);
  }, []);
  const [session, setSession] = useState<Session>();
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [requestId] = useState(requestUuid);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  async function call(method = "GET", body?: unknown) {
    const r = await fetch("/api/service-book-upload", {
      method,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: {
        "x-service-upload-token": token,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "Upload unavailable.");
    return data;
  }
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
    document.title = "Service-book upload";
    if (!token) {
      setError("Scan a fresh QR code from the car’s staff workspace.");
      return;
    }
    void call()
      .then((s) => {
        setSession(s);
        setDone(s.completed);
      })
      .catch((e) => setError(e.message));
  }, [token]);
  async function choose(files: FileList | null) {
    if (!files) return;
    setError("");
    if (!session || photos.length + files.length > session.remaining) {
      setError(
        `Choose no more than ${session?.remaining ?? 0} photos in total.`,
      );
      return;
    }
    setBusy(true);
    try {
      const prepared = await Promise.all(
        Array.from(files).map(prepareServicePhoto),
      );
      setPhotos((old) => [...old, ...prepared]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    setBusy(true);
    setError("");
    try {
      await call("POST", { requestId, photos: photos.map((p) => p.base64) });
      setDone(true);
      setPhotos([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="service-upload-page">
      <section className="service-upload-card">
        <p className="inventory-kicker">Private staff upload</p>
        <h1>
          {session?.category === "pre_accident"
            ? "Pre-accident photos"
            : "Service-book photos"}
        </h1>
        {session && (
          <>
            <h2>{session.title}</h2>
            {session.registration && <p>{session.registration}</p>}
          </>
        )}
        {done ? (
          <div role="status">
            <h2>Photos received</h2>
            <p>
              They are attached privately to this car. You can close this page.
            </p>
          </div>
        ) : (
          <>
            <p>
              {session?.category === "pre_accident"
                ? "Upload the original photos supplied for this car. The label describes their purpose; it does not verify when they were taken."
                : "Photograph each page clearly. Check that dates, mileage and stamps are readable."}{" "}
              Up to three photos per category.
            </p>
            {session && (
              <p className="inventory-muted">
                {session.remaining} spaces available · Link expires{" "}
                {new Date(session.expiresAt).toLocaleTimeString("en-GB", {
                  timeZone: "Europe/London",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                UK time.
              </p>
            )}
            {session && session.remaining > 0 && (
              <>
                <label className="inventory-file-button">
                  Take a photo
                  <input
                    aria-label="Take a service-book photo"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    disabled={busy}
                    onChange={(e) => {
                      void choose(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                <label className="inventory-file-button inventory-file-secondary">
                  Choose existing photos
                  <input
                    aria-label="Choose service-book photos"
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={busy}
                    onChange={(e) => {
                      void choose(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              </>
            )}
            {photos.length > 0 && <div className="inventory-photo-grid">
              {photos.map((p, i) => (
                <figure key={i}>
                  <img
                    src={p.preview}
                    alt={`Service-book page ${i + 1} for review`}
                  />
                  <figcaption>
                    {Math.ceil(p.bytes / 1024)} KB{" "}
                    <button
                      disabled={busy}
                      onClick={() =>
                        setPhotos((old) => old.filter((_, n) => n !== i))
                      }
                    >
                      Remove
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>}
            {photos.length > 0 && (
              <Button disabled={busy} onClick={() => void send()}>
                {busy
                  ? "Uploading…"
                  : `Upload ${photos.length} ${photos.length === 1 ? "photo" : "photos"}`}
              </Button>
            )}
          </>
        )}
        {error && (
          <div role="alert" className="inventory-error">
            {error}
          </div>
        )}
        {busy && !photos.length && (
          <p role="status">Preparing small, readable photos…</p>
        )}
      </section>
    </main>
  );
}
