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
      enquiryId?: string; customerEmail?: string; title?: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [phone, setPhone] = useState(customerPhone);
  const [email, setEmail] = useState(customerEmail), [emailFallback, setEmailFallback] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<WhatsAppConfirmationResult|null>(null), [confirmationLocked,setConfirmationLocked] = useState(false);
  const [shareVersion,setShareVersion]=useState(0);
  const confirmationAttempt = useRef<WhatsAppConfirmationRequest|null>(null);
  const attempt = useRef<{ requestId: string; token: string } | null>(null);
  const identity = JSON.stringify([source ?? url, whatsapp, customerPhone, message, enquiryId, customerEmail, vehicleId]);
  const current = useRef(identity);
  current.current = identity;
  useEffect(() => {
    setGrant(null);
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
        enquiryId?: string; customerEmail?: string; title?: string;
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
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => void generate()}
      >
        <QrCode size={17} />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="phone-share-dialog">
          <DialogHeader>
            <DialogTitle>{whatsapp ? "Send on WhatsApp" : "Share from your phone"}</DialogTitle>
            <DialogDescription>
              {whatsapp ? "Check the customer number and message, then scan with your phone camera to open WhatsApp. You still press Send yourself. QR creation does not record a sent message." : "Scan this code with your phone camera. Review the content, then choose how to share it with the customer. Nothing is sent automatically."}
            </DialogDescription>
          </DialogHeader>
          {busy && <p role="status">Preparing sharing link…</p>}
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {grant && (
            <>
              {grant.preview && (
                <p>
                  Fictional local preview only. No real customer document is
                  shared.
                </p>
              )}
              {whatsapp && <>
                <label>Customer WhatsApp number<Input type="tel" autoComplete="tel" value={phone} disabled={confirmationLocked} onChange={event => setPhone(event.target.value)} placeholder="07… or +country code" /></label>
                {!whatsappUrl && <p role="status">Enter a valid UK number or an international number starting with + and its country code.</p>}
                <pre className="phone-share-message">{sharedMessage}</pre>
                {whatsappUrl && !directQr && <p>{source ? "This message is too long for a direct WhatsApp QR. Scan to open the full message, then tap Open WhatsApp." : "This message is too long for a direct QR. Use Open WhatsApp to keep the full message."}</p>}
              </>}
              {qrUrl && <div className="phone-share-qr">
                <QRCodeSVG
                  value={qrUrl}
                  size={220}
                  marginSize={4}
                  title={whatsapp ? "Scan to prepare the customer WhatsApp message" : "Scan to open the sharing preview"}
                />
              </div>}
              <p>

                {grant.expiresAt
                  ? `Private link · expires ${new Date(grant.expiresAt).toLocaleString("en-GB")}. Anyone with this link can view this sharing pack until it expires or is revoked.`
                  : grant.url ? "Anyone with this link can open it. Check the recipient before forwarding." : "Check the recipient before sending."}
              </p>
              <div className="phone-share-actions">
                {(!whatsapp || whatsappUrl) && <><Button
                  variant="outline"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(whatsappUrl || grant.url)
                      .then(() => setNotice("Link copied."))
                      .catch(() =>
                        setError(
                          "Copy is unavailable. Open the preview and copy its address.",
                        ),
                      )
                  }
                >
                  {whatsapp ? "Copy WhatsApp link" : "Copy link"}
                </Button>
                <a
                  className="phone-share-open"
                  href={whatsappUrl || grant.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {whatsapp && whatsappUrl ? "Open WhatsApp" : "Open preview"}
                </a>
                </>}
                {grant.id && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void revoke()}
                  >
                    Revoke link
                  </Button>
                )}
              </div>
              {whatsapp && <>
                <WhatsAppConfirmation key={shareVersion} enquiryId={enquiryId || grant.enquiryId || (source && 'enquiryId' in source ? source.enquiryId : undefined)} customerName={customerName} vehicleId={vehicleId} phone={phone} message={sharedMessage} grantId={grant.id} attempt={confirmationAttempt} result={confirmationResult} onConfirmed={setConfirmationResult} onLock={setConfirmationLocked} onPhone={setPhone} onEmail={setEmail} />
                {confirmationResult && !source && url && new URL(url,window.location.origin).pathname.startsWith('/vehicle/') && <Button type="button" variant="outline" onClick={()=>{setConfirmationResult(null);setConfirmationLocked(false);confirmationAttempt.current=null;setPhone('');setEmail('');setShareVersion(value=>value+1);}}>Share with another customer</Button>}
                {!confirmationLocked && <Button type="button" variant="outline" disabled={busy} onClick={async()=>{ if(onEmailFallback){try{await onEmailFallback();setOpen(false);}catch{setError('Could not prepare the email. Your message is kept here.');}}else setEmailFallback(true); }}>Use email instead</Button>}
                {emailFallback && !confirmationLocked && <div className="phone-share-email-fallback"><label>Customer email<Input type="email" value={email} onChange={event=>setEmail(event.target.value)} /></label><p>Opens your email app with the same message and attachment links. Review it there before sending.</p>{/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && <a href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(grant.title || 'Your car enquiry')}&body=${encodeURIComponent(sharedMessage)}`}>Prepare email</a>}</div>}
              </>}
            </>
          )}
          {!grant && !busy && (source || url || message) && (
            <Button onClick={() => void generate()}>Create sharing link</Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
