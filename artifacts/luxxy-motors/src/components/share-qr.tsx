import { WhatsAppConfirmation, type WhatsAppConfirmationRequest, type WhatsAppConfirmationResult } from "./whatsapp-confirmation";
import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { customerWhatsAppUrl } from "@/lib/customer-whatsapp";
import { Input } from "@/components/ui/input";
import { QrCode } from "@/components/icons";
import { InternalShareEmail, type ShareEmailCustomer } from "@/components/internal-share-email";
import "./share-qr.css";
export type PhoneShareSource =
  | {
      kind: "document";
      saleId: string;
      documentId: string;
      taxReference?: string;
    }
  | { kind: "enquiry"; enquiryId: string; draft: unknown; previewHash: string }
  | { kind: "enquiry-message"; enquiryId: string; draft: unknown }
  | { kind: "reservation"; reservationId: string };
export function ShareQr({
  url,
  purpose,
  source,
  label = "Share by QR",
  disabled = false,
  beforeGenerate,
  whatsapp = false,
  customerPhone = "",
  message = "",
  enquiryId, customerName = "", customerEmail = "", vehicleId, onEmailFallback,
}: {
  enquiryId?: string; customerName?: string; customerEmail?: string; vehicleId?: string; onEmailFallback?: () => void | Promise<void>;
  whatsapp?: boolean;
  customerPhone?: string;
  message?: string;
  url?: string;
  purpose?: "record-video";
  source?: PhoneShareSource;
  label?: string;
  disabled?: boolean;
  beforeGenerate?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [grant, setGrant] = useState<{
      id?: string;
      url: string;
      expiresAt?: string;
      preview?: boolean;
      message?: string;
      customerPhone?: string;
      hasAttachments?: boolean;
      enquiryId?: string; customerEmail?: string; customerName?: string; vehicleId?: string; title?: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [phone, setPhone] = useState(customerPhone);
  const [email, setEmail] = useState(customerEmail), [emailFallback, setEmailFallback] = useState(false);
  const [emailCustomer,setEmailCustomer]=useState<ShareEmailCustomer|null>(null);
  const [confirmationResult, setConfirmationResult] = useState<WhatsAppConfirmationResult|null>(null), [confirmationLocked,setConfirmationLocked] = useState(false);
  const [shareVersion,setShareVersion]=useState(0);
  const [recipientReady,setRecipientReady]=useState(false), [now,setNow]=useState(Date.now);
  useEffect(()=>{if(!open || !grant?.expiresAt)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(timer);},[open,grant?.expiresAt]);
  const confirmationAttempt = useRef<WhatsAppConfirmationRequest|null>(null);
  const attempt = useRef<{ requestId: string; token: string } | null>(null);
  const identity = JSON.stringify([source ?? url, whatsapp, customerPhone, message, enquiryId, customerEmail, vehicleId]);
  const current = useRef(identity);
  current.current = identity;
  useEffect(() => {
    setGrant(null);
    setRecipientReady(false);
    setEmailCustomer(null);
    setPhone(customerPhone);
    setEmail(customerEmail); setEmailFallback(false); setConfirmationResult(null); setConfirmationLocked(false); confirmationAttempt.current=null;
    attempt.current = null;
    setError("");
    setNotice("");
  }, [identity]);
  async function generate() {
    setOpen(true);
    setError("");
    setNotice("");
    if (busy) return;
    const expired = Boolean(grant?.expiresAt && Date.parse(grant.expiresAt) <= Date.now());
    if (expired) { setGrant(null); attempt.current = null; }
    if (grant && !expired && !beforeGenerate) return;
    const key = identity;
    if (url || (!source && message)) {
      setBusy(true);
      try {
        await beforeGenerate?.();
        if (current.current !== key) return;
        if (!url) { setGrant({url:"", message}); return; }
        const parsed = new URL(url, window.location.origin);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
        setGrant({ url: parsed.href, message });
      } catch {
        if (current.current === key) { setGrant(null); setError("This link is not available."); }
      } finally { setBusy(false); }
      return;
    }
    if (!source) return;
    setBusy(true);
    try {
      await beforeGenerate?.();
      if (current.current !== key) return;
      if (grant && !expired) return;
      if (!attempt.current) {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        attempt.current = {
          requestId: crypto.randomUUID(),
          token: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
            "",
          ),
        };
      }
      const created = await customFetch<{
        id: string;
        url: string;
        expiresAt: string;
        preview?: boolean;
        message?: string;
        customerPhone?: string;
        hasAttachments?: boolean;
        enquiryId?: string; customerEmail?: string; customerName?: string; vehicleId?: string; title?: string;
      }>("/api/staff/phone-shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...attempt.current, source }),
      });
      if (whatsapp && (!created.message || typeof created.hasAttachments !== "boolean")) throw new Error("WhatsApp sharing needs the updated server. Nothing was sent.");
      if (current.current === key) { setGrant(created); setPhone(customerPhone || created.customerPhone || ""); setEmail(customerEmail || created.customerEmail || ""); }
    } catch (cause) {
      if (current.current === key) {
        setGrant(null);
        setError(
          cause instanceof Error
            ? cause.message
            : "The QR code could not be created. Nothing was sent.",
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    if (!grant?.id) return;
    setBusy(true);
    try {
      await customFetch(`/api/staff/phone-shares/${grant.id}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setGrant(null);
      attempt.current = null;
      setNotice("Link revoked. It can no longer be opened.");
    } catch {
      setError("Could not revoke the link. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const sharedMessage = grant ? (source
    ? `${grant.message || ''}${grant.hasAttachments ? `\n\nView your documents and photos (available for 24 hours):\n${grant.url}` : ''}`
    : `${message}${message && grant.url ? '\n\n' : ''}${grant.url}`) : '';
  const whatsappUrl = grant && whatsapp ? customerWhatsAppUrl(phone, sharedMessage) : null;
  // Large emails cannot fit directly into a camera QR. The secure preview opens
  // the same full message on the phone instead of silently truncating it.
  const directQr = whatsappUrl && new TextEncoder().encode(whatsappUrl).length <= 2000;
  const qrUrl = whatsapp ? (whatsappUrl ? (directQr ? whatsappUrl : source ? `${grant!.url}?wa=${encodeURIComponent(phone)}` : null) : null) : grant?.url;
  const expired = Boolean(grant?.expiresAt && Date.parse(grant.expiresAt) <= now);
  const localRecording = purpose === "record-video" && Boolean(grant?.url && ["localhost","127.0.0.1","[::1]"].includes(new URL(grant.url).hostname));
  async function useEmail() {
    if(onEmailFallback){try{await onEmailFallback();setOpen(false);}catch{setError("Could not prepare the email. Your message is kept here.");}}
    else if (!grant || expired) setError("Create a fresh sharing link first so the email includes the correct message and document links.");
    else {setEmailFallback(true);setOpen(false);}
  }
  const qrContent = grant && !expired && <div className="phone-share-send-panel">
    {whatsapp && <details className="phone-share-message-preview"><summary>Review message</summary><pre className="phone-share-message">{sharedMessage}</pre></details>}
    {qrUrl && (!whatsapp || recipientReady) && <>
      <div className="phone-share-qr"><QRCodeSVG value={qrUrl} size={220} marginSize={4} title={purpose==="record-video"?"Scan to record this car on your phone":whatsapp?"Scan to prepare the customer WhatsApp message":"Scan to open the sharing preview"}/></div>
      {whatsapp && !directQr && <p>This message is too long for a direct QR. Scan to open the full message on your phone, then choose Open WhatsApp.</p>}
    </>}
    {whatsapp && !recipientReady && <p className="phone-share-step-note" role="status">Choose the customer enquiry and check the number to show the WhatsApp QR.</p>}
    {purpose==="record-video" && <p className="phone-share-step-note">Staff sign-in and permission to manage this car are required. This QR does not grant access.</p>}
    {localRecording && <p className="phone-share-step-note">This local preview link only opens on this computer. Use the live HTTPS website when scanning from a phone.</p>}
    {!whatsapp && purpose!=="record-video" && <p className="phone-share-step-note">{grant.expiresAt ? `Private link - expires ${new Date(grant.expiresAt).toLocaleString("en-GB")}. Anyone with the link can view the pack until then or until it is revoked.` : "Anyone with this link can open it. Check the recipient before forwarding."}</p>}
    <div className="phone-share-actions">
      {(!whatsapp || (whatsappUrl && recipientReady)) && <><Button variant="outline" onClick={()=>void navigator.clipboard.writeText(whatsappUrl||grant.url).then(()=>setNotice("Link copied.")).catch(()=>setError("Copy is unavailable. Use Open below instead."))}>{whatsapp?"Copy WhatsApp link":"Copy link"}</Button><a className="phone-share-open" href={whatsappUrl||grant.url} target="_blank" rel="noreferrer">{purpose==="record-video"?"Open recording page":whatsapp?"Open WhatsApp":"Open preview"}</a></>}
    </div>
    {whatsapp && grant.expiresAt && <p className="phone-share-step-note">Attachment link expires {new Date(grant.expiresAt).toLocaleString("en-GB")}. Keep the link private.</p>}
  </div>;
  return <>
    <Button type="button" variant="outline" disabled={disabled} onClick={()=>void generate()}><QrCode size={17} aria-hidden="true"/>{label}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className={`phone-share-dialog ${whatsapp?"phone-share-whatsapp-dialog":""}`}><DialogHeader>
      <DialogTitle>{purpose==="record-video"?"Record on your phone":whatsapp?"Send on WhatsApp":"Share from your phone"}</DialogTitle>
      <DialogDescription>{purpose==="record-video"?"Scan, sign in and record this car. Your video stays private until you review and publish it.":whatsapp?"Choose the customer, scan to send from your phone, then record that you’ve sent it.":"Scan to open the message and documents on your phone. You choose how to share them. Nothing sends automatically."}</DialogDescription>
    </DialogHeader>
    {busy && <p role="status">Preparing sharing link…</p>}
    {error && <p role="alert" className="phone-share-step-note">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {expired && <div role="alert" className="phone-share-step-note">This sharing link has expired. Create a fresh link before sending it.</div>}
    {grant?.preview && <p className="phone-share-step-note">Fictional local preview. No real customer document is shared.</p>}
    {grant && !expired && (whatsapp ? <>
      <label className="phone-share-recipient">Customer WhatsApp number<Input type="tel" autoComplete="tel" value={phone} disabled={confirmationLocked} onChange={event=>setPhone(event.target.value)} placeholder="07… or +country code"/></label>
      {!whatsappUrl && <p role="status">Enter a valid UK number, or an international number starting with + and its country code.</p>}
      <WhatsAppConfirmation key={shareVersion} enquiryId={enquiryId||grant.enquiryId||(source&&'enquiryId' in source?source.enquiryId:undefined)} customerName={customerName || grant.customerName} customerEmail={email} preferKnownCustomer={source?.kind === "document"} vehicleId={vehicleId || grant.vehicleId} phone={phone} message={sharedMessage} grantId={grant.id} attempt={confirmationAttempt} result={confirmationResult} onConfirmed={setConfirmationResult} onLock={setConfirmationLocked} onPhone={setPhone} onEmail={setEmail} onReadyChange={setRecipientReady} onCustomerChange={setEmailCustomer}>{qrContent}</WhatsAppConfirmation>
      {confirmationResult && !source && url && new URL(url,window.location.origin).pathname.startsWith('/vehicle/') && <Button type="button" variant="outline" onClick={()=>{setConfirmationResult(null);setConfirmationLocked(false);setRecipientReady(false);confirmationAttempt.current=null;setPhone('');setEmail('');setShareVersion(value=>value+1);}}>Share with another customer</Button>}
    </> : qrContent)}
    {whatsapp && !confirmationLocked && <Button type="button" variant="outline" disabled={busy} onClick={()=>void useEmail()}>Use email instead</Button>}
    {grant?.id && !confirmationLocked && <details className="phone-share-link-options"><summary>Link options</summary><Button variant="outline" disabled={busy} onClick={()=>void revoke()}>Revoke link</Button></details>}
    {(!grant || expired) && !busy && (source||url||message) && <Button onClick={()=>void generate()}>{error?"Try again":"Create sharing link"}</Button>}
    </DialogContent></Dialog>
    <InternalShareEmail open={emailFallback&&!confirmationLocked} onOpenChange={setEmailFallback} subject={grant?.title||"Your car enquiry"} message={sharedMessage} enquiryId={emailCustomer?.enquiryId||enquiryId||grant?.enquiryId||(source&&'enquiryId' in source?source.enquiryId:undefined)} customerName={emailCustomer?.customerName||customerName||grant?.customerName} createNew={emailCustomer?.createNew} customerEmail={email} customerPhone={phone} vehicleId={vehicleId||grant?.vehicleId} grantId={grant?.id} expiresAt={grant?.expiresAt} verifyBeforePrepare={beforeGenerate}/>
  </>;
}
