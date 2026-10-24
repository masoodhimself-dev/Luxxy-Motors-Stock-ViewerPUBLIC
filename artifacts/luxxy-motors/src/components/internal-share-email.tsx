import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { customerWhatsAppNumber } from "@/lib/customer-whatsapp";

// Public car galleries also use ShareQr; load the staff composer only on demand.
const EnquiryEmailComposer = lazy(() => import("@/components/portal/enquiry-email-composer").then(module => ({ default: module.EnquiryEmailComposer })));

type Customer = { id: string; requestedEnquiryId?: string; customerName: string; phone?: string; email?: string; vehicleTitle?: string };
type Preparation = {
  requestId: string; enquiryId?: string; newCustomer?: { name: string; email?: string };
  vehicleId?: string; grantId?: string; phone?: string; email: string;
};
type Prepared = { enquiry: { id: string; customerName: string; reference?: string }; customerEmail: string };
export type ShareEmailCustomer = { enquiryId?: string; customerName: string; createNew?: boolean };
type Props = {
  open: boolean; onOpenChange: (open: boolean) => void;
  subject: string; message: string; enquiryId?: string; customerName?: string; createNew?: boolean;
  customerEmail?: string; customerPhone?: string; vehicleId?: string; grantId?: string; expiresAt?: string;
  verifyBeforePrepare?: () => Promise<void>;
};
const validEmail = (email: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
const prepare = (body: Preparation) => customFetch<Prepared>("/api/staff/phone-shares/email-enquiry", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

/** Opens the existing reviewed email flow. Resolving a recipient never sends or logs a WhatsApp message. */
export function InternalShareEmail({ open, onOpenChange, subject, message, enquiryId, customerName = "", createNew = false, customerEmail = "", customerPhone = "", vehicleId, grantId, expiresAt, verifyBeforePrepare }: Props) {
  const [search, setSearch] = useState(customerName || customerPhone), [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState(enquiryId || ""), [create, setCreate] = useState(createNew), [name, setName] = useState(customerName), [email, setEmail] = useState(customerEmail);
  const [loading, setLoading] = useState(true), [canCreate, setCanCreate] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [lookupRetry, setLookupRetry] = useState(0), [lookupError, setLookupError] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const attempt = useRef<Preparation | null>(null), currentEmail = useRef(email);
  currentEmail.current = email;
  const identity = JSON.stringify([enquiryId, customerName, createNew, customerEmail, customerPhone, vehicleId, grantId, subject, message]);
  useEffect(() => {
    setSearch(customerName || customerPhone); setSelected(enquiryId || ""); setCreate(createNew); setName(customerName); setEmail(customerEmail);
    setPrepared(null); setError(""); attempt.current = null;
  }, [identity]);
  useEffect(() => {
    if (!open || prepared) return;
    let current = true;
    setLoading(true); setLookupError("");
    const lookup = () => {
      void customFetch<{ enquiries: Customer[]; canCreate?: boolean }>(`/api/staff/phone-shares/enquiries?${enquiryId ? `id=${encodeURIComponent(enquiryId)}` : `q=${encodeURIComponent(search)}`}`)
        .then(data => {
          if (!current) return;
          const rows = data.enquiries || [];
          setCustomers(rows); setCanCreate(data.canCreate === true);
          const customer = enquiryId ? rows.find(item => item.id === enquiryId || item.requestedEnquiryId === enquiryId) : undefined;
          if (customer?.email && !currentEmail.current.trim()) setEmail(customer.email);
          if (enquiryId && !customer) setLookupError("This enquiry could not be found. Reopen the current customer record.");
        })
        .catch(() => { if (current) setLookupError("Customer details could not be checked. Try again."); })
        .finally(() => { if (current) setLoading(false); });
    };
    const timer = enquiryId ? (lookup(), undefined) : setTimeout(lookup, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [open, prepared, enquiryId, search, lookupRetry]);
  const locked = Boolean(attempt.current);
  const requestedId = enquiryId || selected;
  const customer = customers.find(item => item.id === requestedId || item.requestedEnquiryId === requestedId);
  const selectedId = customer?.id || requestedId;
  const expired = Boolean(expiresAt && Date.parse(expiresAt) <= Date.now());
  const ready = !expired && validEmail(email) && !loading && !lookupError && (create ? canCreate && name.trim().length >= 2 : Boolean(customer));
  async function begin() {
    if (busy || (!locked && !ready)) return;
    const body = attempt.current || {
      requestId: crypto.randomUUID(),
      ...(create ? { newCustomer: { name: name.trim(), email: email.trim() } } : { enquiryId: selectedId }),
      ...(vehicleId ? { vehicleId } : {}), ...(grantId ? { grantId } : {}),
      ...(customerWhatsAppNumber(customerPhone) ? { phone: customerPhone } : {}), email: email.trim(),
    };
    attempt.current = body; setBusy(true); setError("");
    try { await verifyBeforePrepare?.(); setPrepared(await prepare(body)); }
    catch (cause) { setError((cause as { data?: { error?: string } })?.data?.error || "The email could not be prepared. Retry here; no email or WhatsApp message was sent."); }
    finally { setBusy(false); }
  }
  if (prepared) return <Suspense fallback={<p role="status">Opening email draft…</p>}><EnquiryEmailComposer
    entry={{ ...prepared.enquiry, reference: prepared.enquiry.reference || "" }}
    initialRecipient={prepared.customerEmail}
    suggestedContent={{ label: "Shared message", subject, message, applyLabel: "Use this shared message", includeVehicle: false, templateId: "enquiry_message" }}
    verifyContext={async () => { await verifyBeforePrepare?.(); if (attempt.current) await prepare(attempt.current); }}
    onClose={() => { setPrepared(null); onOpenChange(false); }}
  /></Suspense>;
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}><DialogContent className="phone-share-dialog"><DialogHeader>
    <DialogTitle>Prepare customer email</DialogTitle><DialogDescription>Use the dealership email system. Review the message and any document links before sending.</DialogDescription>
  </DialogHeader><div className="phone-share-confirmation">
    {enquiryId ? <p>Save the email against {customer?.customerName || customerName || "this customer’s enquiry"}.</p> : <>
      <label>Find customer enquiry<Input value={search} disabled={locked} placeholder="Name, phone or email" onChange={event => { setSearch(event.target.value); setSelected(""); setCreate(false); }}/></label>
      <label>Save against enquiry<NativeSelect value={selected} disabled={locked || loading || create} onChange={event => { setSelected(event.target.value); const chosen = customers.find(item => item.id === event.target.value); if (chosen?.email && !email.trim()) setEmail(chosen.email); }}><option value="">Choose the customer’s enquiry</option>{customers.map(item => <option key={item.id} value={item.id}>{item.customerName}{item.vehicleTitle ? ` — ${item.vehicleTitle}` : ""}</option>)}</NativeSelect></label>
      {canCreate && (!selected || create) && <label className="phone-share-create"><input type="checkbox" checked={create} disabled={locked || loading} onChange={event => { setCreate(event.target.checked); setSelected(""); }}/>Create a new enquiry instead</label>}
      {create && <label>Customer name<Input value={name} maxLength={200} disabled={locked} onChange={event => setName(event.target.value)}/></label>}
    </>}
    <label>Customer email<Input type="email" value={email} autoComplete="email" maxLength={254} disabled={locked} onChange={event => setEmail(event.target.value)}/></label>
    <p>The original message and document links will be kept. Nothing is sent or marked as sent until you approve the email in the next screen.</p>
    {loading && <p role="status">Checking customer details…</p>}
    {lookupError && <div><p role="alert">{lookupError}</p><Button variant="outline" onClick={() => setLookupRetry(value => value + 1)}>Retry customer lookup</Button></div>}
    {expired && <p role="alert">This sharing link has expired. Create a fresh link before preparing the email.</p>}
    {error && <p role="alert">{error}</p>}
    <Button type="button" disabled={busy || expired || (!locked && !ready)} onClick={() => void begin()}>{busy ? "Preparing email…" : locked ? "Retry email preparation" : "Continue to email"}</Button>
  </div></DialogContent></Dialog>;
}

export function InternalShareEmailButton({ label = "Email customer", ...props }: Omit<Props, "open" | "onOpenChange"> & { label?: string }) {
  const [open, setOpen] = useState(false);
  return <><Button type="button" variant="outline" onClick={() => setOpen(true)}>{label}</Button><InternalShareEmail {...props} open={open} onOpenChange={setOpen}/></>;
}
