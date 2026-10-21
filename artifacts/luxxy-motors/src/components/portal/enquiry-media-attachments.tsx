import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { customFetch } from "@workspace/api-client-react";
import { Camera, QrCode } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { prepareServicePhoto } from "@/lib/service-book-photo";
import { requestUuid } from "@/lib/request-uuid";
import { getSafeImageUrl } from "@/lib/utils";

export type CustomEnquiryPhoto = { id: string; byteSize: number; url: string; width?: number; height?: number; createdAt?: string };
type MediaSelection = { customPhotoIds?: string[]; vehiclePhotoIndices?: number[]; includeVideo?: boolean };
function PrivatePhoto({ url, index }: { url: string; index: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true, object = "";
    void customFetch<Blob>(url, { responseType: "blob" }).then(blob => { if (active) { object = URL.createObjectURL(blob); setSrc(object); } }).catch(() => {});
    return () => { active = false; if (object) URL.revokeObjectURL(object); };
  }, [url]);
  return src ? <img src={src} alt={`Custom enquiry photo ${index + 1}`} /> : <span className="enquiry-email-photo-empty">Preview unavailable</span>;
}
export function EnquiryMediaAttachments({ enquiryId, photos = [], vehiclePhotos = [], videoAvailable, selection, disabled, onChange, onRefresh, onBusyChange }: {
  enquiryId: string; photos?: CustomEnquiryPhoto[]; vehiclePhotos?: { index: number; url: string }[]; videoAvailable?: boolean;
  selection: MediaSelection; disabled: boolean; onChange: (selection: MediaSelection) => void; onRefresh: () => Promise<unknown>; onBusyChange: (busy: boolean) => void;
}) {
  const [error, setError] = useState(""), [working, setWorking] = useState(false);
  const [qr, setQr] = useState<{ id: string; url: string; expiresAt: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (!qr) return; const timer = window.setInterval(() => setNow(Date.now()), 5000); return () => window.clearInterval(timer); }, [qr]);
  const pending = useRef(false), input = useRef<HTMLInputElement>(null);
  const attempt = useRef<{ files: File[]; body: { requestId: string; photos: string[] } } | null>(null);
  const locked = disabled || working;
  const remaining = Math.max(0, 2 - photos.length);
  async function action(run: () => Promise<void>) {
    if (pending.current || disabled) return;
    pending.current = true; setWorking(true); onBusyChange(true); setError(""); setNotice("");
    try { await run(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Photos could not be updated. Your message has been kept."); }
    finally { pending.current = false; setWorking(false); onBusyChange(false); }
  }
  async function choose(files: FileList | null) {
    if (!files?.length || pending.current || disabled || attempt.current) return;
    const chosen = Array.from(files);
    if (chosen.length > remaining) { setError(`You can add ${remaining} more ${remaining === 1 ? "photo" : "photos"}. Remove an existing custom photo first if needed.`); return; }
    await action(async () => {
      const prepared = await Promise.all(chosen.map(prepareServicePhoto));
      attempt.current = { files: chosen, body: { requestId: requestUuid(), photos: prepared.map(photo => photo.base64) } };
      await sendPrepared();
    });
  }
  async function sendPrepared() {
    if (!attempt.current) return;
    const result = await customFetch<{ uploaded: string[] }>(`/api/staff/enquiries/${enquiryId}/photos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(attempt.current.body) });
    onChange({ customPhotoIds: [...new Set([...(selection.customPhotoIds ?? []), ...result.uploaded])] });
    attempt.current = null; await onRefresh(); setNotice("Photos added and selected. Review them before sending.");
  }
  async function makeQr() {
    await action(async () => {
      const result = await customFetch<{ id: string; url: string; expiresAt: string }>(`/api/staff/enquiries/${enquiryId}/photo-upload-session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setNow(Date.now()); setQr({ ...result, url: new URL(result.url, window.location.origin).href });
    });
  }
  const qrExpired = Boolean(qr && (!Number.isFinite(Date.parse(qr.expiresAt)) || Date.parse(qr.expiresAt) <= now));
  return <section className="enquiry-email-media" aria-label="Photos and video"><h3>Photos &amp; video</h3><p className="enquiry-email-hint">Choose what this customer needs. Nothing is sent until you approve the message.</p>
    {vehiclePhotos.length > 0 && <details><summary>Car photos <span>{selection.vehiclePhotoIndices?.length ?? 0} selected · up to 4</span></summary><p className="enquiry-email-hint">These are shared as links to the car’s existing photographs.</p><div className="enquiry-email-media-grid">{vehiclePhotos.map(photo => <label key={photo.index}><img src={getSafeImageUrl(photo.url)} alt={`Car photo ${photo.index + 1}`} loading="lazy" /><span><input type="checkbox" aria-label={`Include car photo ${photo.index + 1}`} checked={selection.vehiclePhotoIndices?.includes(photo.index) ?? false} disabled={locked || (!selection.vehiclePhotoIndices?.includes(photo.index) && (selection.vehiclePhotoIndices?.length ?? 0) >= 4)} onChange={event => onChange({ vehiclePhotoIndices: event.target.checked ? [...(selection.vehiclePhotoIndices ?? []), photo.index] : selection.vehiclePhotoIndices?.filter(index => index !== photo.index) ?? [] })} />Photo {photo.index + 1}</span></label>)}</div></details>}
    {videoAvailable && <label className="enquiry-email-video-choice"><input type="checkbox" checked={selection.includeVideo ?? false} disabled={locked} onChange={event => onChange({ includeVideo: event.target.checked })} /><span><strong>Include the published car video</strong><small>Adds a link the customer can open on their phone.</small></span></label>}
    <div className="enquiry-email-custom-photos"><h4>Custom photos <span>{photos.length}/2</span></h4><p className="enquiry-email-hint">For example, a close-up, tyre or interior detail. Photos are compressed below 500 KB each; camera location details are removed.</p>
      {photos.length > 0 && <div className="enquiry-email-media-grid">{photos.map((photo, index) => <div key={photo.id}><PrivatePhoto url={photo.url || `/api/staff/enquiries/${enquiryId}/photos/${photo.id}`} index={index} /><label><input type="checkbox" checked={selection.customPhotoIds?.includes(photo.id) ?? false} disabled={locked} onChange={event => onChange({ customPhotoIds: event.target.checked ? [...(selection.customPhotoIds ?? []), photo.id] : selection.customPhotoIds?.filter(id => id !== photo.id) ?? [] })} />Attach photo {index + 1} · {Math.ceil(photo.byteSize / 1024)} KB</label><Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => { if (!window.confirm("Remove this custom photo from the enquiry? Messages already sent remain unchanged.")) return; void action(async () => { await customFetch(`/api/staff/enquiries/${enquiryId}/photos/${photo.id}`, { method: "DELETE" }); onChange({ customPhotoIds: selection.customPhotoIds?.filter(id => id !== photo.id) ?? [] }); await onRefresh(); }); }}>Remove photo {index + 1}</Button></div>)}</div>}
      <div className="enquiry-email-media-actions"><input type="file" ref={input} hidden accept="image/*" multiple aria-label="Choose custom enquiry photos" disabled={locked || !remaining || Boolean(attempt.current)} onChange={event => { void choose(event.target.files); event.target.value = ""; }} /><Button type="button" variant="outline" disabled={locked || !remaining || Boolean(attempt.current)} onClick={() => input.current?.click()}><Camera size={17} aria-hidden="true" />Add custom photos</Button><Button type="button" variant="outline" disabled={locked || !remaining || Boolean(attempt.current)} onClick={() => void makeQr()}><QrCode size={17} aria-hidden="true" />Add photos from phone</Button><Button type="button" variant="outline" disabled={locked} onClick={() => void action(async () => { await onRefresh(); setNotice("Photos refreshed. Select the photos to include."); })}>Refresh photos</Button>{attempt.current && <Button type="button" disabled={locked} onClick={() => void action(sendPrepared)}>Retry same photo upload</Button>}</div>
      {qr && <div className="enquiry-email-upload-qr" role="region" aria-label="Phone photo upload QR">{!qrExpired && <QRCodeSVG value={qr.url} size={180} level="M" />}<div><strong>{qrExpired ? "Upload QR expired" : "Scan with your phone’s camera"}</strong><p>Take or choose up to two photos, upload them, then return here and tap Refresh photos.</p><p>Private upload link expires {new Date(qr.expiresAt).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })} UK time. It does not send anything to the customer.</p>{qrExpired ? <p role="status">Create a new upload QR above to continue. This link is no longer available.</p> : <a href={qr.url} target="_blank" rel="noreferrer">Open upload page</a>}<Button type="button" variant="outline" size="sm" disabled={locked} onClick={() => void action(async () => { await customFetch(`/api/staff/enquiries/${enquiryId}/photo-upload-session/${qr.id}`, { method: "DELETE" }); setQr(null); })}>Disable upload link</Button></div></div>}
    </div>{working && <p role="status" className="enquiry-email-hint">Preparing or updating photos…</p>}{notice && <p role="status" className="enquiry-email-save-state">{notice}</p>}{error && <p role="alert" className="enquiry-email-error">{error}</p>}
  </section>;
}
