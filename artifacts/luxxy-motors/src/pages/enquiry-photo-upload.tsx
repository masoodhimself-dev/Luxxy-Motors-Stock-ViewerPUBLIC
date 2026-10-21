import { useEffect, useRef, useState } from "react";
import { Camera, Image, Check } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { prepareServicePhoto, type PreparedPhoto } from "@/lib/service-book-photo";
import { requestUuid } from "@/lib/request-uuid";
import "./enquiry-photo-upload.css";

type Session = { title: string; customerName?: string; remaining: number; expiresAt: string; completed: boolean };
export default function EnquiryPhotoUpload() {
  const [token] = useState(() => window.location.hash.slice(1));
  const [session, setSession] = useState<Session>();
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "preparing" | "uploading" | "done">("loading");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  const alive = useRef(true), busy = useRef(false), attempt = useRef<{ requestId: string; photos: string[] } | null>(null);
  async function call(method = "GET", body?: unknown) {
    const response = await fetch("/api/enquiry-photo-upload", { method, credentials: "omit", referrerPolicy: "no-referrer", headers: { "x-enquiry-upload-token": token, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(typeof data?.error === "string" ? data.error : "The upload link could not be checked. Try again or ask for a fresh QR code.");
    return data;
  }
  useEffect(() => {
    alive.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    document.title = "Add enquiry photos";
    const rescan = () => { if (window.location.hash.length > 1) window.location.reload(); };
    window.addEventListener("hashchange", rescan);
    if (!token) { setError("Scan a fresh Add photos from phone QR code from the customer’s message."); setPhase("ready"); }
    else void call().then((data: Session) => { if (!alive.current) return; setSession(data); setPhase(data.completed ? "done" : "ready"); }).catch(cause => { if (alive.current) { setError(cause.message); setPhase("ready"); } });
    return () => { alive.current = false; window.removeEventListener("hashchange", rescan); };
  }, [token]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 5000); return () => window.clearInterval(timer); }, []);
  async function choose(files: FileList | null) {
    if (!files?.length || !session || busy.current || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now() || attempt.current) return;
    const remaining = Math.min(2, session.remaining);
    if (photos.length + files.length > remaining) { setError(`Choose up to ${remaining} ${remaining === 1 ? "photo" : "photos"} in total.`); return; }
    busy.current = true; setPhase("preparing"); setError("");
    try {
      const prepared = await Promise.all(Array.from(files).map(prepareServicePhoto));
      if (alive.current) { setPhotos(current => [...current, ...prepared]); attempt.current = null; }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "The photo could not be prepared. Try another photo."); }
    finally { busy.current = false; if (alive.current) setPhase("ready"); }
  }
  async function upload() {
    if (!photos.length || !session || busy.current) return;
    if (!Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) { setError("This link has expired. Ask for a fresh QR code; these photos have not been sent to the customer."); return; }
    busy.current = true; setPhase("uploading"); setError("");
    attempt.current ??= { requestId: requestUuid(), photos: photos.map(photo => photo.base64) };
    try {
      await call("POST", attempt.current);
      if (alive.current) { setPhotos([]); setPhase("done"); }
    } catch (cause) { if (alive.current) { setError(cause instanceof Error ? cause.message : "Upload could not be confirmed. Retry uses the same upload."); setPhase("ready"); } }
    finally { busy.current = false; }
  }
  const working = phase === "preparing" || phase === "uploading";
  const expired = Boolean(session && (!Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= now));
  return <main className="enquiry-phone-upload"><section className="enquiry-phone-upload-card">
    <p className="enquiry-phone-upload-kicker">Private staff upload</p><h1>Add enquiry photos</h1>
    {session && <div className="enquiry-phone-upload-context"><strong>{session.title || "Customer enquiry"}</strong>{session.customerName && <span>{session.customerName}</span>}</div>}
    {phase === "loading" ? <p role="status">Checking your upload link…</p> : phase === "done" ? <div className="enquiry-phone-upload-done" role="status"><Check aria-hidden="true" /><h2>Photos are ready</h2><p>Return to the customer’s message and refresh the photos. Staff can review them before sending by email or WhatsApp.</p><p>Nothing has been sent to the customer. You can close this page.</p></div> : <>
      <p>Take or choose up to two photos. We make them smaller and remove camera location details before uploading.</p>
      {session && <p className="enquiry-phone-upload-hint">{session.remaining} {session.remaining === 1 ? "space" : "spaces"} available · expires {new Date(session.expiresAt).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })} UK time.</p>}
      {expired && <p role="status" className="enquiry-phone-upload-error">This upload link has expired. Ask for a fresh QR code. Any photos you selected remain on this page; nothing has been sent to the customer.</p>}
      {session && session.remaining > photos.length && <div className="enquiry-phone-upload-choices"><label><Camera aria-hidden="true" />Take a photo<input type="file" accept="image/*" capture="environment" aria-label="Take an enquiry photo" disabled={working || expired || Boolean(attempt.current)} onChange={event => { void choose(event.target.files); event.target.value = ""; }} /></label><label><Image aria-hidden="true" />Choose photos<input type="file" accept="image/*" multiple aria-label="Choose enquiry photos" disabled={working || expired || Boolean(attempt.current)} onChange={event => { void choose(event.target.files); event.target.value = ""; }} /></label></div>}
      {photos.length > 0 && <div className="enquiry-phone-upload-photos">{photos.map((photo, index) => <figure key={index}><img src={photo.preview} alt={`Enquiry photo ${index + 1} for review`} /><figcaption>{Math.ceil(photo.bytes / 1024)} KB<Button type="button" size="sm" variant="outline" disabled={working || Boolean(attempt.current)} onClick={() => { setPhotos(current => current.filter((_, n) => n !== index)); attempt.current = null; }}>Remove photo {index + 1}</Button></figcaption></figure>)}</div>}
      {working && <p role="status">{phase === "preparing" ? "Preparing small, clear photos…" : "Uploading photos… Keep this page open."}</p>}
      {photos.length > 0 && <Button type="button" disabled={working || expired} onClick={() => void upload()}>{phase === "uploading" ? "Uploading…" : `Upload ${photos.length} ${photos.length === 1 ? "photo" : "photos"}`}</Button>}
    </>}{error && <p className="enquiry-phone-upload-error" role="alert">{error}</p>}
  </section></main>;
}
