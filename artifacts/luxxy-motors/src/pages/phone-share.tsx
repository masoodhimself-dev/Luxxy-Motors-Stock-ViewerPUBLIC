import { customerWhatsAppNumber, customerWhatsAppUrl } from "@/lib/customer-whatsapp";
import { useEffect, useRef, useState } from "react";
import { customerPhoneMessage } from "@/lib/customer-phone-message";
import { Button } from "@/components/ui/button";
import "@/components/share-qr.css";
export type Pack = {
  stockChange?: { taskId: string; revision: number };
  customerPhone?: string;
  title: string;
  message: string;
  expiresAt: string;
  files: { filename: string; content: string; contentType: string }[];
};
export function sharedFile(file: Pack["files"][number]) {
  const raw = atob(file.content);
  return new File(
    [Uint8Array.from(raw, (char) => char.charCodeAt(0))],
    file.filename,
    { type: file.contentType },
  );
}
/** Refreshes the same capability immediately before a price-message handoff.
 * A changed pack is rejected rather than silently replacing staff-reviewed text.
 */
export async function verifiedPriceWhatsAppUrl({ pack, hash, baseUrl, currentHash, signal }: {
  pack: Pack; hash: string; baseUrl: string; currentHash: () => string; signal?: AbortSignal;
}): Promise<string> {
  const token = hash.slice(1).split('?')[0];
  const stillCurrent = () => {
    if (signal?.aborted || currentHash() !== hash) throw new DOMException('This QR changed.', 'AbortError');
  };
  stillCurrent();
  if (!pack.stockChange || !/^[a-f0-9]{64}$/.test(token)) throw new Error('This price-update link is incomplete. Ask staff for a fresh QR.');
  const response = await fetch('/api/phone-shares', {
    credentials: 'omit', headers: { 'x-phone-share-token': token }, cache: 'no-store', referrerPolicy: 'no-referrer', signal,
  });
  const latest = await response.json() as Pack & { error?: string };
  stillCurrent();
  if (!response.ok) throw new Error(latest.error || 'This price update is no longer available. Ask staff for a fresh QR.');
  if (!Array.isArray(pack.files) || !Array.isArray(latest.files) || typeof latest.message !== 'string')
    throw new Error('This price update could not be confirmed. Ask staff for a fresh QR.');
  const identity = (value: Pack) => JSON.stringify([
    value.stockChange?.taskId, value.stockChange?.revision, value.title, value.message,
    customerWhatsAppNumber(value.customerPhone ?? ''), value.expiresAt,
    Array.isArray(value.files) ? value.files.map(file => [file.filename, file.contentType, file.content]) : null,
  ]);
  if (!latest.stockChange || identity(latest) !== identity(pack)) throw new Error('This price update or its customer details have changed. Ask staff to review it and create a fresh QR.');
  if (![pack.expiresAt, latest.expiresAt].every(value => Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now()))
    throw new Error('This price-update link has expired. Ask staff for a fresh QR.');
  const confirmedNumber = customerWhatsAppNumber(latest.customerPhone ?? '');
  const selectedNumber = new URLSearchParams(hash.split('?')[1] || '').get('wa');
  if (!confirmedNumber || (selectedNumber !== null && customerWhatsAppNumber(selectedNumber) !== confirmedNumber))
    throw new Error('This price update belongs to a different or invalid customer number. Ask staff to review it and create a fresh QR.');
  const number = latest.customerPhone || '';
  const message = customerPhoneMessage(latest.message, latest.files.length > 0, `${baseUrl}${hash}`.split('?wa=')[0]);
  const url = customerWhatsAppUrl(number, message);
  if (!url) throw new Error('The customer number could not be confirmed. Ask staff for a fresh WhatsApp QR.');
  stillCurrent();
  return url;
}

export default function PhoneShare() {
  const [shareHash, setShareHash] = useState(() => window.location.hash);
  const currentHash = useRef(shareHash);
  const activeRequest = useRef<AbortController | null>(null);
  const handoffRequest = useRef<AbortController | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffFailed, setHandoffFailed] = useState(false);
  const [pack, setPack] = useState<Pack | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(timer);},[]);
  useEffect(() => {
    const rescan = () => {
      const nextHash = window.location.hash;
      if (nextHash === currentHash.current) return;
      // A new QR can reuse this browser tab. Clear the previous customer's
      // content before checking the new link, including when that link fails.
      activeRequest.current?.abort();
      handoffRequest.current?.abort(); handoffRequest.current = null;
      setHandoffBusy(false); setHandoffFailed(false);
      currentHash.current = nextHash;
      setPack(null); setError(""); setNotice(""); setShareHash(nextHash);
    };
    window.addEventListener("hashchange", rescan);
    return () => { window.removeEventListener("hashchange", rescan); handoffRequest.current?.abort(); };
  }, []);
  useEffect(() => {
    document.title = "Customer sharing preview";
    const token = shareHash.slice(1).split("?")[0];
    const controller = new AbortController();
    activeRequest.current = controller;
    if (!/^[a-f0-9]{64}$/.test(token)) {
      setError("This sharing link is incomplete. Scan a fresh QR code.");
      return;
    }
    void fetch("/api/phone-shares", {
      credentials: "omit",
      headers: { "x-phone-share-token": token },
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "This sharing link is unavailable.");
        if (!controller.signal.aborted) setPack(data);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to open the sharing pack.",
          );
      });
    return () => { controller.abort(); if (activeRequest.current === controller) activeRequest.current = null; };
  }, [shareHash]);
  async function openPriceWhatsApp() {
    if (!pack?.stockChange || handoffRequest.current || handoffFailed) return;
    const hash = currentHash.current;
    const controller = new AbortController();
    handoffRequest.current = controller;
    setHandoffBusy(true); setError(''); setNotice('');
    try {
      const url = await verifiedPriceWhatsAppUrl({ pack, hash, baseUrl: `${window.location.origin}${window.location.pathname}${window.location.search}`, currentHash: () => currentHash.current, signal: controller.signal });
      if (!controller.signal.aborted && currentHash.current === hash) window.location.assign(url);
    } catch (cause) {
      if (!controller.signal.aborted && currentHash.current === hash) {
        setHandoffFailed(true);
        setError(cause instanceof Error ? `${cause.message} Nothing was opened or sent.` : 'The current price could not be checked. Ask staff for a fresh QR. Nothing was opened or sent.');
      }
    } finally {
      if (handoffRequest.current === controller) handoffRequest.current = null;
      if (currentHash.current === hash) setHandoffBusy(false);
    }
  }
  async function share() {
    if (!pack) return;
    const requestHash = currentHash.current;
    try {
      const files = pack.files.map(sharedFile);
      if (files.length && navigator.canShare?.({ files })) {
        await navigator.share({ title: pack.title, text: sharedMessage, files });
      } else if (navigator.share) {
        await navigator.share({
          title: pack.title,
          text: sharedMessage,
        });
      } else {
        await navigator.clipboard.writeText(
          sharedMessage,
        );
        if (currentHash.current === requestHash) setNotice("Message and link copied. Paste them into your chosen app.");
        return;
      }
      if (currentHash.current === requestHash) setNotice("Check the chosen app to confirm whether it was sent.");
    } catch (cause) {
      if (currentHash.current === requestHash && !(cause instanceof DOMException && cause.name === "AbortError"))
        setError(
          "Sharing is unavailable here. Download the files or copy the message instead.",
        );
    }
  }
  async function copyMessage() {
    const requestHash = currentHash.current;
    try {
      await navigator.clipboard.writeText(sharedMessage);
      if (currentHash.current === requestHash) setNotice("Message copied.");
    } catch {
      if (currentHash.current === requestHash) setError("Copy is unavailable in this browser.");
    }
  }
  function download(file: Pack["files"][number]) {
    const url = URL.createObjectURL(sharedFile(file));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  const number = pack?.stockChange ? pack.customerPhone || '' : new URLSearchParams(shareHash.split('?')[1] || '').get('wa') || pack?.customerPhone || '';
  const expired=Boolean(pack && Date.parse(pack.expiresAt)<=now);
  const recipient=customerWhatsAppNumber(number);
  const packUrl = `${window.location.origin}${window.location.pathname}${window.location.search}${shareHash}`;
  const sharedMessage = pack ? customerPhoneMessage(pack.message, pack.files.length > 0, packUrl.split('?wa=')[0]) : '';
  const whatsappUrl = pack && !expired ? customerWhatsAppUrl(number, sharedMessage) : null;
  return (
    <main className="phone-share-page">
      <p className="phone-share-kicker">Private customer message</p>
      <h1>{pack?.title || "Open your sharing pack"}</h1>
      <p>
        This link contains customer information. Check the recipient before
        forwarding it. Scanning or opening it does not send anything.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!pack && !error && <p role="status">Opening sharing pack…</p>}
      {expired && <p role="alert" className="phone-share-step-note">This link has expired. Ask the dealership for a fresh link.</p>}
      {pack && !expired && !handoffFailed && (
        <>
          {whatsappUrl && <div className="phone-share-recipient-card"><span>WhatsApp recipient</span><strong>+{recipient}</strong>{pack.stockChange ? <Button type="button" disabled={handoffBusy} onClick={() => void openPriceWhatsApp()}>{handoffBusy ? 'Checking current price…' : 'Check price & open WhatsApp'}</Button> : <a className="phone-share-open" href={whatsappUrl} target="_blank" rel="noreferrer">Open WhatsApp</a>}<p>Check the number and message in WhatsApp, then tap Send yourself.</p></div>}
          {pack.stockChange && <p className="phone-share-step-note">The current price and customer are checked again when you open WhatsApp. Staff must still review the message and tap Send.</p>}
          <details className="phone-share-full-message" open><summary>Message</summary><pre>{sharedMessage}</pre></details>
          <div className="phone-share-files">
            {pack.files.map((file) => (
              <article key={file.filename}>
                <strong>{file.filename}</strong>
                <br />
                <Button variant="outline" disabled={handoffBusy} onClick={() => download(file)}>
                  Download {file.filename}
                </Button>
              </article>
            ))}
          </div>
          <div className="phone-share-actions">
            {!pack.stockChange && <><Button variant="outline" onClick={() => void share()}>Other sharing options</Button>
            <Button
              variant="outline"
              onClick={() => void copyMessage()}
            >
              Copy message
            </Button></>}
            {!whatsappUrl && <p>{pack.stockChange ? 'No valid customer phone number. Ask staff for a fresh WhatsApp QR.' : 'No valid customer phone number. Ask staff for a new WhatsApp QR or use the other sharing options.'}</p>}
          </div>
          <p className="phone-share-staff-note">For staff: after sending, return to the signed-in sharing window and choose “I’ve sent it” to save the message in the enquiry history. This page cannot confirm delivery.</p>
          <p>
            Link expires {new Date(pack.expiresAt).toLocaleString("en-GB")}. The
            dealership can revoke it sooner.
          </p>
        </>
      )}
    </main>
  );
}
