import { WhatsAppConfirmation, type WhatsAppConfirmationRequest, type WhatsAppConfirmationResult } from "./whatsapp-confirmation";
import { useContext, useEffect, useId, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { QueryClientContext } from "@tanstack/react-query";
import { type WhatsAppTemplateId, type WhatsAppTemplateVariable } from "@workspace/vehicle-meta";
import { WhatsAppMessageEditor } from "./whatsapp-message-editor";
import { customFetch, getGetDealerSettingsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { customerWhatsAppUrl } from "@/lib/customer-whatsapp";
import { customerPhoneMessage } from "@/lib/customer-phone-message";
import { usePhoneSharingSettings } from "@/lib/phone-sharing-settings";
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
  | { kind: "reservation"; reservationId: string }
  | { kind: "message"; message: string; url?: string; enquiryId?: string; vehicleId?: string };
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
  enquiryId, customerName = "", customerEmail = "", vehicleId, templateVariables = {}, onEmailFallback,
}: {
  templateVariables?: Partial<Record<WhatsAppTemplateVariable, string>>;
  enquiryId?: string; customerName?: string; customerEmail?: string; vehicleId?: string; onEmailFallback?: (messageBody?: string) => void | Promise<void>;
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
  const cache = useContext(QueryClientContext);
  const availabilityId = useId();
  const sharingSettings = usePhoneSharingSettings(whatsapp);
  const sharingUnavailable = whatsapp && !sharingSettings.enabled;
  const [open, setOpen] = useState(false),
    [grant, setGrant] = useState<{
      id?: string;
      url: string;
      expiresAt?: string;
      preview?: boolean;
      message?: string;
      customerPhone?: string;
      hasAttachments?: boolean;
      messageBody?: string; requiredText?: string; templateId?: WhatsAppTemplateId; templateVariables?: Partial<Record<WhatsAppTemplateVariable, string>>; messageLinkRequired?: boolean;
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
  const [messageDirty,setMessageDirty] = useState(false);
  const longSource = useRef<PhoneShareSource|null>(null);
  const reviewedMessage = useRef<{body: string; templateId?: WhatsAppTemplateId}|null>(null);
  const editedAttempt = useRef<{key:string;requestId:string;token:string}|null>(null);
  const [recipientReady,setRecipientReady]=useState(false), [now,setNow]=useState(Date.now);
  useEffect(()=>{if(!open || !grant?.expiresAt)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(timer);},[open,grant?.expiresAt]);
  const confirmationAttempt = useRef<WhatsAppConfirmationRequest|null>(null);
  const attempt = useRef<{ requestId: string; token: string } | null>(null);
  const identity = JSON.stringify([source ?? url, whatsapp, customerPhone, message, enquiryId, customerName, customerEmail, vehicleId, templateVariables]);
  const current = useRef(identity);
  current.current = identity;
  useEffect(() => {
    setGrant(null);
    setMessageDirty(false); longSource.current = null; reviewedMessage.current = null; editedAttempt.current = null;
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
    if (sharingUnavailable) {
      // Disabling new shares must not strand a message already prepared/sent.
      if (grant && (!grant.expiresAt || Date.parse(grant.expiresAt) > Date.now())) return;
      setError("WhatsApp QR sharing is unavailable. Check Settings → Emails & documents → WhatsApp & QR, or use email instead."); return;
    }
    const expired = Boolean(grant?.expiresAt && Date.parse(grant.expiresAt) <= Date.now());
    if (expired) {
      setGrant(null); attempt.current = null;
      setConfirmationResult(null); setConfirmationLocked(false);
      confirmationAttempt.current = null; setRecipientReady(false);
      setEmailCustomer(null); setShareVersion(value => value + 1);
    }
    if (grant && !expired && !beforeGenerate) return;
    const key = identity;
    if ((url || (!source && message)) && !longSource.current) {
      setBusy(true);
      try {
        await beforeGenerate?.();
        if (current.current !== key) return;
        if (grant && !expired) return;
        const body = reviewedMessage.current?.body ?? message;
        if (!url) { setGrant({url:"", message:body, messageBody:body}); return; }
        const parsed = new URL(url, window.location.origin);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
        setGrant({ url: parsed.href, message:body, messageBody:body, requiredText:parsed.href });
      } catch {
        if (current.current === key) { setGrant(null); setError("This link is not available."); }
      } finally { setBusy(false); }
      return;
    }
    const effectiveSource = source || longSource.current;
    if (!effectiveSource) return;
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
      messageBody?: string; requiredText?: string; templateId?: WhatsAppTemplateId; templateVariables?: Partial<Record<WhatsAppTemplateVariable, string>>; messageLinkRequired?: boolean;
        enquiryId?: string; customerEmail?: string; customerName?: string; vehicleId?: string; title?: string;
      }>("/api/staff/phone-shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...attempt.current, source:effectiveSource, ...(reviewedMessage.current ? {messageBody:reviewedMessage.current.body, ...(reviewedMessage.current.templateId ? {templateId:reviewedMessage.current.templateId} : {})} : {}) }),
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
  async function updateMessage(body: string, templateId?: WhatsAppTemplateId) {
    if (busy || confirmationLocked || !grant) return;
    const key = identity;
    const editedSource = source || longSource.current;
    const complete = [body, grant.requiredText].filter(Boolean).join('\n\n');
    const directUrl = customerWhatsAppUrl("07700900123", complete);
    // Short, public link messages can stay local. Longer wording needs the
    // same authenticated phone preview used for private attachment packs.
    const needsPack = !!editedSource || Boolean(directUrl && new TextEncoder().encode(directUrl).length > 1900);
    if (!needsPack) { reviewedMessage.current = {body,templateId}; setGrant({...grant, message:body, messageBody:body}); setMessageDirty(false); return; }
    const nextSource = editedSource || {kind:'message' as const, message, ...(url?{url}:{}), ...(enquiryId?{enquiryId}:{}), ...(vehicleId?{vehicleId}:{})};
    if (sharingUnavailable) throw new Error('New WhatsApp sharing is off. Ask an owner to enable it before changing this pack.');
    const fingerprint = JSON.stringify([key,nextSource,body,templateId]);
    if (!editedAttempt.current || editedAttempt.current.key !== fingerprint) {
      editedAttempt.current = {key:fingerprint,requestId:crypto.randomUUID(),token:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')};
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const {key:_key,...request}=editedAttempt.current;
      const created=await customFetch<NonNullable<typeof grant>>('/api/staff/phone-shares',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,source:nextSource,messageBody:body,...(templateId?{templateId}:{})})});
      if (current.current !== key) return;
      if (created.messageBody === undefined) throw new Error('The updated server is needed to edit WhatsApp wording. Your original QR is unchanged.');
      longSource.current = nextSource; reviewedMessage.current = {body,templateId}; setGrant(created); setMessageDirty(false); setNotice('Message updated. Scan the new QR before sending.'); editedAttempt.current=null;
    } finally { setBusy(false); }
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
      longSource.current = null; reviewedMessage.current = null; editedAttempt.current = null; setMessageDirty(false);
      setNotice("Link revoked. It can no longer be opened.");
    } catch {
      setError("Could not revoke the link. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const sharedMessage = grant ? ((source || grant.id)
    ? customerPhoneMessage(grant.message || '', Boolean(grant.hasAttachments), grant.url)
    : `${grant.message || ''}${grant.message && grant.url ? '\n\n' : ''}${grant.url}`) : '';
  const whatsappUrl = grant && whatsapp ? customerWhatsAppUrl(phone, sharedMessage) : null;
  // Large emails cannot fit directly into a camera QR. The secure preview opens
  // the same full message on the phone instead of silently truncating it.
  const directQr = whatsappUrl && new TextEncoder().encode(whatsappUrl).length <= 2000;
  const qrUrl = whatsapp ? (whatsappUrl ? (directQr ? whatsappUrl : grant?.id ? `${grant!.url}?wa=${encodeURIComponent(phone)}` : null) : null) : grant?.url;
  const expired = Boolean(grant?.expiresAt && Date.parse(grant.expiresAt) <= now);
  const sharingBlocked = sharingUnavailable && (!grant || expired);
  const settingsFailed = sharingBlocked && sharingSettings.data === undefined && sharingSettings.isError;
  const sharingReason = sharingBlocked ? sharingSettings.data?.enabled === false
    ? "WhatsApp QR is turned off in Settings → Emails & documents → WhatsApp & QR. Use email instead."
    : settingsFailed
      ? "WhatsApp sharing could not be checked. Retry the settings check, or use email instead."
      : "Checking WhatsApp sharing settings…"
    : undefined;
  const localRecording = purpose === "record-video" && Boolean(grant?.url && ["localhost","127.0.0.1","[::1]"].includes(new URL(grant.url).hostname));
  async function useEmail() {
    if(onEmailFallback){try{await onEmailFallback(grant?.messageBody);setOpen(false);}catch{setError("Could not prepare the email. Your message is kept here.");}}
    else if (!grant || expired) setError("Create a fresh sharing link first so the email includes the correct message and document links.");
    else {setEmailFallback(true);setOpen(false);}
  }
  const dealerName = cache?.getQueryData<{identity?:{name?:string}}>(getGetDealerSettingsQueryKey())?.identity?.name || '';
  const serverVariables = Object.fromEntries(Object.entries(grant?.templateVariables ?? {}).filter(([,value]) => value?.trim()));
  const variables = {dealer_name:dealerName, customer_name:emailCustomer?.customerName || customerName || grant?.customerName || '', message:message, ...templateVariables, ...serverVariables};
  function shareWithAnotherCustomer() {
    if (!url) return;
    // One customer's personalised wording must not carry into the next enquiry.
    const publicUrl = new URL(url, window.location.origin).href;
    setGrant({url:publicUrl,message,messageBody:message,requiredText:publicUrl});
    reviewedMessage.current=null; longSource.current=null; editedAttempt.current=null; attempt.current=null;
    setMessageDirty(false);setConfirmationResult(null);setConfirmationLocked(false);setRecipientReady(false);
    confirmationAttempt.current=null;setEmailCustomer(null);setPhone('');setEmail('');setNotice('');setError('');setShareVersion(value=>value+1);
  }
  const qrContent = grant && !expired && <div className="phone-share-send-panel">
    {whatsapp && <details className="phone-share-message-preview"><summary>Review message</summary><pre className="phone-share-message">{sharedMessage}</pre></details>}
    {qrUrl && (!whatsapp || (recipientReady && !messageDirty)) && <>
      <div className="phone-share-qr"><QRCodeSVG value={qrUrl} size={220} marginSize={4} title={purpose==="record-video"?"Scan to record this car on your phone":whatsapp?"Scan to prepare the customer WhatsApp message":"Scan to open the sharing preview"}/></div>
      {whatsapp && !directQr && <p>This message is too long for a direct QR. Scan to open the full message on your phone, then choose Open WhatsApp.</p>}
    </>}
    {whatsapp && !recipientReady && !messageDirty && <p className="phone-share-step-note" role="status">Choose the customer enquiry and check the number to show the WhatsApp QR.</p>}
    {purpose==="record-video" && <p className="phone-share-step-note">Staff sign-in and permission to manage this car are required. This QR does not grant access.</p>}
    {localRecording && <p className="phone-share-step-note">This local preview link only opens on this computer. Use the live HTTPS website when scanning from a phone.</p>}
    {!whatsapp && purpose!=="record-video" && <p className="phone-share-step-note">{grant.expiresAt ? `Private link - expires ${new Date(grant.expiresAt).toLocaleString("en-GB")}. Anyone with the link can view the pack until then or until it is revoked.` : "Anyone with this link can open it. Check the recipient before forwarding."}</p>}
    <div className="phone-share-actions">
      {(!whatsapp || (whatsappUrl && recipientReady && !messageDirty)) && <><Button variant="outline" onClick={()=>void navigator.clipboard.writeText(whatsappUrl||grant.url).then(()=>setNotice("Link copied.")).catch(()=>setError("Copy is unavailable. Use Open below instead."))}>{whatsapp?"Copy WhatsApp link":"Copy link"}</Button><a className="phone-share-open" href={whatsappUrl||grant.url} target="_blank" rel="noreferrer">{purpose==="record-video"?"Open recording page":whatsapp?"Open WhatsApp":"Open preview"}</a></>}
    </div>
    {whatsapp && grant.expiresAt && <p className="phone-share-step-note">Attachment link expires {new Date(grant.expiresAt).toLocaleString("en-GB")}. Keep the link private.</p>}
  </div>;
  const trigger = <Button type="button" variant="outline" disabled={disabled || sharingBlocked} aria-describedby={sharingBlocked ? availabilityId : undefined} title={sharingReason} onClick={()=>void generate()}><QrCode size={17} aria-hidden="true"/>{label}</Button>;
  return <>
    {sharingBlocked ? <span className="phone-share-unavailable">{trigger}<span id={availabilityId} className="phone-share-availability" role="status">{sharingReason}{settingsFailed && <Button type="button" variant="ghost" disabled={sharingSettings.isFetching} onClick={()=>void sharingSettings.refetch()}>{sharingSettings.isFetching ? "Checking settings…" : "Retry WhatsApp settings"}</Button>}</span></span> : trigger}
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
      {grant.messageBody !== undefined && <WhatsAppMessageEditor body={grant.messageBody} requiredText={grant.requiredText} variables={variables} disabled={busy || confirmationLocked || Boolean(confirmationResult)} onDirtyChange={setMessageDirty} onApply={updateMessage} />}
      <WhatsAppConfirmation disabled={messageDirty || busy} key={shareVersion} enquiryId={enquiryId||grant.enquiryId||(source&&'enquiryId' in source?source.enquiryId:undefined)} customerName={customerName || grant.customerName} customerEmail={email} preferKnownCustomer={source?.kind === "document"} vehicleId={vehicleId || grant.vehicleId} phone={phone} message={sharedMessage} grantId={grant.id} attempt={confirmationAttempt} result={confirmationResult} onConfirmed={setConfirmationResult} onLock={setConfirmationLocked} onPhone={setPhone} onEmail={setEmail} onReadyChange={setRecipientReady} onCustomerChange={setEmailCustomer}>{qrContent}</WhatsAppConfirmation>
      {confirmationResult && !source && url && new URL(url,window.location.origin).pathname.startsWith('/vehicle/') && <Button type="button" variant="outline" onClick={shareWithAnotherCustomer}>Share with another customer</Button>}
    </> : qrContent)}
    {whatsapp && !confirmationLocked && <Button type="button" variant="outline" disabled={busy || messageDirty} onClick={()=>void useEmail()}>Use email instead</Button>}
    {grant?.id && !confirmationLocked && <details className="phone-share-link-options"><summary>Link options</summary><Button variant="outline" disabled={busy} onClick={()=>void revoke()}>Revoke link</Button></details>}
    {(!grant || expired) && !busy && (source||url||message) && <Button onClick={()=>void generate()}>{error?"Try again":"Create sharing link"}</Button>}
    </DialogContent></Dialog>
    <InternalShareEmail open={emailFallback&&!confirmationLocked} onOpenChange={setEmailFallback} subject={grant?.title||"Your car enquiry"} message={sharedMessage} enquiryId={emailCustomer?.enquiryId||enquiryId||grant?.enquiryId||(source&&'enquiryId' in source?source.enquiryId:undefined)} customerName={emailCustomer?.customerName||customerName||grant?.customerName} createNew={emailCustomer?.createNew} customerEmail={email} customerPhone={phone} vehicleId={vehicleId||grant?.vehicleId} grantId={grant?.id} expiresAt={grant?.expiresAt} verifyBeforePrepare={beforeGenerate}/>
  </>;
}
